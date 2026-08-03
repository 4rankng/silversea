import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { createHandoff } from '../services/dispatch-handoff.service';
import { createShipmentChangeRequest } from '../services/shipment-edit-boundary.service';
import { ensureShipmentFulfillmentsInTx } from '../services/shipment-fulfillment.service';
import { createTrip } from '../services/trip-mutations.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdTripIds: number[] = [];

async function createActor() {
  const [actor] = await db.insert(s.users).values({
    username: `app-trip-guard-${suffix}-${createdUserIds.length}`,
    passwordHash: 'test-only',
    role: 'ADMIN',
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(actor.id);
  return actor;
}

async function createLclShipment(actorId: number) {
  const [customer] = await db.insert(s.customers).values({
    name: `App trip guard customer ${suffix}-${createdCustomerIds.length}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `ATG-${suffix}-${createdShipmentIds.length}`,
    cargoMode: 'LCL',
    createdBy: actorId,
  }).returning();
  createdShipmentIds.push(shipment.id);
  return shipment;
}

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.notifications).where(and(
        eq(s.notifications.relatedEntityType, 'shipments'),
        inArray(s.notifications.relatedEntityId, createdShipmentIds),
      ));
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
      await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentChangeRequests).where(inArray(s.shipmentChangeRequests.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await client.end();
  }
});

describe('application-owned trip workflow guards', () => {
  test('concurrent trip creation allocates distinct monthly codes without upsert authority', async () => {
    const [customer] = await db.insert(s.customers).values({
      name: `App trip counter customer ${suffix}-${createdCustomerIds.length}`,
    }).returning();
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes).values({
      name: `App trip counter route ${suffix}`,
    }).returning();
    createdRouteIds.push(route.id);
    const [cargoType] = await db.insert(s.cargoTypes).values({
      name: `App trip counter cargo ${suffix}`,
    }).returning();
    createdCargoTypeIds.push(cargoType.id);
    const [containerType] = await db.insert(s.containerTypes).values({
      code: `AT${suffix.slice(-6)}`.slice(0, 20),
      name: `App trip counter container ${suffix}`,
    }).returning();
    createdContainerTypeIds.push(containerType.id);
    const input = {
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      containerTypeId: containerType.id,
      departureDate: '2099-12-01',
      containerCount: 1,
    };

    const trips = await Promise.all([createTrip(input), createTrip(input)]);
    createdTripIds.push(...trips.map((trip) => trip.id));
    assert.notEqual(trips[0].tripCode, trips[1].tripCode);
    assert.ok(trips.every((trip) => trip.tripCode?.startsWith('TRP-209912-') === true));
  });

  test('concurrent fulfillment decomposition returns one canonical active row', async () => {
    const actor = await createActor();
    const shipment = await createLclShipment(actor.id);

    const results = await Promise.all([
      db.transaction((tx) => ensureShipmentFulfillmentsInTx(tx, {
        shipmentId: shipment.id,
        actorId: actor.id,
        expectedVersion: shipment.version,
      })),
      db.transaction((tx) => ensureShipmentFulfillmentsInTx(tx, {
        shipmentId: shipment.id,
        actorId: actor.id,
        expectedVersion: shipment.version,
      })),
    ]);

    assert.equal(results[0].length, 1);
    assert.equal(results[1].length, 1);
    assert.equal(results[0][0].id, results[1][0].id);
    const persisted = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipment.id));
    assert.equal(persisted.length, 1);
  });

  test('concurrent change requests produce one row and one domain conflict', async () => {
    const actor = await createActor();
    const shipment = await createLclShipment(actor.id);
    const command = () => db.transaction((tx) => createShipmentChangeRequest(tx, {
      shipment,
      sourceVersion: shipment.version,
      requestKind: 'PLAN_UPDATE',
      requestedBy: actor.id,
      beforeSnapshot: { operationalNotes: null },
      afterSnapshot: { operationalNotes: 'Đổi kế hoạch' },
    }));

    const results = await Promise.allSettled([command(), command()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.equal((rejected.reason as { statusCode?: number }).statusCode, 409);
    assert.match((rejected.reason as Error).message, /yêu cầu thay đổi mới hơn/i);
    const persisted = await db.select().from(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.shipmentId, shipment.id));
    assert.equal(persisted.length, 1);
  });

  test('concurrent handoff creation produces one active row and one domain conflict', async () => {
    const actor = await createActor();
    const shipment = await createLclShipment(actor.id);
    const command = () => createHandoff({
      shipmentId: shipment.id,
      handlerId: actor.id,
      createdBy: actor.id,
    });

    const results = await Promise.allSettled([command(), command()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.equal((rejected.reason as { statusCode?: number }).statusCode, 409);
    assert.match((rejected.reason as Error).message, /lệnh điều vận đang xử lý/i);
    const persisted = await db.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.equal(persisted.length, 1);
  });
});
