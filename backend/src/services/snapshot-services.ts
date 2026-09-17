import { computeFuelSurcharge } from '@tingting/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { ApSnapshotService, ArSnapshotService } from './trip-snapshots.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { upsertTripFinancialState } from './trip-composite.service';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

export class SnapshotServices {
  /**
   * PostgreSQL aborts a transaction after any statement error. Isolate AP
   * capture behind a savepoint so completion can deliberately degrade to the
   * dirty queue without losing the completed trip or its ledger posting.
   */
  static async captureApWithDegradation(tripId: number, tx: Tx): Promise<boolean> {
    try {
      // Drizzle's nested transaction is a real PostgreSQL savepoint and also
      // clears postgres-js's failed-query state when it rolls back. Hand-written
      // SAVEPOINT SQL is insufficient with this driver: the original statement
      // error is still rethrown when the outer transaction completes.
      await tx.transaction(async (captureTx) => {
        await ApSnapshotService.captureSnapshot(tripId, captureTx);
      });
      return true;
    } catch (error) {
      console.warn('[ap-snapshot] capture failed; queued for reconciliation', {
        tripId,
        error: error instanceof Error ? error.message : error,
      });
      await upsertTripFinancialState(tx, tripId, {
        apCostHash: null,
        apSnapshotDirty: true,
        apSnapshotChangedAt: new Date(),
      });
      return false;
    }
  }

  static async markBothDirty(tripId: number, txOrDb: DbOrTx): Promise<void> {
    if (txOrDb === db) {
      await db.transaction(async (tx) => {
        await ArSnapshotService.markDirty(tripId, tx);
        await ApSnapshotService.markDirty(tripId, tx);
      });
      return;
    }

    await ArSnapshotService.markDirty(tripId, txOrDb);
    await ApSnapshotService.markDirty(tripId, txOrDb);
  }

  static async listFuelSurchargeDirty() {
    return db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      customerId: s.trips.customerId,
      completedAt: s.trips.completedAt,
      updatedAt: s.trips.updatedAt,
    }).from(s.trips)
      .innerJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
      .where(and(
        eq(s.trips.status, 'COMPLETED'),
        eq(s.tripFinancialState.fuelSurchargeSnapshotDirty, true),
      ))
      .orderBy(s.trips.updatedAt);
  }

  static async recaptureFuelSurcharge(tripId: number, transaction?: Tx): Promise<void> {
    const execute = async (tx: Tx) => {
      await lockTripFinancialAuthority(tx, [tripId]);
      const [trip] = await tx.select({
        status: s.trips.status,
        customerId: s.trips.customerId,
        fuelLiters: s.tripFinancialState.fuelLiters,
        fuelSurchargeAmount: s.tripFinancialState.fuelSurchargeAmount,
      }).from(s.trips)
        .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
        .where(eq(s.trips.id, tripId))
        .limit(1)
        .for('update', { of: [s.trips] });
      if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
      if (trip.status !== 'COMPLETED') {
        throw new ApiError(409, 'Chỉ có thể chụp lại phụ phí nhiên liệu cho chuyến đã hoàn thành');
      }

      const [[customer], [config]] = await Promise.all([
        tx.select({ fuelSurchargeSharePct: s.customers.fuelSurchargeSharePct })
          .from(s.customers)
          .where(eq(s.customers.id, trip.customerId))
          .limit(1),
        tx.select({
          unitPrice: s.fuelConfig.unitPrice,
          baseUnitPrice: s.fuelConfig.baseUnitPrice,
        }).from(s.fuelConfig)
          .where(isNull(s.fuelConfig.deletedAt))
          .limit(1),
      ]);
      const currentPrice = config?.unitPrice != null ? Number(config.unitPrice) : null;
      const basePrice = config?.baseUnitPrice != null ? Number(config.baseUnitPrice) : null;
      const sharePct = customer?.fuelSurchargeSharePct != null
        ? Number(customer.fuelSurchargeSharePct)
        : null;
      const quotaLiters = Number(trip.fuelLiters ?? 0);
      const surcharge = computeFuelSurcharge({ currentPrice, basePrice, sharePct, quotaLiters });
      if (surcharge.amount !== Number(trip.fuelSurchargeAmount ?? 0)) {
        throw new ApiError(
          409,
          'Phụ phí nhiên liệu đã thay đổi; cần ghi nhận điều chỉnh tài chính trước khi chụp lại',
        );
      }

      // Trips-split: snapshot fields persist on the financial sidecar; the
      // trips.updatedAt freshness bump (pre-split side effect) is preserved.
      await upsertTripFinancialState(tx, tripId, {
        fuelSurchargeSnapshot: {
          currentFuelPrice: currentPrice,
          baseFuelPrice: basePrice,
          quotaLiters,
          customerSharePct: sharePct,
          customerId: trip.customerId,
          computedAt: new Date().toISOString(),
        },
        fuelSurchargeSnapshotDirty: false,
      });
      await tx.update(s.trips).set({ updatedAt: new Date() }).where(eq(s.trips.id, tripId));
    };
    await runInTx(transaction, execute);
  }
}
