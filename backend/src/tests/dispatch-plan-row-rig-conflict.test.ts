// Card 20261003_317 — duplicate tractor assignment across plan-row edits.
//
// The detail-plan row edit assigns rigs BEFORE dispatch (the row has no trip
// yet), and the path never checked resource conflicts: the same tractor could
// be planned onto two fulfillments in overlapping windows with two 200s. This
// suite pins the contract: assigning a rig whose plate already rides another
// live fulfillment (or a dispatched trip) in an OVERLAPPING window is a 409;
// provably disjoint windows and self re-saves stay allowed.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { updateDispatchDetailPlan } from '../services/dispatch-planning-detail-plan.service';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const ids: Record<string, number[]> = {
  users: [], customers: [], routes: [], containerTypes: [], shipments: [], containers: [],
  fulfillments: [], trucks: [], trailers: [], drivers: [],
};
let actorId = 0;
let truckId = 0;
const plate = `51C-${suffix.slice(-6)}`.slice(0, 20);
let lotA = { shipmentId: 0, fulfillmentId: 0, fulfillmentVersion: 1, shipmentVersion: 1 };
let lotB = { shipmentId: 0, fulfillmentId: 0, fulfillmentVersion: 1, shipmentVersion: 1 };
let lotC = { shipmentId: 0, fulfillmentId: 0, fulfillmentVersion: 1, shipmentVersion: 1 };

const DAY = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

async function seedLot(tag: string, appointment: string) {
  const [customer] = await db.insert(s.customers).values({ name: `RigConflict customer ${suffix} ${tag}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `RigConflict route ${suffix} ${tag}` }).returning();
  ids.routes.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `RGC-${suffix.slice(-8)}-${tag}`.slice(0, 50),
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
  }).returning();
  ids.shipments.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: ids.containerTypes[0],
    containerNumber: `RGSU${String(700000 + ids.containers.length).slice(-6)}`,
    customerAppointmentAt: new Date(`${appointment}T02:00:00.000Z`),
  }).returning();
  ids.containers.push(container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
  }).returning();
  ids.fulfillments.push(fulfillment.id);
  return { shipmentId: shipment.id, shipmentVersion: shipment.version, fulfillmentId: fulfillment.id, fulfillmentVersion: 1 };
}

async function currentVersions(fulfillmentId: number, shipmentId: number) {
  const [ful] = await db.select({ version: s.shipmentFulfillments.version }).from(s.shipmentFulfillments)
    .where(eq(s.shipmentFulfillments.id, fulfillmentId));
  const [ship] = await db.select({ version: s.shipments.version }).from(s.shipments)
    .where(eq(s.shipments.id, shipmentId));
  return { fulfillmentVersion: ful.version, shipmentVersion: ship.version };
}

async function patchPlan(fulfillmentId: number, shipmentId: number, plannedEndAt: string) {
  const { fulfillmentVersion, shipmentVersion } = await currentVersions(fulfillmentId, shipmentId);
  return updateDispatchDetailPlan({
    actor: { userId: actorId, role: Role.DISPATCHER } as Parameters<typeof updateDispatchDetailPlan>[0]['actor'],
    idempotencyKey: crypto.randomUUID(),
    fulfillmentId,
    expectedFulfillmentVersion: fulfillmentVersion,
    expectedShipmentVersion: shipmentVersion,
    carrierType: 'OWN',
    truckId,
    plannedRevenue: null,
    plannedCarrierCost: null,
    plannedEndAt,
  });
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `rigconf-${suffix.slice(-10)}`, passwordHash: 'test-only', role: Role.DISPATCHER,
  }).returning();
  ids.users.push(actor.id);
  actorId = actor.id;
  const [type20] = await db.insert(s.containerTypes).values({
    code: `RG${suffix.slice(-6)}`, name: `Rig conflict ${suffix.slice(-4)}`,
  }).returning();
  ids.containerTypes.push(type20.id);
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${suffix.slice(-6)}`.slice(0, 20), type: '20FT',
  }).returning();
  ids.trailers.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: plate, currentTrailerId: trailer.id, trailerType: '20FT',
  }).returning();
  ids.trucks.push(truck.id);
  truckId = truck.id;
  lotA = await seedLot('a', DAY(2));
  lotB = await seedLot('b', DAY(2));
  lotC = await seedLot('c', DAY(9));
});

after(async () => {
  try {
    if (ids.fulfillments.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, ids.fulfillments));
    if (ids.containers.length > 0) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, ids.containers));
    if (ids.shipments.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.containerTypes.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, ids.containerTypes));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.trucks.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, ids.trucks));
    if (ids.trailers.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, ids.trailers));
    if (ids.drivers.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, ids.drivers));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('dispatch plan-row rig conflict (card 20261003_317)', () => {
  test('setup: two lots, one shared tractor, overlapping appointment windows', async () => {
    assert.ok(lotA.fulfillmentId > 0 && lotB.fulfillmentId > 0 && truckId > 0);
  });

  test('A1 the first assignment of the rig succeeds', async () => {
    const r = await patchPlan(lotA.fulfillmentId, lotA.shipmentId, `${DAY(2)}T18:00:00+07:00`);
    assert.equal(r.replayed, false);
  });

  test('B1 the same rig on an overlapping window is refused with 409', async () => {
    await assert.rejects(
      () => patchPlan(lotB.fulfillmentId, lotB.shipmentId, `${DAY(2)}T18:00:00+07:00`),
      (err: unknown) => {
        assert.ok(err instanceof Error && /đầu xe|trùng/i.test(err.message), `unexpected message: ${String(err)}`);
        return true;
      },
      'the duplicate same-window assignment must 409',
    );
  });

  test('C1 a rig assignment in a provably disjoint window is allowed', async () => {
    const r = await patchPlan(lotC.fulfillmentId, lotC.shipmentId, `${DAY(9)}T18:00:00+07:00`);
    assert.equal(r.replayed, false);
  });

  test('A2 re-saving the same row with the same rig is allowed (self excluded)', async () => {
    const r = await patchPlan(lotA.fulfillmentId, lotA.shipmentId, `${DAY(2)}T18:00:00+07:00`);
    assert.equal(r.replayed, false);
  });
});
