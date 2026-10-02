import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { TxnType, FINANCIAL_ROLES } from '@tingting/shared';
import { PARTNER_DEFAULT_CURRENCY } from './legal-partner.service';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
} from './governance-action-core.service';
import type { GovernanceApplyResult } from './governance-transition.service';

type DualEntityCandidate = {
  customerId: number;
  customerName: string;
  supplierId: number;
  partnerId: number | null;
  eligible: boolean;
  eligibilityReason: string | null;
};

function debtOffsetStatusVersion(status: string): number {
  switch (status) {
    case 'PENDING':
      return 1;
    case 'APPROVED':
      return 2;
    case 'CANCELED':
      return 3;
    default:
      throw new ApiError(409, `Trạng thái đối trừ công nợ không hợp lệ: ${status}`);
  }
}

function assertDebtOffsetStatusVersion(status: string, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  const actualVersion = debtOffsetStatusVersion(status);
  if (actualVersion !== expectedVersion) {
    throw new ApiError(409, 'Bản ghi đối trừ đã thay đổi. Vui lòng tải lại.');
  }
}

async function loadCounterparties(
  tx: Tx,
  customerId: number,
  supplierId: number,
) {
  const [customer] = await tx.select({
    id: s.customers.id,
    partnerId: s.customers.partnerId,
  })
    .from(s.customers)
    .where(eq(s.customers.id, customerId))
    .limit(1);
  const [supplier] = await tx.select({
    id: s.suppliers.id,
    partnerId: s.suppliers.partnerId,
  })
    .from(s.suppliers)
    .where(eq(s.suppliers.id, supplierId))
    .limit(1);

  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
  if (!supplier) throw new ApiError(404, 'Không tìm thấy nhà cung cấp');
  return { customer, supplier };
}

function assertEligibleCanonicalPair(
  customerPartnerId: number | null,
  supplierPartnerId: number | null,
  currency: string,
): number {
  if (currency !== PARTNER_DEFAULT_CURRENCY) {
    throw new ApiError(400, 'Chỉ hỗ trợ đối trừ thủ công cùng loại tiền VND');
  }
  if (customerPartnerId == null || supplierPartnerId == null) {
    throw new ApiError(400, 'Khách hàng và nhà cung cấp phải có cùng mã số thuế chuẩn hóa để đối trừ');
  }
  if (customerPartnerId !== supplierPartnerId) {
    throw new ApiError(400, 'Khách hàng và nhà cung cấp không cùng pháp nhân theo mã số thuế');
  }
  return customerPartnerId;
}

/**
 * List all customers that have a dual-role supplier pairing,
 * with current AR and AP balances and computed net/offset amounts.
 */
export async function getDualEntities() {
  const customers = await db
    .select({
      customerId: s.customers.id,
      customerName: s.customers.name,
      partnerId: s.customers.partnerId,
      linkedSupplierId: s.customers.linkedSupplierId,
    })
    .from(s.customers)
    .where(and(isNull(s.customers.deletedAt)));
  const suppliers = await db
    .select({
      supplierId: s.suppliers.id,
      partnerId: s.suppliers.partnerId,
    })
    .from(s.suppliers)
    .where(and(isNull(s.suppliers.deletedAt)));

  const supplierById = new Map(suppliers.map((supplier) => [supplier.supplierId, supplier]));
  const suppliersByPartner = new Map<number, Array<{ supplierId: number; partnerId: number | null }>>();
  for (const supplier of suppliers) {
    if (supplier.partnerId == null) continue;
    const rows = suppliersByPartner.get(supplier.partnerId) ?? [];
    rows.push(supplier);
    suppliersByPartner.set(supplier.partnerId, rows);
  }

  const seen = new Set<string>();
  const pairs: DualEntityCandidate[] = [];
  for (const customer of customers) {
    const explicitSupplier = customer.linkedSupplierId != null
      ? supplierById.get(customer.linkedSupplierId)
      : undefined;
    const inferredSuppliers = customer.partnerId != null
      ? suppliersByPartner.get(customer.partnerId) ?? []
      : [];
    const chosenSupplier = explicitSupplier
      ?? (inferredSuppliers.length === 1 ? inferredSuppliers[0] : undefined);
    if (!chosenSupplier) continue;

    const key = `${customer.customerId}:${chosenSupplier.supplierId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const eligible = customer.partnerId != null
      && chosenSupplier.partnerId != null
      && customer.partnerId === chosenSupplier.partnerId;
    pairs.push({
      customerId: customer.customerId,
      customerName: customer.customerName,
      supplierId: chosenSupplier.supplierId,
      partnerId: customer.partnerId ?? chosenSupplier.partnerId ?? null,
      eligible,
      eligibilityReason: eligible
        ? null
        : 'Cặp khách hàng/nhà cung cấp chưa cùng pháp nhân theo mã số thuế chuẩn hóa',
    });
  }

  // Single batch query instead of N individual getBalance() calls
  const balanceEntries = pairs.flatMap(row => [
    { entityType: 'CUSTOMER' as const, entityId: row.customerId },
    { entityType: 'VENDOR' as const, entityId: row.supplierId },
  ]);
  const balances = await LedgerService.getBalancesBatch(balanceEntries);

  return pairs.map(row => {
    const arBalance = balances.get(`CUSTOMER:${row.customerId}`) ?? 0;
    const apBalance = balances.get(`VENDOR:${row.supplierId}`) ?? 0;
    return {
      customerId: row.customerId,
      customerName: row.customerName,
      supplierId: row.supplierId,
      partnerId: row.partnerId,
      currency: PARTNER_DEFAULT_CURRENCY,
      eligible: row.eligible,
      eligibilityReason: row.eligibilityReason,
      arBalance,
      apBalance,
      netBalance: arBalance - apBalance,
      offsetAmount: Math.min(arBalance, apBalance),
    };
  });
}

/**
 * Record a debt offset and its paired ledger entries atomically.
 * Amount is server-computed as min(AR, AP); no pending approval is persisted.
 * Returns 400 if offset amount <= 0.
 */
export async function createDebtOffset(input: {
  customerId: number;
  supplierId: number;
  offsetDate: string;
  currency: 'VND';
  note: string;
  minutesReference: string;
  minutesDocumentHash?: string | null;
  createdBy: number;
  actorRole: string;
  transaction?: Tx;
}) {
  if (!(FINANCIAL_ROLES as readonly string[]).includes(input.actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền ghi nhận đối trừ công nợ');
  }
  const execute = async (tx: Tx) => {
    const note = input.note.trim();
    const minutesReference = input.minutesReference.trim();
    if (!note) {
      throw new ApiError(400, 'Lý do đối trừ không được để trống');
    }
    if (!minutesReference) {
      throw new ApiError(400, 'Biên bản đối trừ là bắt buộc');
    }

    // Lock both entities to prevent TOCTOU race
    await LedgerService.lockEntities(tx, [
      { entityType: 'CUSTOMER', entityId: input.customerId },
      { entityType: 'VENDOR',   entityId: input.supplierId },
    ]);

    const { customer, supplier } = await loadCounterparties(tx, input.customerId, input.supplierId);
    const partnerId = assertEligibleCanonicalPair(
      customer.partnerId,
      supplier.partnerId,
      input.currency,
    );

    const arBalance = await LedgerService.getBalanceTx(tx, 'CUSTOMER', input.customerId);
    const apBalance = await LedgerService.getBalanceTx(tx, 'VENDOR', input.supplierId);
    const amount = Math.min(arBalance, apBalance);

    if (amount <= 0) {
      throw new ApiError(400, 'Không có số dư để đối trừ (số tiền đối trừ phải > 0)');
    }

    const [row] = await tx
      .insert(s.debtOffsets)
      .values({
        customerId: input.customerId,
        supplierId: input.supplierId,
        partnerId,
        amount: String(amount),
        offsetDate: input.offsetDate,
        currency: input.currency,
        minutesReference,
        minutesDocumentHash: input.minutesDocumentHash ?? null,
        note,
        // Legacy storage code means recorded; it is not an approval stage.
        approvalStatus: 'APPROVED',
        approvedBy: input.createdBy,
        approvedAt: new Date(),
        createdBy: input.createdBy,
      })
      .returning();
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: row.id,
      entityType: 'CUSTOMER',
      entityId: input.customerId,
      debit: 0,
      credit: amount,
      note: 'Đối trừ công nợ khách hàng và nhà cung cấp',
    });
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: row.id,
      entityType: 'VENDOR',
      entityId: input.supplierId,
      debit: amount,
      credit: 0,
      note: 'Đối trừ công nợ khách hàng và nhà cung cấp',
    });
    return row;
  };
  return runInTx(input.transaction, execute);
}

/** Reverse a recorded offset with compensating entries, preserving history. */
export async function cancelDebtOffset(
  id: number,
  actorId: number,
  actorRole: string,
  transaction?: Tx,
) {
  // Direct reversal retains the financial role guard.
  if (!(FINANCIAL_ROLES as readonly string[]).includes(actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền hủy đối trừ công nợ');
  }

  const execute = async (tx: Tx) => {
    const [offset] = await tx
      .select()
      .from(s.debtOffsets)
      .where(eq(s.debtOffsets.id, id))
      .limit(1)
      .for('update');

    if (!offset) {
      throw new ApiError(404, 'Không tìm thấy bản ghi đối trừ');
    }
    if (offset.approvalStatus === 'CANCELED') {
      throw new ApiError(409, 'Bản ghi đã hủy, không thể hoàn tác lại');
    }
    if (offset.approvalStatus !== 'APPROVED') {
      // Legacy unposted rows have no financial effect to reverse.
      throw new ApiError(
        400,
        `Không thể hủy bản ghi đang ở ${offset.approvalStatus}; chỉ đối trừ đã ghi nhận mới có thể đảo`,
      );
    }

    const amount = Number(offset.amount);

    const [claimed] = await tx
      .update(s.debtOffsets)
      .set({ approvalStatus: 'CANCELED' })
      .where(and(
        eq(s.debtOffsets.id, id),
        eq(s.debtOffsets.approvalStatus, 'APPROVED'),
      ))
      .returning();

    if (!claimed) {
      throw new ApiError(409, 'Bản ghi đã bị hủy bởi người khác. Vui lòng tải lại.');
    }

    // Reverse the original paired entries.
    // DEBIT on customer: restores AR (CUSTOMER balance += debit − credit).
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: id,
      entityType: 'CUSTOMER',
      entityId: offset.customerId,
      debit: amount,
      credit: 0,
      note: 'Hoàn tác đối trừ công nợ khách hàng và nhà cung cấp',
    });

    // CREDIT on vendor: restores AP (VENDOR balance += credit − debit).
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: id,
      entityType: 'VENDOR',
      entityId: offset.supplierId,
      debit: 0,
      credit: amount,
      note: 'Hoàn tác đối trừ công nợ khách hàng và nhà cung cấp',
    });

    return claimed;
  };
  return runInTx(transaction, execute);
}

/**
 * List debt offsets, optionally filtered by customer/supplier.
 */
export async function listDebtOffsets(filters?: {
  customerId?: number;
  supplierId?: number;
  approvalStatus?: string;
}) {
  const conditions = [];
  if (filters?.customerId) conditions.push(eq(s.debtOffsets.customerId, filters.customerId));
  if (filters?.supplierId) conditions.push(eq(s.debtOffsets.supplierId, filters.supplierId));
  if (filters?.approvalStatus) conditions.push(eq(s.debtOffsets.approvalStatus, filters.approvalStatus));

  return db
    .select()
    .from(s.debtOffsets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(s.debtOffsets.createdAt));
}

export async function requestDebtOffsetCancelGovernance(input: {
  debtOffsetId: number;
  expectedVersion: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('DEBT_OFFSET_CANCEL', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) {
    throw new ApiError(400, 'Lý do là bắt buộc');
  }

  const execute = async (tx: Tx) => {
    const [offset] = await tx.select()
      .from(s.debtOffsets)
      .where(eq(s.debtOffsets.id, input.debtOffsetId))
      .limit(1)
      .for('update');
    if (!offset) {
      throw new ApiError(404, 'Không tìm thấy bản ghi đối trừ');
    }
    assertDebtOffsetStatusVersion(offset.approvalStatus, input.expectedVersion);
    if (offset.approvalStatus !== 'APPROVED') {
      throw new ApiError(409, 'Chỉ có thể đảo đối trừ đã được ghi nhận');
    }

    return buildGovernanceAction({
      subjectType: 'DEBT_OFFSET',
      subjectId: offset.id,
      subjectKey: `debt-offset:${offset.id}:cancel`,
      actionKind: 'DEBT_OFFSET_CANCEL',
      reason,
      originalVersion: input.expectedVersion,
      beforeSnapshot: {
        approvalStatus: offset.approvalStatus,
        customerId: offset.customerId,
        supplierId: offset.supplierId,
        partnerId: offset.partnerId,
        amount: offset.amount,
        currency: offset.currency,
        offsetDate: offset.offsetDate,
        note: offset.note,
        minutesReference: offset.minutesReference,
        minutesDocumentHash: offset.minutesDocumentHash,
        approvedBy: offset.approvedBy,
        approvedAt: offset.approvedAt?.toISOString() ?? null,
      },
      afterSnapshot: {
        approvalStatus: 'CANCELED',
      },
      deltaSnapshot: {
        amount: offset.amount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyDebtOffsetGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (action.subjectType !== 'DEBT_OFFSET' || action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu quản trị không có đối tượng đối trừ hợp lệ');
  }

  const [offset] = await tx.select()
    .from(s.debtOffsets)
    .where(eq(s.debtOffsets.id, action.subjectId))
    .limit(1)
    .for('update');
  if (!offset) {
    throw new ApiError(404, 'Không tìm thấy bản ghi đối trừ');
  }
  assertDebtOffsetStatusVersion(offset.approvalStatus, action.originalVersion!);

  if (action.actionKind === 'DEBT_OFFSET_CANCEL') {
    const canceled = await cancelDebtOffset(
      offset.id,
      action.approverId!,
      action.approverRole!,
      tx,
    );
    return {
      applicationResult: {
        subjectType: 'DEBT_OFFSET',
        subjectId: canceled.id,
        approvalStatus: 'CANCELED',
        resultingVersion: debtOffsetStatusVersion('CANCELED'),
      },
    };
  }

  throw new ApiError(409, 'Loại yêu cầu không thuộc đối trừ công nợ');
}
