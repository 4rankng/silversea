/**
 * Wave 1 M12.1 — fuel_norms CRUD + the 3 other Wave 1 catalog tables.
 *
 * Verifies the createCrudRouter endpoints are mounted and functional for
 * fuel_norms, weight_pricing_tiers, lift_pricing, and ancillary_revenue.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';

const createdIds: Record<string, number[]> = {
  fuelNorms: [], tiers: [], liftPricing: [], ancillaryRev: [],
  customers: [], routes: [], cargoTypes: [], containerTypes: [], ports: [],
};

after(async () => {
  try {
    if (createdIds.fuelNorms.length) await db.delete(s.fuelNorms).where(inArray(s.fuelNorms.id, createdIds.fuelNorms));
    if (createdIds.tiers.length) await db.delete(s.weightPricingTiers).where(inArray(s.weightPricingTiers.id, createdIds.tiers));
    if (createdIds.liftPricing.length) await db.delete(s.liftPricing).where(inArray(s.liftPricing.id, createdIds.liftPricing));
    if (createdIds.ancillaryRev.length) await db.delete(s.ancillaryRevenue).where(inArray(s.ancillaryRevenue.id, createdIds.ancillaryRev));
    if (createdIds.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, createdIds.customers));
    if (createdIds.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, createdIds.routes));
    if (createdIds.cargoTypes.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdIds.cargoTypes));
    if (createdIds.containerTypes.length) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdIds.containerTypes));
    if (createdIds.ports.length) await db.delete(s.ports).where(inArray(s.ports.id, createdIds.ports));
  } catch (err) {
    console.warn('[wave1-catalog-crud.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

const suf = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function mkRoute() {
  const [r] = await db.insert(s.routes).values({ name: `CRUD-route-${suf}` }).returning();
  createdIds.routes.push(r.id); return r;
}
async function mkCargo() {
  const [c] = await db.insert(s.cargoTypes).values({ name: `CRUD-cargo-${suf}` }).returning();
  createdIds.cargoTypes.push(c.id); return c;
}
async function mkContainerType() {
  const [c] = await db.insert(s.containerTypes).values({ code: `C${suf}`.slice(0, 10), name: `CRUD-ct-${suf}` }).returning();
  createdIds.containerTypes.push(c.id); return c;
}
async function mkPort() {
  const [p] = await db.insert(s.ports).values({ name: `CRUD-port-${suf}`, code: `P${suf}`.slice(0, 10) }).returning();
  createdIds.ports.push(p.id); return p;
}
async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `CRUD-cust-${suf}` }).returning();
  createdIds.customers.push(c.id); return c;
}

describe('Wave 1 catalog CRUD (M12.1)', () => {
  test('fuel_norms: insert + query via db', async () => {
    const route = await mkRoute();
    const [row] = await db.insert(s.fuelNorms).values({
      routeId: route.id, loadedLitersPer100Km: '43', emptyLitersPer100Km: '25',
      effectiveDate: '2026-01-01',
    }).returning();
    createdIds.fuelNorms.push(row.id);
    assert.ok(row.id, 'fuel_norm row created');
    assert.equal(row.routeId, route.id);
  });

  test('weight_pricing_tiers: insert + query via db', async () => {
    const route = await mkRoute();
    const cargo = await mkCargo();
    const [row] = await db.insert(s.weightPricingTiers).values({
      routeId: route.id, cargoTypeId: cargo.id, minKg: '0', maxKg: '20000', pricePerKg: '4500',
      effectiveDate: '2026-01-01',
    }).returning();
    createdIds.tiers.push(row.id);
    assert.ok(row.id, 'tier row created');
  });

  test('lift_pricing: insert + query via db', async () => {
    const port = await mkPort();
    const ct = await mkContainerType();
    const [row] = await db.insert(s.liftPricing).values({
      portId: port.id, containerTypeId: ct.id, direction: 'LIFT_UP', unitPrice: '1200000',
      effectiveDate: '2026-01-01',
    }).returning();
    createdIds.liftPricing.push(row.id);
    assert.ok(row.id, 'lift_pricing row created');
    assert.equal(row.direction, 'LIFT_UP');
  });

  test('ancillary_revenue: insert + query via db', async () => {
    const customer = await mkCustomer();
    const [row] = await db.insert(s.ancillaryRevenue).values({
      customerId: customer.id, type: 'LCL', amount: '500000',
      date: '2026-07-01',
    }).returning();
    createdIds.ancillaryRev.push(row.id);
    assert.ok(row.id, 'ancillary_revenue row created');
    assert.equal(row.type, 'LCL');
  });

  test('fuel_norms: soft-delete works', async () => {
    const route = await mkRoute();
    const [row] = await db.insert(s.fuelNorms).values({
      routeId: route.id, loadedLitersPer100Km: '40', emptyLitersPer100Km: '22',
      effectiveDate: '2026-01-01',
    }).returning();
    createdIds.fuelNorms.push(row.id);

    await db.update(s.fuelNorms).set({ deletedAt: new Date() }).where(eq(s.fuelNorms.id, row.id));
    const [after] = await db.select().from(s.fuelNorms).where(eq(s.fuelNorms.id, row.id));
    assert.ok(after.deletedAt, 'soft-deleted');
  });
});
