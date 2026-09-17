/**
 * DEMO freight-pricing chain — dev + staging ONLY (PM decision D4, 2026-09-10).
 *
 * Makes the automatic freight engine demonstrable without waiting for the
 * customer's real contract values. Runs as part of the dev seed (`pnpm seed`)
 * and standalone after a staging deploy/stgdb cycle:
 *   npx tsx src/seed/seed-demo-freight-pricing.ts
 *
 * HARD BOUNDARY: seed-prod.ts deliberately EXCLUDES this module. Production
 * never receives invented contract data — real 15T prices and thresholds are
 * entered through the config UI when the customer delivers them.
 *
 * Converges seven things, all idempotent on natural keys:
 *   1. vehicle_size_classes — canonical 9-code catalog (ensure-if-missing).
 *   2. fuel_price_periods — the two REAL Excel fuel prices (insert-if-missing;
 *      existing period rows are audit records and are never modified).
 *   3. fuel_consumption_norms — design liters/km ladder @ 2026-09-09.
 *   3b. the 3 pricing routes — ensure-if-missing by normalized name so a
 *      staging DB that mirrors prod master data (no dev reference seeder
 *      ever ran there) still converges; existing routes never modified.
 *   3c. the REAL anchor rungs of the customer pricing matrix (5T/10T/
 *      CONT20/CONT40…) — insert-if-missing, so the demo 15T rungs hang
 *      off a real ladder on staging too.
 *   4. freight_rate_terms (LONG MINH × the 3 pricing routes) — D3 defaults
 *      (share %, billed km, base fuel price) plus the D4 threshold demo:
 *        Hải Phòng-NEWEB : lag 1, threshold 5 % (pct mode)
 *        ASKEY           : lag 0, threshold 1,500 VNĐ/l (abs mode)
 *        SUNRISE+  SJ    : lag 0, threshold NULL (always adjust)
 *      → all three threshold modes demoable on real routes.
 *   5. pricing_tables 15T rungs — the customer Excel leaves 15T blank
 *      (engine falls back to MANUAL by design). DEMO ladder-consistent
 *      prices fill the gap: 10T + half of the 10T→CONT20 gap per route:
 *        Hải Phòng-NEWEB : 3,500,000  (10T 3.1M / CONT20 3.9M)
 *        ASKEY           : 3,400,000  (10T 3.0M / CONT20 3.8M)
 *        SUNRISE+  SJ    : 3,500,000  (10T 3.1M / CONT20 3.9M)
 *
 * DEMO provenance: pricing_tables has no note column, so the 15T rows are
 * flagged here, in the seeding commit message, and on the terms rows' note.
 * The demo 15T rows share the customer's matrix effective date so a future
 * real price entered with a later date supersedes them naturally.
 *
 * Test fixtures (FreightEng/DBG rows, suffixed classes and periods) never
 * match these natural keys and are left for QA's cleanup lane.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import { pricing } from './data/index.js';

const LONG_MINH_NAME = 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH';

// Matches the customer's matrix rung (seedPricingTables EFFECTIVE_DATE) so the
// demo 15T row lives on the same timeline; a blank-Excel re-extract soft
// deletes it and the next full seed converges it back (revive pattern).
const PRICE_EFFECTIVE_DATE = '2026-07-30';
// The D3 defaults rung the live terms rows already carry.
const TERMS_EFFECTIVE_DATE = '2026-09-09';
const NORMS_EFFECTIVE_DATE = '2026-09-09';

const DEMO_NOTE = 'DEMO — thay bằng giá thật của khách hàng';
const DEMO_NORM_NOTE = 'DEMO — định mức thiết kế, chờ số thật của khách hàng';

const CANONICAL_CLASSES = [
  { code: '1.25T', name: 'Xe 1.25 tấn', isContainer: false, sortOrder: 1 },
  { code: '2.5T', name: 'Xe 2.5 tấn', isContainer: false, sortOrder: 2 },
  { code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 3 },
  { code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 4 },
  { code: '8T', name: 'Xe 8 tấn', isContainer: false, sortOrder: 5 },
  { code: '10T', name: 'Xe 10 tấn', isContainer: false, sortOrder: 6 },
  { code: '15T', name: 'Xe 15 tấn', isContainer: false, sortOrder: 7 },
  { code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8 },
  { code: 'CONT40', name: 'Container 40 feet', isContainer: true, sortOrder: 9 },
] as const;

// Design liters/km ladder (CuocPhiThietKeDB.md §3.3) — DEMO until the
// customer confirms real consumption norms.
const CANONICAL_NORMS: Record<string, string> = {
  '1.25T': '0.1000',
  '2.5T': '0.1300',
  '3.5T': '0.1300',
  '5T': '0.1500',
  '8T': '0.2000',
  '10T': '0.2400',
  '15T': '0.3000',
  'CONT20': '0.3200',
  'CONT40': '0.3500',
};

// Real fuel prices from the customer's Excel (BG Long Minh T7) — not invented.
const REAL_FUEL_PERIODS = [
  { unitPrice: '21740.00', effectiveFrom: '2026-07-11', sourceNote: 'Sheet 11.7 - BG Long Minh T7.xlsx' },
  { unitPrice: '27620.00', effectiveFrom: '2026-07-18', sourceNote: 'Sheet 18.7 - BG Long Minh T7.xlsx' },
] as const;

// LONG MINH contract terms per route: share % / billed km one-way come from
// the docx (D3); lag + thresholds are the D4 demo knobs. baseFuelPrice =
// 19270 / 1.08 (Excel §3.2.1).
const TERMS_BY_ROUTE = [
  {
    routeName: 'Hải Phòng-NEWEB',
    sharePct: '2.00',
    billingKmOneWay: 130,
    fuelLagDays: 1,
    fuelLagConfirmed: true,
    surchargeThresholdMode: 'PCT' as const,
    surchargeThresholdPct: '5.00' as string | null,
    surchargeThresholdAbs: null as string | null,
  },
  {
    routeName: 'ASKEY',
    sharePct: '4.00',
    billingKmOneWay: 100,
    fuelLagDays: 0,
    // PRD: the ASKEY lag is still unconfirmed — record the provisional 0 but
    // do NOT mark it confirmed (20260917_11 criterion 4).
    fuelLagConfirmed: false,
    surchargeThresholdMode: 'ABS' as const,
    surchargeThresholdPct: null as string | null,
    surchargeThresholdAbs: '1500.00' as string | null,
  },
  {
    routeName: 'SUNRISE+  SJ',
    sharePct: '2.50',
    billingKmOneWay: 120,
    fuelLagDays: 0,
    fuelLagConfirmed: false,
    surchargeThresholdMode: 'UNSET' as const,
    surchargeThresholdPct: null as string | null,
    surchargeThresholdAbs: null as string | null,
  },
] as const;

const BASE_FUEL_PRICE = '17842.5926';

// DEMO 15T prices — ladder-consistent: 10T + half the 10T→CONT20 gap.
const DEMO_15T_PRICE_BY_ROUTE: Record<string, number> = {
  'Hải Phòng-NEWEB': 3_500_000,
  'ASKEY': 3_400_000,
  'SUNRISE+  SJ': 3_500_000,
};

// The 3 pricing routes as canonical reference rows (seed/data/reference.ts
// shape). Ensured insert-if-missing so the demo chain also converges on a
// staging DB that mirrors prod master data (which never ran the dev
// reference seeder — verified 2026-09-10: staging carries only the 4 real
// operational KCN routes).
const PRICING_ROUTE_SEEDS = [
  { name: 'Hải Phòng-NEWEB', twoWayKm: 260 },
  { name: 'ASKEY', twoWayKm: 200 },
  { name: 'SUNRISE+  SJ', twoWayKm: 240 },
] as const;

export async function seedDemoFreightPricing(): Promise<void> {
  await ensureVehicleSizeClasses();
  await ensureFuelPricePeriods();
  await ensureFuelConsumptionNorms();
  await ensurePricingRoutes();

  // Resolve the real LONG MINH customer and the 3 pricing routes by their
  // stable names — the same identity the pricing-tables seeder keys on
  // (the customers.code column is not maintained; name is the row's identity).
  const [customer] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      isNull(s.customers.deletedAt),
      eq(s.customers.name, LONG_MINH_NAME),
    ))
    .limit(1);
  if (!customer) {
    throw new Error(`Không tìm thấy khách hàng LONG MINH ("${LONG_MINH_NAME}") để nạp demo giá cước`);
  }

  await ensureAnchorPricingRungs(customer.id);

  const routeRows = await db.select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes)
    .where(isNull(s.routes.deletedAt));
  const routeIdByName = new Map(routeRows.map((r) => [r.name, r.id]));

  await convergeFreightRateTerms(customer.id, routeIdByName);
  await convergeDemo15TPrices(customer.id, routeIdByName);
}

// ─── Step 1: vehicle size classes (ensure-if-missing) ───────────────────────
async function ensureVehicleSizeClasses(): Promise<void> {
  let created = 0;
  for (const cls of CANONICAL_CLASSES) {
    const [existing] = await db.select({ id: s.vehicleSizeClasses.id })
      .from(s.vehicleSizeClasses)
      .where(eq(s.vehicleSizeClasses.code, cls.code))
      .limit(1);
    if (existing) continue;
    await db.insert(s.vehicleSizeClasses).values({ ...cls });
    created += 1;
  }
  console.log(`✅ Vehicle size classes verified! (${CANONICAL_CLASSES.length - created} present, ${created} new)`);
}

// ─── Step 2: real fuel price periods (insert-if-missing, never modify) ──────
async function ensureFuelPricePeriods(): Promise<void> {
  let created = 0;
  for (const period of REAL_FUEL_PERIODS) {
    const [existing] = await db.select({ id: s.fuelPricePeriods.id })
      .from(s.fuelPricePeriods)
      .where(eq(s.fuelPricePeriods.effectiveFrom, period.effectiveFrom))
      .limit(1);
    if (existing) continue;
    await db.insert(s.fuelPricePeriods).values({ ...period });
    created += 1;
  }
  console.log(`✅ Fuel price periods verified! (${REAL_FUEL_PERIODS.length - created} present, ${created} new)`);
}

// ─── Step 3: fuel consumption norms (upsert the canonical rung) ─────────────
async function ensureFuelConsumptionNorms(): Promise<void> {
  const classRows = await db.select({ id: s.vehicleSizeClasses.id, code: s.vehicleSizeClasses.code })
    .from(s.vehicleSizeClasses);
  const classIdByCode = new Map(classRows.map((c) => [c.code, c.id]));

  let created = 0;
  let refreshed = 0;
  for (const [code, litersPerKm] of Object.entries(CANONICAL_NORMS)) {
    const classId = classIdByCode.get(code);
    if (classId == null) continue;
    const [existing] = await db.select({ id: s.fuelConsumptionNorms.id })
      .from(s.fuelConsumptionNorms)
      .where(and(
        eq(s.fuelConsumptionNorms.vehicleSizeClassId, classId),
        eq(s.fuelConsumptionNorms.effectiveDate, NORMS_EFFECTIVE_DATE),
      ))
      .limit(1);
    const values = {
      vehicleSizeClassId: classId,
      litersPerKm,
      effectiveDate: NORMS_EFFECTIVE_DATE,
      note: DEMO_NORM_NOTE,
      deletedAt: null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(s.fuelConsumptionNorms).set(values)
        .where(eq(s.fuelConsumptionNorms.id, existing.id));
      refreshed += 1;
    } else {
      await db.insert(s.fuelConsumptionNorms).values(values);
      created += 1;
    }
  }
  console.log(`✅ Fuel consumption norms converged! (${created} new, ${refreshed} refreshed)`);
}

// ─── Step 3b: the 3 pricing routes (ensure-if-missing) ──────────────────────
async function ensurePricingRoutes(): Promise<void> {
  let created = 0;
  for (const route of PRICING_ROUTE_SEEDS) {
    // Same normalized-name match as the reference seeder (routes are unique
    // on name where deleted_at is null). Insert-only: an existing route —
    // dev-reference or prod master data — is never modified.
    const [existing] = await db.select({ id: s.routes.id })
      .from(s.routes)
      .where(sql`${s.routes.deletedAt} is null and lower(btrim(${s.routes.name})) = lower(btrim(${route.name}))`)
      .limit(1);
    if (existing) continue;
    const [row] = await db.insert(s.routes).values({
      name: route.name,
      shortName: route.name.split(/[+-]/)[0]!.trim(),
      distanceKm: route.twoWayKm,
      fixedFuelAllowance: null,
    }).returning({ id: s.routes.id });
    if (row) created += 1;
  }
  console.log(`✅ Pricing routes verified! (${PRICING_ROUTE_SEEDS.length - created} present, ${created} new)`);
}

// ─── Step 3c: real anchor rungs of the customer matrix (insert-if-missing) ──
// On dev these belong to seedPricingTables; on staging (prod mirror) nobody
// seeds them, so the DEMO 15T rungs would hang off a ladder with no anchors.
// Insert-if-missing only — existing rows are never touched, and the blank
// 15T cells stay with the demo step below.
async function ensureAnchorPricingRungs(customerId: number): Promise<void> {
  const routeRows = await db.select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes)
    .where(isNull(s.routes.deletedAt));
  const routeIdByName = new Map(routeRows.map((r) => [r.name.toLowerCase(), r.id]));

  let created = 0;
  for (const row of pricing) {
    if (row.basePrice == null || row.basePrice <= 0) continue; // 15T blank → demo step
    const routeId = routeIdByName.get(row.route.toLowerCase());
    if (routeId == null) continue;
    const [existing] = await db.select({ id: s.pricingTables.id })
      .from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.routeId, routeId),
        eq(s.pricingTables.rateKey, row.size),
        eq(s.pricingTables.effectiveDate, PRICE_EFFECTIVE_DATE),
        isNull(s.pricingTables.containerTypeId),
      ))
      .limit(1);
    if (existing) continue;
    await db.insert(s.pricingTables).values({
      customerId,
      routeId,
      price: String(row.basePrice),
      rateKey: row.size,
      effectiveDate: PRICE_EFFECTIVE_DATE,
    });
    created += 1;
  }
  console.log(`✅ Anchor pricing rungs verified! (${created} new — real Excel prices, insert-if-missing)`);
}

// ─── Step 4: freight rate terms (D3 defaults + D4 threshold demo) ───────────
async function convergeFreightRateTerms(customerId: number, routeIdByName: Map<string, number>): Promise<void> {
  for (const terms of TERMS_BY_ROUTE) {
    const routeId = routeIdByName.get(terms.routeName);
    if (routeId == null) {
      throw new Error(`Không tìm thấy tuyến đường để nạp điều kiện cước demo: ${terms.routeName}`);
    }
    // Natural key of freight_rate_terms_cust_route_date_uniq.
    const [existing] = await db.select({ id: s.freightRateTerms.id })
      .from(s.freightRateTerms)
      .where(and(
        eq(s.freightRateTerms.customerId, customerId),
        eq(s.freightRateTerms.routeId, routeId),
        eq(s.freightRateTerms.effectiveDate, TERMS_EFFECTIVE_DATE),
      ))
      .limit(1);
    const values = {
      customerId,
      routeId,
      sharePct: terms.sharePct,
      billingKmOneWay: terms.billingKmOneWay,
      baseFuelPrice: BASE_FUEL_PRICE,
      fuelLagDays: terms.fuelLagDays,
      fuelLagConfirmed: terms.fuelLagConfirmed,
      // Explicit nulls keep the pct/abs XOR convergent when the mode changes.
      surchargeThresholdPct: terms.surchargeThresholdPct,
      surchargeThresholdAbs: terms.surchargeThresholdAbs,
      surchargeThresholdMode: terms.surchargeThresholdMode,
      effectiveDate: TERMS_EFFECTIVE_DATE,
      note: DEMO_NOTE,
      deletedAt: null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(s.freightRateTerms).set(values)
        .where(eq(s.freightRateTerms.id, existing.id));
    } else {
      await db.insert(s.freightRateTerms).values(values);
    }
  }
  console.log(`✅ Freight rate terms converged! (${TERMS_BY_ROUTE.length} routes; lag 1/0/0, thresholds 5% / 1500đ/l / none)`);
}

// ─── Step 5: DEMO 15T base prices (revive-or-insert on the matrix rung) ─────
async function convergeDemo15TPrices(customerId: number, routeIdByName: Map<string, number>): Promise<void> {
  for (const [routeName, price] of Object.entries(DEMO_15T_PRICE_BY_ROUTE)) {
    const routeId = routeIdByName.get(routeName);
    if (routeId == null) {
      throw new Error(`Không tìm thấy tuyến đường để nạp giá 15T demo: ${routeName}`);
    }
    // Same lookup shape as seedPricingTables — includes soft-deleted rows so
    // a blank-Excel re-extract sweep (15T basePrice 0 ⇒ withhold+delete)
    // converges back to the demo price on the next run.
    const [existing] = await db.select({ id: s.pricingTables.id })
      .from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.routeId, routeId),
        eq(s.pricingTables.rateKey, '15T'),
        eq(s.pricingTables.effectiveDate, PRICE_EFFECTIVE_DATE),
        isNull(s.pricingTables.containerTypeId),
      ))
      .limit(1);
    const values = {
      customerId,
      routeId,
      price: String(price),
      rateKey: '15T',
      effectiveDate: PRICE_EFFECTIVE_DATE,
      deletedAt: null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(s.pricingTables).set(values)
        .where(eq(s.pricingTables.id, existing.id));
    } else {
      await db.insert(s.pricingTables).values(values);
    }
  }
  console.log(`✅ DEMO 15T base prices converged! (${Object.keys(DEMO_15T_PRICE_BY_ROUTE).length} routes @ ${PRICE_EFFECTIVE_DATE} — DEMO, replace with real customer prices)`);
}

// CLI entry — standalone application on staging after a deploy/stgdb cycle.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seedDemoFreightPricing()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Demo freight-pricing seed failed:', err);
      process.exit(1);
    });
}
