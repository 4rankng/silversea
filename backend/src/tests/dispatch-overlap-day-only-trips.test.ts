// Card 171026121100 (FB-038 / FB-072, third verify-fail on staging e5559305):
// assigning a tractor — to a second plan row on the same day, or through
// "Phân xe lại" onto a trip that collides with a COMPLETED trip of the same
// day — saved with no warning, although every guard of the family was already
// deployed.
//
// Root cause (data shape, not deployment): every holder scan of the guard
// family required `trips.planned_start_at IS NOT NULL`. A trip created through
// the trip form / legacy flow carries only `departure_date`; in the mirrored
// data 408 of 435 COMPLETED trips have no staged start, so the tractor's
// same-day COMPLETED trip was invisible to the warning. Law now owned by
// `tripClaimStartSql/tripClaimEndSql` (dispatch-resource-availability.service):
// a trip without a staged start claims its whole departure day. A day claim is
// weak evidence, so it WARNS once (RIG_OVERLAP_COMPLETED) and the confirmed
// retry proceeds — never a new hard block. Timestamp-provable sequential
// same-day windows keep their silence (round-18 law: the window math decides).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { DispatchActor } from '../services/dispatch-planning-utils.service';
import { updateDispatchDetailPlan } from '../services/dispatch-planning-detail-plan.service';
import { assertTripRigAvailable } from '../services/dispatch-plan-conflict-scan.service';
import { assertResourceAvailability } from '../services/dispatch-resource-availability.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const siteIds: number[] = [];
const containerTypeIds: number[] = [];
const shipmentIds: number[] = [];
const truckIds: number[] = [];
let keySeq = 0;
let tripSeq = 0;

// The card's slot: 08:45 on 2026-10-01 Asia/Ho_Chi_Minh.
const SLOT = new Date('2026-10-01T01:45:00.000Z');
const SLOT_DAY = '2026-10-01';

async function actor(): Promise<DispatchActor> {
  const [row] = await db.insert(s.users).values({
    username: `dot-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  userIds.push(row.id);
  return { userId: row.id, username: row.username, email: null, fullName: null, role: Role.ADMIN };
}

type Fixture = {
  actor: DispatchActor;
  customerId: number;
  routeId: number;
  shipmentId: number;
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentVersion: number;
  truckId: number;
  truckPlate: string;
};

async function makeTruck() {
  const plate = `DOT-${suffix.slice(-4)}-${truckIds.length}`.toUpperCase();
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plate, status: 'ACTIVE' }).returning();
  truckIds.push(truck.id);
  return truck;
}

// One lot + FCL fulfillment whose displayed slot is the container appointment,
// plus (optionally) a shared truck so a holder trip can sit on it.
async function makeFixture(a: DispatchActor, opts: { appointment: Date; truck?: { id: number; licensePlate: string } }): Promise<Fixture> {
  const [customer] = await db.insert(s.customers).values({ name: `DOT KH ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `DOT Tuyen ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `DT-${suffix}-${siteIds.length}`,
    name: `DOT NM ${suffix}`,
    siteType: 'FACTORY',
    address: 'KCN Sóng Thần, Bình Dương',
  }).returning();
  siteIds.push(site.id);
  const [ctype] = await db.insert(s.containerTypes).values({
    code: `20GDT${containerTypeIds.length}${suffix.slice(-4)}`.slice(0, 20),
    name: `Container 20 feet ${suffix}`,
  }).returning();
  containerTypeIds.push(ctype.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `DOT-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    createdBy: a.userId,
  }).returning();
  shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    routeId: route.id,
    operationalSiteId: site.id,
    containerTypeId: ctype.id,
    containerNumber: `DT${shipmentIds.length}${suffix.slice(-5)}`.toUpperCase(),
    customerAppointmentAt: opts.appointment,
    createdBy: a.userId,
  }).returning();
  const [ff] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    createdBy: a.userId,
  }).returning();
  const truck = opts.truck ?? await makeTruck();
  return {
    actor: a,
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    fulfillmentId: ff.id,
    fulfillmentVersion: ff.version,
    shipmentVersion: shipment.version,
    truckId: truck.id,
    truckPlate: truck.licensePlate,
  };
}

// A trip that carries ONLY its departure day — the dominant real shape of a
// COMPLETED trip (trip form / legacy flow never stages a start).
async function insertDayOnlyTrip(fx: Fixture, values: { truckId: number; departureDate: string; status: 'COMPLETED' | 'CREATED' | 'IN_TRANSIT' }) {
  const [row] = await db.insert(s.trips).values({
    tripCode: `DOT-TRIP-${suffix}-${tripSeq++}`,
    customerId: fx.customerId,
    routeId: fx.routeId,
    departureDate: values.departureDate,
    truckId: values.truckId,
    plannedStartAt: null,
    plannedEndAt: null,
    status: values.status,
    createdBy: fx.actor.userId,
  }).returning();
  return row;
}

function saveInput(fx: Fixture) {
  return {
    fulfillmentId: fx.fulfillmentId,
    expectedFulfillmentVersion: fx.fulfillmentVersion,
    expectedShipmentVersion: fx.shipmentVersion,
    carrierType: 'OWN' as const,
    truckId: fx.truckId,
    plannedRevenue: null,
    plannedCarrierCost: null,
    idempotencyKey: `dot-${suffix}-${keySeq++}`,
    actor: fx.actor,
  };
}

async function expectWarn(run: () => Promise<unknown>, label: string) {
  await assert.rejects(run, (error: unknown) => {
    const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
    assert.equal(e.statusCode, 409, `${label}: expected the warn refusal, got: ${e.message}`);
    assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', `${label}: expected the family warn payload, got: ${e.message}`);
    assert.match(String(e.message), /Vẫn lưu/, `${label}: the copy must invite the confirm`);
    return true;
  });
}

function resourceArgs(truckId: number, extra: Partial<Parameters<typeof assertResourceAvailability>[1]> = {}) {
  return {
    tripId: null,
    truckId,
    trailerId: null,
    driverId: null,
    plannedStartAt: SLOT,
    plannedEndAt: new Date(SLOT.getTime() + 8 * 3600_000),
    cargoWeightKg: null,
    vehicleCapacityKg: null,
    ...extra,
  };
}

describe('FB038-DAYONLY-PLAN — plan-row save vs a tractor trip that only carries its departure day', () => {
  test('a same-day COMPLETED trip with no staged start warns once; the confirmed retry proceeds', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const target = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(target, { truckId: truck.id, departureDate: SLOT_DAY, status: 'COMPLETED' });

    await expectWarn(() => updateDispatchDetailPlan(saveInput(target) as never), 'plan-row vs completed day-only trip');
    const saved = await updateDispatchDetailPlan({ ...saveInput(target), rigOverlapCompletedConfirmed: true } as never);
    assert.ok(saved, 'the confirmed retry must proceed (FB-038: warning only)');
  });

  test('control: a live day-only trip is not swept in here (its plan row is the holder; T9 pins live = cannot prove)', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const target = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(target, { truckId: truck.id, departureDate: SLOT_DAY, status: 'CREATED' });
    assert.ok(await updateDispatchDetailPlan(saveInput(target) as never));
  });

  test('control: the completed day-only trip is on ANOTHER day — silent', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const target = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(target, { truckId: truck.id, departureDate: '2026-10-03', status: 'COMPLETED' });
    assert.ok(await updateDispatchDetailPlan(saveInput(target) as never));
  });

  test('control: the same-day day-only trip rides ANOTHER tractor — silent', async () => {
    const a = await actor();
    const target = await makeFixture(a, { appointment: SLOT });
    const elsewhere = await makeTruck();
    await insertDayOnlyTrip(target, { truckId: elsewhere.id, departureDate: SLOT_DAY, status: 'COMPLETED' });
    assert.ok(await updateDispatchDetailPlan(saveInput(target) as never));
  });
});

describe('FB038-DAYONLY-REASSIGN — Phân xe lại gate vs a tractor trip that only carries its departure day', () => {
  test('a same-day COMPLETED day-only trip warns once; confirmed proceeds', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(fx, { truckId: truck.id, departureDate: SLOT_DAY, status: 'COMPLETED' });

    await expectWarn(() => db.transaction((tx) => assertResourceAvailability(tx, resourceArgs(truck.id))), 'reassign vs completed day-only trip');
    await db.transaction((tx) => assertResourceAvailability(tx, resourceArgs(truck.id, { rigOverlapCompletedConfirmed: true })));
  });

  test('control: a live day-only trip stays skipped at the reassign gate (T9 — cannot prove overlap)', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(fx, { truckId: truck.id, departureDate: SLOT_DAY, status: 'IN_TRANSIT' });
    await db.transaction((tx) => assertResourceAvailability(tx, resourceArgs(truck.id)));
  });

  test('the saving trip is not its own holder', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    const own = await insertDayOnlyTrip(fx, { truckId: truck.id, departureDate: SLOT_DAY, status: 'COMPLETED' });
    await db.transaction((tx) => assertResourceAvailability(tx, resourceArgs(truck.id, { tripId: own.id })));
  });

  test('control: a day-only trip on another day is silent', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(fx, { truckId: truck.id, departureDate: '2026-10-02', status: 'COMPLETED' });
    await db.transaction((tx) => assertResourceAvailability(tx, resourceArgs(truck.id)));
  });

  test('control: a COMPLETED trip with PROVABLE sequential same-day times stays silent (the window math decides)', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    const [row] = await db.insert(s.trips).values({
      tripCode: `DOT-TRIP-${suffix}-${tripSeq++}`,
      customerId: fx.customerId,
      routeId: fx.routeId,
      departureDate: SLOT_DAY,
      truckId: truck.id,
      // 20:00–22:00 VN the same evening — after the 08:45–16:45 saving window.
      plannedStartAt: new Date('2026-10-01T13:00:00.000Z'),
      plannedEndAt: new Date('2026-10-01T15:00:00.000Z'),
      status: 'COMPLETED',
      createdBy: a.userId,
    }).returning();
    assert.ok(row);
    await db.transaction((tx) => assertResourceAvailability(tx, resourceArgs(truck.id)));
  });
});

describe('FB038-DAYONLY-TRIPFORM — the trip form guard vs a COMPLETED trip that only carries its departure day', () => {
  test('a date-only departure on a tractor with a same-day COMPLETED day-only trip warns once', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(fx, { truckId: truck.id, departureDate: SLOT_DAY, status: 'COMPLETED' });

    const args = { truckId: truck.id, departureDate: SLOT_DAY };
    await expectWarn(() => db.transaction((tx) => assertTripRigAvailable(tx, args)), 'trip form vs completed day-only trip');
    await db.transaction((tx) => assertTripRigAvailable(tx, { ...args, confirmOverlap: true }));
  });

  test('control: a different departure day is silent', async () => {
    const a = await actor();
    const truck = await makeTruck();
    const fx = await makeFixture(a, { appointment: SLOT, truck });
    await insertDayOnlyTrip(fx, { truckId: truck.id, departureDate: SLOT_DAY, status: 'COMPLETED' });
    await db.transaction((tx) => assertTripRigAvailable(tx, { truckId: truck.id, departureDate: '2026-10-05' }));
  });
});

after(async () => {
  try {
    if (shipmentIds.length) {
      await db.delete(s.trips).where(inArray(s.trips.shipmentId, shipmentIds));
    }
    if (truckIds.length) {
      await db.delete(s.trips).where(inArray(s.trips.truckId, truckIds));
      await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.truckId, truckIds));
    }
    if (shipmentIds.length) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
    if (truckIds.length) await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
    if (siteIds.length) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, siteIds));
    if (containerTypeIds.length) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } finally {
    await client.end({ timeout: 5 });
    await disconnectRedis();
  }
});
