// Card 20260928_172 — "TRỌNG TẢI CONTAINER" in the phơi-phiếu container-specs
// column.
//
// The column used to print one weight under the label "Trọng tải", and that
// weight is the CARGO weight — a different number that reads identically. PM
// asked for the container's rated payload, so the board now carries both, named
// apart, and `containerPayloadKg` is the container TYPE's rating (null when we
// have no rating for that type — never a guess).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { listPhoiPhieuRows } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const containerIds: number[] = [];
const containerTypeIds: number[] = [];

async function mkContainerType(code: string, payloadKg: number | null) {
  const [row] = await db.insert(s.containerTypes)
    .values({ code: `C172-${code}-${suffix.slice(-4)}`.slice(0, 20), name: `C172 ${code} ${suffix}`, payloadKg })
    .returning({ id: s.containerTypes.id });
  containerTypeIds.push(row.id);
  return row;
}

/** One shipment whose container is of `typeId` and carries `cargoWeightKg`. */
async function mkRow(typeId: number, cargoWeightKg: number | null, day: string) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `C172 cust ${suffix} ${customerIds.length}` })
    .returning({ id: s.customers.id });
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C172 route ${suffix}` }).returning({ id: s.routes.id });
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments)
    .values({ customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED' })
    .returning({ id: s.shipments.id });
  shipmentIds.push(shipment.id);
  // The number must be unique per call: the board's own search and the unique
  // index both key on it, so a shared one fails the second fixture.
  const [container] = await db.insert(s.shipmentContainers)
    .values({ shipmentId: shipment.id, containerNumber: `C172${suffix.slice(-5)}${containerIds.length}`.slice(0, 11), containerTypeId: typeId, cargoWeightKg })
    .returning({ id: s.shipmentContainers.id });
  containerIds.push(container.id);
  // The board reaches the container through the trip's FULFILLMENT, not through
  // the shipment directly — without this the row comes back with no container at
  // all, which is exactly how a "the column shows nothing" bug hides.
  const [fulfillment] = await db.insert(s.shipmentFulfillments)
    .values({ shipmentId: shipment.id, shipmentContainerId: container.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 })
    .returning({ id: s.shipmentFulfillments.id });
  fulfillmentIds.push(fulfillment.id);
  const [trip] = await db.insert(s.trips)
    .values({ fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id, tripCode: `C172-${suffix.slice(-6)}-${shipment.id}`.slice(0, 28), departureDate: day, status: 'IN_TRANSIT' })
    .returning({ id: s.trips.id });
  return trip.id;
}

after(async () => {
  // Trips reference their fulfillment, so they go first — deleting the
  // fulfillment first trips the foreign key and fails the whole cleanup.
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (fulfillmentIds.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  if (containerIds.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, containerIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (containerTypeIds.length) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
});

const tripIds: number[] = [];
const fulfillmentIds: number[] = [];

describe('card 20260928_172 — the board carries the container rating AND the cargo weight, apart', () => {
  test('a rated type reports its payload, and it is not the cargo weight', async () => {
    const rated = await mkContainerType('40HC', 26500);
    const tripId = await mkRow(rated.id, 12000, '2026-09-22');
    tripIds.push(tripId);

    const rows = await listPhoiPhieuRows({});
    const row = rows.find((item) => item.tripId === tripId);
    assert.ok(row, 'the fixture trip is on the board');

    assert.equal(row.containerPayloadKg, 26500, 'the TYPE rating reaches the board');
    assert.equal(row.cargoWeightKg, 12000, 'the CARGO weight is unchanged');
    assert.notEqual(
      row.containerPayloadKg,
      row.cargoWeightKg,
      'the two numbers a reader would confuse are genuinely different values',
    );
  });

  // The rule that keeps this honest: an unknown type is "we do not know", not
  // "assume the nearest size". Guessing here would be a fabricated capacity on
  // a screen an accountant pays against.
  test('a type with no rating reports null, never a guessed number', async () => {
    const unknown = await mkContainerType('XRW', null);
    const tripId = await mkRow(unknown.id, 8000, '2026-09-23');
    tripIds.push(tripId);

    const rows = await listPhoiPhieuRows({});
    const row = rows.find((item) => item.tripId === tripId);
    assert.ok(row, 'the fixture trip is on the board');

    assert.equal(row.containerPayloadKg, null, 'no rating known → null, so the UI prints "—"');
    assert.equal(row.cargoWeightKg, 8000, 'the cargo weight is still reported on its own');
  });
});
