import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { round2dp } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

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
      && expense.approvalStatus === 'APPROVED'
      && expense.settlementMethod === 'COMPANY_DIRECT'
      && Number(expense.buyAmount ?? 0) > 0
    ))
    .sort((a, b) => a.id - b.id);
}

async function computeApHash(tripId: number, tx: DbOrTx): Promise<string> {
  const [trip] = await tx.select({
    carrierType: s.trips.carrierType,
    fuelSupplierId: s.trips.fuelSupplierId,
    totalFuelCost: s.trips.totalFuelCost,
    externalEntityId: s.trips.externalEntityId,
    externalEntityType: s.trips.externalEntityType,
    externalFreightCost: s.trips.externalFreightCost,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);

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

  const supplierExpenses = collectApPayableExpenses(expenses);
  const includeExternalCarrierPayable = (trip.carrierType ?? 'OWN') === 'EXTERNAL'
    && trip.externalEntityType === 'CUSTOMER'
    && trip.externalEntityId != null
    && Number(trip.externalFreightCost ?? 0) > 0;

  const payload = {
    carrierType: trip.carrierType ?? 'OWN',
    externalEntityId: includeExternalCarrierPayable
      ? trip.externalEntityId
      : null,
    externalFreightCost: includeExternalCarrierPayable
      ? round2dp(Number(trip.externalFreightCost ?? 0))
      : null,
    fuelSupplierId: trip.fuelSupplierId && Number(trip.totalFuelCost ?? 0) > 0
      ? trip.fuelSupplierId
      : null,
    totalFuelCost: trip.fuelSupplierId && Number(trip.totalFuelCost ?? 0) > 0
      ? round2dp(Number(trip.totalFuelCost ?? 0))
      : null,
    expenses: supplierExpenses.map((expense) => ({
      id: expense.id,
      buyAmount: round2dp(Number(expense.buyAmount ?? 0)),
      approvalStatus: expense.approvalStatus,
      settlementMethod: expense.settlementMethod,
      supplierId: expense.supplierId,
    })),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export class ApSnapshotService {
  static async captureSnapshot(tripId: number, tx: DbOrTx): Promise<void> {
    const hash = await computeApHash(tripId, tx);
    await tx.update(s.trips).set({
      apCostHash: hash,
      apSnapshotDirty: false,
      apSnapshotChangedAt: new Date(),
    }).where(eq(s.trips.id, tripId));
  }

  static async markDirty(tripId: number, tx: DbOrTx): Promise<void> {
    const [trip] = await tx.select({
      status: s.trips.status,
      apCostHash: s.trips.apCostHash,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    if (!trip || trip.status !== 'COMPLETED') return;

    const currentHash = await computeApHash(tripId, tx);
    const dirty = currentHash !== (trip.apCostHash ?? null);

    await tx.update(s.trips).set({
      ...(dirty ? { apSnapshotDirty: true } : {}),
      apSnapshotChangedAt: new Date(),
    }).where(eq(s.trips.id, tripId));
  }

  static async listDirty() {
    return db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      customerId: s.trips.customerId,
      completedAt: s.trips.completedAt,
      apSnapshotChangedAt: s.trips.apSnapshotChangedAt,
    }).from(s.trips)
      .where(eq(s.trips.apSnapshotDirty, true))
      .orderBy(s.trips.apSnapshotChangedAt);
  }

  static async recapture(tripId: number): Promise<void> {
    await db.transaction(async (tx) => {
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
        throw new ApiError(409, 'Chỉ có thể chụp lại đối soát AP cho chuyến đã hoàn thành');
      }
      await this.captureSnapshot(tripId, tx);
    });
  }
}
