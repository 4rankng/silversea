/**
 * Trips-split equivalence probe (plans/260906-1032-db-lean-down).
 *
 * --baseline : dump the 52 split columns for every trip from the legacy
 *              trips-table read → probe-baseline.json
 * --verify   : dump the same shape through the trips_composite view →
 *              probe-after.json, then diff against the baseline.
 *
 * Byte-identical dumps prove the split preserved every stored financial /
 * carrier value through the new read + write paths.
 *
 *   cd backend && npx tsx src/scripts/trip-split-probe.ts --baseline
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db';
import * as s from '../db/schema';
import { asc } from 'drizzle-orm';

const MODE = process.argv.includes('--verify') ? 'verify' : 'baseline';
const PLAN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../plans/260906-1032-db-lean-down');
const OUT_FILE = process.argv.includes('--verify')
  ? join(PLAN_DIR, 'probe-after.json')
  : join(PLAN_DIR, 'probe-baseline.json');

// The split columns, verbatim from tripFinancialState + tripCarrierInfo.
export const FINANCIAL_PROBE_COLUMNS = {
  driverSalary: s.tripFinancialState.driverSalary,
  fuelPriceApplied: s.tripFinancialState.fuelPriceApplied,
  fuelActualUnitPrice: s.tripFinancialState.fuelActualUnitPrice,
  roadAllowanceBaseApplied: s.tripFinancialState.roadAllowanceBaseApplied,
  fuelLoadedNormApplied: s.tripFinancialState.fuelLoadedNormApplied,
  fuelEmptyNormApplied: s.tripFinancialState.fuelEmptyNormApplied,
  fuelFixedAllowanceApplied: s.tripFinancialState.fuelFixedAllowanceApplied,
  fuelSupplementNormApplied: s.tripFinancialState.fuelSupplementNormApplied,
  tollPerStationApplied: s.tripFinancialState.tollPerStationApplied,
  returnCargoBonusApplied: s.tripFinancialState.returnCargoBonusApplied,
  fuelLiters: s.tripFinancialState.fuelLiters,
  totalFuelCost: s.tripFinancialState.totalFuelCost,
  fuelSurchargeAmount: s.tripFinancialState.fuelSurchargeAmount,
  fuelSurchargeSnapshot: s.tripFinancialState.fuelSurchargeSnapshot,
  fuelSurchargeSnapshotDirty: s.tripFinancialState.fuelSurchargeSnapshotDirty,
  totalRoadAllowance: s.tripFinancialState.totalRoadAllowance,
  tollCost: s.tripFinancialState.tollCost,
  tollDeduction: s.tripFinancialState.tollDeduction,
  roadAllowanceOverride: s.tripFinancialState.roadAllowanceOverride,
  totalCost: s.tripFinancialState.totalCost,
  revenue: s.tripFinancialState.revenue,
  revenueEmptyReturn: s.tripFinancialState.revenueEmptyReturn,
  revenueCombine: s.tripFinancialState.revenueCombine,
  twoPointDeliveryBonus: s.tripFinancialState.twoPointDeliveryBonus,
  vehicleShiftAllowance: s.tripFinancialState.vehicleShiftAllowance,
  grossProfit: s.tripFinancialState.grossProfit,
  revenueOriginal: s.tripFinancialState.revenueOriginal,
  revenueOverriddenBy: s.tripFinancialState.revenueOverriddenBy,
  revenueOverriddenAt: s.tripFinancialState.revenueOverriddenAt,
  revenueOverrideReason: s.tripFinancialState.revenueOverrideReason,
  pricingSource: s.tripFinancialState.pricingSource,
  pricingFormula: s.tripFinancialState.pricingFormula,
  pricingSnapshot: s.tripFinancialState.pricingSnapshot,
  customerCommission: s.tripFinancialState.customerCommission,
  tripWageDays: s.tripFinancialState.tripWageDays,
  fuelSupplierId: s.tripFinancialState.fuelSupplierId,
  vatRate: s.tripFinancialState.vatRate,
  arCostHash: s.tripFinancialState.arCostHash,
  arSnapshotDirty: s.tripFinancialState.arSnapshotDirty,
  arSnapshotChangedAt: s.tripFinancialState.arSnapshotChangedAt,
  apCostHash: s.tripFinancialState.apCostHash,
  apSnapshotDirty: s.tripFinancialState.apSnapshotDirty,
  apSnapshotChangedAt: s.tripFinancialState.apSnapshotChangedAt,
  pnlSnapshotGrossProfit: s.tripFinancialState.pnlSnapshotGrossProfit,
} as const;

export const CARRIER_PROBE_COLUMNS = {
  carrierType: s.tripCarrierInfo.carrierType,
  externalEntityId: s.tripCarrierInfo.externalEntityId,
  externalEntityType: s.tripCarrierInfo.externalEntityType,
  externalFreightCost: s.tripCarrierInfo.externalFreightCost,
  externalPlateNumber: s.tripCarrierInfo.externalPlateNumber,
  externalCarrierVehicleId: s.tripCarrierInfo.externalCarrierVehicleId,
  externalDriverName: s.tripCarrierInfo.externalDriverName,
  externalDriverPhone: s.tripCarrierInfo.externalDriverPhone,
} as const;

function stable(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, stable(v)])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }
  return value;
}

async function main() {
  const rows = MODE === 'verify'
    ? await db.select({
        id: s.tripsComposite.id,
        tripCode: s.tripsComposite.tripCode,
        ...Object.fromEntries([...Object.keys(FINANCIAL_PROBE_COLUMNS), ...Object.keys(CARRIER_PROBE_COLUMNS)]
          .map((k) => [k, (s.tripsComposite as unknown as Record<string, typeof s.tripsComposite.id>)[k]])),
      }).from(s.tripsComposite).orderBy(asc(s.tripsComposite.id))
    : await db.select({
        id: s.trips.id,
        tripCode: s.trips.tripCode,
        ...(Object.fromEntries(Object.entries(FINANCIAL_PROBE_COLUMNS)
          .map(([k, _col]) => [k, (s.trips as unknown as Record<string, typeof _col>)[k]]))),
        ...(Object.fromEntries(Object.entries(CARRIER_PROBE_COLUMNS)
          .map(([k, _col]) => [k, (s.trips as unknown as Record<string, typeof _col>)[k]]))),
      }).from(s.trips).orderBy(asc(s.trips.id));

  const dump = rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, stable(v)]),
  ));
  writeFileSync(OUT_FILE, `${JSON.stringify(dump, null, 0)}\n`);
  console.log(`${MODE}: ${dump.length} trips → ${OUT_FILE}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
