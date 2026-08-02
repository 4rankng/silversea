// O2C AR snapshot + dirty-flag (docs/prd/O2C dev.md, 01/08/2026).
//
// Costs stay editable after a trip COMPLETED (no hard-freeze). To keep the
// accountant reconciliation view honest, we capture a canonical cost hash at the
// completion moment; any later cost edit recomputes the hash and flips
// `trips.ar_snapshot_dirty = true` so the dirty trips surface as a queue.
//
// The canonical AR total for downstream (billing_documents.totalInclVat) is
// `trips.revenue` (incl-VAT) — captured implicitly at completion, never
// re-stored here. This service only tracks whether costs drifted afterwards.

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { round2dp } from '@tingting/shared';
import type { Tx } from './trip-shared';

/** Accepts either the shared db handle or a transaction (both have select/update). */
type DbOrTx = typeof db | Tx;

/**
 * Build a stable sha256 over the canonical cost payload for a trip. The payload
 * is pinned (Phase 2 architecture): trip-level revenue/cost figures + the
 * tripExpenses rows sorted by id. round2dp numeric precision avoids float drift
 * between identical amounts stored with differing trailing precision.
 */
async function computeCostHash(tripId: number, tx: DbOrTx): Promise<string> {
  const [trip] = await tx.select({
    revenue: s.trips.revenue,
    driverSalary: s.trips.driverSalary,
    totalFuelCost: s.trips.totalFuelCost,
    externalFreightCost: s.trips.externalFreightCost,
    vatRate: s.trips.vatRate,
    customerCommission: s.trips.customerCommission,
    totalCost: s.trips.totalCost,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);

  const expenses = await tx.select({
    id: s.tripExpenses.id,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    supplierId: s.tripExpenses.supplierId,
    forwarderId: s.tripExpenses.forwarderId,
    approvalStatus: s.tripExpenses.approvalStatus,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.tripId, tripId));

  // Sort by id so row order never perturbs the hash.
  const sorted = [...expenses].sort((a, b) => a.id - b.id);

  const payload = {
    revenue: round2dp(Number(trip?.revenue ?? 0)),
    driverSalary: round2dp(Number(trip?.driverSalary ?? 0)),
    totalFuelCost: round2dp(Number(trip?.totalFuelCost ?? 0)),
    externalFreightCost: round2dp(Number(trip?.externalFreightCost ?? 0)),
    vatRate: round2dp(Number(trip?.vatRate ?? 0)),
    customerCommission: round2dp(Number(trip?.customerCommission ?? 0)),
    totalCost: round2dp(Number(trip?.totalCost ?? 0)),
    expenses: sorted.map((e) => ({
      id: e.id,
      buyAmount: round2dp(Number(e.buyAmount ?? 0)),
      sellAmount: round2dp(Number(e.sellAmount ?? 0)),
      settlementMethod: e.settlementMethod,
      supplierId: e.supplierId,
      forwarderId: e.forwarderId,
      approvalStatus: e.approvalStatus,
    })),
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

export class ArSnapshotService {
  /**
   * Capture the canonical cost hash at the IN_TRANSIT → COMPLETED transition.
   * Must run inside the same transaction as the status update + postTripCompletion
   * so a concurrent cost edit cannot land between the status flip and the
   * capture (row-level locking from the version UPDATE serializes them).
   */
  static async captureSnapshot(tripId: number, tx: DbOrTx): Promise<void> {
    const hash = await computeCostHash(tripId, tx);
    // O2C H4: freeze grossProfit at completion so P&L reports read a stable
    // value even if costs are edited afterwards. The mutable `grossProfit`
    // column is the live figure; `pnlSnapshotGrossProfit` is the period-frozen
    // figure that pnl.service / profit-distribution read.
    const [trip] = await tx.select({
      grossProfit: s.trips.grossProfit,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    await tx.update(s.trips).set({
      arCostHash: hash,
      arSnapshotDirty: false,
      arSnapshotChangedAt: new Date(),
      pnlSnapshotGrossProfit: trip?.grossProfit ?? null,
    }).where(eq(s.trips.id, tripId));
  }

  /**
   * Recompute the cost hash and, if it differs from the captured one, mark the
   * snapshot dirty. Call from every cost-edit endpoint when the parent trip is
   * COMPLETED. Always bumps ar_snapshot_changed_at so the queue can surface churn
   * even when already dirty.
   */
  static async markDirty(tripId: number, tx: DbOrTx): Promise<void> {
    const [trip] = await tx.select({
      status: s.trips.status,
      arCostHash: s.trips.arCostHash,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    if (!trip) return;
    // Only completed trips carry a snapshot. In-progress edits are not dirtying.
    if (trip.status !== 'COMPLETED') return;

    const currentHash = await computeCostHash(tripId, tx);
    const dirty = currentHash !== (trip.arCostHash ?? null);
    await tx.update(s.trips).set({
      ...(dirty ? { arSnapshotDirty: true } : {}),
      arSnapshotChangedAt: new Date(),
    }).where(eq(s.trips.id, tripId));
  }

  /**
   * List dirty completed trips for the accountant reconciliation queue.
   */
  static async listDirty() {
    return db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      customerId: s.trips.customerId,
      completedAt: s.trips.completedAt,
      arSnapshotChangedAt: s.trips.arSnapshotChangedAt,
    }).from(s.trips)
      .where(eq(s.trips.arSnapshotDirty, true))
      .orderBy(s.trips.arSnapshotChangedAt);
  }

  /**
   * Re-capture the snapshot after the accountant has reconciled. Flips dirty
   * back to false against the now-current cost payload.
   */
  static async recapture(tripId: number, transaction?: Tx): Promise<void> {
    const execute = async (tx: Tx) => {
      await this.captureSnapshot(tripId, tx);
    };
    if (transaction) {
      await execute(transaction);
      return;
    }
    await db.transaction(execute);
  }
}
