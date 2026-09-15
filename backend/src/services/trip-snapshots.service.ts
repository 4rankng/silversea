// Trip snapshot services (T4a merge) — AR + AP cost-hash snapshots.
//
// ar-snapshot.service.ts and ap-snapshot.service.ts were structural twins
// (166 vs 146 lines, identical skeleton, different hash payload + column
// names). Merged into one module with a shared skeleton; the hash payload
// builders stay side-specific because they hash genuinely different fields.
//
// Semantics preserved exactly:
//   - AR captures pnlSnapshotGrossProfit at completion (O2C H4 freeze);
//     AP does not.
//   - recapture error copy differs per side (AR/AP) — preserved.
//   - AP capture-with-degradation lives in snapshot-services.ts (savepoint
//     isolation) and is unchanged.

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { round2dp } from '@tingting/shared';
import { ApiError } from '../errors';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { upsertTripFinancialState } from './trip-composite.service';
import type { Tx } from './trip-shared';

/** Accepts either the shared db handle or a transaction (both have select/update). */
type DbOrTx = typeof db | Tx;

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ─── Side-specific hash payload builders ────────────────────────────────────

/**
 * Canonical AR cost payload: trip-level revenue/cost figures + tripExpenses
 * rows sorted by id. round2dp avoids float drift between identical amounts
 * stored with differing trailing precision.
 */
async function computeArCostHash(tripId: number, tx: DbOrTx): Promise<string> {
  // Trips-split: financial fields live on the trip_financial_state sidecar;
  // external freight cost on trip_carrier_info. The hashed payload is
  // unchanged — same values, same order, so existing hashes stay valid.
  const [trip] = await tx.select({
    revenue: s.tripFinancialState.revenue,
    driverSalary: s.tripFinancialState.driverSalary,
    totalFuelCost: s.tripFinancialState.totalFuelCost,
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
    vatRate: s.tripFinancialState.vatRate,
    customerCommission: s.tripFinancialState.customerCommission,
    totalCost: s.tripFinancialState.totalCost,
  }).from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId)).limit(1);

  const expenses = await tx.select({
    id: s.tripExpenses.id,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    supplierId: s.tripExpenses.supplierId,
    forwarderId: s.tripExpenses.forwarderId,
    approvalStatus: s.tripExpenses.approvalStatus,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.tripId, tripId));

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
  return hashPayload(payload);
}

function collectApPayableExpenses(
  expenses: Array<{
    id: number;
    buyAmount: string | null;
    settlementMethod: string;
    supplierId: number | null;
    approvalStatus: string;
  }>,
) {
  return expenses
    .filter((expense): expense is typeof expense & { supplierId: number } => (
      expense.supplierId != null
      && ['RECORDED', 'APPROVED'].includes(expense.approvalStatus)
      && expense.settlementMethod === 'COMPANY_DIRECT'
      && Number(expense.buyAmount ?? 0) > 0
    ))
    .sort((a, b) => a.id - b.id);
}

async function computeApHash(tripId: number, tx: DbOrTx): Promise<string> {
  // Trips-split: carrier execution fields live on trip_carrier_info, the
  // fuel/salary figures on trip_financial_state. Payload unchanged.
  const [trip] = await tx.select({
    carrierType: s.tripCarrierInfo.carrierType,
    fuelSupplierId: s.tripFinancialState.fuelSupplierId,
    totalFuelCost: s.tripFinancialState.totalFuelCost,
    externalEntityId: s.tripCarrierInfo.externalEntityId,
    externalEntityType: s.tripCarrierInfo.externalEntityType,
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
  }).from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId)).limit(1);

  if (!trip) {
    throw new Error(`Không tìm thấy chuyến ${tripId} để chụp AP snapshot`);
  }

  const expenses = await tx.select({
    id: s.tripExpenses.id,
    buyAmount: s.tripExpenses.buyAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    supplierId: s.tripExpenses.supplierId,
    approvalStatus: s.tripExpenses.approvalStatus,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.tripId, tripId));

  const payables = collectApPayableExpenses(expenses);

  const payload = {
    carrierType: trip.carrierType,
    fuelSupplierId: trip.fuelSupplierId,
    totalFuelCost: round2dp(Number(trip.totalFuelCost ?? 0)),
    externalEntityId: trip.externalEntityId,
    externalEntityType: trip.externalEntityType,
    externalFreightCost: round2dp(Number(trip.externalFreightCost ?? 0)),
    expenses: payables.map((e) => ({
      id: e.id,
      buyAmount: round2dp(Number(e.buyAmount ?? 0)),
      settlementMethod: e.settlementMethod,
      supplierId: e.supplierId,
    })),
  };
  return hashPayload(payload);
}

// ─── Shared skeleton ─────────────────────────────────────────────────────────

/**
 * Column triple per side. Everything else in the lifecycle (capture, dirty
 * flip, queue, recapture) is identical between AR and AP.
 */
const COLUMNS = {
  ar: {
    costHash: s.tripFinancialState.arCostHash,
    dirty: s.tripFinancialState.arSnapshotDirty,
    changedAt: s.tripFinancialState.arSnapshotChangedAt,
    label: 'AR',
  },
  ap: {
    costHash: s.tripFinancialState.apCostHash,
    dirty: s.tripFinancialState.apSnapshotDirty,
    changedAt: s.tripFinancialState.apSnapshotChangedAt,
    label: 'AP',
  },
} as const;

type Side = keyof typeof COLUMNS;

async function computeHash(side: Side, tripId: number, tx: DbOrTx): Promise<string> {
  return side === 'ar' ? computeArCostHash(tripId, tx) : computeApHash(tripId, tx);
}

class TripSnapshotService {
  static async captureSnapshot(side: Side, tripId: number, tx: DbOrTx): Promise<void> {
    const hash = await computeHash(side, tripId, tx);
    if (side === 'ar') {
      // O2C H4: freeze grossProfit at completion so P&L reports read a stable
      // value even if costs are edited afterwards. The mutable `grossProfit`
      // column is the live figure; `pnlSnapshotGrossProfit` is the period-frozen
      // figure that pnl.service / profit-distribution read.
      const [fin] = await tx.select({
        grossProfit: s.tripFinancialState.grossProfit,
      }).from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId)).limit(1);
      await upsertTripFinancialState(tx, tripId, {
        arCostHash: hash,
        arSnapshotDirty: false,
        arSnapshotChangedAt: new Date(),
        pnlSnapshotGrossProfit: fin?.grossProfit ?? null,
      });
      return;
    }
    await upsertTripFinancialState(tx, tripId, {
      apCostHash: hash,
      apSnapshotDirty: false,
      apSnapshotChangedAt: new Date(),
    });
  }

  static async markDirty(side: Side, tripId: number, tx: DbOrTx): Promise<void> {
    const cols = COLUMNS[side];
    const [trip] = await tx.select({
      status: s.trips.status,
      costHash: cols.costHash,
    }).from(s.trips)
      .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .where(eq(s.trips.id, tripId)).limit(1);
    if (!trip) return;
    // Only completed trips carry a snapshot. In-progress edits are not dirtying.
    if (trip.status !== 'COMPLETED') return;

    const currentHash = await computeHash(side, tripId, tx);
    const dirty = currentHash !== (trip.costHash ?? null);
    const changedAtCol = side === 'ar' ? { arSnapshotChangedAt: new Date() } : { apSnapshotChangedAt: new Date() };
    const dirtyCol = side === 'ar' ? { arSnapshotDirty: true } : { apSnapshotDirty: true };
    await upsertTripFinancialState(tx, tripId, {
      ...(dirty ? dirtyCol : {}),
      ...changedAtCol,
    });
  }

  static async listDirty(side: Side) {
    const cols = COLUMNS[side];
    return db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      customerId: s.trips.customerId,
      completedAt: s.trips.completedAt,
      snapshotChangedAt: cols.changedAt,
    }).from(s.trips)
      .innerJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .where(eq(cols.dirty, true))
      .orderBy(cols.changedAt);
  }

  static async recapture(side: Side, tripId: number, transaction?: Tx): Promise<void> {
    const label = COLUMNS[side].label;
    const execute = async (tx: Tx) => {
      await lockTripFinancialAuthority(tx, [tripId]);
      const [trip] = await tx.select({ status: s.trips.status })
        .from(s.trips)
        .where(eq(s.trips.id, tripId))
        .limit(1)
        .for('update');
      if (!trip) {
        throw new ApiError(404, 'Không tìm thấy chuyến đi');
      }
      if (trip.status !== 'COMPLETED') {
        throw new ApiError(409, `Chỉ có thể chụp lại đối soát ${label} cho chuyến đã hoàn thành`);
      }
      await this.captureSnapshot(side, tripId, tx);
    };
    await runInTx(transaction, execute);
  }
}

export class ArSnapshotService {
  static captureSnapshot(tripId: number, tx: DbOrTx) { return TripSnapshotService.captureSnapshot('ar', tripId, tx); }
  static markDirty(tripId: number, tx: DbOrTx) { return TripSnapshotService.markDirty('ar', tripId, tx); }
  static listDirty() { return TripSnapshotService.listDirty('ar'); }
  static recapture(tripId: number, transaction?: Tx) { return TripSnapshotService.recapture('ar', tripId, transaction); }
}

export class ApSnapshotService {
  static captureSnapshot(tripId: number, tx: DbOrTx) { return TripSnapshotService.captureSnapshot('ap', tripId, tx); }
  static markDirty(tripId: number, tx: DbOrTx) { return TripSnapshotService.markDirty('ap', tripId, tx); }
  static listDirty() { return TripSnapshotService.listDirty('ap'); }
  static recapture(tripId: number, transaction?: Tx) { return TripSnapshotService.recapture('ap', tripId, transaction); }
}
