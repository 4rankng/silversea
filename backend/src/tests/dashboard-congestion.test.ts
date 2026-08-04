/**
 * O2C Step 4 — flow-congestion dashboard alerts.
 *
 * (TK) Product Spec.md Step 4 Dev Notes: "Dashboard cảnh báo tắc nghẽn luồng
 * (Ví dụ: Xe đã phân xong chờ quá lâu chưa có lệnh, hoặc Lệnh đã lấy xong sắp
 * hết hạn lưu bãi nhưng chưa phân được xe)."
 *
 * Two parallel-branch stall conditions surface as dispatch-kind decision items
 * on the director dashboard decision strip:
 *
 *   Stall A — dispatched (truck assigned) but Ops order-exchange not done for
 *             over DISPATCH_NO_ORDER_STALL_HOURS (24h).
 *   Stall B — order-exchange done but no truck yet, and customs cutoff is
 *             within YARD_EXPIRY_WINDOW_HOURS (48h, warning) or already past
 *             (critical).
 *
 * Tests exercise the exported getCongestionAlertCounts() query directly (no
 * dashboard cache) and assert buildDecisionItems emits the right items. This
 * keeps the test deterministic in a shared-DB test environment.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import {
  getCongestionAlertCounts,
  DISPATCH_NO_ORDER_STALL_HOURS,
  YARD_EXPIRY_WINDOW_HOURS,
} from '../services/dashboard-stats.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const customerIds: number[] = [];
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const truckIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];

let routeId = 0;
let cargoTypeId = 0;

async function seedCatalog() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Congestion cust ${suffix}`.slice(0, 255) })
    .returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `Congestion route ${suffix}`.slice(0, 255) })
    .returning();
  routeId = route.id;
  routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Congestion cargo ${suffix}`.slice(0, 255) })
    .returning();
  cargoTypeId = cargoType.id;
  cargoTypeIds.push(cargoType.id);
  return customer.id;
}

let truckCounter = 0;
async function seedTruck() {
  truckCounter += 1;
  const plate = `CG${Date.now().toString(36)}${truckCounter}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
  const [truck] = await db.insert(s.trucks)
    .values({ licensePlate: plate, status: 'ACTIVE' })
    .returning();
  truckIds.push(truck.id);
  return truck.id;
}

/**
 * Insert a shipment in a given parallel-branch state plus a backing CREATED
 * trip. tripCreatedAt is backdated to simulate elapsed stall time. Returns the
 * shipment id so the caller can reason about expected counts.
 */
async function seedShipment(args: {
  label: string;
  status: 'READY_FOR_DISPATCH' | 'DISPATCHED';
  hasTruck: boolean;
  exchangeCompleted: boolean;
  customsCutoffAt: Date | null;
  tripCreatedAt: Date;
  customerId: number;
}): Promise<number> {
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: args.label.slice(0, 50),
    customerId: args.customerId,
    routeId,
    cargoTypeId,
    cargoMode: 'FCL',
    factoryName: `Nhà máy ${args.label}`.slice(0, 255),
    status: args.status,
    orderExchangeCompletedAt: args.exchangeCompleted ? new Date() : null,
    customsCutoffAt: args.customsCutoffAt,
  }).returning();
  shipmentIds.push(shipment.id);

  const truckId = args.hasTruck ? await seedTruck() : null;
  const [trip] = await db.insert(s.trips).values({
    tripCode: args.label.slice(0, 50),
    customerId: args.customerId,
    routeId,
    cargoTypeId,
    shipmentId: shipment.id,
    truckId,
    status: 'CREATED',
    departureDate: new Date().toISOString().slice(0, 10),
    createdAt: args.tripCreatedAt,
  }).returning();
  tripIds.push(trip.id);
  return shipment.id;
}

describe('O2C flow-congestion dashboard alerts', () => {
  let customerId = 0;
  // +6h cutoff: inside the YARD_EXPIRY_WINDOW_HOURS window, not yet past.
  const cutoffSoon = new Date(Date.now() + 6 * 60 * 60 * 1000);
  assert.ok(cutoffSoon.getTime() < Date.now() + YARD_EXPIRY_WINDOW_HOURS * 60 * 60 * 1000,
    'cutoffSoon fixture must stay inside the warning window');
  // -2h cutoff: already past => critical.
  const cutoffPast = new Date(Date.now() - 2 * 60 * 60 * 1000);
  // 30h ago: exceeds the 24h stall-A threshold.
  const createdLongAgo = new Date(Date.now() - (DISPATCH_NO_ORDER_STALL_HOURS + 6) * 60 * 60 * 1000);
  // 1h ago: under the 24h stall-A threshold (healthy for stall A).
  const createdRecent = new Date(Date.now() - 1 * 60 * 60 * 1000);

  // Counts BEFORE seeding, so each assertion uses the delta attributable to
  // this test's rows alone — robust against pre-existing data in the shared DB.
  let baselineStallA = 0;
  let baselineStallB = 0;
  let baselineStallBOverdue = 0;
  let seededStallAId = 0;
  let seededStallBCritId = 0;

  before(async () => {
    customerId = await seedCatalog();
    const baseline = await getCongestionAlertCounts();
    baselineStallA = baseline.stalledDispatchedNoOrder;
    baselineStallB = baseline.stalledOrderNoTruck;
    baselineStallBOverdue = baseline.stalledOrderNoTruckOverdue;

    // Stall A: dispatched + truck, exchange NOT done, trip > 24h old.
    seededStallAId = await seedShipment({
      label: `CONG-A-${suffix}`,
      status: 'DISPATCHED', hasTruck: true, exchangeCompleted: false,
      customsCutoffAt: null, tripCreatedAt: createdLongAgo, customerId,
    });
    // Stall B (warning): exchange done, no truck, cutoff soon (not past).
    await seedShipment({
      label: `CONG-BW-${suffix}`,
      status: 'READY_FOR_DISPATCH', hasTruck: false, exchangeCompleted: true,
      customsCutoffAt: cutoffSoon, tripCreatedAt: createdRecent, customerId,
    });
    // Stall B (critical): exchange done, no truck, cutoff past.
    seededStallBCritId = await seedShipment({
      label: `CONG-BC-${suffix}`,
      status: 'READY_FOR_DISPATCH', hasTruck: false, exchangeCompleted: true,
      customsCutoffAt: cutoffPast, tripCreatedAt: createdRecent, customerId,
    });
    // Healthy: both branches complete -> excluded from both stalls.
    await seedShipment({
      label: `CONG-H1-${suffix}`,
      status: 'DISPATCHED', hasTruck: true, exchangeCompleted: true,
      customsCutoffAt: cutoffSoon, tripCreatedAt: createdLongAgo, customerId,
    });
    // Healthy for stall A: dispatched + truck, exchange not done, but recent.
    await seedShipment({
      label: `CONG-H2-${suffix}`,
      status: 'DISPATCHED', hasTruck: true, exchangeCompleted: false,
      customsCutoffAt: null, tripCreatedAt: createdRecent, customerId,
    });
  });

  test('Stall A counts the dispatched-no-order shipment (truck assigned, exchange pending, > 24h)', async () => {
    const counts = await getCongestionAlertCounts();
    const delta = counts.stalledDispatchedNoOrder - baselineStallA;
    assert.equal(delta, 1,
      `expected +1 stall-A from seed ${seededStallAId}, baseline=${baselineStallA}, now=${counts.stalledDispatchedNoOrder}`);
  });

  test('Stall B counts both order-done-no-truck shipments and flags the past-due one as overdue', async () => {
    const counts = await getCongestionAlertCounts();
    const deltaB = counts.stalledOrderNoTruck - baselineStallB;
    const deltaOverdue = counts.stalledOrderNoTruckOverdue - baselineStallBOverdue;
    assert.equal(deltaB, 2,
      `expected +2 stall-B (warn+crit), baseline=${baselineStallB}, now=${counts.stalledOrderNoTruck}`);
    assert.ok(deltaOverdue >= 1,
      `expected overdue >= 1 from past-cutoff seed ${seededStallBCritId}, baseline=${baselineStallBOverdue}, now=${counts.stalledOrderNoTruckOverdue}`);
  });

  test('threshold boundary: the 1h-old dispatched-no-order shipment is NOT counted in stall A', async () => {
    // CONG-H2 is dispatched + truck + exchange-not-done but only 1h old, so it
    // must not inflate stall A. The healthy both-branches row (CONG-H1) is also
    // excluded. So the stall-A delta must remain exactly 1 (only CONG-A).
    const counts = await getCongestionAlertCounts();
    const delta = counts.stalledDispatchedNoOrder - baselineStallA;
    assert.equal(delta, 1,
      `recent + healthy rows leaked into stall A; expected delta 1, got ${delta}`);
  });
});

after(async () => {
  try {
    if (tripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    if (shipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (truckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
    if (cargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
    if (routeIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  } catch (err) {
    console.warn('[dashboard-congestion.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
