/**
 * Wave 1 — pricing.service.ts integration tests.
 *
 * Exercises resolveFreightPrice (TIER / TABLE / MANUAL branches) and the
 * overlap validators against the real Postgres DB.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  resolveFreightPrice,
  validateWeightTierOverlap,
  validatePricingTableOverlap,
} from '../services/pricing.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTierIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `PricingSvc customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes)
    .values({ name: `PricingSvc route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkCargoType(isBulk: boolean) {
  const [c] = await db.insert(s.cargoTypes)
    .values({ name: `PricingSvc cargo ${suffix}-${createdCargoTypeIds.length} ${isBulk ? 'bulk' : 'fixed'}`, isBulk })
    .returning();
  createdCargoTypeIds.push(c.id);
  return c;
}

async function mkTier(routeId: number, cargoTypeId: number, minKg: string, maxKg: string, pricePerKg: string, effectiveDate = '2026-01-01') {
  const [t] = await db.insert(s.weightPricingTiers)
    .values({ routeId, cargoTypeId, minKg, maxKg, pricePerKg, effectiveDate })
    .returning();
  createdTierIds.push(t.id);
  return t;
}

async function mkPricingTable(customerId: number, routeId: number, price: string, effectiveDate = '2026-01-01') {
  const [p] = await db.insert(s.pricingTables)
    .values({ customerId, routeId, price, effectiveDate })
    .returning();
  createdPricingTableIds.push(p.id);
  return p;
}

after(async () => {
  try {
    if (createdTierIds.length > 0) {
      await db.delete(s.weightPricingTiers).where(inArray(s.weightPricingTiers.id, createdTierIds));
    }
    if (createdPricingTableIds.length > 0) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[pricing-service.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

// ─── resolveFreightPrice: TIER ─────────────────────────────────────────────

describe('resolveFreightPrice — TIER (bulk cargo)', () => {
  test('resolves weight-tier price for bulk cargo in range', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    await mkTier(route.id, cargo.id, '0', '10000', '5000');
    await mkTier(route.id, cargo.id, '10000', '20000', '4500');

    const result = await resolveFreightPrice({
      customerId: 1, routeId: route.id, cargoTypeId: cargo.id,
      weightKg: 15000, date: '2026-07-01',
    });

    assert.equal(result.source, 'TIER');
    assert.equal(result.price, 15000 * 4500);
    assert.match(result.formula, /15000kg/);
    assert.match(result.formula, /4.500/);
  });

  test('picks the tier at the boundary correctly (minKg inclusive)', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    await mkTier(route.id, cargo.id, '0', '10000', '5000');
    await mkTier(route.id, cargo.id, '10000', '20000', '4500');

    // weightKg = 10000 should be in the SECOND tier (minKg=10000 inclusive).
    const result = await resolveFreightPrice({
      customerId: 1, routeId: route.id, cargoTypeId: cargo.id,
      weightKg: 10000, date: '2026-07-01',
    });
    assert.equal(result.source, 'TIER');
    assert.equal(result.unitPrice, 4500);
  });

  test('returns MANUAL when weight is outside all tiers', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    await mkTier(route.id, cargo.id, '0', '20000', '5000');

    const result = await resolveFreightPrice({
      customerId: 1, routeId: route.id, cargoTypeId: cargo.id,
      weightKg: 25000, date: '2026-07-01',
    });
    assert.equal(result.source, 'MANUAL');
    assert.equal(result.price, 0);
    assert.match(result.formula, /ngoài khoảng/);
  });

  test('returns MANUAL when no tiers exist', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);

    const result = await resolveFreightPrice({
      customerId: 1, routeId: route.id, cargoTypeId: cargo.id,
      weightKg: 5000, date: '2026-07-01',
    });
    assert.equal(result.source, 'MANUAL');
    assert.match(result.formula, /Chưa có bảng giá theo trọng lượng/);
  });

  test('returns MANUAL when weightKg is missing', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    await mkTier(route.id, cargo.id, '0', '20000', '5000');

    const result = await resolveFreightPrice({
      customerId: 1, routeId: route.id, cargoTypeId: cargo.id,
      date: '2026-07-01',
    });
    assert.equal(result.source, 'MANUAL');
    assert.match(result.formula, /Thiếu trọng lượng/);
  });
});

// ─── resolveFreightPrice: TABLE ────────────────────────────────────────────

describe('resolveFreightPrice — TABLE (fixed-price cargo)', () => {
  test('resolves fixed price from pricing_tables', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargoType(false);
    await mkPricingTable(customer.id, route.id, '5000000');

    const result = await resolveFreightPrice({
      customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
      containerCount: 2, date: '2026-07-01',
    });
    assert.equal(result.source, 'TABLE');
    assert.equal(result.price, 10_000_000);
    assert.equal(result.unitPrice, 5_000_000);
    assert.match(result.formula, /2 container/);
  });

  test('returns MANUAL when no pricing_table exists', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargoType(false);

    const result = await resolveFreightPrice({
      customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
      date: '2026-07-01',
    });
    assert.equal(result.source, 'MANUAL');
    assert.match(result.formula, /Chưa có bảng giá/);
  });

  test('picks the most recent effectiveDate pricing_table', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargoType(false);
    await mkPricingTable(customer.id, route.id, '3000000', '2026-01-01');
    await mkPricingTable(customer.id, route.id, '4000000', '2026-06-01');

    const result = await resolveFreightPrice({
      customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
      date: '2026-07-01',
    });
    assert.equal(result.unitPrice, 4_000_000);
  });
});

// ─── Overlap validators ────────────────────────────────────────────────────

describe('validateWeightTierOverlap', () => {
  test('detects overlapping tiers', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    await mkTier(route.id, cargo.id, '0', '10000', '5000');
    await mkTier(route.id, cargo.id, '5000', '20000', '4500'); // overlaps [0,10000)

    const overlaps = await validateWeightTierOverlap(route.id, cargo.id, '2026-01-01');
    assert.ok(overlaps.length > 0, 'detected at least one overlap');
    assert.match(overlaps[0].detail, /chồng lên/);
  });

  test('returns empty for adjacent (non-overlapping) tiers', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    await mkTier(route.id, cargo.id, '0', '10000', '5000');
    await mkTier(route.id, cargo.id, '10000', '20000', '4500'); // adjacent, NOT overlapping

    const overlaps = await validateWeightTierOverlap(route.id, cargo.id, '2026-01-01');
    assert.equal(overlaps.length, 0);
  });

  test('excludes a specific id when editing', async () => {
    const route = await mkRoute();
    const cargo = await mkCargoType(true);
    const t1 = await mkTier(route.id, cargo.id, '0', '10000', '5000');
    await mkTier(route.id, cargo.id, '5000', '20000', '4500');

    // Exclude t1 — should report no overlaps from t1's perspective.
    const overlaps = await validateWeightTierOverlap(route.id, cargo.id, '2026-01-01', t1.id);
    assert.equal(overlaps.length, 0, 'excluded tier not reported');
  });
});

describe('validatePricingTableOverlap', () => {
  test('DB unique index prevents duplicate effectiveDate — insert throws', async () => {
    // The existing unique index `pricing_tables_customer_route_date_idx` on
    // (customerId, routeId, effectiveDate) means duplicates are DB-enforced.
    // The validator is a softer "check before submit" helper; the DB is the
    // hard guarantee. Verify the DB catches it.
    const customer = await mkCustomer();
    const route = await mkRoute();
    await mkPricingTable(customer.id, route.id, '3000000', '2026-01-01');

    await assert.rejects(
      () => mkPricingTable(customer.id, route.id, '4000000', '2026-01-01'),
      (err: unknown) => err instanceof Error,
      'duplicate insert should be rejected by the DB unique index',
    );
  });

  test('returns empty for different effectiveDates', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    await mkPricingTable(customer.id, route.id, '3000000', '2026-01-01');
    await mkPricingTable(customer.id, route.id, '4000000', '2026-06-01');

    const overlaps = await validatePricingTableOverlap(customer.id, route.id, '2026-01-01');
    assert.equal(overlaps.length, 0);
  });
});
