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

// The widget counts a trip by its VIETNAM business completion date
// (reporting-shared.tripCompletionBusinessDateSql anchors completedAt to
// Asia/Ho_Chi_Minh) and windows it into the month passed to
// getDashboardWidgets. Deriving that month from the local clock breaks for
// seven hours at every month boundary: at Sep 30 21:00 UTC the local month
// is still September, yet every trip completed "now" already carries the
// Vietnam business date Oct 1 and falls OUTSIDE September's window —
// card 20261001_255: exactly how this suite red-flapped in the isolated
// runner (TZ=UTC) while passing solo at other hours. Anchor the month to
// the same Vietnam business date the widget counts by (UTC+7, no DST).
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
function vietnamMonthYear(at: Date = now): { m: number; y: number } {
  const vn = new Date(at.getTime() + VN_OFFSET_MS);
  return { m: vn.getUTCMonth() + 1, y: vn.getUTCFullYear() };
}
const { m, y } = vietnamMonthYear();

const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

function isoDateFromToday(deltaDays: number): string {
  const value = new Date();
  value.setDate(value.getDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

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
    completedAt: new Date(),
    hasReturnCargo: opts.hasReturnCargo ?? false,
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

describe('M11.5 — salary-period month derivation (card 20261001_255)', () => {
  test('the widget month follows the Vietnam business date across the UTC boundary', () => {
    // Vietnam's day starts at 17:00 UTC. 16:59:30Z on Sep 30 is still
    // Sep 30 in BOTH zones (23:59:30 Vietnam); thirty seconds later the
    // Vietnam business date is already Oct 1 — the derivation must follow it,
    // because that is where the widget's business-date window places a trip
    // completed "now".
    assert.deepEqual(vietnamMonthYear(new Date('2026-09-30T16:59:30Z')), { m: 9, y: 2026 });
    assert.deepEqual(vietnamMonthYear(new Date('2026-09-30T17:00:30Z')), { m: 10, y: 2026 });
    // The mirror boundary at the next month end: Oct 31 17:00Z is Nov 1 in
    // Vietnam while UTC still says October.
    assert.deepEqual(vietnamMonthYear(new Date('2026-10-31T16:59:30Z')), { m: 10, y: 2026 });
    assert.deepEqual(vietnamMonthYear(new Date('2026-10-31T17:00:30Z')), { m: 11, y: 2026 });
    // Midnight UTC on the 1st is unambiguous in both zones.
    assert.deepEqual(vietnamMonthYear(new Date('2026-10-01T00:00:00Z')), { m: 10, y: 2026 });
  });
});

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

  test('fleetAttention: inspection due date is included in Vietnamese reminder text', async () => {
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `M115D${tripCounter}`,
      status: 'ACTIVE',
      nextInspectionDate: isoDateFromToday(-3),
    }).returning();
    createdTruckIds.push(truck.id);

    const w = await getDashboardWidgets(m, y, true);
    const found = w.fleetAttention.find((t) => t.truckId === truck.id);
    assert.ok(found, 'truck with overdue inspection in attention list');
    assert.match(found!.reason, /Đăng kiểm quá hạn \d+ ngày/);
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
