// SIL-1016 — the ngoài-chốt sidecar of the phơi-phiếu board died the moment
// the board carried a date window: `listPhoiPhieuUnattachedTrips` compiled
// `dispatchDetailTransportDateSql()` (coalesce over
// shipment_containers.customer_appointment_at) with NO shipment_containers
// join in its FROM clause — Postgres answered 'missing FROM-clause entry for
// table "shipment_containers"' and GET /phoi-phieu/rows?dateFrom=… returned
// HTTP 500. A bare load never touches that column, which is why QA only saw
// the 500 on dated reads.
//
// Sibling regression on the same ticket: the debit surfaces' ngoài-chốt rows
// (shipment-debit-detail + debit-merge) never carried billOrBooking/
// customerName, so UnattachedTripsTable rendered '—' on /shipments-debit and
// /debit-merge (CR-011 §2.5.1/§10.6.8 — identify by Số Bill/Booking, fall to
// tên khách + ngày, '—' only when both are missing).
//
// Real dev DB, tracked cleanup, isolated date window (the house convention of
// phoi-phieu-party-lots.test.ts): the fixture trip is fulfillment-less, so
// the transport date MUST fall back to the lot's expectedDeliveryDate — a
// container appointment on a different day must not pull the row out of the
// window nor break the query.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import {
  listPhoiPhieuRows,
  listPhoiPhieuUnattachedTrips,
} from '../services/phoi-phieu-control.service';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// An isolated window: no other suite writes 2026-08-19 departures.
const DAY = '2026-08-19';
const OTHER_DAY = '2026-08-21';
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

interface Fixture {
  tripId: number;
  shipmentId: number;
  blNumber: string | null;
  bookingRef: string | null;
  customerName: string;
}

async function mkUnattachedFixture(opts?: { tradeDirection?: 'IMPORT' | 'EXPORT' }): Promise<Fixture> {
  const [user] = await db.insert(s.users).values({
    username: `s16-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(() => db.delete(s.users).where(eq(s.users.id, user.id)));
  const [customer] = await db.insert(s.customers).values({
    name: `S16 khách ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id, name: s.customers.name });
  track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [route] = await db.insert(s.routes).values({ name: `S16 route ${suffix}` }).returning({ id: s.routes.id });
  track(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  // House direction law (shipments_document_reference_direction_check): an
  // IMPORT lot carries ONLY the Bill, an EXPORT lot ONLY the Booking.
  const isExport = opts?.tradeDirection === 'EXPORT';
  const ref = `${isExport ? 'S16BK' : 'S16BL'}${cleanup.length}${suffix.slice(0, 4).toUpperCase()}`;
  const blNumber = isExport ? null : ref;
  const bookingRef = isExport ? ref : null;
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY, blNumber, bookingRef,
    tradeDirection: opts?.tradeDirection ?? 'IMPORT',
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  // A container whose appointment sits OUTSIDE the window — the fallback law
  // (unattached trip ⇒ no fulfillment ⇒ expectedDeliveryDate) must hold.
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `S16U30543${cleanup.length % 10}`.slice(0, 11),
    customerAppointmentAt: new Date(`${OTHER_DAY}T08:00:00.000Z`),
  }).returning({ id: s.shipmentContainers.id });
  track(() => db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id)));
  // No fulfillment: the ngoài-chốt definition itself (fulfillmentId NULL).
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-S16-${cleanup.length}-${suffix}`, departureDate: DAY, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: trip.id, expenseType: 'LIFT', feeName: 'Phí nâng',
    buyAmount: '500000', sellAmount: '500000', invoiceNumber: `S16-HD-${cleanup.length}`,
  }).returning({ id: s.tripExpenses.id });
  track(() => db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id)));
  return { tripId: trip.id, shipmentId: shipment.id, blNumber, bookingRef, customerName: customer.name };
}

describe('SIL-1016 — the dated ngoài-chốt read never explodes on the missing container join', () => {
  test('unattachedTrips with dateFrom+dateTo resolves and falls back to expectedDeliveryDate', async () => {
    const fx = await mkUnattachedFixture();
    const trips = await listPhoiPhieuUnattachedTrips({ dateFrom: DAY, dateTo: DAY });
    const row = trips.find((trip) => trip.tripId === fx.tripId);
    assert.ok(row, 'the window trip must survive its own date window');
    assert.equal(row.billOrBooking, fx.blNumber);
    assert.equal(row.customerName, fx.customerName);
    assert.equal(row.chotIncluded, false);
    assert.equal(row.feeTotal, 500_000);
    assert.equal(row.items.length, 1);
    assert.equal(row.items[0]!.feeName, 'Phí nâng');
  });

  test('a window that misses the lot date excludes the trip (the filter still filters)', async () => {
    const fx = await mkUnattachedFixture();
    const trips = await listPhoiPhieuUnattachedTrips({ dateFrom: '2026-08-22', dateTo: '2026-08-23' });
    assert.equal(trips.some((trip) => trip.tripId === fx.tripId), false,
      'the container appointment must NOT leak the trip into a foreign window');
  });

  test('GET rows composition with dateFrom+dateTo returns both board and sidecar (the 500 repro)', async () => {
    await mkUnattachedFixture();
    const [items, unattached] = await Promise.all([
      listPhoiPhieuRows({ dateFrom: DAY, dateTo: DAY }),
      listPhoiPhieuUnattachedTrips({ dateFrom: DAY, dateTo: DAY }),
    ]);
    assert.ok(Array.isArray(items), 'the board rows read resolves with a date window');
    assert.ok(Array.isArray(unattached), 'the sidecar read resolves with a date window');
  });
});

describe('SIL-1016 — the debit ngoài-chốt rows identify their lot (CR-011 §2.5.1/§10.6.8)', () => {
  test('debit-detail unattached sections carry billOrBooking + customerName', async () => {
    const fx = await mkUnattachedFixture();
    const detail = await getShipmentDebitDetail(fx.shipmentId);
    const section = detail.unattachedTrips.find((trip) => trip.tripId === fx.tripId);
    assert.ok(section, 'the lot lists its ngoài-chốt trip');
    assert.equal(section.billOrBooking, fx.blNumber);
    assert.equal(section.customerName, fx.customerName);
    assert.equal(section.chotIncluded, false);
  });

  test('an EXPORT lot keys the row by booking, never the bill (house direction law)', async () => {
    const fx = await mkUnattachedFixture({ tradeDirection: 'EXPORT' });
    const detail = await getShipmentDebitDetail(fx.shipmentId);
    const section = detail.unattachedTrips.find((trip) => trip.tripId === fx.tripId);
    assert.ok(section);
    assert.equal(section.billOrBooking, fx.bookingRef);
  });
});

after(async () => {
  for (const run of cleanup) {
    await run();
  }
  await disconnectRedis();
});
