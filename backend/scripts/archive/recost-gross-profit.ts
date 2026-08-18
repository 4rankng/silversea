/**
 * A8 (a.div) remediation — grossProfit recost dry-run analyzer.
 *
 * WHAT THIS DOES
 *   Recomputes each trip's `grossProfit` and `totalCost` from its CURRENT row
 *   using the SAME math the write-path uses (`computeTripTotals` from
 *   shared/src/calculations/tripTotals.ts — never reimplemented here), then
 *   compares against the stored, denormalized `trips.gross_profit` /
 *   `trips.total_cost` columns and reports every row that has drifted.
 *
 *   This is the data-side diagnostic for the documented ~34M VND P&L divergence
 *   pinned in `backend/src/tests/pnl-invariant.test.ts` (test `(a.div)`).
 *
 * DRY-RUN BY DEFAULT
 *   With no flags this script is READ-ONLY. It performs no DB writes and never
 *   updates `trips`. It is safe to run against any environment.
 *
 *   `--apply` alone is STILL a dry run: it prints "DRY RUN — sign-off required"
 *   and exits without writing. Writing additionally requires `--i-have-signoff`
 *   (i.e. `--apply --i-have-signoff`), and even then each changed row is logged
 *   before the UPDATE runs inside a single transaction.
 *
 * THE DIVERGENCE HAS TWO CAUSES (this script addresses only #1)
 *
 *   1. PRIMARY — stale denormalized columns. `trips.gross_profit` / `total_cost`
 *      go stale when a trip's revenue/costs are edited (incl. the now-fixed A1
 *      revenue-zeroing bug) without recomputing the denormalized totals. A
 *      recost (`--apply --i-have-signoff`) closes this component.
 *
 *   2. SECONDARY — commission / serviceMargin asymmetry. Inside
 *      `computeTripTotals` the customer `commission` is subtracted from
 *      freightExVat (→ recordedRevenue → grossProfit) but the P&L headline
 *      `adjustedGrossProfit` does NOT subtract commission; likewise own-truck
 *      `serviceMargin` is added into grossProfit by `computeTripTotals` but is
 *      stranded on the P&L side. So even a perfect grossProfit recost leaves a
 *      residual equal to (Σ commission − Σ own-truck serviceMargin) over the
 *      same trip set. This script quantifies that residual so the sign-off
 *      expectation is correct. Closing the residual requires a SEPARATE
 *      signed-off fix to `backend/src/services/pnl.service.ts`, NOT a data
 *      recost.
 *
 * SIGN-OFF GATE
 *   Applying the recost is money-data work. It requires explicit Pete / audit
 *   sign-off captured out-of-band. The `--i-have-signoff` flag is the operator's
 *   assertion that sign-off exists; it does NOT constitute sign-off itself.
 *
 * Usage:
 *   npx tsx scripts/recost-gross-profit.ts                         # dry-run report (default)
 *   npx tsx scripts/recost-gross-profit.ts --apply                 # still dry-run (sign-off guard)
 *   npx tsx scripts/recost-gross-profit.ts --apply --i-have-signoff # WRITE (requires sign-off)
 *   npx tsx scripts/recost-gross-profit.ts --sample 50             # show up to 50 stale rows
 *   npx tsx scripts/recost-gross-profit.ts --period 5 2026         # restrict to a month
 *   npx tsx scripts/recost-gross-profit.ts --trips 12,15,22        # restrict to specific trips
 *
 * Exit code: 0 if no STALE rows (all within 1 VND tolerance); 1 if any STALE
 * rows exist — so this can gate CI/deploys once the recost is approved and run.
 *
 * Plan ref: feedback202606 finalization plan §2 (A8 a.div).
 */
import { db, client } from '../src/db';
import * as s from '../src/db/schema';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { TripStatus, computeTripTotals, type ComputeTripTotalsInput } from '@tingting/shared';

// ─── CLI flags (match audit-revenue-splits.ts style) ────────────────────────
const APPLY = process.argv.includes('--apply');
const HAVE_SIGNOFF = process.argv.includes('--i-have-signoff');
const HELP = process.argv.includes('--help') || process.argv.includes('-h');

const SAMPLE_LIMIT = (() => {
  const i = process.argv.indexOf('--sample');
  if (i !== -1 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  }
  return 20;
})();

// Optional --period MONTH YEAR restriction (matches salary-period semantics:
// trips are otherwise scanned in bulk across all history).
const PERIOD = (() => {
  const i = process.argv.indexOf('--period');
  if (i !== -1 && process.argv[i + 1] && process.argv[i + 2]) {
    const month = Number(process.argv[i + 1]);
    const year = Number(process.argv[i + 2]);
    if (Number.isFinite(month) && month >= 1 && month <= 12 && Number.isFinite(year)) {
      return { month: Math.floor(month), year: Math.floor(year) };
    }
  }
  return null;
})();

// Optional --trips <csv> restriction — scope the scan to specific trip IDs
// (e.g. only the trips whose km was just backfilled). Keeps the sign-off delta
// clean: unrelated drift in other trips is NOT swept into a financial write.
const TRIPS_FLAG_IDX = process.argv.indexOf('--trips');
const TRIP_IDS = (() => {
  if (TRIPS_FLAG_IDX !== -1 && process.argv[TRIPS_FLAG_IDX + 1]) {
    return process.argv[TRIPS_FLAG_IDX + 1]
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
  }
  return null;
})();
// `--trips ""` / `--trips abc` parses to [] — refuse to fall through to a full-table
// scan (in WRITE_MODE that would rewrite every drifted financial row). Abort instead.
if (TRIPS_FLAG_IDX !== -1 && (TRIP_IDS === null || TRIP_IDS.length === 0)) {
  console.error(
    `--trips "${process.argv[TRIPS_FLAG_IDX + 1] ?? ''}" yielded no valid trip IDs; aborting ` +
      `(pass a non-empty CSV of positive IDs, or omit --trips to scan all).`,
  );
  process.exit(2);
}

const WRITE_MODE = APPLY && HAVE_SIGNOFF;
const TOLERANCE = 1; // VND is integer (numeric scale 0); 1 VND absorbs per-trip VAT rounding.

if (HELP) {
  console.log(`grossProfit recost dry-run analyzer (A8 a.div)

Usage:
  npx tsx scripts/recost-gross-profit.ts [options]

Options:
  --apply                  Enable write mode (still dry-run without --i-have-signoff)
  --i-have-signoff         Assert out-of-band Pete/audit sign-off exists (enables writes with --apply)
  --sample N               Show up to N stale rows in the report (default 20)
  --period MONTH YEAR      Restrict scan to one month (e.g. --period 5 2026)
  --trips 1,2,3            Restrict scan to specific trip IDs (csv) — clean scoped sign-off
  --help, -h               Show this help

Exit code: 0 if no STALE rows; 1 if any STALE rows exist.
`);
  process.exit(0);
}

interface RecostRow {
  id: number;
  tripCode: string | null;
  status: string;
  carrierType: string;
  truckId: number | null;
  departureDate: string | null;
  storedGrossProfit: number;
  recomputedGrossProfit: number;
  gpDelta: number; // stored - recomputed
  storedTotalCost: number;
  recomputedTotalCost: number;
  tcDelta: number;
  customerCommission: number;
  serviceMargin: number;
}

type Classification = 'MATCH' | 'STALE';

function classify(absDelta: number): Classification {
  return absDelta <= TOLERANCE ? 'MATCH' : 'STALE';
}

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

// Build the computeTripTotals input from a trip row + its legs + fees, using
// the SAME snapshotted columns the write-path persisted against. We do NOT
// re-fetch live fuel/road config — that would recost stored totals and is the
// exact behavior the LOCKED-invariant forbids (see trip-mutations.service.ts
// applyCommittedLegacyFuelFreeze). Snapshots are what was used at write time.
function buildTotalsInput(
  trip: TripRow,
  legs: Array<{ sequence: number; km: number; loadingType: 'HANG' | 'VO' }>,
  fees: Array<{ buyAmount: string | null; sellAmount: string | null; vatRate: string | null }>,
  isMountainRoute: boolean,
): ComputeTripTotalsInput {
  const fuelFixedAllowanceApplied = num(trip.fuelFixedAllowanceApplied);
  return {
    legs,
    fuelMode: (trip.fuelMode ?? 'AUTO') as 'AUTO' | 'FLAT_RATE',
    fuelLitersOverride: trip.fuelLitersOverride == null ? null : num(trip.fuelLitersOverride),
    fuelSupplementLiters: num(trip.fuelSupplementLiters),
    fuelLoadedNorm: num(trip.fuelLoadedNormApplied),
    fuelEmptyNorm: num(trip.fuelEmptyNormApplied),
    fuelPerTripSupplement: num(trip.fuelSupplementNormApplied),
    fuelUnitPrice: num(trip.fuelPriceApplied),
    fuelActualUnitPrice: trip.fuelActualUnitPrice == null ? null : num(trip.fuelActualUnitPrice),
    isMountainRoute,
    mountainFixedAllowance: fuelFixedAllowanceApplied > 0 ? fuelFixedAllowanceApplied : null,
    roadAllowanceBase: num(trip.roadAllowanceBaseApplied),
    tollsDiscount: num(trip.tollsDiscount),
    tollsAddition: num(trip.tollsAddition),
    tollsStations: num(trip.tollsStations),
    tollPerStation: num(trip.tollPerStationApplied),
    hasReturnCargo: !!trip.hasReturnCargo,
    returnCargoBonus: num(trip.returnCargoBonusApplied),
    revenue: num(trip.revenue),
    driverSalary: num(trip.driverSalary),
    twoPointDeliveryBonus: num(trip.twoPointDeliveryBonus),
    vehicleShiftAllowance: num(trip.vehicleShiftAllowance),
    roadAllowanceOverride: trip.roadAllowanceOverride == null ? null : num(trip.roadAllowanceOverride),
    vatRate: num(trip.vatRate),
    carrierType: ((trip.carrierType ?? 'OWN') === 'EXTERNAL' ? 'EXTERNAL' : 'OWN'),
    externalFreightCost: num(trip.externalFreightCost),
    ancillaryFees: fees.map(f => ({
      buyAmount: num(f.buyAmount),
      sellAmount: num(f.sellAmount),
      vatRate: num(f.vatRate) || 0.080,
    })),
    customerCommission: num(trip.customerCommission),
  };
}

// Minimal trip-row shape (drizzle returns numeric as string).
type TripRow = typeof s.trips.$inferSelect;

async function main() {
  if (APPLY && !HAVE_SIGNOFF) {
    console.log('DRY RUN — sign-off required');
    console.log('   --apply was passed without --i-have-signoff.');
    console.log('   No writes performed. Obtain Pete/audit sign-off, then re-run with both flags.');
    // Fall through to the read-only report so the operator sees what would change.
  }

  console.log('🔍 grossProfit Recost Analyzer (A8 a.div)');
  console.log(`   Mode: ${WRITE_MODE ? 'APPLY (write — sign-off asserted)' : 'dry-run (read-only)'}`);
  console.log(`   Period: ${PERIOD ? `${PERIOD.month}/${PERIOD.year}` : 'all history'}`);
  console.log(`   Scope:  ${TRIP_IDS ? `${TRIP_IDS.length} trip(s) [${TRIP_IDS.slice(0, 12).join(',')}${TRIP_IDS.length > 12 ? ',…' : ''}]` : 'all matched'}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // Load non-canceled, non-deleted trips. CANCELED trips are excluded from P&L
  // and from the (a.div) invariant. Both OWN and EXTERNAL are scanned; the
  // external bucket asymmetry (pnl.service.ts:231) is handled in the residual
  // section, not by excluding external trips here.
  const tripWhereParts = [
    ne(s.trips.status, TripStatus.CANCELED),
    isNull(s.trips.deletedAt),
  ];
  if (PERIOD) {
    // Month filter on calendar departure month (analyzer-level restriction;
    // not the salary-period window — close enough for a scoped recost).
    tripWhereParts.push(
      sql`extract(month from ${s.trips.departureDate})::int = ${PERIOD.month}`,
      sql`extract(year from ${s.trips.departureDate})::int = ${PERIOD.year}`,
    );
  }
  if (TRIP_IDS && TRIP_IDS.length > 0) {
    tripWhereParts.push(inArray(s.trips.id, TRIP_IDS));
  }
  const tripRows = await db.select().from(s.trips).where(and(...tripWhereParts));

  if (tripRows.length === 0) {
    console.log('   No trips matched. Nothing to analyze.');
    await client.end();
    process.exit(0);
  }

  const tripIds = tripRows.map(t => t.id);

  // Legs (one batched query).
  const legRows = await db.select({
    tripId: s.tripLegs.tripId,
    sequence: s.tripLegs.sequence,
    km: s.tripLegs.km,
    loadingType: s.tripLegs.loadingType,
  }).from(s.tripLegs).where(inArray(s.tripLegs.tripId, tripIds));
  const legsByTrip = new Map<number, Array<{ sequence: number; km: number; loadingType: 'HANG' | 'VO' }>>();
  for (const l of legRows) {
    if (!legsByTrip.has(l.tripId)) legsByTrip.set(l.tripId, []);
    legsByTrip.get(l.tripId)!.push({ sequence: l.sequence, km: l.km, loadingType: l.loadingType });
  }

  // Ancillary fees — match the WRITE path's "non-rejected" filter
  // (trip-mutations.service.ts:512 `ne(approvalStatus, 'REJECTED')`). The stored
  // grossProfit was persisted against non-rejected fees, so the recost must use
  // the same population to detect true drift. (P&L display uses APPROVED-only;
  // that asymmetry is reported separately below, not reconciled by a recost.)
  const feeRows = await db.select({
    tripId: s.tripExpenses.tripId,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    vatRate: s.forwarderExpenseTypes.vatRate,
  }).from(s.tripExpenses)
    .innerJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .where(and(
      inArray(s.tripExpenses.tripId, tripIds),
      ne(s.tripExpenses.approvalStatus, 'REJECTED'),
    ));
  const feesByTrip = new Map<number, Array<{ buyAmount: string | null; sellAmount: string | null; vatRate: string | null }>>();
  for (const f of feeRows) {
    if (!feesByTrip.has(f.tripId)) feesByTrip.set(f.tripId, []);
    feesByTrip.get(f.tripId)!.push({ buyAmount: f.buyAmount, sellAmount: f.sellAmount, vatRate: f.vatRate });
  }

  // route.isMountain (one batched query).
  const routeIds = [...new Set(tripRows.map(t => t.routeId).filter((id): id is number => id != null))];
  const routeRows = routeIds.length > 0
    ? await db.select({ id: s.routes.id, isMountain: s.routes.isMountain }).from(s.routes)
        .where(sql`${s.routes.id} IN (${sql.join(routeIds.map(id => sql`${id}`), sql`, `)})`)
    : [];
  const mountainByRoute = new Map<number, boolean>(routeRows.map(r => [r.id, !!r.isMountain]));

  const recostRows: RecostRow[] = [];
  let totalCommission = 0;      // commission subtracted in computeTripTotals but not in adjustedGrossProfit
  let totalOwnServiceMargin = 0; // own-truck serviceMargin added in computeTripTotals, stranded on P&L side

  for (const trip of tripRows) {
    const legs = legsByTrip.get(trip.id) ?? [];
    const fees = feesByTrip.get(trip.id) ?? [];
    const isMountainRoute = trip.routeId ? !!mountainByRoute.get(trip.routeId) : false;

    const totalsInput = buildTotalsInput(trip, legs, fees, isMountainRoute);
    const recomputed = computeTripTotals(totalsInput);

    const storedGp = num(trip.grossProfit);
    const storedTc = num(trip.totalCost);
    const recomputedGp = recomputed.grossProfit;
    const recomputedTc = recomputed.totalCost;

    recostRows.push({
      id: trip.id,
      tripCode: trip.tripCode,
      status: String(trip.status ?? ''),
      carrierType: String(trip.carrierType ?? 'OWN'),
      truckId: trip.truckId,
      departureDate: trip.departureDate,
      storedGrossProfit: storedGp,
      recomputedGrossProfit: recomputedGp,
      gpDelta: storedGp - recomputedGp,
      storedTotalCost: storedTc,
      recomputedTotalCost: recomputedTc,
      tcDelta: storedTc - recomputedTc,
      customerCommission: num(trip.customerCommission),
      serviceMargin: recomputed.serviceMargin,
    });

    totalCommission += num(trip.customerCommission);
    if ((trip.carrierType ?? 'OWN') === 'OWN') {
      totalOwnServiceMargin += recomputed.serviceMargin;
    }
  }

  // ─── Report ──────────────────────────────────────────────────────────────
  // A row is STALE if EITHER grossProfit OR totalCost drifted beyond tolerance.
  const classified = recostRows.map(r => {
    const absGp = Math.abs(r.gpDelta);
    const absTc = Math.abs(r.tcDelta);
    const cls = classify(Math.max(absGp, absTc));
    return { ...r, cls };
  });

  const matchRows = classified.filter(r => r.cls === 'MATCH');
  const staleRows = classified.filter(r => r.cls === 'STALE');

  const totalAbsGpDrift = staleRows.reduce((a, r) => a + Math.abs(r.gpDelta), 0);
  const totalAbsTcDrift = staleRows.reduce((a, r) => a + Math.abs(r.tcDelta), 0);
  const netSignedGpDrift = staleRows.reduce((a, r) => a + r.gpDelta, 0); // stored - recomputed; >0 means stored overstates profit
  const netSignedTcDrift = staleRows.reduce((a, r) => a + r.tcDelta, 0);

  // Residual = commission (subtracted in computeTripTotals, NOT in adjustedGrossProfit)
  //          − own-truck serviceMargin (added in computeTripTotals, stranded on P&L side).
  // A grossProfit recost brings Σ stored grossProfit in line with computeTripTotals,
  // but the headline vs. per-truck sum still diverges by this residual until
  // pnl.service.ts is fixed separately.
  const residualAsymmetry = totalCommission - totalOwnServiceMargin;
  const grossProfitClosableByRecost = Math.abs(netSignedGpDrift);

  console.log(`   Total trips scanned:        ${recostRows.length}`);
  console.log(`     • MATCH (within ${TOLERANCE} VND): ${matchRows.length}`);
  console.log(`     • STALE (drifted):         ${staleRows.length}`);
  console.log(`   grossProfit |drift| (Σ STALE): ${totalAbsGpDrift.toLocaleString()} VND`);
  console.log(`   grossProfit net signed drift: ${netSignedGpDrift.toLocaleString()} VND  (stored − recomputed; + = stored overstates profit)`);
  console.log(`   totalCost    |drift| (Σ STALE): ${totalAbsTcDrift.toLocaleString()} VND`);
  console.log(`   totalCost    net signed drift: ${netSignedTcDrift.toLocaleString()} VND\n`);

  if (staleRows.length > 0) {
    console.log(`${'─'.repeat(72)}`);
    console.log(`STALE rows (showing up to ${SAMPLE_LIMIT}, biggest |grossProfit drift| first):`);
    console.log(`${'─'.repeat(72)}`);
    const top = [...staleRows].sort((a, b) => Math.abs(b.gpDelta) - Math.abs(a.gpDelta)).slice(0, SAMPLE_LIMIT);
    for (const r of top) {
      console.log(
        `  ⚠️  Trip #${r.id} (${r.tripCode ?? '-'}) [${r.status}/${r.carrierType}${r.truckId ? ` truck#${r.truckId}` : ''}] ${r.departureDate ?? '-'}\n` +
        `       grossProfit: stored=${r.storedGrossProfit.toLocaleString()}  recomputed=${r.recomputedGrossProfit.toLocaleString()}  Δ=${r.gpDelta.toLocaleString()}\n` +
        `       totalCost:   stored=${r.storedTotalCost.toLocaleString()}  recomputed=${r.recomputedTotalCost.toLocaleString()}  Δ=${r.tcDelta.toLocaleString()}\n` +
        `       commission=${r.customerCommission.toLocaleString()}  serviceMargin=${r.serviceMargin.toLocaleString()}`,
      );
    }
    if (staleRows.length > SAMPLE_LIMIT) {
      console.log(`  …and ${staleRows.length - SAMPLE_LIMIT} more (raise with --sample N).`);
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('📋 Residual asymmetry a grossProfit recost will NOT close');
  console.log('═'.repeat(72));
  console.log(`   Σ customerCommission (all scanned trips): ${totalCommission.toLocaleString()} VND`);
  console.log(`   Σ own-truck serviceMargin (stranded):     ${totalOwnServiceMargin.toLocaleString()} VND`);
  console.log(`   Residual (commission − own serviceMargin): ${residualAsymmetry.toLocaleString()} VND\n`);
  console.log('   Expectation for sign-off:');
  console.log(`     • Recosting grossProfit would close ≈ ${grossProfitClosableByRecost.toLocaleString()} VND`);
  console.log('         of the stored-vs-recomputed drift (the stale-denormalized component).');
  console.log(`     • The residual ≈ ${residualAsymmetry.toLocaleString()} VND is the commission/serviceMargin`);
  console.log('         asymmetry between computeTripTotals and pnl.service.ts adjustedGrossProfit.');
  console.log('         It needs a SEPARATE signed-off fix to pnl.service.ts, NOT a data recost.');

  // ─── Optional apply (write) path ──────────────────────────────────────────
  if (WRITE_MODE) {
    if (staleRows.length === 0) {
      console.log('\n   No STALE rows — nothing to write.');
    } else {
      console.log('\n' + '═'.repeat(72));
      console.log(`🔧 APPLY: updating ${staleRows.length} trip(s) in a single transaction`);
      console.log('═'.repeat(72));
      // Drizzle's standalone transaction over the existing postgres-js client.
      await db.transaction(async (tx) => {
        for (const r of staleRows) {
          console.log(
            `   UPDATE trips #${r.id} (${r.tripCode ?? '-'}): ` +
            `gross_profit ${r.storedGrossProfit.toLocaleString()} → ${r.recomputedGrossProfit.toLocaleString()}, ` +
            `total_cost ${r.storedTotalCost.toLocaleString()} → ${r.recomputedTotalCost.toLocaleString()}`,
          );
          await tx.update(s.trips).set({
            grossProfit: String(r.recomputedGrossProfit),
            totalCost: String(r.recomputedTotalCost),
          }).where(eq(s.trips.id, r.id));
        }
      });
      console.log(`   ✅ Wrote ${staleRows.length} row(s).`);
    }
  } else if (APPLY && !HAVE_SIGNOFF) {
    // Already printed the "DRY RUN — sign-off required" banner at the top.
    console.log('\n   (No writes performed. Re-run with --apply --i-have-signoff once sign-off is captured.)');
  }

  await client.end();

  // Exit 1 if any STALE rows so this can gate CI/deploys once approved.
  process.exit(staleRows.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('❌ Recost analyzer failed:', err);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
