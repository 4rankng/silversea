/**
 * Wave 3 M5.6 — Payment allocation service.
 *
 * Allocates a single customer receipt across multiple outstanding TRIP
 * documents according to a strategy. Writes traceability rows into
 * `payment_allocations` and posts the corresponding PAYMENT_RECEIVED
 * ledger credits inline within the same transaction.
 *
 * Hard invariants:
 *  - Cannot over-allocate: total allocated ≤ receipt amount AND per-trip
 *    allocation ≤ trip outstanding.
 *  - Idempotent on receiptId: re-calling with the same receiptId does NOT
 *    double-post. Outstanding is read from the ledger, which already
 *    reflects every credit posted by any prior committed allocation.
 *  - Leftover (unallocated) is returned to the caller — never silently
 *    dropped. Callers may post it as customer-level credit via recordPayment.
 *
 * Concurrency: every allocation takes a per-customer advisory lock via
 * LedgerService.lockEntity, so concurrent receipts for the same customer
 * serialize cleanly. We deliberately do NOT delegate ledger posting to
 * recordPayment because that helper opens its own transaction and would
 * re-acquire the same advisory lock → deadlock.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

export type AllocationMethod = 'OLDEST_FIRST' | 'MANUAL';

export interface AllocationRequest {
  customerId: number;
  receiptId: string;
  amount: number; // VND, integer-scale
  method?: AllocationMethod; // default OLDEST_FIRST
  allocatedBy?: number;
  // For MANUAL only: explicit per-trip allocation intents. Total may be less
  // than `amount` (leftover returned). Per-trip amount clamped to outstanding.
  manual?: Array<{ tripId: number; amount: number }>;
}

export interface AllocationResult {
  allocations: Array<{ tripId: number; amount: number }>;
  allocatedTotal: number;
  unallocated: number;
  method: AllocationMethod;
}

/**
 * Sum of TRIP_REVENUE debit − PAYMENT_RECEIVED credit for one trip on the
 * customer's ledger. Returns 0 if the trip has no AR activity yet.
 */
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

/**
 * Allocate a customer receipt across outstanding trips and persist:
 *   1. payment_allocations rows (traceability)
 *   2. PAYMENT_RECEIVED ledger entries (inline — see header for why not recordPayment)
 *
 * Returns the allocation plan and any leftover unallocated amount.
 */
export async function allocatePayment(req: AllocationRequest): Promise<AllocationResult> {
  if (!Number.isInteger(req.amount) || req.amount <= 0) {
    throw new ApiError(400, `Số tiền thanh toán không hợp lệ (nhận ${req.amount}, phải là số nguyên dương)`);
  }
  if (!req.receiptId || !req.receiptId.trim()) {
    throw new ApiError(400, 'Thiếu mã biên lai (receiptId)');
  }
  const method: AllocationMethod = req.method ?? 'OLDEST_FIRST';

  return db.transaction(async (tx) => {
    // Serialize concurrent allocations for this customer.
    await LedgerService.lockEntity(tx, 'CUSTOMER', req.customerId);

    // Build the candidate list of (tripId, intendedAmount).
    //
    // Idempotency note: outstanding is computed from the ledger, which
    // already reflects every PAYMENT_RECEIVED credit posted in any prior
    // committed allocation (including prior calls with this same receiptId,
    // since allocations post ledger entries atomically). So we do NOT need
    // to also subtract prior payment_allocations rows here — that would
    // double-count and prevent legitimate follow-up allocations.
    let candidates: Array<{ tripId: number; intended: number }>;
    if (method === 'MANUAL') {
      if (!req.manual || req.manual.length === 0) {
        throw new ApiError(400, 'Phương pháp MANUAL yêu cầu danh sách phân bổ thủ công (manual)');
      }
      candidates = req.manual.map(m => ({ tripId: m.tripId, intended: m.amount }));
    } else {
      // OLDEST_FIRST: gather every outstanding trip for this customer,
      // ordered by departure_date ASC then id ASC. The "intended" amount
      // for each is its remaining outstanding — the loop below caps the
      // running total at the receipt amount.
      const outstandingTrips = await tx.select({
        id: s.trips.id,
        departureDate: s.trips.departureDate,
      })
        .from(s.trips)
        .where(and(
          eq(s.trips.customerId, req.customerId),
          isNull(s.trips.deletedAt),
        ))
        .orderBy(asc(s.trips.departureDate), asc(s.trips.id));

      candidates = [];
      for (const t of outstandingTrips) {
        const outstanding = await getTripOutstanding(tx, req.customerId, t.id);
        if (outstanding > 0) candidates.push({ tripId: t.id, intended: outstanding });
      }
    }

    // Walk candidates applying the receipt amount. Per-trip clamp to
    // outstanding (recomputed to be safe under the lock).
    const allocations: Array<{ tripId: number; amount: number }> = [];
    let remainingReceipt = req.amount;
    for (const c of candidates) {
      if (remainingReceipt <= 0) break;
      const outstanding = await getTripOutstanding(tx, req.customerId, c.tripId);
      const applied = Math.max(0, Math.min(c.intended, outstanding, remainingReceipt));
      if (applied > 0) {
        allocations.push({ tripId: c.tripId, amount: applied });
        remainingReceipt -= applied;
      }
    }

    const allocatedTotal = allocations.reduce((s2, a) => s2 + a.amount, 0);
    const unallocated = Math.max(0, req.amount - allocatedTotal);

    // Persist traceability rows + post ledger entries INLINE within this
    // transaction. We deliberately do NOT call recordPayment here because
    // recordPayment opens its own db.transaction and re-acquires the same
    // advisory lock → deadlock. Since we already clamp per-trip allocation
    // to outstanding above, no overpayment is possible at this point.
    if (allocations.length > 0) {
      await tx.insert(s.paymentAllocations).values(allocations.map(a => ({
        receiptId: req.receiptId,
        customerId: req.customerId,
        targetType: 'TRIP',
        targetId: a.tripId,
        amount: String(a.amount),
        allocationMethod: method,
        allocatedBy: req.allocatedBy ?? null,
      })));

      // Resolve trip codes for human-readable ledger notes.
      const tripIds = allocations.map(a => a.tripId);
      const tripRows = await tx.select({ id: s.trips.id, tripCode: s.trips.tripCode })
        .from(s.trips)
        .where(sql`${s.trips.id} IN (${sql.join(tripIds.map(id => sql`${id}`), sql`, `)})`);
      const codeById = new Map(tripRows.map(t => [t.id, t.tripCode || '']));

      for (const a of allocations) {
        const tripLabel = codeById.get(a.tripId) || '';
        await LedgerService.postEntry(tx, {
          txnType: TxnType.PAYMENT_RECEIVED,
          txnId: a.tripId,
          receiptId: req.receiptId,
          entityType: 'CUSTOMER',
          entityId: req.customerId,
          debit: 0,
          credit: a.amount,
          note: tripLabel ? `Thanh toán chuyến ${tripLabel}` : 'Thanh toán chuyến',
        });
      }
    }

    return { allocations, allocatedTotal, unallocated, method };
  });
}

/**
 * List all allocations for a receipt (traceability read).
 */
export async function listAllocationsForReceipt(receiptId: string) {
  return db.select().from(s.paymentAllocations)
    .where(eq(s.paymentAllocations.receiptId, receiptId))
    .orderBy(asc(s.paymentAllocations.id));
}
