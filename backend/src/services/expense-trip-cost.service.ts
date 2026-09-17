import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { round2dp } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { getTripCompositeInTx, upsertTripFinancialState } from './trip-composite.service';
import { createFinancialPosting, getActiveFinancialPosting } from './financial-posting.service';
import { captureProfitabilityAttributionSnapshot } from './profitability.service';
import { LedgerService } from './ledger.service';
import { SnapshotServices } from './snapshot-services';

export function reconciledDriverCosts(rows: ReadonlyArray<{ costType: string; costGroup: string | null; amount: string; customerChargeAmount: string | null }>) {
  const tolls = rows.filter(row => row.costType === 'TOLL');
  return {
    toll: tolls.length ? tolls.reduce((sum, row) => round2dp(sum + Number(row.amount)), 0) : null,
    extra: rows.filter(row => row.costType !== 'TOLL' && row.costType !== 'ROAD_ALLOWANCE'
      && (row.costGroup === 'DRIVER_ROAD' || Number(row.customerChargeAmount ?? 0) === 0))
      .reduce((sum, row) => round2dp(sum + Number(row.amount)), 0),
  };
}

/** Rebuild derived transport cost from confirmed claims; never accumulate a replay's delta. */
export async function refreshExpenseTripCosts(tx: Tx, tripId: number) {
  const firstRead = await getTripCompositeInTx(tx, tripId);
  if (!firstRead || firstRead.status === 'CANCELED') return;
  const [pair] = firstRead.activeTripPairId ? await tx.select().from(s.tripPairs).where(eq(s.tripPairs.id, firstRead.activeTripPairId)) : [];
  const pairIds = pair?.status === 'ACTIVE' ? [pair.firstTripId, pair.secondTripId] : [tripId];
  await lockTripFinancialAuthority(tx, pairIds);
  const sourceRows = await tx.select({ e: s.driverIncidentalCosts }).from(s.driverIncidentalCosts)
    .innerJoin(s.expenseAccountingSources, and(eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), eq(s.expenseAccountingSources.sourceId, s.driverIncidentalCosts.id)))
    .where(and(inArray(s.driverIncidentalCosts.tripId, pairIds), eq(s.expenseAccountingSources.status, 'RECORDED'), isNotNull(s.expenseAccountingSources.confirmedAt)));
  const totalToll = reconciledDriverCosts(sourceRows.map(row => row.e)).toll;
  for (const id of [...pairIds].sort((a, b) => a - b)) {
    await lockTripFinancialAuthority(tx, [id]);
    await assertTripShipmentAccountingUnlocked(tx, id);
    const current = await getTripCompositeInTx(tx, id);
    if (!current || current.status === 'CANCELED') continue;
    const own = reconciledDriverCosts(sourceRows.filter(row => row.e.tripId === id).map(row => row.e));
    const actualToll = totalToll == null ? null : pair?.status === 'ACTIVE'
      ? id === pair.firstTripId ? totalToll : 0 : own.toll;
    const toll = actualToll ?? Math.max(0, (current.tollsStations ?? 0) * Number(current.tollPerStationApplied ?? 0) - Number(current.tollDeduction ?? 0));
    const extra = own.extra;
    const delta = round2dp((current.carrierType === 'OWN' ? toll - Number(current.tollCost ?? 0) : 0) + extra - Number(current.reconciledExtraCost ?? 0));
    if (delta === 0 && current.reconciledTollCost === (actualToll == null ? null : String(actualToll)) && Number(current.reconciledExtraCost ?? 0) === extra) continue;
    await upsertTripFinancialState(tx, id, { reconciledTollCost: actualToll == null ? null : String(actualToll), reconciledExtraCost: String(extra),
      tollCost: String(toll), totalCost: String(round2dp(Number(current.totalCost ?? 0) + delta)), grossProfit: String(round2dp(Number(current.grossProfit ?? 0) - delta)) });
    const [updated] = await tx.update(s.trips).set({ version: current.version + 1, updatedAt: new Date() }).where(eq(s.trips.id, id)).returning();
    if (current.status === 'COMPLETED') {
      const existing = await getActiveFinancialPosting(tx, id);
      const prior = existing ?? await createFinancialPosting(tx, { tripId: id, tripVersion: current.version, reason: 'COMPLETION', effectiveAt: current.completedAt ?? undefined });
      const fees = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, id));
      const authority = { id, tripCode: current.tripCode, customerId: current.customerId, driverId: current.driverId,
        revenue: current.revenue, driverSalary: current.driverSalary, carrierType: current.carrierType ?? 'OWN',
        externalEntityId: current.externalEntityId, externalEntityType: current.externalEntityType,
        externalFreightCost: current.externalFreightCost, fuelSupplierId: current.fuelSupplierId,
        totalFuelCost: current.totalFuelCost, fuelSurchargeAmount: current.fuelSurchargeAmount,
        ancillaryFees: fees.map(fee => ({ id: fee.id, buyAmount: fee.buyAmount, sellAmount: fee.sellAmount,
          settlementMethod: fee.settlementMethod, supplierId: fee.supplierId, forwarderId: fee.forwarderId, approvalStatus: fee.approvalStatus })) };
      await LedgerService.postTripCompletionReverse(tx, authority, { strict: false, financialPostingId: prior.id });
      const posting = await createFinancialPosting(tx, { tripId: id, tripVersion: updated.version, reason: 'GOVERNED_CORRECTION' });
      await LedgerService.postTripCompletion(tx, authority, { strict: false, financialPostingId: posting.id });
      await captureProfitabilityAttributionSnapshot(tx, id, posting.id);
      await SnapshotServices.markBothDirty(id, tx);
    }
  }
}
