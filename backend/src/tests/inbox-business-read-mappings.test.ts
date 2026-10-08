import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { customerWorkInbox, driverWorkInbox, financialWorkInbox, managerDecisionInbox, operationsWorkInbox } from '../services/work-inbox.service';
import { getForwarderTrips, getForwarderTripDetail } from '../services/forwarder-trip-query.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const shipmentIds: number[] = [], fulfillmentIds: number[] = [], tripIds: number[] = [];
const query = { page: 1, limit: 2000 };

async function assignedTrip(input: { bill: string | null; booking?: string | null; status?: 'CREATED' | 'COMPLETED'; carrierType?: 'OWN' | 'EXTERNAL'; externalPlateNumber?: string | null }) {
  const [customer] = await db.select().from(s.customers).limit(1);
  const [route] = await db.select().from(s.routes).limit(1);
  const [cargo] = await db.select().from(s.cargoTypes).limit(1);
  const [driver] = await db.select().from(s.drivers).limit(1);
  const [truck] = await db.select().from(s.trucks).limit(1);
  const [user] = await db.select().from(s.users).where(eq(s.users.role, 'OPS')).limit(1);
  assert.ok(customer && route && cargo && driver && truck && user);
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `SHP-INBOX-${suffix}-${shipmentIds.length}`, customerId: customer.id,
    blNumber: input.bill, bookingRef: input.booking, tradeDirection: input.booking ? 'EXPORT' : 'IMPORT', cargoMode: 'LCL', status: 'DISPATCHED',
    orderExchangeCompletedAt: new Date('2026-09-01T00:00:00Z'), customsCutoffAt: new Date('2026-09-01T00:00:00Z'),
  }).returning();
  shipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, fulfillmentType: 'LCL_SHIPMENT', cargoMode: 'LCL',
    dispatchClassification: 'LCL', sourceShipmentVersion: shipment.version,
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  const trip = await insertTripComposite(db, {
    tripCode: `TRP-INBOX-${suffix}-${tripIds.length}`, customerId: customer.id, routeId: route.id,
    cargoTypeId: cargo.id, shipmentId: shipment.id, fulfillmentId: fulfillment.id,
    departureDate: '2026-09-01', plannedStartAt: new Date('2026-09-01T01:00:00Z'),
    status: input.status ?? 'CREATED', driverId: driver.id, truckId: truck.id,
    customerReference: input.bill?.trim() || input.booking?.trim() || null,
    carrierType: input.carrierType ?? 'OWN', externalPlateNumber: input.externalPlateNumber,
    externalDriverName: driver.name,
  });
  tripIds.push(trip.id);
  await db.insert(s.userShipmentLinks).values({ userId: user.id, shipmentId: shipment.id });
  return { shipment, trip, customer, driver, truck, user };
}

test('every trip inbox lane displays Bill/Booking or explicit missing reference without substituting internal codes', async () => {
  for (const input of [
    { bill: ` QA-BILL-${suffix} `, booking: null },
    { bill: null, booking: ` QA-BOOK-${suffix} ` },
    { bill: null, booking: null },
  ]) {
    const fixture = await assignedTrip(input);
    const expected = input.bill?.trim() || input.booking?.trim() || 'Chưa có số Bill/Booking';
    const ops = await operationsWorkInbox(fixture.user.id, query);
    assert.equal(ops.items.find(row => row.tripId === fixture.trip.id)?.title, expected);
    const driver = await driverWorkInbox(fixture.driver.id, query);
    assert.equal(driver.items.find(row => row.tripId === fixture.trip.id)?.title, expected);
    const manager = await managerDecisionInbox(fixture.user.id, query);
    assert.equal(manager.items.find(row => row.id === `paper-handoff:${fixture.trip.id}`)?.title, `${expected} quá hạn bàn giao lệnh gốc`);
    assert.equal(manager.items.find(row => row.id === `shipment-sla:${fixture.shipment.id}`)?.title, `${expected} quá hạn cut-off`);
    await db.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, fixture.trip.id));
    const financial = await financialWorkInbox(query);
    assert.equal(financial.items.find(row => row.tripId === fixture.trip.id)?.title, expected);
    if (input.bill?.trim()) {
      const customer = await customerWorkInbox(fixture.customer.id, { ...query, search: input.bill.trim() });
      assert.equal(customer.items.find(row => row.shipmentId === fixture.shipment.id)?.title, expected);
    }
  }
});

test('OPS list/detail use external persisted plate while OWN retains its truck and missing external plate stays absent', async () => {
  for (const carrierType of ['EXTERNAL', 'OWN'] as const) {
    for (const externalPlateNumber of ['15H-154.98', null]) {
      const fixture = await assignedTrip({ bill: `QA-PLATE-${suffix}-${tripIds.length}`, carrierType, externalPlateNumber });
      const expected = carrierType === 'EXTERNAL' ? externalPlateNumber : fixture.truck.licensePlate;
      const rows = await getForwarderTrips(fixture.user.id);
      assert.equal(rows.find(row => row.tripId === fixture.trip.id)?.truckPlate, expected);
      const detail = await getForwarderTripDetail(fixture.trip.id, fixture.user.id);
      assert.equal(detail?.truckPlate, expected);
      const inbox = await operationsWorkInbox(fixture.user.id, query);
      assert.equal(inbox.items.find(row => row.tripId === fixture.trip.id)?.truckPlate, expected);
      assert.equal(inbox.items.find(row => row.tripId === fixture.trip.id)?.driverName, fixture.driver.name);
    }
  }
});

after(async () => {
  try {
    if (tripIds.length) {
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    }
    if (fulfillmentIds.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
    if (shipmentIds.length) {
      await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
  } finally { await client.end(); }
});
