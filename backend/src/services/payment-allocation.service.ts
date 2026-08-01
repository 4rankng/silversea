import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import type { PaymentAllocationMethod, PaymentReceiptResult } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent, hashPayload } from './idempotency.service';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  insertTreasuryMovement,
  appendTreasuryReversal,
  resolveTreasuryPaymentContract,
  type ResolvedTreasuryPaymentContract,
  type TreasuryPaymentFields,
} from './treasury.service';

const MAX_PAYMENT_INSTRUCTIONS = 200;
const MAX_DEFAULT_AUTO_ALLOCATIONS = 200;
const MAX_WHOLE_VND = 999_999_999_999_999;

export interface PaymentInstruction {
  tripId: number;
  amount: number;
}

export interface PaymentReceiptInput extends TreasuryPaymentFields {
  customerId: number;
  receiptId: string;
  amount?: number;
  payments?: PaymentInstruction[];
  allocatedBy?: number | null;
}

interface NormalizedPaymentReceiptInput {
  customerId: number;
  receiptId: string;
  receivedAmount: number;
  payments: PaymentInstruction[] | null;
  allocationMethod: PaymentAllocationMethod;
  requestHash: string;
  allocatedBy: number | null;
  treasury: ResolvedTreasuryPaymentContract;
}

interface PersistedPaymentReceiptResult extends PaymentReceiptResult {
  created: boolean;
}

export interface PaymentReceiptMutationResult {
  result: PaymentReceiptResult;
  replayed: boolean;
}

export interface PaymentRefundRequest {
  paymentReceiptId: number;
  amount: number;
  reason: string;
  makerId: number;
  makerRole: string;
}

type GovernanceActionRow = typeof s.governanceActions.$inferSelect;

function toPublicPaymentReceiptResult(result: PersistedPaymentReceiptResult): PaymentReceiptResult {
  return {
    id: result.id,
    receiptId: result.receiptId,
    customerId: result.customerId,
    receivedAmount: result.receivedAmount,
    allocations: result.allocations,
    allocatedTotal: result.allocatedTotal,
    unappliedAmount: result.unappliedAmount,
    refundedAmount: result.refundedAmount,
    version: result.version,
    allocationMethod: result.allocationMethod,
    createdAt: result.createdAt,
  };
}

function buildPaymentReceiptReason(receiptId: string): string {
  return `Đề nghị ghi nhận phiếu thu ${receiptId}`;
}

function buildPaymentReceiptSubjectKey(input: NormalizedPaymentReceiptInput): string {
  return `customer:${input.customerId}:receipt:${input.receiptId}`;
}

function assertPositiveWholeAmount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, `${field} phải là số nguyên dương hợp lệ`);
  }
  if (value > MAX_WHOLE_VND) {
    throw new ApiError(400, `${field} vượt quá giới hạn số tiền cho phép`);
  }
}

function normalizePaymentInstructions(payments: PaymentInstruction[] | undefined): PaymentInstruction[] | null {
  if (!payments || payments.length === 0) return null;
  if (payments.length > MAX_PAYMENT_INSTRUCTIONS) {
    throw new ApiError(400, `payments chỉ được tối đa ${MAX_PAYMENT_INSTRUCTIONS} dòng`);
  }
  const normalized = payments.map((payment) => ({
    tripId: Number(payment.tripId),
    amount: Number(payment.amount),
  }));
  const seen = new Set<number>();
  for (const payment of normalized) {
    if (!Number.isInteger(payment.tripId) || payment.tripId <= 0) {
      throw new ApiError(400, 'tripId phải là số nguyên dương');
    }
    assertPositiveWholeAmount(payment.amount, 'amount');
    if (seen.has(payment.tripId)) {
      throw new ApiError(400, 'Mỗi chuyến chỉ được xuất hiện một lần trong payments');
    }
    seen.add(payment.tripId);
  }
  return normalized;
}

function normalizePaymentReceiptInput(
  input: PaymentReceiptInput,
  treasury: ResolvedTreasuryPaymentContract = {
    treasuryAccountId: null,
    valueDate: null,
    physicalReference: null,
    paymentContractVersion: 1,
  },
): NormalizedPaymentReceiptInput {
  const customerId = Number(input.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new ApiError(400, 'customerId không hợp lệ');
  }

  const receiptId = input.receiptId.trim();
  if (!receiptId) {
    throw new ApiError(400, 'Thiếu mã biên lai (receiptId)');
  }

  const payments = normalizePaymentInstructions(input.payments);
  const explicitTotal = payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0;
  const receivedAmount = input.amount !== undefined ? Number(input.amount) : explicitTotal;
  assertPositiveWholeAmount(receivedAmount, 'amount');

  if (!payments && input.amount === undefined) {
    throw new ApiError(400, 'Cần cung cấp amount hoặc payments');
  }
  if (payments && input.amount !== undefined && explicitTotal > receivedAmount) {
    throw new ApiError(400, 'Tổng payments.amount không được lớn hơn amount');
  }

  const allocationMethod: PaymentAllocationMethod = payments ? 'EXPLICIT' : 'OLDEST_DUE';
  const baseRequestPayload = {
    customerId,
    receiptId,
    amount: receivedAmount,
    payments,
  };
  const requestHash = hashPayload(
    treasury.treasuryAccountId == null
      ? baseRequestPayload
      : { ...baseRequestPayload, treasury },
  );

  return {
    customerId,
    receiptId,
    receivedAmount,
    payments,
    allocationMethod,
    requestHash,
    allocatedBy: input.allocatedBy ?? null,
    treasury,
  };
}

function compareDueOrder(
  a: { effectiveDueDate: string; issueTimestamp: string; tripId: number; ledgerId: number },
  b: { effectiveDueDate: string; issueTimestamp: string; tripId: number; ledgerId: number },
): number {
  if (a.effectiveDueDate !== b.effectiveDueDate) {
    return a.effectiveDueDate.localeCompare(b.effectiveDueDate);
  }
  if (a.issueTimestamp !== b.issueTimestamp) {
    return a.issueTimestamp.localeCompare(b.issueTimestamp);
  }
  if (a.ledgerId !== b.ledgerId) {
    return a.ledgerId - b.ledgerId;
  }
  return a.tripId - b.tripId;
}

function effectiveDueDate(processingDueDate: string | null, originalDueDate: string | null, issueTimestamp: string) {
  return processingDueDate ?? originalDueDate ?? issueTimestamp.slice(0, 10);
}

async function assertActiveCustomerTx(tx: Tx, customerId: number): Promise<void> {
  const [customer] = await tx.select({
    id: s.customers.id,
    status: s.customers.status,
    deletedAt: s.customers.deletedAt,
  }).from(s.customers)
    .where(eq(s.customers.id, customerId))
    .limit(1)
    .for('update');

  if (!customer || customer.deletedAt != null) {
    throw new ApiError(404, 'Khách hàng không tồn tại');
  }
  if (customer.status !== 'ACTIVE') {
    throw new ApiError(422, 'Khách hàng đã bị khóa và không thể ghi nhận thanh toán');
  }
}

type TripAuthoritySnapshot = {
  sourceTripId: number;
  targetType: 'TRIP' | 'BILLING_DOCUMENT';
  targetId: number;
  billingDocumentId: number | null;
  originalDueDate: string | null;
  processingDueDate: string | null;
  effectiveDueDate: string;
  issueTimestamp: string;
  ledgerId: number;
};

type BillingDocumentAuthoritySnapshot = {
  documentId: number;
  sourceTripId: number;
  originalDueDate: string | null;
  processingDueDate: string | null;
  effectiveDueDate: string;
  issueTimestamp: string;
};

type CustomerPaymentLedgerRowInput = {
  txnId: number;
  receiptId: string;
  credit: number;
  note: string;
};

async function getTripReceivableState(
  tx: Tx,
  customerId: number,
  tripIds?: number[],
) {
  const tripRows = await tx.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
  }).from(s.trips)
    .where(and(
      eq(s.trips.customerId, customerId),
      isNull(s.trips.deletedAt),
      tripIds && tripIds.length > 0 ? inArray(s.trips.id, tripIds) : undefined,
    ));
  const resolvedTripIds = tripRows.map((trip) => trip.tripId);
  const tripCodeById = new Map(tripRows.map((trip) => [trip.tripId, trip.tripCode || '']));
  const authorityByTripId = new Map<number, TripAuthoritySnapshot>();
  const outstandingByTargetKey = new Map<string, number>();

  if (resolvedTripIds.length === 0) {
    return { resolvedTripIds, tripCodeById, authorityByTripId, outstandingByTargetKey };
  }

  const authorityRows = await tx.select({
    tripId: s.ledger.txnId,
    ledgerId: s.ledger.id,
    issueTimestamp: s.ledger.timestamp,
    originalDueDate: s.ledger.originalDueDate,
    processingDueDate: s.ledger.processingDueDate,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      inArray(s.ledger.txnId, resolvedTripIds),
      sql`${s.ledger.txnType} IN ('TRIP_REVENUE', 'ADJUSTMENT')`,
    ));

  for (const row of authorityRows) {
    if (row.tripId == null) continue;
    const issueTimestamp = new Date(row.issueTimestamp).toISOString();
    const candidate: TripAuthoritySnapshot = {
      sourceTripId: row.tripId,
      targetType: 'TRIP',
      targetId: row.tripId,
      billingDocumentId: null,
      originalDueDate: row.originalDueDate,
      processingDueDate: row.processingDueDate,
      effectiveDueDate: effectiveDueDate(row.processingDueDate, row.originalDueDate, issueTimestamp),
      issueTimestamp,
      ledgerId: row.ledgerId,
    };
    const current = authorityByTripId.get(row.tripId);
    if (
      !current
      || compareDueOrder(
        {
          effectiveDueDate: candidate.effectiveDueDate,
          issueTimestamp: candidate.issueTimestamp,
          tripId: candidate.sourceTripId,
          ledgerId: candidate.ledgerId,
        },
        {
          effectiveDueDate: current.effectiveDueDate,
          issueTimestamp: current.issueTimestamp,
          tripId: current.sourceTripId,
          ledgerId: current.ledgerId,
        },
      ) < 0
    ) {
      authorityByTripId.set(row.tripId, candidate);
    }
  }

  const directOutstandingRows = await tx.select({
    tripId: s.ledger.txnId,
    outstanding: sql<string>`coalesce(sum(${s.ledger.debit}), 0) - coalesce(sum(${s.ledger.credit}), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      inArray(s.ledger.txnId, resolvedTripIds),
      sql`${s.ledger.txnType} IN ('TRIP_REVENUE', 'PAYMENT_RECEIVED', 'ADJUSTMENT', 'UNLOCK_REVERSAL')`,
    ))
    .groupBy(s.ledger.txnId);

  const directOutstandingByTripId = new Map<number, number>();
  for (const row of directOutstandingRows) {
    if (row.tripId == null) continue;
    directOutstandingByTripId.set(row.tripId, Math.max(0, Number(row.outstanding ?? 0)));
  }

  const documentRows = await tx.select({
    documentId: s.billingDocuments.id,
    sourceTripId: s.billingDocumentLines.sourceId,
    originalDueDate: s.billingDocuments.originalDueDate,
    processingDueDate: s.billingDocuments.processingDueDate,
    issuedAt: s.billingDocuments.issuedAt,
    createdAt: s.billingDocuments.createdAt,
  })
    .from(s.billingDocumentLines)
    .innerJoin(s.billingDocuments, eq(s.billingDocuments.id, s.billingDocumentLines.documentId))
    .where(and(
      eq(s.billingDocumentLines.sourceType, 'TRIP'),
      inArray(s.billingDocumentLines.sourceId, resolvedTripIds),
      eq(s.billingDocuments.entityType, 'CUSTOMER'),
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      isNull(s.billingDocuments.deletedAt),
      sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') not in ('DRAFT', 'CANCELED')`,
    ));

  const documentIds = [...new Set(documentRows.map((row) => row.documentId))];
  const documentAdjustmentRows = documentIds.length > 0
    ? await tx.select({
      documentId: s.governanceActions.subjectId,
      deltaSnapshot: s.governanceActions.deltaSnapshot,
    })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'BILLING_DOCUMENT'),
        eq(s.governanceActions.actionKind, 'DEBIT_NOTE_ADJUSTMENT'),
        inArray(s.governanceActions.subjectId, documentIds),
        inArray(s.governanceActions.status, ['APPROVED', 'APPLIED']),
      ))
    : [];
  const documentPayments = documentIds.length > 0
    ? await tx.select({
      targetType: s.paymentAllocations.targetType,
      targetId: s.paymentAllocations.targetId,
      billingDocumentId: s.paymentAllocations.billingDocumentId,
      amount: s.paymentAllocations.amount,
    })
      .from(s.paymentAllocations)
      .where(and(
        eq(s.paymentAllocations.customerId, customerId),
        or(
          and(
            sql`${s.paymentAllocations.billingDocumentId} is not null`,
            inArray(s.paymentAllocations.billingDocumentId, documentIds),
          ),
          and(
            sql`${s.paymentAllocations.billingDocumentId} is null`,
            eq(s.paymentAllocations.targetType, 'BILLING_DOCUMENT'),
            inArray(s.paymentAllocations.targetId, documentIds),
          ),
        )!,
      ))
    : [];

  const documentOutstandingById = new Map<number, number>();
  for (const row of documentRows) {
    if (!documentOutstandingById.has(row.documentId)) {
      documentOutstandingById.set(row.documentId, 0);
    }
  }
  for (const row of documentRows) {
    const current = documentOutstandingById.get(row.documentId) ?? 0;
    documentOutstandingById.set(row.documentId, current);
  }
  const documentTotals = await tx.select({
    id: s.billingDocuments.id,
    totalInclVat: s.billingDocuments.totalInclVat,
  })
    .from(s.billingDocuments)
    .where(inArray(s.billingDocuments.id, documentIds));
  for (const document of documentTotals) {
    documentOutstandingById.set(document.id, Number(document.totalInclVat ?? 0));
  }
  for (const row of documentAdjustmentRows) {
    if (row.documentId == null) continue;
    const delta = Number((row.deltaSnapshot as Record<string, unknown> | null)?.adjustmentAmount ?? 0);
    documentOutstandingById.set(
      row.documentId,
      (documentOutstandingById.get(row.documentId) ?? 0) + delta,
    );
  }
  for (const row of documentPayments) {
    const documentId = row.billingDocumentId ?? (row.targetType === 'BILLING_DOCUMENT' ? row.targetId : null);
    if (documentId == null) continue;
    documentOutstandingById.set(
      documentId,
      Math.max(0, (documentOutstandingById.get(documentId) ?? 0) - Number(row.amount ?? 0)),
    );
  }

  const documentAuthorityByTripId = new Map<number, BillingDocumentAuthoritySnapshot>();
  for (const row of documentRows) {
    if (row.sourceTripId == null) continue;
    const issueTimestamp = new Date(row.issuedAt ?? row.createdAt).toISOString();
    const candidate: BillingDocumentAuthoritySnapshot = {
      documentId: row.documentId,
      sourceTripId: row.sourceTripId,
      originalDueDate: row.originalDueDate,
      processingDueDate: row.processingDueDate,
      effectiveDueDate: effectiveDueDate(row.processingDueDate, row.originalDueDate, issueTimestamp),
      issueTimestamp,
    };
    const current = documentAuthorityByTripId.get(row.sourceTripId);
    if (!current || compareDueOrder(
      {
        effectiveDueDate: candidate.effectiveDueDate,
        issueTimestamp: candidate.issueTimestamp,
        tripId: candidate.sourceTripId,
        ledgerId: candidate.documentId,
      },
      {
        effectiveDueDate: current.effectiveDueDate,
        issueTimestamp: current.issueTimestamp,
        tripId: current.sourceTripId,
        ledgerId: current.documentId,
      },
    ) < 0) {
      documentAuthorityByTripId.set(row.sourceTripId, candidate);
    }
  }

  for (const tripId of resolvedTripIds) {
    const documentAuthority = documentAuthorityByTripId.get(tripId);
    if (documentAuthority) {
      authorityByTripId.set(tripId, {
        sourceTripId: tripId,
        targetType: 'BILLING_DOCUMENT',
        targetId: documentAuthority.documentId,
        billingDocumentId: documentAuthority.documentId,
        originalDueDate: documentAuthority.originalDueDate,
        processingDueDate: documentAuthority.processingDueDate,
        effectiveDueDate: documentAuthority.effectiveDueDate,
        issueTimestamp: documentAuthority.issueTimestamp,
        ledgerId: documentAuthority.documentId,
      });
      outstandingByTargetKey.set(
        `BILLING_DOCUMENT:${documentAuthority.documentId}`,
        Math.max(0, documentOutstandingById.get(documentAuthority.documentId) ?? 0),
      );
      continue;
    }

    const directAuthority = authorityByTripId.get(tripId);
    if (!directAuthority) continue;
    outstandingByTargetKey.set(
      `TRIP:${tripId}`,
      directOutstandingByTripId.get(tripId) ?? 0,
    );
  }

  return { resolvedTripIds, tripCodeById, authorityByTripId, outstandingByTargetKey };
}

async function getLegacyReceiptConflict(tx: Tx, receiptId: string): Promise<boolean> {
  const [ledgerRow] = await tx.select({ id: s.ledger.id })
    .from(s.ledger)
    .where(eq(s.ledger.receiptId, receiptId))
    .limit(1);
  if (ledgerRow) return true;

  const [allocationRow] = await tx.select({ id: s.paymentAllocations.id })
    .from(s.paymentAllocations)
    .where(and(
      eq(s.paymentAllocations.receiptId, receiptId),
      isNull(s.paymentAllocations.paymentReceiptId),
    ))
    .limit(1);
  return Boolean(allocationRow);
}

async function loadPaymentReceiptResultTx(tx: Tx, paymentReceiptId: number): Promise<PaymentReceiptResult> {
  const [receipt] = await tx.select({
    id: s.paymentReceipts.id,
    receiptId: s.paymentReceipts.receiptId,
    customerId: s.paymentReceipts.customerId,
    receivedAmount: s.paymentReceipts.receivedAmount,
    allocatedTotal: s.paymentReceipts.allocatedTotal,
    unappliedAmount: s.paymentReceipts.unappliedAmount,
    refundedAmount: s.paymentReceipts.refundedAmount,
    version: s.paymentReceipts.version,
    allocationMethod: s.paymentReceipts.allocationMethod,
    createdAt: s.paymentReceipts.createdAt,
  })
    .from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.id, paymentReceiptId))
    .limit(1);

  if (!receipt) {
    throw new ApiError(404, 'Phiếu thu không tồn tại');
  }

  const allocations = await tx.select({
    tripId: s.paymentAllocations.sourceTripId,
    targetId: s.paymentAllocations.targetId,
    amount: s.paymentAllocations.amount,
    processingDueDate: s.paymentAllocations.processingDueDateSnapshot,
    issueTimestamp: s.paymentAllocations.issueTimestampSnapshot,
  })
    .from(s.paymentAllocations)
    .where(eq(s.paymentAllocations.paymentReceiptId, paymentReceiptId))
    .orderBy(asc(s.paymentAllocations.allocationOrder), asc(s.paymentAllocations.id));

  return {
    id: receipt.id,
    receiptId: receipt.receiptId,
    customerId: receipt.customerId,
    receivedAmount: Number(receipt.receivedAmount),
    allocations: allocations.map((allocation) => ({
      tripId: allocation.tripId ?? allocation.targetId,
      amount: Number(allocation.amount),
      processingDueDate: allocation.processingDueDate,
      issueTimestamp: new Date(allocation.issueTimestamp ?? receipt.createdAt).toISOString(),
    })),
    allocatedTotal: Number(receipt.allocatedTotal),
    unappliedAmount: Number(receipt.unappliedAmount),
    refundedAmount: Number(receipt.refundedAmount),
    version: receipt.version,
    allocationMethod: receipt.allocationMethod as PaymentAllocationMethod,
    createdAt: new Date(receipt.createdAt).toISOString(),
  };
}

async function getLatestCustomerLedgerVersionTx(tx: Tx, customerId: number): Promise<number> {
  const [row] = await tx.select({ id: s.ledger.id })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
    ))
    .orderBy(sql`${s.ledger.id} desc`)
    .limit(1);
  return row?.id ?? 0;
}

export async function loadPaymentReceiptResult(paymentReceiptId: number, tx?: Tx): Promise<PaymentReceiptResult> {
  if (tx) {
    return loadPaymentReceiptResultTx(tx, paymentReceiptId);
  }
  return db.transaction((innerTx) => loadPaymentReceiptResultTx(innerTx, paymentReceiptId));
}

async function createOrReplayPaymentReceiptTx(
  tx: Tx,
  input: NormalizedPaymentReceiptInput,
): Promise<PersistedPaymentReceiptResult> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`payment-receipt\u001f${input.receiptId}`}, 0))`,
  );

  const [existing] = await tx.select({
    id: s.paymentReceipts.id,
    customerId: s.paymentReceipts.customerId,
    requestHash: s.paymentReceipts.requestHash,
  })
    .from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.receiptId, input.receiptId))
    .limit(1);

  if (existing) {
    if (existing.customerId !== input.customerId || existing.requestHash !== input.requestHash) {
      throw new ApiError(
        409,
        'Mã biên lai đã tồn tại với khách hàng hoặc nội dung khác.',
        `receipt_id=${input.receiptId}`,
      );
    }
    return { ...(await loadPaymentReceiptResultTx(tx, existing.id)), created: false };
  }

  if (await getLegacyReceiptConflict(tx, input.receiptId)) {
    throw new ApiError(
      409,
      'Mã biên lai đã tồn tại trong dữ liệu cũ và không thể phát lại an toàn. Vui lòng dùng mã biên lai mới.',
      `receipt_id=${input.receiptId}`,
    );
  }

  await LedgerService.lockEntity(tx, 'CUSTOMER', input.customerId);
  await assertActiveCustomerTx(tx, input.customerId);

  const receivableState = await getTripReceivableState(
    tx,
    input.customerId,
    input.payments?.map((payment) => payment.tripId),
  );
  const { authorityByTripId, outstandingByTargetKey, tripCodeById } = receivableState;

  let allocations: Array<{
    sourceTripId: number;
    targetType: 'TRIP' | 'BILLING_DOCUMENT';
    targetId: number;
    billingDocumentId: number | null;
    amount: number;
    originalDueDate: string | null;
    processingDueDate: string | null;
    issueTimestamp: string;
  }> = [];

  if (input.payments) {
    const missingTripIds = input.payments
      .map((payment) => payment.tripId)
      .filter((tripId) => !authorityByTripId.has(tripId));
    if (missingTripIds.length > 0) {
      throw new ApiError(
        422,
        'Khoản phân bổ không thuộc khách hàng hoặc chưa có công nợ phải thu.',
        `trip_ids=${missingTripIds.join(',')}`,
      );
    }

    allocations = [];
    const requestedByTarget = new Map<string, number>();
    for (const payment of input.payments) {
      const authority = authorityByTripId.get(payment.tripId);
      if (!authority) continue;
      const key = `${authority.targetType}:${authority.targetId}`;
      requestedByTarget.set(key, (requestedByTarget.get(key) ?? 0) + payment.amount);
    }
    for (const [key, amount] of requestedByTarget.entries()) {
      if ((outstandingByTargetKey.get(key) ?? 0) < amount) {
        throw new ApiError(
          422,
          'Chỉ dẫn thanh toán vượt quá số dư còn lại của khoản phải thu.',
          `target=${key}`,
        );
      }
    }
    for (const payment of input.payments) {
      const authority = authorityByTripId.get(payment.tripId);
      if (!authority) {
        throw new ApiError(422, 'Không tìm thấy mốc công nợ của chuyến được chỉ định.');
      }
      allocations.push({
        sourceTripId: payment.tripId,
        targetType: authority.targetType,
        targetId: authority.targetId,
        billingDocumentId: authority.billingDocumentId,
        amount: payment.amount,
        originalDueDate: authority.originalDueDate,
        processingDueDate: authority.processingDueDate,
        issueTimestamp: authority.issueTimestamp,
      });
    }
  } else {
    const candidates = [...new Map(
      [...authorityByTripId.values()].map((candidate) => [
        `${candidate.targetType}:${candidate.targetId}`,
        candidate,
      ]),
    ).values()]
      .filter((candidate) => (outstandingByTargetKey.get(`${candidate.targetType}:${candidate.targetId}`) ?? 0) > 0)
      .sort((left, right) => compareDueOrder(
        {
          effectiveDueDate: left.effectiveDueDate,
          issueTimestamp: left.issueTimestamp,
          tripId: left.sourceTripId,
          ledgerId: left.ledgerId,
        },
        {
          effectiveDueDate: right.effectiveDueDate,
          issueTimestamp: right.issueTimestamp,
          tripId: right.sourceTripId,
          ledgerId: right.ledgerId,
        },
      ));
    let remaining = input.receivedAmount;
    allocations = [];
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      if (allocations.length >= MAX_DEFAULT_AUTO_ALLOCATIONS) {
        throw new ApiError(
          422,
          `Thanh toán tự động chỉ hỗ trợ tối đa ${MAX_DEFAULT_AUTO_ALLOCATIONS} chuyến mỗi lần. Vui lòng chọn payments cụ thể.`,
        );
      }
      const outstanding = outstandingByTargetKey.get(`${candidate.targetType}:${candidate.targetId}`) ?? 0;
      const amount = Math.min(outstanding, remaining);
      allocations.push({
        sourceTripId: candidate.sourceTripId,
        targetType: candidate.targetType,
        targetId: candidate.targetId,
        billingDocumentId: candidate.billingDocumentId,
        amount,
        originalDueDate: candidate.originalDueDate,
        processingDueDate: candidate.processingDueDate,
        issueTimestamp: candidate.issueTimestamp,
      });
      remaining -= amount;
    }
  }

  const allocatedTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const unappliedAmount = Math.max(0, input.receivedAmount - allocatedTotal);

  const [receipt] = await tx.insert(s.paymentReceipts).values({
    receiptId: input.receiptId,
    customerId: input.customerId,
    receivedAmount: String(input.receivedAmount),
    allocatedTotal: String(allocatedTotal),
    unappliedAmount: String(unappliedAmount),
    allocationMethod: input.allocationMethod,
    requestHash: input.requestHash,
    treasuryAccountId: input.treasury.treasuryAccountId,
    valueDate: input.treasury.valueDate,
    physicalReference: input.treasury.physicalReference,
    paymentContractVersion: input.treasury.paymentContractVersion,
    createdBy: input.allocatedBy,
  }).returning({ id: s.paymentReceipts.id });

  const ledgerCredits: CustomerPaymentLedgerRowInput[] = [];
  if (allocations.length > 0) {
    await tx.insert(s.paymentAllocations).values(allocations.map((allocation, index) => ({
      receiptId: input.receiptId,
      paymentReceiptId: receipt.id,
      allocationOrder: index + 1,
      customerId: input.customerId,
      billingDocumentId: allocation.billingDocumentId,
      sourceTripId: allocation.sourceTripId,
      targetType: allocation.targetType,
      targetId: allocation.targetId,
      amount: String(allocation.amount),
      originalDueDateSnapshot: allocation.originalDueDate,
      processingDueDateSnapshot: allocation.processingDueDate,
      issueTimestampSnapshot: new Date(allocation.issueTimestamp),
      allocationMethod: input.allocationMethod,
      allocatedBy: input.allocatedBy,
    })));

    for (const allocation of allocations) {
      const tripLabel = tripCodeById.get(allocation.sourceTripId) || '';
      ledgerCredits.push({
        txnId: allocation.sourceTripId,
        receiptId: input.receiptId,
        credit: allocation.amount,
        note: tripLabel ? `Thanh toán chuyến ${tripLabel}` : 'Thanh toán chuyến',
      });
    }
  }

  if (unappliedAmount > 0) {
    ledgerCredits.push({
      txnId: 0,
      receiptId: input.receiptId,
      credit: unappliedAmount,
      note: 'Thanh toán thừa — giữ ở trạng thái chưa phân bổ',
    });
  }

  if (ledgerCredits.length > 0) {
    let runningBalance = await LedgerService.getBalanceTx(tx, 'CUSTOMER', input.customerId);
    await tx.insert(s.ledger).values(ledgerCredits.map((entry) => {
      runningBalance -= entry.credit;
      return {
        txnType: TxnType.PAYMENT_RECEIVED,
        txnId: entry.txnId,
        receiptId: entry.receiptId,
        entityType: 'CUSTOMER' as const,
        entityId: input.customerId,
        debit: '0',
        credit: String(entry.credit),
        balance: String(runningBalance),
        note: entry.note,
      };
    }));
  }

  return { ...(await loadPaymentReceiptResultTx(tx, receipt.id)), created: true };
}

export async function requestPaymentReceiptGovernance(input: {
  payment: PaymentReceiptInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('PAYMENT_RECEIPT', input.makerRole);
  const execute = async (tx: Tx) => {
    const requestedAt = new Date();
    const treasury = await resolveTreasuryPaymentContract(tx, input.payment, requestedAt);
    const normalized = normalizePaymentReceiptInput({
      ...input.payment,
      allocatedBy: input.makerId,
    }, treasury);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`payment-receipt\u001f${normalized.receiptId}`}, 0))`,
    );
    if (await getLegacyReceiptConflict(tx, normalized.receiptId)) {
      throw new ApiError(
        409,
        'Mã biên lai đã tồn tại trong dữ liệu cũ và không thể phát lại an toàn. Vui lòng dùng mã biên lai mới.',
        `receipt_id=${normalized.receiptId}`,
      );
    }

    const [existingReceipt] = await tx.select({ id: s.paymentReceipts.id })
      .from(s.paymentReceipts)
      .where(eq(s.paymentReceipts.receiptId, normalized.receiptId))
      .limit(1);
    if (existingReceipt) {
      throw new ApiError(409, 'Mã biên lai đã tồn tại.');
    }

    await LedgerService.lockEntity(tx, 'CUSTOMER', normalized.customerId);
    await assertActiveCustomerTx(tx, normalized.customerId);
    const currentBalance = await LedgerService.getBalanceTx(tx, 'CUSTOMER', normalized.customerId);
    const currentVersion = await getLatestCustomerLedgerVersionTx(tx, normalized.customerId);

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'PAYMENT_RECEIPT',
      subjectId: null,
      subjectKey: buildPaymentReceiptSubjectKey(normalized),
      actionKind: 'PAYMENT_RECEIPT',
      reason: buildPaymentReceiptReason(normalized.receiptId),
      originalVersion: currentVersion,
      beforeSnapshot: {
        customerId: normalized.customerId,
        currentBalance,
        currentVersion,
      },
      afterSnapshot: {
        customerId: normalized.customerId,
        receiptId: normalized.receiptId,
        amount: normalized.receivedAmount,
        payments: normalized.payments,
        allocationMethod: normalized.allocationMethod,
        allocatedBy: normalized.allocatedBy,
        requestHash: normalized.requestHash,
        treasuryAccountId: treasury.treasuryAccountId,
        valueDate: treasury.valueDate,
        physicalReference: treasury.physicalReference,
        paymentContractVersion: treasury.paymentContractVersion,
      },
      deltaSnapshot: {
        customerBalanceDelta: -normalized.receivedAmount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
      createdAt: requestedAt,
      updatedAt: requestedAt,
    }).returning();
    return action;
  };

  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function applyPaymentReceiptGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
) {
  if (action.actionKind !== 'PAYMENT_RECEIPT' || action.subjectType !== 'PAYMENT_RECEIPT') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc ghi nhận phiếu thu');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const customerId = Number(afterSnapshot?.customerId);
  const receiptId = typeof afterSnapshot?.receiptId === 'string' ? afterSnapshot.receiptId : '';
  const amount = Number(afterSnapshot?.amount);
  const payments = Array.isArray(afterSnapshot?.payments)
    ? afterSnapshot.payments.map((payment) => ({
      tripId: Number((payment as Record<string, unknown>).tripId),
      amount: Number((payment as Record<string, unknown>).amount),
    }))
    : undefined;
  const allocatedBy = afterSnapshot?.allocatedBy == null ? null : Number(afterSnapshot.allocatedBy);

  if (!Number.isInteger(customerId) || customerId <= 0 || !receiptId || !Number.isFinite(amount)) {
    throw new ApiError(409, 'Yêu cầu phiếu thu không có dữ liệu áp dụng hợp lệ');
  }

  await LedgerService.lockEntity(tx, 'CUSTOMER', customerId);
  const currentVersion = await getLatestCustomerLedgerVersionTx(tx, customerId);
  if (currentVersion !== action.originalVersion) {
    throw new ApiError(409, 'Công nợ khách hàng đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const treasury = await resolveTreasuryPaymentContract(tx, {
    treasuryAccountId: afterSnapshot?.treasuryAccountId == null
      ? null
      : Number(afterSnapshot.treasuryAccountId),
    valueDate: typeof afterSnapshot?.valueDate === 'string' ? afterSnapshot.valueDate : null,
    physicalReference: typeof afterSnapshot?.physicalReference === 'string'
      ? afterSnapshot.physicalReference
      : null,
  }, action.createdAt);
  const snapshottedContractVersion = Number(afterSnapshot?.paymentContractVersion ?? 1);
  if (snapshottedContractVersion !== treasury.paymentContractVersion) {
    throw new ApiError(409, 'Phiên bản hợp đồng thanh toán không còn phù hợp với thời điểm chuyển đổi kho quỹ');
  }

  const persisted = await createOrReplayPaymentReceiptTx(tx, normalizePaymentReceiptInput({
    customerId,
    receiptId,
    amount,
    payments,
    allocatedBy,
  }, treasury));

  let treasuryMovementId: number | null = null;
  if (
    treasury.paymentContractVersion >= 2
    && treasury.treasuryAccountId
    && treasury.valueDate
    && treasury.physicalReference
  ) {
    const movement = await insertTreasuryMovement(tx, {
      treasuryAccountId: treasury.treasuryAccountId,
      direction: 'IN',
      amount,
      valueDate: treasury.valueDate,
      physicalReference: treasury.physicalReference,
      paymentContractVersion: treasury.paymentContractVersion,
      paymentReceiptId: persisted.id,
      sourceVersion: persisted.version,
      externalReference: receiptId,
      governanceActionId: action.id,
      createdBy: action.makerId,
    });
    treasuryMovementId = movement.id;
  }

  const [firstLedgerRow] = await tx.select({ id: s.ledger.id })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnType, TxnType.PAYMENT_RECEIVED),
      eq(s.ledger.receiptId, receiptId),
    ))
    .orderBy(asc(s.ledger.id))
    .limit(1);

  await tx.update(s.governanceActions).set({
    subjectId: persisted.id,
    updatedAt: new Date(),
  }).where(eq(s.governanceActions.id, action.id));

  return {
    ledgerEntryId: firstLedgerRow?.id ?? null,
    applicationResult: {
      paymentReceiptId: persisted.id,
      receiptId: persisted.receiptId,
      customerId: persisted.customerId,
      allocatedTotal: persisted.allocatedTotal,
      unappliedAmount: persisted.unappliedAmount,
      treasuryMovementId,
      paymentContractVersion: treasury.paymentContractVersion,
    },
  };
}

export async function requestPaymentRefundGovernance(
  input: PaymentRefundRequest & { transaction?: Tx },
): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('PAYMENT_REFUND', input.makerRole);
  const paymentReceiptId = Number(input.paymentReceiptId);
  const amount = Number(input.amount);
  const reason = input.reason.trim();
  if (!Number.isInteger(paymentReceiptId) || paymentReceiptId < 1) {
    throw new ApiError(400, 'paymentReceiptId không hợp lệ');
  }
  assertPositiveWholeAmount(amount, 'amount');
  if (!reason) {
    throw new ApiError(400, 'Lý do hoàn tiền là bắt buộc');
  }

  const execute = async (tx: Tx) => {
    const [receipt] = await tx.select().from(s.paymentReceipts)
      .where(eq(s.paymentReceipts.id, paymentReceiptId))
      .limit(1)
      .for('update');
    if (!receipt) throw new ApiError(404, 'Phiếu thu không tồn tại');
    if (amount > Number(receipt.unappliedAmount)) {
      throw new ApiError(409, 'Số tiền hoàn vượt quá khoản chưa phân bổ của phiếu thu');
    }

    const [treasuryMovement] = await tx.select().from(s.treasuryMovements)
      .where(and(
        eq(s.treasuryMovements.paymentReceiptId, receipt.id),
        eq(s.treasuryMovements.direction, 'IN'),
        eq(s.treasuryMovements.status, 'POSTED'),
        isNull(s.treasuryMovements.reversalOfId),
      ))
      .limit(1)
      .for('update');
    if (receipt.paymentContractVersion >= 2 && !treasuryMovement) {
      throw new ApiError(409, 'Phiếu thu chưa có giao dịch kho quỹ gốc để hoàn tiền');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'PAYMENT_REFUND',
      subjectId: receipt.id,
      subjectKey: `payment-receipt:${receipt.id}:refund:v${receipt.version}`,
      actionKind: 'PAYMENT_REFUND',
      status: 'PENDING_CHECK',
      reason,
      originalVersion: receipt.version,
      beforeSnapshot: {
        paymentReceiptId: receipt.id,
        receiptId: receipt.receiptId,
        customerId: receipt.customerId,
        receivedAmount: Number(receipt.receivedAmount),
        allocatedTotal: Number(receipt.allocatedTotal),
        unappliedAmount: Number(receipt.unappliedAmount),
        refundedAmount: Number(receipt.refundedAmount),
        version: receipt.version,
        treasuryMovementId: treasuryMovement?.id ?? null,
        treasuryMovementSourceVersion: treasuryMovement?.sourceVersion ?? null,
      },
      afterSnapshot: {
        paymentReceiptId: receipt.id,
        receiptId: receipt.receiptId,
        customerId: receipt.customerId,
        amount,
        reason,
        treasuryMovementId: treasuryMovement?.id ?? null,
      },
      deltaSnapshot: {
        unappliedAmountDelta: -amount,
        refundedAmountDelta: amount,
        customerBalanceDelta: amount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };

  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function applyPaymentRefundGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
) {
  if (action.actionKind !== 'PAYMENT_REFUND' || action.subjectType !== 'PAYMENT_REFUND') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc hoàn tiền phiếu thu');
  }
  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const paymentReceiptId = Number(afterSnapshot?.paymentReceiptId);
  const amount = Number(afterSnapshot?.amount);
  const reason = typeof afterSnapshot?.reason === 'string' ? afterSnapshot.reason.trim() : '';
  const treasuryMovementId = afterSnapshot?.treasuryMovementId == null
    ? null
    : Number(afterSnapshot.treasuryMovementId);
  if (!Number.isInteger(paymentReceiptId) || paymentReceiptId < 1 || !reason) {
    throw new ApiError(409, 'Yêu cầu hoàn tiền không có dữ liệu áp dụng hợp lệ');
  }
  assertPositiveWholeAmount(amount, 'amount');
  if (action.approverId == null) {
    throw new ApiError(409, 'Yêu cầu hoàn tiền chưa có người phê duyệt');
  }

  const [receipt] = await tx.select().from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.id, paymentReceiptId))
    .limit(1)
    .for('update');
  if (!receipt) throw new ApiError(404, 'Phiếu thu không tồn tại');
  if (receipt.version !== action.originalVersion) {
    throw new ApiError(409, 'Phiếu thu đã thay đổi; yêu cầu hoàn tiền không thể áp dụng');
  }
  if (amount > Number(receipt.unappliedAmount)) {
    throw new ApiError(409, 'Số tiền hoàn vượt quá khoản chưa phân bổ hiện tại');
  }

  const ledgerEntry = await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: receipt.id,
    receiptId: `REFUND-${receipt.receiptId}-${action.id}`.slice(0, 100),
    entityType: 'CUSTOMER',
    entityId: receipt.customerId,
    debit: amount,
    credit: 0,
    note: `Hoàn tiền chưa phân bổ phiếu thu ${receipt.receiptId}: ${reason}`,
  });

  const [refund] = await tx.insert(s.paymentRefunds).values({
    paymentReceiptId: receipt.id,
    governanceActionId: action.id,
    amount: String(amount),
    reason,
    createdBy: action.makerId,
    approvedBy: action.approverId,
    ledgerEntryId: ledgerEntry.id,
  }).returning();

  const [updatedReceipt] = await tx.update(s.paymentReceipts).set({
    unappliedAmount: sql`${s.paymentReceipts.unappliedAmount} - ${amount}`,
    refundedAmount: sql`${s.paymentReceipts.refundedAmount} + ${amount}`,
    version: sql`${s.paymentReceipts.version} + 1`,
  }).where(and(
    eq(s.paymentReceipts.id, receipt.id),
    eq(s.paymentReceipts.version, action.originalVersion),
  )).returning();
  if (!updatedReceipt) {
    throw new ApiError(409, 'Phiếu thu đã thay đổi; yêu cầu hoàn tiền không thể áp dụng');
  }

  let refundTreasuryMovementId: number | null = null;
  if (receipt.paymentContractVersion >= 2) {
    if (!Number.isInteger(treasuryMovementId) || treasuryMovementId! < 1) {
      throw new ApiError(409, 'Yêu cầu hoàn tiền thiếu liên kết giao dịch kho quỹ gốc');
    }
    const movement = await appendTreasuryReversal(tx, {
      originalMovementId: treasuryMovementId!,
      amount,
      valueDate: new Date().toISOString().slice(0, 10),
      sourceVersion: updatedReceipt.version,
      physicalReference: `REFUND:${receipt.id}:V${updatedReceipt.version}`,
      governanceActionId: action.id,
      createdBy: action.makerId,
      ledgerEntryId: ledgerEntry.id,
    });
    refundTreasuryMovementId = movement.id;
  }

  return {
    ledgerEntryId: ledgerEntry.id,
    applicationResult: {
      paymentRefundId: refund.id,
      paymentReceiptId: receipt.id,
      receiptId: receipt.receiptId,
      customerId: receipt.customerId,
      amount,
      unappliedAmount: Number(updatedReceipt.unappliedAmount),
      refundedAmount: Number(updatedReceipt.refundedAmount),
      version: updatedReceipt.version,
      treasuryMovementId: refundTreasuryMovementId,
    },
  };
}

export async function recordPaymentReceipt(
  input: PaymentReceiptInput,
): Promise<PersistedPaymentReceiptResult> {
  const normalized = normalizePaymentReceiptInput(input);
  return db.transaction((tx) => createOrReplayPaymentReceiptTx(tx, normalized));
}

export async function recordPaymentReceiptIdempotent(args: {
  input: PaymentReceiptInput;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}): Promise<PaymentReceiptMutationResult> {
  const normalized = normalizePaymentReceiptInput({
    ...args.input,
    allocatedBy: args.createdBy ?? args.input.allocatedBy ?? null,
  });

  const { result, replayed } = await runIdempotent<PersistedPaymentReceiptResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      customerId: normalized.customerId,
      receiptId: normalized.receiptId,
      amount: normalized.receivedAmount,
      payments: normalized.payments,
    },
    createdBy: args.createdBy ?? null,
    entityType: 'payment_receipt',
    create: async (tx) => createOrReplayPaymentReceiptTx(tx, normalized),
    load: async (entityId, tx) => ({
      ...(await loadPaymentReceiptResultTx(tx, entityId)),
      created: false,
    }),
  });

  return {
    result: toPublicPaymentReceiptResult(result),
    replayed: replayed || !result.created,
  };
}

export async function listAllocationsForReceipt(receiptId: string) {
  return db.select().from(s.paymentAllocations)
    .where(eq(s.paymentAllocations.receiptId, receiptId))
    .orderBy(asc(s.paymentAllocations.allocationOrder), asc(s.paymentAllocations.id));
}
