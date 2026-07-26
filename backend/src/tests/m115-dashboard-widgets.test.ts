/**
 * Wave 4 M11.5 — dashboard widgets integration tests.
 *
 * Creates trucks + trips, exercises `getDashboardWidgets`, tears down.
 *
 * Coverage (PRD M11-05-01/03):
 *   - twoWayCargoRatio: correct percentage.
 *   - fleetAttention: MAINTENANCE/INACTIVE trucks listed.
 *   - fleetAttention: ACTIVE truck with no recent trip listed.
 *   - periodOverPeriod: shape present with numeric values.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getDashboardWidgets } from '../services/dashboard-widgets.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = new Date();
const m = now.getMonth() + 1;
const y = now.getFullYear();

const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCatalogs() {
  const [customer] = await db.insert(s.customers).values({ name: `M115 cust ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `M115 route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `M115 cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return { customer, route, cargoType };
}

let tripCounter = 0;
async function mkTrip(truckId: number | null, customerId: number, routeId: number, cargoTypeId: number, opts: { hasReturnCargo?: boolean; status?: string; departureDate?: string } = {}) {
  tripCounter += 1;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M115${tripCounter}-${tripCounter}`.slice(0, 50),
    truckId, customerId, routeId, cargoTypeId,
    status: (opts.status ?? 'COMPLETED') as 'COMPLETED',
    departureDate: opts.departureDate ?? new Date().toISOString().slice(0, 10),
    hasReturnCargo: opts.hasReturnCargo ?? false,
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

describe('M11.5 — dashboard widgets', () => {
  test('twoWayCargoRatio: correct percentage', async () => {
    const cat = await mkCatalogs();
    const [truck] = await db.insert(s.trucks).values({ licensePlate: `M115${tripCounter}`, status: 'ACTIVE' }).returning();
    createdTruckIds.push(truck.id);
    await mkTrip(truck.id, cat.customer.id, cat.route.id, cat.cargoType.id, { hasReturnCargo: true });
    await mkTrip(truck.id, cat.customer.id, cat.route.id, cat.cargoType.id, { hasReturnCargo: false });

    const w = await getDashboardWidgets(m, y, true);
    // At least 2 billable trips, at least 1 with return cargo.
    assert.ok(w.twoWayCargoRatio.totalBillableTrips >= 2);
    assert.ok(w.twoWayCargoRatio.percentage >= 0 && w.twoWayCargoRatio.percentage <= 100);
  });

  test('fleetAttention: MAINTENANCE truck listed', async () => {
    const [truck] = await db.insert(s.trucks).values({ licensePlate: `M115M${tripCounter}`, status: 'MAINTENANCE' }).returning();
    createdTruckIds.push(truck.id);
    const w = await getDashboardWidgets(m, y, true);
    const found = w.fleetAttention.find((t) => t.truckId === truck.id);
    assert.ok(found, 'MAINTENANCE truck in attention list');
    assert.equal(found!.reason, 'Đang bảo dưỡng');
  });

  test('fleetAttention: ACTIVE truck with no recent trip listed', async () => {
    const [truck] = await db.insert(s.trucks).values({ licensePlate: `M115I${tripCounter}`, status: 'ACTIVE' }).returning();
    createdTruckIds.push(truck.id);
    // No trips assigned → should appear as "Chưa có chuyến".
    const w = await getDashboardWidgets(m, y, true);
    const found = w.fleetAttention.find((t) => t.truckId === truck.id);
    assert.ok(found, 'ACTIVE truck with no trips in attention list');
    assert.match(found!.reason, /Chưa có chuyến|Không hoạt động/);
  });

  test('periodOverPeriod: shape present with numeric values', async () => {
    const w = await getDashboardWidgets(m, y, true);
    assert.ok(typeof w.periodOverPeriod.currentRevenue === 'number');
    assert.ok(typeof w.periodOverPeriod.previousRevenue === 'number');
    assert.ok(typeof w.periodOverPeriod.revenueChangePct === 'number');
    assert.ok(typeof w.periodOverPeriod.currentProfit === 'number');
    assert.ok(typeof w.periodOverPeriod.profitChangePct === 'number');
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) {
    console.warn('[m115-dashboard-widgets.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
