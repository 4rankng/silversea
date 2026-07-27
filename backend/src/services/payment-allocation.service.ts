import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import type { PaymentAllocationMethod, PaymentReceiptResult } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent, hashPayload } from './idempotency.service';
import type { Tx } from './trip-shared';

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

function assertPositiveWholeAmount(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, `${field} phải là số nguyên dương`);
  }
}

function normalizePaymentInstructions(payments: PaymentInstruction[] | undefined): PaymentInstruction[] | null {
  if (!payments || payments.length === 0) return null;
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
  return normalized.sort((a, b) => a.tripId - b.tripId);
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

async function getTripOutstanding(tx: Tx, customerId: number, tripId: number): Promise<number> {
  const [row] = await tx.select({
    outstanding: sql<string>`coalesce(
      sum(case when ${s.ledger.txnType} = 'TRIP_REVENUE' then ${s.ledger.debit} else 0 end), 0
    ) - coalesce(
      sum(case when ${s.ledger.txnType} = 'PAYMENT_RECEIVED' then ${s.ledger.credit} else 0 end), 0
    )`,
  })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnId, tripId),
      sql`${s.ledger.txnType} IN ('TRIP_REVENUE', 'PAYMENT_RECEIVED')`,
    ));
  return Math.max(0, Number(row?.outstanding ?? 0));
}

function compareDueOrder(
  a: { processingDueDate: string | null; issueTimestamp: string; tripId: number },
  b: { processingDueDate: string | null; issueTimestamp: string; tripId: number },
): number {
  if (a.processingDueDate !== b.processingDueDate) {
    if (a.processingDueDate == null) return 1;
    if (b.processingDueDate == null) return -1;
    return a.processingDueDate.localeCompare(b.processingDueDate);
  }
  if (a.issueTimestamp !== b.issueTimestamp) {
    return a.issueTimestamp.localeCompare(b.issueTimestamp);
  }
  return a.tripId - b.tripId;
}

async function getTripAuthorityRows(tx: Tx, customerId: number, tripIds?: number[]) {
  const rows = await tx.select({
    tripId: s.trips.id,
    issueTimestamp: s.ledger.timestamp,
    processingDueDate: s.ledger.processingDueDate,
  })
    .from(s.trips)
    .innerJoin(s.ledger, and(
      eq(s.ledger.txnId, s.trips.id),
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
    ))
    .where(and(
      eq(s.trips.customerId, customerId),
      isNull(s.trips.deletedAt),
      tripIds && tripIds.length > 0 ? inArray(s.trips.id, tripIds) : undefined,
    ));

  const byTripId = new Map<number, {
    tripId: number;
    processingDueDate: string | null;
    issueTimestamp: string;
  }>();
  for (const row of rows) {
    if (row.tripId == null) continue;
    const issueTimestamp = new Date(row.issueTimestamp).toISOString();
    const current = byTripId.get(row.tripId);
    if (!current || compareDueOrder({
      tripId: row.tripId,
      processingDueDate: row.processingDueDate,
      issueTimestamp,
    }, current) < 0) {
      byTripId.set(row.tripId, {
        tripId: row.tripId,
        processingDueDate: row.processingDueDate,
        issueTimestamp,
      });
    }
  }
  return byTripId;
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
    processingDueDate: s.ledger.processingDueDate,
    issueTimestamp: s.ledger.timestamp,
  })
    .from(s.paymentAllocations)
    .leftJoin(s.ledger, and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, receipt.customerId),
      eq(s.ledger.txnType, TxnType.TRIP_REVENUE),
      eq(s.ledger.txnId, s.paymentAllocations.targetId),
    ))
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

export async function loadPaymentReceiptResult(paymentReceiptId: number): Promise<PaymentReceiptResult> {
  return db.transaction((tx) => loadPaymentReceiptResultTx(tx, paymentReceiptId));
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

  const authorityByTrip = await getTripAuthorityRows(
    tx,
    input.customerId,
    input.payments?.map((payment) => payment.tripId),
  );

  let allocations: Array<{
    tripId: number;
    amount: number;
    processingDueDate: string | null;
    issueTimestamp: string;
  }> = [];

  if (input.payments) {
    const missingTripIds = input.payments
      .map((payment) => payment.tripId)
      .filter((tripId) => !authorityByTrip.has(tripId));
    if (missingTripIds.length > 0) {
      throw new ApiError(
        422,
        'Khoản phân bổ không thuộc khách hàng hoặc chưa có công nợ phải thu.',
        `trip_ids=${missingTripIds.join(',')}`,
      );
    }

    allocations = [];
    for (const payment of input.payments) {
      const outstanding = await getTripOutstanding(tx, input.customerId, payment.tripId);
      if (outstanding < payment.amount) {
        throw new ApiError(
          422,
          'Chỉ dẫn thanh toán vượt quá số dư còn lại của chuyến.',
          `trip_id=${payment.tripId}`,
        );
      }
      const authority = authorityByTrip.get(payment.tripId);
      if (!authority) {
        throw new ApiError(422, 'Không tìm thấy mốc công nợ của chuyến được chỉ định.');
      }
      allocations.push({
        tripId: payment.tripId,
        amount: payment.amount,
        processingDueDate: authority.processingDueDate,
        issueTimestamp: authority.issueTimestamp,
      });
    }
  } else {
    const candidates = [...authorityByTrip.values()].sort(compareDueOrder);
    let remaining = input.receivedAmount;
    allocations = [];
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const outstanding = await getTripOutstanding(tx, input.customerId, candidate.tripId);
      if (outstanding <= 0) continue;
      const amount = Math.min(outstanding, remaining);
      allocations.push({
        tripId: candidate.tripId,
        amount,
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

  if (allocations.length > 0) {
    await tx.insert(s.paymentAllocations).values(allocations.map((allocation, index) => ({
      receiptId: input.receiptId,
      paymentReceiptId: receipt.id,
      allocationOrder: index + 1,
      customerId: input.customerId,
      targetType: 'TRIP',
      targetId: allocation.tripId,
      amount: String(allocation.amount),
      allocationMethod: input.allocationMethod,
      allocatedBy: input.allocatedBy,
    })));

    const tripIds = allocations.map((allocation) => allocation.tripId);
    const tripRows = await tx.select({ id: s.trips.id, tripCode: s.trips.tripCode })
      .from(s.trips)
      .where(inArray(s.trips.id, tripIds));
    const codeById = new Map(tripRows.map((trip) => [trip.id, trip.tripCode || '']));

    for (const allocation of allocations) {
      const tripLabel = codeById.get(allocation.tripId) || '';
      await LedgerService.postEntry(tx, {
        txnType: TxnType.PAYMENT_RECEIVED,
        txnId: allocation.tripId,
        receiptId: input.receiptId,
        entityType: 'CUSTOMER',
        entityId: input.customerId,
        debit: 0,
        credit: allocation.amount,
        note: tripLabel ? `Thanh toán chuyến ${tripLabel}` : 'Thanh toán chuyến',
      });
    }
  }

  if (unappliedAmount > 0) {
    await LedgerService.postEntry(tx, {
      txnType: TxnType.PAYMENT_RECEIVED,
      txnId: 0,
      receiptId: input.receiptId,
      entityType: 'CUSTOMER',
      entityId: input.customerId,
      debit: 0,
      credit: unappliedAmount,
      note: 'Thanh toán thừa — giữ ở trạng thái chưa phân bổ',
    });
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
    create: () => db.transaction((tx) => createOrReplayPaymentReceiptTx(tx, normalized)),
    load: async (entityId) => ({ ...(await loadPaymentReceiptResult(entityId)), created: false }),
  });

  return {
    result,
    replayed: replayed || !result.created,
  };
}

export async function listAllocationsForReceipt(receiptId: string) {
  return db.select().from(s.paymentAllocations)
    .where(eq(s.paymentAllocations.receiptId, receiptId))
    .orderBy(asc(s.paymentAllocations.allocationOrder), asc(s.paymentAllocations.id));
}
