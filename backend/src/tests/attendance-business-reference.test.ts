import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { insertTripComposite } from '../services/trip-composite.service';
import { getTripLabelsForWorkDays } from '../services/attendance.service';

const runKey = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const tripIds: number[] = [];
const shipmentIds: number[] = [];

test('ATT01 attendance labels use persisted Bill/Booking without changing trip or financial identity', async () => {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id, name: s.routes.name }).from(s.routes).limit(1);
  assert.ok(customer); assert.ok(route);
  const cases = [
    { direction: 'IMPORT' as const, bill: `ATT-BILL-${runKey}`, booking: null, expected: `ATT-BILL-${runKey}` },
    { direction: 'EXPORT' as const, bill: null, booking: `ATT-BOOKING-${runKey}`, expected: `ATT-BOOKING-${runKey}` },
    { direction: 'IMPORT' as const, bill: `  ATT-TRIM-${runKey}  `, booking: null, expected: `ATT-TRIM-${runKey}` },
    { direction: 'IMPORT' as const, bill: null, booking: null, expected: 'Chưa có số Bill/Booking' },
  ];
  const expected = new Map<number, string>();
  for (const item of cases) {
    const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, routeId: route.id, cargoMode: 'FCL', tradeDirection: item.direction, blNumber: item.bill, bookingRef: item.booking }).returning({ id: s.shipments.id });
    shipmentIds.push(shipment.id);
    const trip = await insertTripComposite(db, { customerId: customer.id, routeId: route.id, shipmentId: shipment.id, tripCode: `ATT-INTERNAL-${runKey}-${tripIds.length}`, departureDate: '2026-10-01', status: 'CREATED' });
    tripIds.push(trip.id);
    expected.set(trip.id, item.expected);
  }
  const legacy = await insertTripComposite(db, { customerId: customer.id, routeId: route.id, tripCode: `ATT-LEGACY-${runKey}`, departureDate: '2026-10-01', status: 'CREATED' });
  tripIds.push(legacy.id);
  expected.set(legacy.id, 'Chưa có số Bill/Booking');
  const beforeTrips = await db.select().from(s.trips).where(inArray(s.trips.id, tripIds)).orderBy(s.trips.id);
  const beforeFinancial = await db.select().from(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds)).orderBy(s.tripFinancialState.tripId);
  const labels = await getTripLabelsForWorkDays([...tripIds, legacy.id]);
  assert.equal(labels.length, tripIds.length, 'duplicate requested IDs never multiply attendance labels');
  for (const label of labels) {
    assert.equal(label.tripCode, expected.get(label.id));
    assert.equal(label.routeName, route.name);
    assert.deepEqual(Object.keys(label).sort(), ['id', 'routeName', 'tripCode'], 'legacy response shape is preserved');
  }
  assert.deepEqual(await getTripLabelsForWorkDays([]), []);
  assert.deepEqual(await getTripLabelsForWorkDays([-1]), []);
  assert.deepEqual(await db.select().from(s.trips).where(inArray(s.trips.id, tripIds)).orderBy(s.trips.id), beforeTrips);
  assert.deepEqual(await db.select().from(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds)).orderBy(s.tripFinancialState.tripId), beforeFinancial);
});

after(async () => {
  try {
    for (const id of tripIds) {
      await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, id));
      await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, id));
      await db.delete(s.trips).where(eq(s.trips.id, id));
    }
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  } finally { await disconnectRedis(); await client.end(); }
});
