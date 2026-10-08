// Card 061026174603 (FB-017) — an LCL lot could not be dispatched AT ALL.
//
// Card 20261003_317 added the duplicate-tractor guard and resolved the saving
// row's window from `shipmentContainerId`, throwing 409 when it was null. But
// an LCL lot decomposes into exactly ONE `LCL_SHIPMENT` fulfillment whose
// `shipmentContainerId` is null BY DESIGN (shipment-fulfillment.service.ts:
// containers are an FCL-only concept), so every vehicle save on an LCL plan row
// was refused with 'Lô hàng không có container để gán xe.' and the whole
// dispatch / Phát lệnh flow for Hàng lẻ was dead end-to-end.
//
// This suite pins both halves:
//   1. the reported defect — an LCL row ACCEPTS a rig assignment;
//   2. the defect CLASS — the guard card 317 exists to provide must keep
//      working for LCL rows: a second LCL row, and an FCL row, on the same rig
//      in an overlapping window are still refused with 409.
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
  fulfillments: [], trucks: [], trailers: [],
};
let actorId = 0;
let truckId = 0;
const plate = `51L-${suffix.slice(-6)}`.slice(0, 20);
let lclA = { shipmentId: 0, fulfillmentId: 0 };
let lclB = { shipmentId: 0, fulfillmentId: 0 };
let fclC = { shipmentId: 0, fulfillmentId: 0 };

const DAY = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

// An LCL lot: cargoMode LCL, ONE LCL_SHIPMENT fulfillment, NO container. The
// lot-level closingAt is its dispatch window — the same fallback the dispatch
// list itself reads (coalesce(appointment, closingAt, plannedReturnAt)).
async function seedLclLot(tag: string, closingAt: string) {
  const [customer] = await db.insert(s.customers).values({ name: `LclRig customer ${suffix} ${tag}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `LclRig route ${suffix} ${tag}` }).returning();
  ids.routes.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `LCL-${suffix.slice(-8)}-${tag}`.slice(0, 50),
    cargoMode: 'LCL',
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    closingAt: new Date(`${closingAt}T02:00:00.000Z`),
  }).returning();
  ids.shipments.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    shipmentContainerId: null,
    sourceShipmentVersion: shipment.version,
    dispatchClassification: 'LCL',
  }).returning();
  ids.fulfillments.push(fulfillment.id);
  return { shipmentId: shipment.id, fulfillmentId: fulfillment.id };
}

async function seedFclLot(tag: string, appointment: string) {
  const [customer] = await db.insert(s.customers).values({ name: `LclRig customer ${suffix} ${tag}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `LclRig route ${suffix} ${tag}` }).returning();
  ids.routes.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `FCX-${suffix.slice(-8)}-${tag}`.slice(0, 50),
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
  }).returning();
  ids.shipments.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: ids.containerTypes[0],
    containerNumber: `LGSU${String(800000 + ids.containers.length).slice(-6)}`,
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
  return { shipmentId: shipment.id, fulfillmentId: fulfillment.id };
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
    username: `lclrig-${suffix.slice(-10)}`, passwordHash: 'test-only', role: Role.DISPATCHER,
  }).returning();
  ids.users.push(actor.id);
  actorId = actor.id;
  const [type20] = await db.insert(s.containerTypes).values({
    code: `LG${suffix.slice(-6)}`, name: `LCL rig ${suffix.slice(-4)}`,
  }).returning();
  ids.containerTypes.push(type20.id);
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51Q-${suffix.slice(-6)}`.slice(0, 20), type: '20FT',
  }).returning();
  ids.trailers.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: plate, currentTrailerId: trailer.id, trailerType: '20FT',
  }).returning();
  ids.trucks.push(truck.id);
  truckId = truck.id;
  lclA = await seedLclLot('a', DAY(3));
  lclB = await seedLclLot('b', DAY(3));
  fclC = await seedFclLot('c', DAY(3));
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
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('dispatch plan-row rig assignment on an LCL lot (card 061026174603)', () => {
  test('setup: two LCL lots and one FCL lot share a tractor on the same day', () => {
    assert.ok(lclA.fulfillmentId > 0 && lclB.fulfillmentId > 0 && fclC.fulfillmentId > 0 && truckId > 0);
  });

  // The reported defect: this is the save the dispatcher could never make.
  test('A1 an LCL row ACCEPTS a rig assignment (was 409 "không có container")', async () => {
    const r = await patchPlan(lclA.fulfillmentId, lclA.shipmentId, `${DAY(3)}T18:00:00+07:00`);
    assert.equal(r.replayed, false);
  });

  // The class sweep: the guard card 317 exists to provide must still bite.
  test('B1 a SECOND LCL row on the same rig in an overlapping window is refused 409', async () => {
    await assert.rejects(
      () => patchPlan(lclB.fulfillmentId, lclB.shipmentId, `${DAY(3)}T18:00:00+07:00`),
      (err: unknown) => {
        assert.ok(err instanceof Error && /đầu xe|trùng/i.test(err.message), `unexpected message: ${String(err)}`);
        return true;
      },
      'a duplicate LCL assignment in an overlapping window must 409',
    );
  });

  test('C1 an FCL row on the same rig in an overlapping window is refused 409 (LCL does not open a hole)', async () => {
    await assert.rejects(
      () => patchPlan(fclC.fulfillmentId, fclC.shipmentId, `${DAY(3)}T18:00:00+07:00`),
      (err: unknown) => {
        assert.ok(err instanceof Error && /đầu xe|trùng/i.test(err.message), `unexpected message: ${String(err)}`);
        return true;
      },
      'the LCL row must not let the same rig ride an FCL row either',
    );
  });

  test('A2 re-saving the same LCL row with the same rig is allowed (self excluded)', async () => {
    const r = await patchPlan(lclA.fulfillmentId, lclA.shipmentId, `${DAY(3)}T18:00:00+07:00`);
    assert.equal(r.replayed, false);
  });
});
