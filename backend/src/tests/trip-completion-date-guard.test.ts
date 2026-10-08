// Card 061026221826 — a trip's Ngày hoàn thành must never land before its
// Ngày khởi hành: both write paths (the manual actuals edit and the status
// machine's completion stamp) refuse it. Red-first at HEAD, where the manual
// path saved the impossible pair (/trips/135 on staging).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { FuelMode, LoadingType, Role, TripStatus } from '@tingting/shared';
import { insertTripComposite } from '../services/trip-composite.service';
import { updateTripFigures } from '../services/trip-figure-updates.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `CDG customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `CDG route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `CDG cargo ${suffix}-${createdCargoTypeIds.length}`, isBulk: false })
    .returning();
  createdCargoTypeIds.push(cargoType.id);
  return { route, cargoType };
}

async function mkTrip(opts: { departureDate: string; status?: TripStatus; revenue?: string }) {
  const customer = await mkCustomer();
  const cat = await mkCatalogs();
  const trip = await insertTripComposite(db, {
    tripCode: `CDG-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: cat.route.id,
    cargoTypeId: cat.cargoType.id,
    status: opts.status ?? TripStatus.CREATED,
    departureDate: opts.departureDate,
    revenue: opts.revenue ?? '5000000',
    revenueEmptyReturn: '5000000',
    revenueCombine: '0',
    twoPointDeliveryBonus: '0',
    vehicleShiftAllowance: '0',
    pricingSource: 'MANUAL',
    carrierType: 'OWN',
  });
  createdTripIds.push(trip.id);
  return trip;
}

function baseUpdate(tripVersion: number, overrides: Record<string, unknown> = {}) {
  return {
    legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 100, loadingType: LoadingType.HANG }],
    fuelMode: FuelMode.AUTO,
    expectedVersion: tripVersion,
    userId: 1,
    userRole: Role.MANAGER,
    ...overrides,
  };
}

describe('trip completion date cannot precede departure (card 061026221826)', () => {
  test('the manual actuals edit refuses completedAt before departureDate', async () => {
    const trip = await mkTrip({ departureDate: '2026-10-07' });
    // RED at HEAD: the edit saved the impossible pair (the /trips/135 report).
    await assert.rejects(
      () => updateTripFigures(trip.id, baseUpdate(trip.version, { completedAt: '2026-10-05T10:00:00.000Z' })),
      /Ngày hoàn thành không thể trước ngày khởi hành/,
    );
  });

  test('the manual actuals edit accepts completedAt after departureDate', async () => {
    const trip = await mkTrip({ departureDate: '2026-10-07' });
    await updateTripFigures(trip.id, baseUpdate(trip.version, { completedAt: '2026-10-08T10:00:00.000Z' }));
    const [row] = await db.select({ completedAt: s.trips.completedAt })
      .from(s.trips).where(eq(s.trips.id, trip.id));
    assert.ok(row?.completedAt);
  });

  test('the completion transition refuses a future departure date', async () => {
    // A far-future departure keeps the pin date-stable (the guard compares the
    // VN wall-clock date of `now` against it).
    const trip = await mkTrip({ departureDate: '2027-01-15', status: TripStatus.IN_TRANSIT, revenue: '5000000' });
    // RED at HEAD: completing today stamps completedAt = now (before the
    // planned departure) — the same nonsense in the other write path.
    await assert.rejects(
      () => transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER),
      /Ngày hoàn thành không thể trước ngày khởi hành/,
    );
  });

  after(async () => {
    try {
      if (createdTripIds.length > 0) {
        await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
        await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
        await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
        await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
      }
      if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
      if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
      if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
      if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    } catch { /* best-effort cleanup */ }
  });
});
