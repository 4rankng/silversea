// Wave 7 (SIL-676 / SIL-638 TC3-T3) — completion-time economics writer.
//
// QA pair 29 (trips 320+321, both COMPLETED) closed with tollCost 0/null and
// driverSalary null on BOTH legs: the only salary writers lived in the
// dispatcher figures-save path (updateTripFigures) and the pairing
// transaction, so a pair closed purely through the driver app completed with
// unmaterialed economics and the ledger posted no DRIVER_SALARY credit.
// materializeCompletedTripEconomics applies the pure laws from
// trip-pair-rules.service at the completion transition itself, BEFORE the
// completion posting, so the ledger and every economics surface read complete
// numbers. COMPLETED-trip figures still change only through governed
// corrections afterwards — this runs inside the completion commit moment.
import { aliasedTable, and, eq, inArray } from 'drizzle-orm';
import { round2dp } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { applyTripPatch, tripCompositeSelect } from './trip-composite.service';
import { getPairSalarySettingsFrom, pairSurchargeFor } from './pair-salary-settings.service';
import {
  completedLegSalaryLaw,
  netTollForCompletedLeg,
  tripCostBreakdown,
  type TripCostBreakdown,
} from './trip-pair-rules.service';

/** What one completion transition materialized (or why it was a no-op). */
export interface MaterializedEconomics {
  tripId: number;
  changed: boolean;
  salarySource: 'stored' | 'pair_surcharge' | 'base_allocation' | 'route_default' | 'none';
  salaryBefore: number;
  salaryAfter: number;
  surchargeApplied: number;
  tollBefore: number;
  tollAfter: number;
  tripWageDays: number;
}

/** The live pair-salary context a leg reads (null when unpaired or broken). */
interface LegPairContext {
  order: 1 | 2;
  active: true;
  surcharge: number;
}

async function legPairContextFrom(
  q: typeof db | Tx,
  activeTripPairId: number | null,
  activeTripPairOrder: number | null,
): Promise<LegPairContext | null> {
  if (activeTripPairId == null || activeTripPairOrder == null) return null;
  const [pairRow] = await q.select({
    status: s.tripPairs.status,
    pairKind: s.tripPairs.pairKind,
  }).from(s.tripPairs).where(eq(s.tripPairs.id, activeTripPairId)).limit(1);
  if (pairRow?.status !== 'ACTIVE') return null;
  const settings = await getPairSalarySettingsFrom(q);
  return {
    order: activeTripPairOrder as 1 | 2,
    active: true,
    surcharge: pairSurchargeFor(pairRow.pairKind as 'KEP' | 'KET_HOP', settings),
  };
}

export interface TripBreakdownContext {
  breakdown: TripCostBreakdown;
  pair: LegPairContext | null;
}

/**
 * The explicit per-leg cost breakdown for a composed trip row — the shared
 * read model for the driver trip detail and the ops trip composite GET.
 * Reads the pair + surcharge settings live; every number is present (0 is an
 * honest computed value, never a gap).
 */
export async function buildTripBreakdown(row: {
  revenue: string | null;
  driverSalary: string | null;
  totalFuelCost: string | null;
  totalRoadAllowance: string | null;
  totalCost: string | null;
  tollsStations: number | null;
  tollPerStationApplied: string | null;
  tollDeduction: string | null;
  reconciledTollCost: string | null;
  activeTripPairId: number | null;
  activeTripPairOrder: number | null;
}): Promise<TripBreakdownContext> {
  const pair = await legPairContextFrom(db, row.activeTripPairId, row.activeTripPairOrder);
  return {
    pair,
    breakdown: tripCostBreakdown({
      revenue: row.revenue,
      driverSalary: row.driverSalary,
      totalFuelCost: row.totalFuelCost,
      totalRoadAllowance: row.totalRoadAllowance,
      totalCost: row.totalCost,
      tollsStations: row.tollsStations,
      tollPerStationApplied: row.tollPerStationApplied,
      tollDeduction: row.tollDeduction,
      reconciledTollCost: row.reconciledTollCost,
      pair,
    }),
  };
}

/**
 * Materialize a COMPLETED leg's economics per the pure laws:
 * driver salary (stored → pair surcharge → base allocation) and the
 * once-per-pair VETC net toll, with the matching totalCost/grossProfit delta.
 * Idempotent: an already-materialized leg whose stored values agree with the
 * laws writes nothing.
 */
export async function materializeCompletedTripEconomics(
  tx: Tx,
  tripId: number,
  completedAt: Date,
): Promise<MaterializedEconomics | null> {
  // The completion transition already holds the trips row lock; plain read.
  const [trip] = await tx.select(tripCompositeSelect())
    .from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId))
    .limit(1);
  if (!trip) return null;
  // External carriers have no driver wage or VETC allowance in this model.
  if ((trip.carrierType ?? 'OWN') !== 'OWN') return null;

  const pair = await legPairContextFrom(tx, trip.activeTripPairId ?? null, trip.activeTripPairOrder ?? null);

  let driverBaseSalary = 0;
  if (trip.driverId != null) {
    const [driver] = await tx.select({ baseSalary: s.drivers.baseSalary })
      .from(s.drivers).where(eq(s.drivers.id, trip.driverId)).limit(1);
    driverBaseSalary = Number(driver?.baseSalary ?? 0) || 0;
  }
  let routeSalary = 0;
  if (trip.routeId != null) {
    const [route] = await tx.select({ driverSalary: s.routes.driverSalary })
      .from(s.routes).where(eq(s.routes.id, trip.routeId)).limit(1);
    routeSalary = Number(route?.driverSalary ?? 0) || 0;
  }

  const salary = completedLegSalaryLaw({
    storedDriverSalary: trip.driverSalary,
    driverBaseSalary,
    routeDriverSalary: routeSalary,
    storedTripWageDays: trip.tripWageDays,
    departureDate: String(trip.departureDate),
    completedAt,
    pair,
  });
  const toll = netTollForCompletedLeg({
    tollsStations: trip.tollsStations,
    tollPerStationApplied: trip.tollPerStationApplied,
    tollDeduction: trip.tollDeduction,
    reconciledTollCost: trip.reconciledTollCost,
  });

  const salaryBefore = Math.max(0, Math.round(Number(trip.driverSalary ?? 0)) || 0);
  const tollBefore = Math.max(0, Math.round(Number(trip.tollCost ?? 0)) || 0);
  const costDelta = round2dp(salary.driverSalary - salaryBefore + toll.tollCost - tollBefore);
  if (!salary.applied && costDelta === 0) {
    return {
      tripId, changed: false, salarySource: salary.source,
      salaryBefore, salaryAfter: salary.driverSalary,
      surchargeApplied: salary.surchargeApplied,
      tollBefore, tollAfter: toll.tollCost,
      tripWageDays: salary.tripWageDays,
    };
  }

  const storedTotalCost = Math.max(0, Math.round(Number(trip.totalCost ?? 0)) || 0);
  const storedGrossProfit = trip.grossProfit != null
    ? Math.round(Number(trip.grossProfit))
    : Math.round(Number(trip.revenue ?? 0) || 0) - storedTotalCost;

  // Trips-split: driverSalary/tripWageDays/tollCost/totalCost/grossProfit all
  // route to trip_financial_state via the composite patch.
  await applyTripPatch(tx, tripId, {
    ...(salary.applied ? {
      driverSalary: String(salary.driverSalary),
      tripWageDays: salary.tripWageDays,
    } : {}),
    ...(toll.tollCost !== tollBefore ? { tollCost: String(toll.tollCost) } : {}),
    ...(costDelta !== 0 ? {
      totalCost: String(Math.max(0, round2dp(storedTotalCost + costDelta))),
      grossProfit: String(round2dp(storedGrossProfit - costDelta)),
    } : {}),
    updatedAt: new Date(),
  });

  return {
    tripId, changed: true, salarySource: salary.source,
    salaryBefore, salaryAfter: salary.driverSalary,
    surchargeApplied: salary.surchargeApplied,
    tollBefore, tollAfter: toll.tollCost,
    tripWageDays: salary.tripWageDays,
  };
}

// ─── Completed-pair settlement records (GET /api/settlements) ──────────────

export interface CompletedPairSettlementRecord {
  /** Discriminator: derived pair economics vs a manual OPS freeze batch. */
  source: 'TRIP_PAIR';
  pairId: number;
  pairKind: 'KEP' | 'KET_HOP';
  pairStatus: 'ACTIVE' | 'BROKEN';
  code: string;
  status: 'RECORDED';
  totalAmount: string;
  note: string;
  createdAt: string;
  firstTripId: number;
  secondTripId: number;
  firstTripCode: string | null;
  secondTripCode: string | null;
  economics: {
    tollOnceLeg: 1 | 2 | null;
    tollAmount: number;
    baseSalary: number;
    surcharge: number;
    totalSalary: number;
    firstLeg: TripCostBreakdown;
    secondLeg: TripCostBreakdown;
  };
}

/**
 * One record per trip pair with BOTH legs COMPLETED — the settlement record
 * QA's CHECK reads for a finished pair (VETC once + base wage + phụ phí).
 * Derived at read from the stored trip economics, so exactly one record per
 * pair by construction and the ops_settlements manual-batch semantics stay
 * untouched.
 */
export async function listCompletedPairSettlements(limit = 50): Promise<CompletedPairSettlementRecord[]> {
  const firstTrips = aliasedTable(s.trips, 'pair_first_trips');
  const rows = await db.select({
    id: s.tripPairs.id,
    pairKind: s.tripPairs.pairKind,
    status: s.tripPairs.status,
    firstTripId: s.tripPairs.firstTripId,
    secondTripId: s.tripPairs.secondTripId,
    firstCompletedAt: firstTrips.completedAt,
  })
    .from(s.tripPairs)
    .innerJoin(firstTrips, eq(firstTrips.id, s.tripPairs.firstTripId))
    .innerJoin(s.trips, eq(s.trips.id, s.tripPairs.secondTripId))
    .where(and(
      eq(firstTrips.status, 'COMPLETED'),
      eq(s.trips.status, 'COMPLETED'),
    ))
    .orderBy(s.tripPairs.id)
    .limit(limit);

  // Each leg's surcharge component reads its own live pair context below
  // (legPairContextFrom), so no outer settings fetch is needed here.
  const records: CompletedPairSettlementRecord[] = [];
  for (const row of rows) {
    const legRows = await db.select({
      id: s.tripsComposite.id,
      tripCode: s.tripsComposite.tripCode,
      revenue: s.tripsComposite.revenue,
      driverSalary: s.tripsComposite.driverSalary,
      totalFuelCost: s.tripsComposite.totalFuelCost,
      totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
      totalCost: s.tripsComposite.totalCost,
      tollsStations: s.tripsComposite.tollsStations,
      tollPerStationApplied: s.tripsComposite.tollPerStationApplied,
      tollDeduction: s.tripsComposite.tollDeduction,
      reconciledTollCost: s.tripsComposite.reconciledTollCost,
      activeTripPairId: s.tripsComposite.activeTripPairId,
      activeTripPairOrder: s.tripsComposite.activeTripPairOrder,
    }).from(s.tripsComposite).where(inArray(s.tripsComposite.id, [row.firstTripId, row.secondTripId]));
    const legById = new Map(legRows.map((leg) => [leg.id, leg]));
    const firstLeg = legById.get(row.firstTripId);
    const secondLeg = legById.get(row.secondTripId);
    if (!firstLeg || !secondLeg) continue;

    const firstPair = await legPairContextFrom(db, firstLeg.activeTripPairId, firstLeg.activeTripPairOrder);
    const secondPair = await legPairContextFrom(db, secondLeg.activeTripPairId, secondLeg.activeTripPairOrder);
    const firstBreakdown = tripCostBreakdown({ ...firstLeg, pair: firstPair });
    const secondBreakdown = tripCostBreakdown({ ...secondLeg, pair: secondPair });
    const tollAmount = firstBreakdown.tolls + secondBreakdown.tolls;
    const totalSalary = firstBreakdown.salary + secondBreakdown.salary;
    records.push({
      source: 'TRIP_PAIR',
      pairId: row.id,
      pairKind: row.pairKind as 'KEP' | 'KET_HOP',
      pairStatus: row.status as 'ACTIVE' | 'BROKEN',
      code: `OS-PAIR-${row.id}`,
      status: 'RECORDED',
      totalAmount: String(tollAmount + totalSalary),
      note: `Quyết toán economics cặp ${row.pairKind === 'KEP' ? 'KẸP' : 'KẾT HỢP'} — VETC 1 lần ${tollAmount.toLocaleString('vi-VN')} ₫ + lương cơ bản ${firstBreakdown.salary.toLocaleString('vi-VN')} ₫ + phụ phí ${secondBreakdown.surcharge.toLocaleString('vi-VN')} ₫`,
      createdAt: (row.firstCompletedAt ?? new Date()).toISOString(),
      firstTripId: row.firstTripId,
      secondTripId: row.secondTripId,
      firstTripCode: firstLeg.tripCode,
      secondTripCode: secondLeg.tripCode,
      economics: {
        tollOnceLeg: firstBreakdown.tolls > 0 ? 1 : secondBreakdown.tolls > 0 ? 2 : null,
        tollAmount,
        baseSalary: firstBreakdown.salary,
        surcharge: secondBreakdown.surcharge,
        totalSalary,
        firstLeg: firstBreakdown,
        secondLeg: secondBreakdown,
      },
    });
  }
  return records;
}
