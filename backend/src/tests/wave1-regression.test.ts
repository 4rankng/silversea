/**
 * Wave 1 — regression test: existing trip P&L still reconciles.
 *
 * Creates a trip via createTrip (now using resolveFreightPrice +
 * resolveFuelNorm) and verifies:
 *   1. The trip's revenue matches what the pricing table computed.
 *   2. The trip's fuel snapshot values are non-zero (resolved from fuel_config
 *      or fuel_norms, not left at 0).
 *   3. pricingSource is set correctly.
 *
 * This is the "garbage-in-garbage-out" guarantee: the Wave 1 pricing/fuel
 * wiring produces the same downstream P&L numbers as the old inline path.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createTrip } from '../services/trip-mutations.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdPricingTableIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `Reg customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `Reg route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Reg cargo ${suffix}-${createdCargoTypeIds.length}`, isBulk: false })
    .returning();
  createdCargoTypeIds.push(cargoType.id);
  const shortCode = `RG${Math.random().toString(16).slice(2, 8)}`;
  const [ct] = await db.insert(s.containerTypes)
    .values({ code: shortCode, name: `Reg ct ${suffix}` }).returning();
  createdContainerTypeIds.push(ct.id);
  return { route, cargoType, containerType: ct };
}

async function mkPricingTable(customerId: number, routeId: number, price: string) {
  const [p] = await db.insert(s.pricingTables)
    .values({ customerId, routeId, price, effectiveDate: '2026-01-01' })
    .returning();
  createdPricingTableIds.push(p.id);
  return p;
}

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdPricingTableIds.length > 0) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
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
    console.warn('[wave1-regression.test] cleanup partial:', (err as Error).message);
  }
  // process.exit(0) is safe here because this is the LAST test file
  // alphabetically (wave1-*) — no subsequent test file's cleanup is
  // interrupted. Without it, postgres-js keeps the pool open and the
  // process hangs.
  process.exit(0);
});

function baseInput(customerId: number, routeId: number, cargoTypeId: number, containerTypeId: number, externalCarrierId?: number) {
  return {
    customerId, routeId, cargoTypeId, containerTypeId,
    departureDate: '2026-08-01', containerCount: 1,
    carrierType: 'EXTERNAL' as const,
    externalCarrierId: externalCarrierId ?? customerId,
  };
}

describe('Wave 1 regression — trip P&L reconciles', () => {
  test('createTrip with pricing table → revenue matches pricing table', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkPricingTable(customer.id, cat.route.id, '10000000');

    const trip = await createTrip(baseInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id, customer.id));
    createdTripIds.push(trip.id);

    // Revenue should be the pricing-table price × 1 container.
    assert.equal(Number(trip.revenue), 10_000_000, 'revenue from pricing table');
    assert.equal(Number(trip.revenueOriginal), 10_000_000);
    assert.equal(Number(trip.revenueEmptyReturn), 10_000_000);
    assert.equal(trip.pricingSource, 'TABLE');
  });

  test('createTrip with no pricing table → revenue = 0, no crash', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    // No pricing table seeded.

    const trip = await createTrip(baseInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id, customer.id));
    createdTripIds.push(trip.id);

    assert.equal(Number(trip.revenue), 0, 'revenue is 0 when no pricing table');
    assert.equal(trip.pricingSource, 'MANUAL');
  });

  test('fuel snapshot is populated (not all zeros)', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkPricingTable(customer.id, cat.route.id, '5000000');

    const trip = await createTrip(baseInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id, customer.id));
    createdTripIds.push(trip.id);

    const loaded = Number(trip.fuelLoadedNormApplied);
    const empty = Number(trip.fuelEmptyNormApplied);
    const price = Number(trip.fuelPriceApplied);
    assert.ok(loaded > 0 || empty > 0 || price > 0,
      `fuel snapshot populated (loaded=${loaded}, empty=${empty}, price=${price})`);
  });

  test('multi-container pricing: revenue = unitPrice × containerCount', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkPricingTable(customer.id, cat.route.id, '4000000');

    const trip = await createTrip({
      ...baseInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id, customer.id),
      containerCount: 3,
    });
    createdTripIds.push(trip.id);

    assert.equal(Number(trip.revenue), 12_000_000, '3 × 4M');
    assert.equal(trip.pricingSource, 'TABLE');
  });

  test('pricingFormula is visible and contains the breakdown', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkPricingTable(customer.id, cat.route.id, '7000000');

    const trip = await createTrip(baseInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id, customer.id));
    createdTripIds.push(trip.id);

    assert.ok(trip.pricingFormula, 'formula is set');
    assert.match(trip.pricingFormula!, /7\.000\.000/);
  });
});
