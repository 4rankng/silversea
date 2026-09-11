import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { TxnType, round2dp } from '@tingting/shared';
import type { CommissionInput } from '@tingting/shared';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
} from './governance-action-core.service';

/** Result of recording a commission — exposes the ledger row for audit. */
export interface CommissionResult {
  ok: true;
  ledgerId: number;
  newBalance: number;
}

type CommissionStoredResult = CommissionResult & { id: number };

function buildCommissionReason(input: CommissionInput): string {
  return input.note?.trim() || 'Đề nghị ghi nhận hoa hồng nhà cung cấp';
}

function buildCommissionSubjectKey(input: CommissionInput): string {
  return `supplier:${input.supplierId}:commission:${Date.parse('1970-01-01T00:00:00Z') + Number(input.amount)}:${input.tripId ?? 0}:${(input.note?.trim() || '').slice(0, 24)}`;
}

async function getLatestVendorLedgerVersionTx(tx: Tx, supplierId: number): Promise<number> {
  const [row] = await tx.select({ id: s.ledger.id })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      eq(s.ledger.entityId, supplierId),
    ))
    .orderBy(sql`${s.ledger.id} desc`)
    .limit(1);
  return row?.id ?? 0;
}

async function recordCommissionTx(tx: Tx, input: CommissionInput): Promise<CommissionStoredResult> {
  const [supplier] = await tx.select({ id: s.suppliers.id })
    .from(s.suppliers)
    .where(and(eq(s.suppliers.id, input.supplierId), isNull(s.suppliers.deletedAt)))
    .limit(1);
  if (!supplier) {
    throw new ApiError(404, 'Không tìm thấy nhà cung cấp — có thể đã bị xóa');
  }

  const inserted = await LedgerService.postEntry(tx, {
    txnType: TxnType.COMMISSION,
    txnId: input.tripId,
    entityType: 'VENDOR',
    entityId: input.supplierId,
    debit: 0,
    credit: round2dp(Number(input.amount)),
    note: input.note?.trim() || 'Hoa hồng',
  });
  return {
    ok: true,
    id: inserted.id,
    ledgerId: inserted.id,
    newBalance: Number(inserted.balance),
  };
}

async function loadCommissionResultTx(tx: Tx, ledgerId: number): Promise<CommissionStoredResult> {
  const [row] = await tx.select({
    id: s.ledger.id,
    balance: s.ledger.balance,
  }).from(s.ledger)
    .where(eq(s.ledger.id, ledgerId))
    .limit(1);
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy bút toán hoa hồng');
  }
  return {
    ok: true,
    id: row.id,
    ledgerId: row.id,
    newBalance: Number(row.balance),
  };
}

/**
 * Record a manual commission payable owed to a supplier.
 *
 * Posts a single COMMISSION ledger row on the supplier's VENDOR ledger:
 * credit = amount (increases the supplier's payable balance per the
 * VENDOR sign convention in LedgerService.postEntry).
 *
 * Verifies the supplier exists (and isn't soft-deleted) inside the tx — a
 * typo'd id would otherwise create a phantom payable invisible in aging
 * (the supplier join `continue`s on miss). Returns the ledger row id +
 * resulting balance for audit traceability.
 *
 * Not trip-scoped — `tripId` is passed through as optional `txnId` context.
 */
export async function recordCommission(input: CommissionInput): Promise<CommissionResult> {
  const result = await db.transaction((tx) => recordCommissionTx(tx, input));
  return {
    ok: result.ok,
    ledgerId: result.ledgerId,
    newBalance: result.newBalance,
  };
}

export async function recordCommissionIdempotent(args: {
  input: CommissionInput;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}): Promise<{ result: CommissionResult; replayed: boolean }> {
  const payload = {
    supplierId: args.input.supplierId,
    amount: Number(args.input.amount),
    tripId: args.input.tripId ?? null,
    note: args.input.note?.trim() || '',
  };

  const { result, replayed } = await runIdempotent<CommissionStoredResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.COMMISSIONS_CREATE,
    idempotencyKey: args.idempotencyKey,
    payload,
    createdBy: args.createdBy ?? null,
    entityType: 'ledger',
    create: async (tx) => recordCommissionTx(tx, args.input),
    load: async (entityId, tx) => loadCommissionResultTx(tx, entityId),
  });

  return {
    replayed,
    result: {
      ok: result.ok,
      ledgerId: result.ledgerId,
      newBalance: result.newBalance,
    },
  };
}

export async function requestCommissionGovernance(input: {
  commission: CommissionInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('COMMISSION', input.makerRole);

  const execute = async (tx: Tx) => {
    const [supplier] = await tx.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(and(eq(s.suppliers.id, input.commission.supplierId), isNull(s.suppliers.deletedAt)))
      .limit(1);
    if (!supplier) {
      throw new ApiError(404, 'Không tìm thấy nhà cung cấp — có thể đã bị xóa');
    }

    await LedgerService.lockEntity(tx, 'VENDOR', input.commission.supplierId);
    const currentBalance = await LedgerService.getBalanceTx(tx, 'VENDOR', input.commission.supplierId);
    const currentVersion = await getLatestVendorLedgerVersionTx(tx, input.commission.supplierId);

    return buildGovernanceAction({
      subjectType: 'COMMISSION',
      subjectId: null,
      subjectKey: buildCommissionSubjectKey(input.commission),
      actionKind: 'COMMISSION',
      reason: buildCommissionReason(input.commission),
      originalVersion: currentVersion,
      beforeSnapshot: {
        supplierId: input.commission.supplierId,
        currentBalance,
        currentVersion,
      },
      afterSnapshot: {
        supplierId: input.commission.supplierId,
        amount: Number(input.commission.amount),
        tripId: input.commission.tripId ?? null,
        note: input.commission.note?.trim() || '',
      },
      deltaSnapshot: {
        vendorBalanceDelta: Number(input.commission.amount),
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyCommissionGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  if (action.actionKind !== 'COMMISSION' || action.subjectType !== 'COMMISSION') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc hoa hồng');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const supplierId = Number(afterSnapshot?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    throw new ApiError(409, 'Yêu cầu hoa hồng không có nhà cung cấp hợp lệ');
  }

  await LedgerService.lockEntity(tx, 'VENDOR', supplierId);
  const currentVersion = await getLatestVendorLedgerVersionTx(tx, supplierId);
  if (currentVersion !== action.originalVersion) {
    throw new ApiError(409, 'Công nợ nhà cung cấp đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const result = await recordCommissionTx(tx, {
    supplierId,
    amount: Number(afterSnapshot?.amount),
    tripId: afterSnapshot?.tripId == null ? undefined : Number(afterSnapshot.tripId),
    note: typeof afterSnapshot?.note === 'string' ? afterSnapshot.note : undefined,
  });

  return {
    ledgerEntryId: result.ledgerId,
    applicationResult: {
      ledgerId: result.ledgerId,
      supplierId,
      newBalance: result.newBalance,
    },
  };
}
