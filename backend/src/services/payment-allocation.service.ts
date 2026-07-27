import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import type { PaymentAllocationMethod, PaymentReceiptResult } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent, hashPayload } from './idempotency.service';
import type { Tx } from './trip-shared';

const MAX_PAYMENT_INSTRUCTIONS = 200;
const MAX_DEFAULT_AUTO_ALLOCATIONS = 200;
const MAX_WHOLE_VND = 999_999_999_999_999;

export interface PaymentInstruction {
  tripId: number;
  amount: number;
}

export interface PaymentReceiptInput {
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
}

interface PersistedPaymentReceiptResult extends PaymentReceiptResult {
  created: boolean;
}

export interface PaymentReceiptMutationResult {
  result: PaymentReceiptResult;
  replayed: boolean;
}

function toPublicPaymentReceiptResult(result: PersistedPaymentReceiptResult): PaymentReceiptResult {
  return {
    id: result.id,
    receiptId: result.receiptId,
    customerId: result.customerId,
    receivedAmount: result.receivedAmount,
    allocations: result.allocations,
    allocatedTotal: result.allocatedTotal,
    unappliedAmount: result.unappliedAmount,
    allocationMethod: result.allocationMethod,
    createdAt: result.createdAt,
  };
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

function normalizePaymentReceiptInput(input: PaymentReceiptInput): NormalizedPaymentReceiptInput {
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
  const requestHash = hashPayload({
    customerId,
    receiptId,
    amount: receivedAmount,
    payments,
  });

  return {
    customerId,
    receiptId,
    receivedAmount,
    payments,
    allocationMethod,
    requestHash,
    allocatedBy: input.allocatedBy ?? null,
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
  tripId: number;
  originalDueDate: string | null;
  processingDueDate: string | null;
  effectiveDueDate: string;
  issueTimestamp: string;
  ledgerId: number;
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
  const outstandingByTripId = new Map<number, number>();

  if (resolvedTripIds.length === 0) {
    return { resolvedTripIds, tripCodeById, authorityByTripId, outstandingByTripId };
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
      tripId: row.tripId,
      originalDueDate: row.originalDueDate,
      processingDueDate: row.processingDueDate,
      effectiveDueDate: effectiveDueDate(row.processingDueDate, row.originalDueDate, issueTimestamp),
      issueTimestamp,
      ledgerId: row.ledgerId,
    };
    const current = authorityByTripId.get(row.tripId);
    if (!current || compareDueOrder(candidate, current) < 0) {
      authorityByTripId.set(row.tripId, candidate);
    }
  }

  const outstandingRows = await tx.select({
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

  for (const row of outstandingRows) {
    if (row.tripId == null) continue;
    outstandingByTripId.set(row.tripId, Math.max(0, Number(row.outstanding ?? 0)));
  }

  return { resolvedTripIds, tripCodeById, authorityByTripId, outstandingByTripId };
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
    tripId: s.paymentAllocations.targetId,
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
      tripId: allocation.tripId,
      amount: Number(allocation.amount),
      processingDueDate: allocation.processingDueDate,
      issueTimestamp: new Date(allocation.issueTimestamp ?? receipt.createdAt).toISOString(),
    })),
    allocatedTotal: Number(receipt.allocatedTotal),
    unappliedAmount: Number(receipt.unappliedAmount),
    allocationMethod: receipt.allocationMethod as PaymentAllocationMethod,
    createdAt: new Date(receipt.createdAt).toISOString(),
  };
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
  const { authorityByTripId, outstandingByTripId, tripCodeById } = receivableState;

  let allocations: Array<{
    tripId: number;
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
    for (const payment of input.payments) {
      const outstanding = outstandingByTripId.get(payment.tripId) ?? 0;
      if (outstanding < payment.amount) {
        throw new ApiError(
          422,
          'Chỉ dẫn thanh toán vượt quá số dư còn lại của chuyến.',
          `trip_id=${payment.tripId}`,
        );
      }
      const authority = authorityByTripId.get(payment.tripId);
      if (!authority) {
        throw new ApiError(422, 'Không tìm thấy mốc công nợ của chuyến được chỉ định.');
      }
      allocations.push({
        tripId: payment.tripId,
        amount: payment.amount,
        originalDueDate: authority.originalDueDate,
        processingDueDate: authority.processingDueDate,
        issueTimestamp: authority.issueTimestamp,
      });
    }
  } else {
    const candidates = [...authorityByTripId.values()]
      .filter((candidate) => (outstandingByTripId.get(candidate.tripId) ?? 0) > 0)
      .sort(compareDueOrder);
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
      const outstanding = outstandingByTripId.get(candidate.tripId) ?? 0;
      const amount = Math.min(outstanding, remaining);
      allocations.push({
        tripId: candidate.tripId,
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
    createdBy: input.allocatedBy,
  }).returning({ id: s.paymentReceipts.id });

  const ledgerCredits: CustomerPaymentLedgerRowInput[] = [];
  if (allocations.length > 0) {
    await tx.insert(s.paymentAllocations).values(allocations.map((allocation, index) => ({
      receiptId: input.receiptId,
      paymentReceiptId: receipt.id,
      allocationOrder: index + 1,
      customerId: input.customerId,
      targetType: 'TRIP',
      targetId: allocation.tripId,
      amount: String(allocation.amount),
      originalDueDateSnapshot: allocation.originalDueDate,
      processingDueDateSnapshot: allocation.processingDueDate,
      issueTimestampSnapshot: new Date(allocation.issueTimestamp),
      allocationMethod: input.allocationMethod,
      allocatedBy: input.allocatedBy,
    })));

    for (const allocation of allocations) {
      const tripLabel = tripCodeById.get(allocation.tripId) || '';
      ledgerCredits.push({
        txnId: allocation.tripId,
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
