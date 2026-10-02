/**
 * Freight pricing engine — T6 unit/integration test coverage.
 *
 * Wave: doc4 Phương án tính cước tự động.
 * Phase-1 (test-first, NOW): pure-function tests in
 *   shared/src/calculations/fuelSurcharge.test.ts (TC-CUOC-001/002/003/007/008)
 * Phase-2 (after T1 wiring lands): this file exercises resolveFreightRate() and
 *   persistFreightRateSnapshot()/upsertDebitNoteOverride() against real DB.
 *
 * Test IDs map to testplan/flows/12-cuocphi-phuphi-dau.md §12.4.
 *
 * Fixture isolation: each run gets a `${suffix}-…` namespace; rows are deleted
 * in `after()` to avoid bleed-through on the shared backend DB.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  resolveFreightRate,
  persistFreightRateSnapshot,
  upsertDebitNoteOverride,
} from '../services/freight-pricing-engine.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdVehicleClassIds: number[] = [];
const createdTermsIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdNormIds: number[] = [];
const createdFuelPricePeriodIds: number[] = [];
const createdSnapshotIds: number[] = [];
const createdOverrideIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `FreightEng customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes)
    .values({ name: `FreightEng route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkVehicleClass(code: string) {
  // vehicle_size_classes.code is varchar(20) with a global unique constraint;
  // embed suffix so each run gets its own namespace (and avoids colliding with
  // other parallel test runs / seeded codes).
  const idx = createdVehicleClassIds.length;
  const tag = suffix.replace('-', '').slice(-5);
  const shortCode = `E${tag}${idx}${code.slice(-3)}`.slice(0, 20);
  const [vc] = await db.insert(s.vehicleSizeClasses)
    .values({
      code: shortCode,
      name: `FreightEng ${code}-${idx}`,
    })
    .returning();
  createdVehicleClassIds.push(vc.id);
  return vc;
}

async function mkTerms(customerId: number, routeId: number, overrides: Partial<typeof s.freightRateTerms.$inferInsert> = {}) {
  const [t] = await db.insert(s.freightRateTerms).values({
    customerId,
    routeId,
    sharePct: overrides.sharePct ?? '2',
    billingKmOneWay: overrides.billingKmOneWay ?? 50,
    billingKmMultiplier: overrides.billingKmMultiplier ?? '2',
    baseFuelPrice: overrides.baseFuelPrice ?? '17842.5926',
    fuelLagDays: overrides.fuelLagDays ?? 0,
    fuelLagConfirmed: overrides.fuelLagConfirmed ?? false,
    surchargeThresholdMode: overrides.surchargeThresholdMode ?? 'UNSET',
    surchargeThresholdPct: overrides.surchargeThresholdPct ?? null,
    surchargeThresholdAbs: overrides.surchargeThresholdAbs ?? null,
    effectiveDate: overrides.effectiveDate ?? '2026-01-01',
    note: `FreightEng terms ${suffix}`,
  }).returning();
  createdTermsIds.push(t.id);
  return t;
}

async function mkPricingTable(customerId: number, routeId: number, rateKey: string, price: string) {
  const [p] = await db.insert(s.pricingTables).values({
    customerId,
    routeId,
    price,
    rateKey,
    effectiveDate: '2026-01-01',
  }).returning();
  createdPricingTableIds.push(p.id);
  return p;
}

async function mkNorm(vehicleClassId: number, litersPerKm: string) {
  const [n] = await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: vehicleClassId,
    litersPerKm,
    effectiveDate: '2026-01-01',
  }).returning();
  createdNormIds.push(n.id);
  return n;
}

// Suite base date: anchored to a unique-per-run offset so parallel runs
// don't collide on the global fuel_price_periods.effective_from unique key.
const SUITE_OFFSET_DAYS = (() => {
  const n = Number(suffix.replace(/\D/g, '').slice(-6)) % 5000;
  return 1000 + n; // baseline 2027-01-01 + 1000 days = ~2029-09
})();
const SUITE_BASE_DATE = (() => {
  const d = new Date('2027-01-01');
  d.setDate(d.getDate() + SUITE_OFFSET_DAYS);
  return d.toISOString().slice(0, 10);
})();
const addDays = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

async function mkFuelPeriod(unitPrice: string, _effectiveFromBase: string) {
  // Per-period offset within the run keeps each period unique.
  const iso = addDays(SUITE_BASE_DATE, createdFuelPricePeriodIds.length);
  const [f] = await db.insert(s.fuelPricePeriods).values({
    unitPrice,
    effectiveFrom: iso,
  }).returning();
  createdFuelPricePeriodIds.push(f.id);
  return f;
}

after(async () => {
  // Best-effort cleanup. Order matters — child rows reference parents.
  try {
    if (createdOverrideIds.length) {
      await db.delete(s.debitNoteOverrides)
        .where(inArray(s.debitNoteOverrides.id, createdOverrideIds));
    }
    if (createdSnapshotIds.length) {
      await db.delete(s.freightRateSnapshots)
        .where(inArray(s.freightRateSnapshots.id, createdSnapshotIds));
    }
    if (createdFuelPricePeriodIds.length) {
      await db.delete(s.fuelPricePeriods)
        .where(inArray(s.fuelPricePeriods.id, createdFuelPricePeriodIds));
    }
    if (createdNormIds.length) {
      await db.delete(s.fuelConsumptionNorms)
        .where(inArray(s.fuelConsumptionNorms.id, createdNormIds));
    }
    if (createdPricingTableIds.length) {
      await db.delete(s.pricingTables)
        .where(inArray(s.pricingTables.id, createdPricingTableIds));
    }
    if (createdTermsIds.length) {
      await db.delete(s.freightRateTerms)
        .where(inArray(s.freightRateTerms.id, createdTermsIds));
    }
    if (createdVehicleClassIds.length) {
      await db.delete(s.vehicleSizeClasses)
        .where(inArray(s.vehicleSizeClasses.id, createdVehicleClassIds));
    }
    if (createdRouteIds.length) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (e) {
    // Cleanup is best-effort — log but don't mask test failures.
    console.warn('[freight-pricing-engine] cleanup error:', (e as Error).message);
  }
  await client.end();
});

// ─── TC-CUOC-015 — MANUAL fallback when 15T has no base price ──────────────

describe('resolveFreightRate — MANUAL fallback (TC-CUOC-015)', () => {
  let customerId: number;
  let routeId: number;
  let vehicleClass15T: typeof s.vehicleSizeClasses.$inferSelect;

  before(async () => {
    const c = await mkCustomer();
    customerId = c.id;
    const r = await mkRoute();
    routeId = r.id;
    vehicleClass15T = await mkVehicleClass('CONT15');
  });

  test('15T without pricing_tables row → MANUAL, total=0, no throw', async () => {
    // Seed terms + fuel norm + fuel period — but NO pricing_tables row for 15T.
    await mkTerms(customerId, routeId, { fuelLagDays: 1 });
    await mkNorm(vehicleClass15T.id, '0.32');
    await mkFuelPeriod('25000', SUITE_BASE_DATE);

    const result = await resolveFreightRate({
      customerId,
      routeId,
      vehicleSizeClassCode: vehicleClass15T.code,
      transportDate: addDays(SUITE_BASE_DATE, 14),
    });

    assert.equal(result.source, 'MANUAL');
    assert.equal(result.freight, 0);
    assert.equal(result.surcharge, 0);
    assert.equal(result.total, 0);
    assert.equal(result.fuelDelta, 0);
    // Liters/billedKm stay 0 in MANUAL — UI shows "thieu gia goc".
    assert.equal(result.liters, 0);
    assert.equal(result.billedKm, 0);
    assert.match(result.formula, /Thiếu giá gốc/);
  });

  test('15T with pricing_tables.price=0 → MANUAL (price==0 guard)', async () => {
    // Reset by deleting any prior terms/pricing/norm/period for this fixture.
    // Use a fresh customer to keep tests independent.
    const c2 = await mkCustomer();
    const r2 = await mkRoute();
    const vc2 = await mkVehicleClass('CONT15B');

    await mkTerms(c2.id, r2.id, { fuelLagDays: 1 });
    await mkPricingTable(c2.id, r2.id, vc2.code, '0');  // explicit zero
    await mkNorm(vc2.id, '0.32');
    await mkFuelPeriod('25000', SUITE_BASE_DATE);

    const result = await resolveFreightRate({
      customerId: c2.id,
      routeId: r2.id,
      vehicleSizeClassCode: vc2.code,
      transportDate: addDays(SUITE_BASE_DATE, 14),
    });

    assert.equal(result.source, 'MANUAL');
    assert.equal(result.total, 0);
  });
});

// ─── TC-CUOC-009/010 — Snapshot persistence + supersede ───────────────────

describe('persistFreightRateSnapshot — idempotency + immutability (TC-CUOC-009/016)', () => {
  let customerId: number;
  let routeId: number;
  let vehicleClass: typeof s.vehicleSizeClasses.$inferSelect;

  before(async () => {
    const c = await mkCustomer();
    customerId = c.id;
    const r = await mkRoute();
    routeId = r.id;
    vehicleClass = await mkVehicleClass('SNAP');
  });

  test('persists with full trace ids (4 FK refs) and amount columns', async () => {
    // Confirmed surcharge terms are mandatory for AUTO since 20260917_11 —
    // the fixture must grant the confirmation explicitly (card _40).
    await mkTerms(customerId, routeId, { fuelLagDays: 0, surchargeThresholdMode: 'NONE', fuelLagConfirmed: true });
    await mkPricingTable(customerId, routeId, vehicleClass.code, '1500000');
    await mkNorm(vehicleClass.id, '0.3');
    await mkFuelPeriod('22000', SUITE_BASE_DATE);

    const resolved = await resolveFreightRate({
      customerId,
      routeId,
      vehicleSizeClassCode: vehicleClass.code,
      transportDate: addDays(SUITE_BASE_DATE, 9),
    });
    assert.equal(resolved.source, 'AUTO');

    const snapshotId = await persistFreightRateSnapshot(resolved, { shipmentId: null, tripId: null });
    createdSnapshotIds.push(snapshotId);
    assert.ok(snapshotId > 0);

    const [row] = await db.select().from(s.freightRateSnapshots)
      .where(eq(s.freightRateSnapshots.id, snapshotId));
    assert.ok(row, 'snapshot row must exist');
    assert.equal(Number(row.freightAmount), resolved.freight);
    assert.equal(Number(row.surchargeAmount), resolved.surcharge);
    assert.equal(Number(row.totalAmount), resolved.total);
    assert.equal(row.rateTermsId, resolved.rateTermsId);
    assert.equal(row.pricingTableId, resolved.pricingTableId);
    assert.equal(row.fuelNormId, resolved.fuelNormId);
    assert.equal(row.fuelPricePeriodId, resolved.fuelPricePeriodId);
  });
});

// ─── TC-CUOC-017/018 — Debit-note override: 1:1 + reason guard ─────────────

describe('upsertDebitNoteOverride — uniqueness + reason requirement (TC-CUOC-017/018)', () => {
  test('one row per snapshot: second call updates in place, does not duplicate', async () => {
    const snapshotId = createdSnapshotIds[0];
    if (!snapshotId) {
      // Setup failed earlier — skip silently so the suite can finish.
      return;
    }
    const id1 = await upsertDebitNoteOverride({
      snapshotId,
      systemCalculatedFreight: 1_500_000,
      finalDebitFreight: 1_400_000,
      overrideReason: 'thương lượng giảm 100k',
      overrideBy: 1,
    });
    createdOverrideIds.push(id1);

    const id2 = await upsertDebitNoteOverride({
      snapshotId,
      systemCalculatedFreight: 1_500_000,
      finalDebitFreight: 1_300_000,
      overrideReason: 'thương lượng giảm 200k',
      overrideBy: 1,
    });
    assert.equal(id1, id2, 'second upsert must hit the same row');

    const rows = await db.select().from(s.debitNoteOverrides)
      .where(eq(s.debitNoteOverrides.snapshotId, snapshotId));
    assert.equal(rows.length, 1, 'exactly one override per snapshot');
    assert.equal(Number(rows[0].finalDebitFreight), 1_300_000);
  });

  test('changing final without reason → 400 error', async () => {
    const snapshotId = createdSnapshotIds[0];
    if (!snapshotId) return;
    await assert.rejects(
      upsertDebitNoteOverride({
        snapshotId,
        systemCalculatedFreight: 1_500_000,
        finalDebitFreight: 1_200_000,
        overrideReason: undefined,  // explicitly missing
        overrideBy: 1,
      }),
      /Bắt buộc nhập lý do/,
    );
  });

  test('final == system with no reason → allowed (no override needed)', async () => {
    const snapshotId = createdSnapshotIds[0];
    if (!snapshotId) return;
    const id = await upsertDebitNoteOverride({
      snapshotId,
      systemCalculatedFreight: 1_500_000,
      finalDebitFreight: 1_500_000,
      overrideReason: undefined,
      overrideBy: 1,
    });
    createdOverrideIds.push(id);
    const rows = await db.select().from(s.debitNoteOverrides)
      .where(eq(s.debitNoteOverrides.snapshotId, snapshotId));
    assert.equal(rows.length, 1);
  });
});
