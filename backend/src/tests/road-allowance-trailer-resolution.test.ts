/**
 * Road-allowance resolution must follow the FINAL trailer type (and route) of
 * a trip edit. The fix (finalTrailerType in every lookup, zero stays zero)
 * shipped with only a standalone scenario script; this file pins the full
 * matrix inside the CI suite: direction both ways × {positive, explicit
 * zero, missing} rate for the new type, route+trailer changed together, and
 * the persisted figures (base, totalRoadAllowance, totalCost, grossProfit)
 * read back after the update.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { FuelMode, LoadingType, Role, TripStatus } from '@tingting/shared';
import { insertTripComposite } from '../services/trip-composite.service';
import { updateTripFigures } from '../services/trip-figure-updates.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdAllowanceIds: number[] = [];
const createdTripIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `RA customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `RA route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `RA cargo ${suffix}-${createdCargoTypeIds.length}`, isBulk: false })
    .returning();
  createdCargoTypeIds.push(cargoType.id);
  return { route, cargoType };
}

async function mkAllowance(routeId: number, trailerType: '20FT' | '40FT', baseAmount: string) {
  const [row] = await db.insert(s.roadAllowances)
    .values({ routeId, trailerType, baseAmount })
    .returning();
  createdAllowanceIds.push(row.id);
  return row;
}

async function mkTrip(opts: { customerId: number; routeId: number; cargoTypeId: number; trailerType: '20FT' | '40FT' }) {
  const trip = await insertTripComposite(db, {
    tripCode: `RA-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: opts.customerId,
    routeId: opts.routeId,
    cargoTypeId: opts.cargoTypeId,
    status: TripStatus.CREATED,
    departureDate: '2026-09-14',
    revenue: '5000000',
    revenueEmptyReturn: '5000000',
    revenueCombine: '0',
    twoPointDeliveryBonus: '0',
    vehicleShiftAllowance: '0',
    pricingSource: 'MANUAL',
    carrierType: 'OWN',
  });
  createdTripIds.push(trip.id);
  // The figures update reads the CURRENT trailerType off the trip row.
  await db.update(s.trips).set({ trailerType: opts.trailerType }).where(eq(s.trips.id, trip.id));
  return { ...trip, trailerType: opts.trailerType };
}

function baseUpdate(tripId: number, tripVersion: number, overrides: Record<string, unknown> = {}) {
  return {
    tripId,
    legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 100, loadingType: LoadingType.HANG }],
    fuelMode: FuelMode.AUTO,
    expectedVersion: tripVersion,
    userId: 1,
    userRole: Role.MANAGER,
    ...overrides,
  };
}

async function readBack(tripId: number) {
  const [row] = await db.select({
    trailerType: s.trips.trailerType,
    base: s.tripFinancialState.roadAllowanceBaseApplied,
    override: s.tripFinancialState.roadAllowanceOverride,
    totalRoadAllowance: s.tripFinancialState.totalRoadAllowance,
    totalCost: s.tripFinancialState.totalCost,
    grossProfit: s.tripFinancialState.grossProfit,
    version: s.trips.version,
  }).from(s.trips)
    .innerJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId)).limit(1);
  return row;
}

describe('road allowance resolves from the final trailer type', () => {
  test('40FT→20FT with a positive 20FT rate applies the 20FT rate', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkAllowance(cat.route.id, '40FT', '500000');
    await mkAllowance(cat.route.id, '20FT', '300000');
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, trailerType: '40FT' });

    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, { trailerType: '20FT' }));
    const row = await readBack(trip.id);
    assert.equal(row.trailerType, '20FT');
    assert.equal(row.base, '300000');
    assert.equal(row.totalRoadAllowance, '300000');
  });

  test('40FT→20FT with the 20FT rate MISSING stays zero — never borrows the 40FT rate', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkAllowance(cat.route.id, '40FT', '500000');
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, trailerType: '40FT' });

    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, { trailerType: '20FT' }));
    const row = await readBack(trip.id);
    assert.equal(row.trailerType, '20FT');
    assert.equal(row.base, '0');
    assert.equal(row.totalRoadAllowance, '0');
  });

  test('40FT→20FT with an EXPLICIT 20FT zero stays zero — configured zero ≠ missing, and neither borrows', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkAllowance(cat.route.id, '40FT', '500000');
    await mkAllowance(cat.route.id, '20FT', '0');
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, trailerType: '40FT' });

    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, { trailerType: '20FT' }));
    const row = await readBack(trip.id);
    assert.equal(row.trailerType, '20FT');
    assert.equal(row.base, '0');
    assert.equal(row.totalRoadAllowance, '0');
  });

  test('20FT→40FT reverse with a positive 40FT rate applies the 40FT rate', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkAllowance(cat.route.id, '20FT', '300000');
    await mkAllowance(cat.route.id, '40FT', '500000');
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, trailerType: '20FT' });

    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, { trailerType: '40FT' }));
    const row = await readBack(trip.id);
    assert.equal(row.trailerType, '40FT');
    assert.equal(row.base, '500000');
    assert.equal(row.totalRoadAllowance, '500000');
  });

  test('route and trailer changed together resolve from the NEW pair', async () => {
    const customer = await mkCustomer();
    const catA = await mkCatalogs();
    const catB = await mkCatalogs();
    await mkAllowance(catA.route.id, '40FT', '500000');
    await mkAllowance(catB.route.id, '20FT', '200000');
    const trip = await mkTrip({ customerId: customer.id, routeId: catA.route.id, cargoTypeId: catA.cargoType.id, trailerType: '40FT' });

    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, {
      routeId: catB.route.id,
      trailerType: '20FT',
    }));
    const row = await readBack(trip.id);
    assert.equal(row.trailerType, '20FT');
    assert.equal(row.base, '200000');
    assert.equal(row.totalRoadAllowance, '200000');
  });

  test('explicit zero override persists and clearing it restores the configured allowance', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkAllowance(cat.route.id, '40FT', '500000');
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, trailerType: '40FT' });
    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, { roadAllowanceOverride: 0 }));
    const zero = await readBack(trip.id);
    assert.equal(zero.override, '0');
    assert.equal(zero.totalRoadAllowance, '0');
    await updateTripFigures(trip.id, baseUpdate(trip.id, zero.version, { roadAllowanceOverride: null }));
    const cleared = await readBack(trip.id);
    assert.equal(cleared.override, null);
    assert.equal(cleared.totalRoadAllowance, '500000');
    assert.equal(Number(cleared.totalCost) - Number(zero.totalCost), 500000);
    assert.equal(Number(zero.grossProfit) - Number(cleared.grossProfit), 500000);
  });

  test('totals follow the resolved allowance (totalCost and grossProfit shift with it)', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await mkAllowance(cat.route.id, '40FT', '500000');
    await mkAllowance(cat.route.id, '20FT', '100000');
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, trailerType: '40FT' });

    await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, { trailerType: '40FT' }));
    const at40 = await readBack(trip.id);
    await updateTripFigures(trip.id, baseUpdate(trip.id, at40.version, { trailerType: '20FT' }));
    const at20 = await readBack(trip.id);

    // Same revenue, allowance 500000 → 100000: cost drops by 400000, profit
    // rises by the same amount.
    assert.equal(Number(at20.totalCost), Number(at40.totalCost) - 400000);
    assert.equal(Number(at20.grossProfit), Number(at40.grossProfit) + 400000);
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdAllowanceIds.length > 0) {
      await db.delete(s.roadAllowances).where(inArray(s.roadAllowances.id, createdAllowanceIds));
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
    console.warn('[road-allowance-trailer-resolution.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});
