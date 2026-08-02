/**
 * Wave 1 M2.1 — pricing override-before-lock + reason tests.
 *
 * Verifies:
 *   - Override works pre-lock with a reason (revenueOverrideReason stored).
 *   - Override on an auto-priced trip (pricingSource=TABLE) WITHOUT a reason
 *     → 400 rejection.
 *   - Override on a MANUAL trip without a reason → allowed (no auto price
 *     to deviate from).
 *   - Completed trips cannot be updated without governance (existing behavior).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TripStatus, FuelMode, LoadingType, Role } from '@tingting/shared';
import { updateTripFigures } from '../services/trip-mutations.service';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M21 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `M21 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `M21 cargo ${suffix}-${createdCargoTypeIds.length}`, isBulk: false })
    .returning();
  createdCargoTypeIds.push(cargoType.id);
  return { route, cargoType };
}

/** Insert a trip directly (bypassing createTrip) with a specific pricingSource. */
async function mkTrip(opts: { customerId: number; routeId: number; cargoTypeId: number; revenue?: string; pricingSource?: 'TABLE' | 'TIER' | 'MANUAL'; status?: TripStatus }) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M21-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: opts.customerId,
    routeId: opts.routeId,
    cargoTypeId: opts.cargoTypeId,
    status: opts.status ?? TripStatus.CREATED,
    departureDate: '2026-08-01',
    revenue: opts.revenue ?? '5000000',
    revenueEmptyReturn: opts.revenue ?? '5000000',
    revenueCombine: '0',
    twoPointDeliveryBonus: '0',
    vehicleShiftAllowance: '0',
    revenueOriginal: opts.revenue ?? '5000000',
    pricingSource: opts.pricingSource ?? 'TABLE',
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
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

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
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
    console.warn('[m21-override-reason.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

describe('M2.1 — pricing override reason', () => {
  test('override on TABLE-priced trip WITH reason succeeds', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, pricingSource: 'TABLE', revenue: '5000000' });

    const updated = await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, {
      revenue: 6_000_000,
      revenueOverrideReason: 'Khách hàng thoả thuận giá mới',
    }));

    assert.equal(Number(updated.revenue), 6_000_000);
    assert.equal(updated.revenueOverrideReason, 'Khách hàng thoả thuận giá mới');
    assert.ok(updated.revenueOverriddenBy, 'overriddenBy is set');
  });

  test('override on TABLE-priced trip WITHOUT reason → 400', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, pricingSource: 'TABLE', revenue: '5000000' });

    await assert.rejects(
      () => updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, {
        revenue: 6_000_000,
        // No revenueOverrideReason
      })),
      (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
  });

  test('override on MANUAL-priced trip WITHOUT reason → allowed', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, pricingSource: 'MANUAL', revenue: '0' });

    // MANUAL trips have no auto-computed price, so no reason is required.
    const updated = await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, {
      revenue: 3_000_000,
    }));

    assert.equal(Number(updated.revenue), 3_000_000);
    assert.ok(updated.revenueOverriddenBy, 'override tracked');
  });

  test('update WITHOUT changing revenue does NOT require reason', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, pricingSource: 'TABLE', revenue: '5000000' });

    // Changing only the fuel data, not the revenue.
    const updated = await updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, {
      tollsStations: 2,
    }));

    assert.ok(updated.id, 'update succeeded without reason');
  });

  test('COMPLETED trip cannot be updated without governance', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const trip = await mkTrip({ customerId: customer.id, routeId: cat.route.id, cargoTypeId: cat.cargoType.id, pricingSource: 'TABLE', status: TripStatus.COMPLETED });

    // O2C: a completed trip's financials may only change through the governed
    // correction flow. A direct edit is rejected with 409.
    await assert.rejects(
      () => updateTripFigures(trip.id, baseUpdate(trip.id, trip.version, {
        revenue: 999_999,
        revenueOverrideReason: 'should not reach',
      })),
      (err: unknown) => err instanceof ApiError && err.statusCode === 409,
    );
  });
});
