/**
 * A8 / GAP 8b — P&L invariant regression (feedback202606).
 *
 * Integration test against the dev DB. Exercises the REAL `getPnlReport`
 * (cache bypassed so assertions hit fresh values, not a stale cache) and
 * pins three load-bearing financial invariants on the returned structure:
 *
 *   (a) Σ all vehicle-bucket profit == adjustedGrossProfit.
 *       The "Xe ngoài" bucket contributes its external-carrier management
 *       margin exactly once, alongside own-truck profit.
 *
 *   (b) Penalty income enters the books exactly once — in `otherIncome`, which
 *       flows into `netProfit` via the single documented formula
 *       `netProfit = adjustedGrossProfit − managementFee − companyExpenses + otherIncome`
 *       (pnl.service.ts:178). Penalties must never also be folded into a truck's
 *       `profit` (they would then double-count). Invariant (a) guarantees the
 *       truck-profit side excludes them; the algebraic netProfit check below
 *       guarantees the single-entry side.
 *
 *   (c) Ancillary service/ocean-fee margin is intentionally excluded from
 *       transport P&L. Those amounts feed debit notes and customer AR only.
 *
 * Tolerance: VND is integer (numeric scale 0). Revenue is rounded per-trip for
 * VAT stripping (pnl.service.ts:64), so Σ per-trip-rounded grossProfit can drift
 * from round(aggregate) by up to ~1 per VAT-rated trip. Tolerance scales with
 * trip count; a real bug (double-count, sign flip, dropped maintenance) is off
 * by thousands+ and still trips the assertion.
 *
 * Plan ref: feedback202606 finalization plan §2 (A8).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { db, client } from '../db';
import * as s from '../db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { getPnlReport } from '../services/pnl.service';
import { cacheInvalidate, disconnectRedis } from '../lib/redis';

interface PnlReport {
  totalRevenue: number;
  totalCosts: number;
  grossProfit: number; // == adjustedGrossProfit
  managementFee: number;
  otherIncome: number;
  companyExpenses: number;
  netProfit: number;
  serviceMarginTotal: number;
  maintenanceByComponent: Record<number, { truck: number; trailer: number }>;
  maintenanceItemsByTruck: Record<number, Array<{
    vehicleComponent: 'TRUCK' | 'TRAILER' | null;
    amount: number;
  }>>;
  tripDetails: Array<{
    vehicleBucketId: number;
    revenue: number;
    customerCommission: number;
    totalCost: number;
    profit: number;
    isExternal: boolean;
  }>;
  trucks: Array<{
    id: number;
    plate: string;
    revenue: number;
    costs: number;
    profit: number;
    trips: number;
    serviceMargin?: number;
    externalMargin?: number;
    maintenanceExpenses: number;
  }>;
}

let period: { month: number; year: number } | null = null;
let report: PnlReport | null = null;
let ownTripCount = 0;

before(async () => {
  // Discover the most recent month that has revenue-bearing OWN trips, so the
  // test is meaningful regardless of which period holds data.
  const yr = sql<number>`extract(year from ${s.trips.departureDate})::int`;
  const mo = sql<number>`extract(month from ${s.trips.departureDate})::int`;
  const [row] = await db.select({ year: yr, month: mo, n: sql<number>`count(*)::int` })
    .from(s.trips)
    .where(and(
      isNull(s.trips.deletedAt),
      inArray(s.trips.status, [TripStatus.COMPLETED]),
      sql`coalesce(${s.trips.carrierType}, 'OWN') = 'OWN'`,
      sql`${s.trips.truckId} IS NOT NULL`,
      sql`coalesce(${s.trips.revenue}, '0')::numeric > 0`,
    ))
    .groupBy(yr, mo)
    .orderBy(sql`max(${s.trips.departureDate}) DESC`)
    .limit(1);

  if (!row) return; // no data — tests below skip gracefully
  period = { month: Number(row.month), year: Number(row.year) };

  // Bypass the cache so we assert fresh values, not a stale cached report.
  await cacheInvalidate(`reports:pnl:${period.month}:${period.year}`);
  const r = await getPnlReport(period.month, period.year) as PnlReport;
  report = r;
  ownTripCount = r.trucks.filter(t => t.id !== 0).reduce((a, t) => a + t.trips, 0);

});

after(async () => {
  await disconnectRedis();
  await client.end();
});

// Tolerance scales with trip count (per-trip VAT-stripping rounding); floor 50.
const tolerance = () => Math.max(50, ownTripCount * 2);

describe('A8 — P&L invariants (integration, dev DB)', () => {
  test('fixture: a data-rich period was found', () => {
    if (!period || !report) {
      console.log('   [skip] no revenue-bearing OWN trips in DB — nothing to assert');
      assert.ok(true, 'no data; invariants vacuously hold');
      return;
    }
    assert.ok(period.month >= 1 && period.month <= 12);
    assert.ok(report.trucks.length >= 0);
  });

  test('(a) Σ OWN-truck costs == report.totalCosts (maintenance counted exactly once)', () => {
    if (!report || ownTripCount === 0) { assert.ok(true, 'no own trucks'); return; }
    // Real "no double-count" guard. Both sides read the STORED trips.totalCost
    // (not a stale derived value), so this reconciles where profit cannot (see
    // a.div). Own-truck `costs` = Σ trip.totalCost + maintenanceExpenses
    // (pnl.service.ts:152,:170); report.totalCosts = adjustedTotalCosts =
    // Σ trip.totalCost + totalMaintenance (pnl.service.ts:177). Maintenance must
    // appear exactly once — never zero, never twice.
    const ownTrucks = report.trucks.filter(t => t.id !== 0);
    const sumOwnCosts = ownTrucks.reduce((a, t) => a + t.costs, 0);
    const diff = Math.abs(sumOwnCosts - report.totalCosts);
    assert.ok(
      diff <= tolerance(),
      `Σ own-truck costs (${sumOwnCosts}) must equal report.totalCosts (${report.totalCosts}); diff=${diff} (maintenance double/under-counted?)`,
    );
  });

  test('(a.component) maintenance component totals equal their visible expense items', () => {
    if (!report) { assert.ok(true, 'no report'); return; }
    for (const [truckIdText, items] of Object.entries(report.maintenanceItemsByTruck ?? {})) {
      const truckId = Number(truckIdText);
      const expected = items.reduce((sum, item) => {
        if (item.vehicleComponent === 'TRAILER') sum.trailer += item.amount;
        else sum.truck += item.amount;
        return sum;
      }, { truck: 0, trailer: 0 });
      assert.deepEqual(
        report.maintenanceByComponent[truckId],
        expected,
        `truck ${truckId} component totals must sum every visible maintenance item`,
      );
    }
  });

  test('(a.div) Σ all vehicle-bucket profit == adjustedGrossProfit', () => {
    if (!report || ownTripCount === 0) { assert.ok(true, 'no own trucks'); return; }
    // Per-truck profit must be recomputed from current revenue/cost/service
    // fee inputs, not the denormalized trips.grossProfit column. This catches
    // revenue edits that would otherwise leave the truck breakdown stale.
    // Remediation path: backend/scripts/recost-gross-profit.ts (dry-run recost
    // analyzer; sign-off-gated --apply).
    const sumBucketProfit = report.trucks.reduce((sum, truck) => sum + truck.profit, 0);
    const diff = Math.abs(report.grossProfit - sumBucketProfit);
    assert.ok(
      diff <= tolerance(),
      `adjustedGrossProfit (${report.grossProfit}) must equal Σ bucket profit (${sumBucketProfit}); diff=${diff}`,
    );
  });

  test('(a.detail) expandable trip rows reconcile with each vehicle summary', () => {
    if (!report) { assert.ok(true, 'no report'); return; }
    for (const truck of report.trucks) {
      const details = report.tripDetails.filter(detail => detail.vehicleBucketId === truck.id);
      assert.equal(details.length, truck.trips, `${truck.plate} detail count must match its summary`);
      assert.equal(details.reduce((sum, detail) => sum + detail.revenue, 0), truck.revenue);
      const tripCosts = details.reduce((sum, detail) => sum + detail.totalCost, 0);
      assert.equal(tripCosts + truck.maintenanceExpenses, truck.costs);
      assert.equal(details.reduce((sum, detail) => sum + detail.profit, 0) - truck.maintenanceExpenses, truck.profit);
    }
  });

  test('(b) penalty/otherIncome enters netProfit exactly once (no truck double-count)', () => {
    if (!report) { assert.ok(true, 'no report'); return; }
    // netProfit = adjustedGrossProfit − managementFee − companyExpenses + otherIncome (pnl.service.ts:178).
    // Solving for otherIncome isolates the single penalty contribution.
    const derivedOtherIncome =
      report.netProfit - (report.grossProfit - report.managementFee - report.companyExpenses);
    const diff = Math.abs(derivedOtherIncome - report.otherIncome);
    assert.ok(
      diff <= tolerance(),
      `otherIncome (penalties) must enter netProfit exactly once: derived=${derivedOtherIncome}, reported=${report.otherIncome}, diff=${diff}`,
    );
  });

  test('(c) service/ocean-fee margin stays out of transport P&L', () => {
    if (!report) { assert.ok(true, 'no report'); return; }
    assert.equal(report.serviceMarginTotal, 0, 'serviceMarginTotal is compatibility-only and stays zero');
    for (const truck of report.trucks) {
      assert.equal(truck.serviceMargin ?? 0, 0, `truck ${truck.plate || truck.id} serviceMargin stays zero`);
    }
    const netProfitFormula =
      report.grossProfit - report.managementFee - report.companyExpenses + report.otherIncome;
    const diff = Math.abs(report.netProfit - netProfitFormula);
    assert.ok(
      diff <= tolerance(),
      `netProfit (${report.netProfit}) must equal transport-only formula (${netProfitFormula}); diff=${diff}.`,
    );
  });

  test('(c.2) external "Xe ngoài" bucket profit equals external carrier margin only', () => {
    if (!report) { assert.ok(true, 'no report'); return; }
    const ext = report.trucks.find(t => t.id === 0);
    if (!ext) { assert.ok(true, 'no external trips this period'); return; }
    const extProfitReconstructed = ext.externalMargin ?? 0;
    assert.ok(
      Math.abs(ext.profit - extProfitReconstructed) <= tolerance(),
      `external "Xe ngoài" profit (${ext.profit}) must equal externalMargin (${extProfitReconstructed})`,
    );
  });

  test('commission-bearing report uses recorded revenue and excludes pre-reportable trips', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const testYear = 2098;
    const testMonth = 7;
    const createdTripIds: number[] = [];
    let customerId: number | null = null;
    let routeId: number | null = null;
    let cargoTypeId: number | null = null;

    try {
      const [customer] = await db.insert(s.customers).values({ name: `P&L customer ${suffix}` }).returning();
      const [route] = await db.insert(s.routes).values({ name: `P&L route ${suffix}` }).returning();
      const [cargoType] = await db.insert(s.cargoTypes).values({ name: `P&L cargo ${suffix}` }).returning();
      customerId = customer.id;
      routeId = route.id;
      cargoTypeId = cargoType.id;

      const inserted = await db.insert(s.trips).values([
        {
          tripCode: `PNL-OWN-${suffix}`.slice(0, 50),
          customerId,
          routeId,
          cargoTypeId,
          status: TripStatus.COMPLETED,
          departureDate: '2098-07-10',
          completedAt: new Date('2098-07-10T05:00:00.000Z'),
          vatRate: '0.080',
          revenue: '10800000',
          customerCommission: '1000000',
          totalCost: '2000000',
          totalFuelCost: '2000000',
          carrierType: 'OWN',
        },
        {
          tripCode: `PNL-EXT-${suffix}`.slice(0, 50),
          customerId,
          routeId,
          cargoTypeId,
          status: TripStatus.COMPLETED,
          departureDate: '2098-07-11',
          completedAt: new Date('2098-07-11T05:00:00.000Z'),
          vatRate: '0.080',
          revenue: '8640000',
          customerCommission: '500000',
          totalCost: '5000000',
          externalFreightCost: '5000000',
          carrierType: 'EXTERNAL',
        },
        {
          tripCode: `PNL-DRAFT-${suffix}`.slice(0, 50),
          customerId,
          routeId,
          cargoTypeId,
          status: TripStatus.CREATED,
          departureDate: '2098-07-12',
          revenue: '99000000',
          customerCommission: '9000000',
          totalCost: '1',
          carrierType: 'OWN',
        },
        {
          tripCode: `PNL-TRANSIT-${suffix}`.slice(0, 50),
          customerId,
          routeId,
          cargoTypeId,
          status: TripStatus.IN_TRANSIT,
          departureDate: '2098-07-13',
          revenue: '88000000',
          customerCommission: '8000000',
          totalCost: '1',
          carrierType: 'OWN',
        },
      ]).returning({ id: s.trips.id });
      createdTripIds.push(...inserted.map(trip => trip.id));

      await cacheInvalidate(`reports:pnl:${testMonth}:${testYear}`);
      const fixtureReport = await getPnlReport(testMonth, testYear) as PnlReport & { tripCount: number };

      assert.equal(fixtureReport.tripCount, 2, 'only COMPLETED trips belong in P&L');
      assert.equal(fixtureReport.totalRevenue, 11_500_000, 'period revenue includes own revenue plus external margin');
      assert.equal(fixtureReport.grossProfit, 9_500_000, 'period gross profit includes external margin exactly once');
      assert.equal(
        fixtureReport.trucks.reduce((sum, truck) => sum + truck.profit, 0),
        fixtureReport.grossProfit,
      );

      const own = fixtureReport.trucks.find(truck => truck.id === -1);
      assert.ok(own, 'unassigned OWN bucket is present');
      assert.equal(own.revenue, 9_000_000);
      assert.equal(own.profit, 7_000_000);

      const external = fixtureReport.trucks.find(truck => truck.id === 0);
      assert.ok(external, 'external bucket is present');
      assert.equal(external.revenue, 7_500_000);
      assert.equal(external.profit, 2_500_000);

      const details = fixtureReport.tripDetails.sort((a, b) => a.revenue - b.revenue);
      assert.deepEqual(
        details.map(detail => ({
          revenue: detail.revenue,
          customerCommission: detail.customerCommission,
          profit: detail.profit,
        })),
        [
          { revenue: 7_500_000, customerCommission: 500_000, profit: 2_500_000 },
          { revenue: 9_000_000, customerCommission: 1_000_000, profit: 7_000_000 },
        ],
      );
    } finally {
      await cacheInvalidate(`reports:pnl:${testMonth}:${testYear}`);
      if (createdTripIds.length > 0) {
        await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
      }
      if (cargoTypeId != null) await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
      if (routeId != null) await db.delete(s.routes).where(eq(s.routes.id, routeId));
      if (customerId != null) await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
  });
});
