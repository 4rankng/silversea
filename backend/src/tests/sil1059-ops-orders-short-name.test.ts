// SIL-1059 — the /ops/orders KHÁCH HÀNG column and the phơi-phiếu
// "Ngoài chốt" block read the house short-name law: customers.shortName over
// the legal name (operationalName — the same projection SIL-877 gave the
// phơi-phiếu board rows and SIL-895 gave the accountant board).
//
// Spec §10.8.1: "Cột khách hàng hiện tên ngắn vận hành (ví dụ 'Long Minh'),
// không hiện tên pháp lý đầy đủ; khối Ngoài chốt trên màn phơi phiếu dùng
// cùng tên ngắn." Before this, both surfaces read customers.name raw, so the
// legal name ("CÔNG TY TNHH … LONG MINH") printed whole and pushed the
// Bill/Booking column off the plan list.
//
// Real dev DB, tracked cleanup (the house convention of
// phoi-phieu-unattached-trips-window.test.ts).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { listOpsOrders } from '../services/ops-orders.service';
import { listPhoiPhieuUnattachedTrips } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SHORT_NAME = 'Long Minh';
const DAY = '2026-08-19';
/** One fixture per test — the legal name is unique per customer row
 *  (customers_active_name_tax_code_uniq_idx), the SHORT name is the same for
 *  every fixture on purpose: the law prints it verbatim. */
let fixtureSeq = 0;
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

interface Fixture {
  userId: number;
  shipmentId: number;
  tripId: number;
  legalName: string;
  /** The customer WITHOUT a short name — operationalName must fall back to
   *  the legal name for it (the law never invents a short name). */
  plainShipmentId: number;
}

/** One fulfillment-less lot (the ngoài-chốt definition) whose customer
 *  carries an operational short name. */
async function mkFixture(): Promise<Fixture> {
  const seq = fixtureSeq++;
  const legalName = `CÔNG TY TNHH MTV LONG MINH ${suffix}-${seq}`;
  const [user] = await db.insert(s.users).values({
    username: `s1059-${suffix}-${seq}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(() => db.delete(s.users).where(eq(s.users.id, user.id)));

  const [customer] = await db.insert(s.customers).values({
    name: legalName, shortName: SHORT_NAME,
  }).returning({ id: s.customers.id });
  track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));

  const [plainCustomer] = await db.insert(s.customers).values({ name: `S1059 pháp lý ${suffix}-${seq}` })
    .returning({ id: s.customers.id });
  track(() => db.delete(s.customers).where(eq(s.customers.id, plainCustomer.id)));

  const [route] = await db.insert(s.routes).values({ name: `S1059 route ${suffix}-${seq}` }).returning({ id: s.routes.id });
  track(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY, blNumber: `S1059BL${seq}`, tradeDirection: 'IMPORT',
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));

  const [plainShipment] = await db.insert(s.shipments).values({
    customerId: plainCustomer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY, blNumber: `S1059PL${seq}`, tradeDirection: 'IMPORT',
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, plainShipment.id)));

  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `S1059U30${seq % 10}`.slice(0, 11),
  }).returning({ id: s.shipmentContainers.id });
  track(() => db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id)));

  // No fulfillment: the ngoài-chốt definition itself (fulfillmentId NULL).
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-S1059-${seq}-${suffix}`, departureDate: DAY, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));

  return { userId: user.id, shipmentId: shipment.id, tripId: trip.id, legalName, plainShipmentId: plainShipment.id };
}

describe('SIL-1059 — the plan list and the ngoài-chốt block read the operational short name', () => {
  test('the /ops/orders KHÁCH HÀNG column reads the short name, not the legal name', async () => {
    const fx = await mkFixture();
    const orders = await listOpsOrders(fx.userId, null);
    const row = orders.find((order) => order.id === fx.shipmentId);
    assert.ok(row, 'the plan list must carry the lot');
    assert.equal(row.customerName, SHORT_NAME);
    assert.notEqual(row.customerName, fx.legalName);
  });

  test('a customer WITHOUT a short name keeps its legal name (the law never invents one)', async () => {
    const fx = await mkFixture();
    const orders = await listOpsOrders(fx.userId, null);
    const row = orders.find((order) => order.id === fx.plainShipmentId);
    assert.ok(row, 'the plan list must carry the lot');
    assert.match(row.customerName!, /^S1059 pháp lý/);
  });

  test('the search box finds the customer by the short name it shows', async () => {
    const fx = await mkFixture();
    const found = await listOpsOrders(fx.userId, null, SHORT_NAME);
    assert.ok(
      found.some((order) => order.id === fx.shipmentId),
      'the box advertises "Khách hàng" — it must find the customer by the name on screen',
    );
  });

  test('the phơi-phiếu Ngoài chốt block reads the SAME short name', async () => {
    const fx = await mkFixture();
    const trips = await listPhoiPhieuUnattachedTrips({});
    const row = trips.find((trip) => trip.tripId === fx.tripId);
    assert.ok(row, 'the ngoài-chốt block must carry the trip');
    assert.equal(row.customerName, SHORT_NAME);
  });
});

after(async () => {
  for (const run of cleanup) {
    await run();
  }
  await disconnectRedis();
});
