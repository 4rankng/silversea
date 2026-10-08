// Card 363 — rig-conflict false blocks: completed trips and open-ended rows
// must not block a tractor assignment forever. Red-first on
// assertPlanRowRigAvailable (via updateDispatchDetailPlan, the editor save).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { DispatchActor } from '../services/dispatch-planning-utils.service';
import { updateDispatchDetailPlan } from '../services/dispatch-planning-detail-plan.service';

// Typed insert seam: the trips insert overload mis-associates multi-field
// literals (two trip-shaped tables live in schema/trips.ts), so route all trip
// fixtures through the inferred insert type.
async function insertTrip(values: typeof s.trips.$inferInsert) {
  const [row] = await db.insert(s.trips).values(values).returning();
  return row;
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const siteIds: number[] = [];
const containerTypeIds: number[] = [];
const shipmentIds: number[] = [];
const truckIds: number[] = [];
let keySeq = 0;

async function actor(): Promise<DispatchActor> {
  const [row] = await db.insert(s.users).values({
    username: `rig363-${suffix}-${userIds.length}`,
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
  containerId: number;
  truckPlate: string;
  truckId: number;
};

// One lot: 1 container at T with a fulfillment, one truck with `plate`.
async function makeFixture(t0: Date): Promise<Fixture> {
  const a = await actor();
  const [customer] = await db.insert(s.customers).values({ name: `Rig363 KH ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Rig363 Tuyen ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `R363-${suffix}-${siteIds.length}`,
    name: `Rig363 NM ${suffix}`,
    siteType: 'FACTORY',
    address: 'KCN Sóng Thần, Bình Dương',
  }).returning();
  siteIds.push(site.id);
  const [ctype] = await db.insert(s.containerTypes).values({
    code: `20GPR363${containerTypeIds.length}${suffix.slice(-4)}`.slice(0, 20),
    name: `Container 20 feet ${suffix}`,
  }).returning();
  containerTypeIds.push(ctype.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `RIG363-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: t0,
    createdBy: a.userId,
  }).returning();
  shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    routeId: route.id,
    operationalSiteId: site.id,
    containerTypeId: ctype.id,
    containerNumber: `R363${shipmentIds.length}${suffix.slice(-5)}`.toUpperCase(),
    customerAppointmentAt: t0,
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
  const plate = `363-${suffix.slice(-5)}-${truckIds.length}`.toUpperCase();
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plate, status: 'ACTIVE' }).returning();
  truckIds.push(truck.id);
  return {
    actor: a,
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    fulfillmentId: ff.id,
    fulfillmentVersion: ff.version,
    shipmentVersion: shipment.version,
    containerId: container.id,
    truckPlate: plate,
    truckId: truck.id,
  };
}

function saveInput(fx: Fixture, windowEnd: Date) {
  return {
    fulfillmentId: fx.fulfillmentId,
    expectedFulfillmentVersion: fx.fulfillmentVersion,
    expectedShipmentVersion: fx.shipmentVersion,
    carrierType: 'OWN' as const,
    truckId: fx.truckId,
    plannedRevenue: null,
    plannedCarrierCost: null,
    plannedEndAt: windowEnd.toISOString(),
    idempotencyKey: `rig363-${suffix}-${keySeq++}`,
    actor: fx.actor,
  };
}

describe('card 081026091100 — a Kẹp (DOUBLE) row may share the rig with its pair', () => {
  // "Kẹp" is DispatchClassification 'DOUBLE' (shared/src/constants/index.ts:918):
  // two 20' containers ride ONE mooc, so the two planned windows on that tractor
  // overlap BY CONSTRUCTION. assertPlanRowRigAvailable never saw the
  // classification — the caller did not pass it — so it applied the full
  // sequential rule set and refused the dispatcher. trip-pairing.service.ts:104
  // already documents that the sequential rules do not apply to KEP.
  test('a DOUBLE row overlapping its partner row on the same plate saves', async () => {
    const t0 = new Date('2026-10-08T08:00:00.000Z');
    const fx = await makeFixture(t0);
    const partner = await makeFixture(t0);
    // The partner leg already rides the same plate, window overlapping.
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: fx.truckPlate })
      .where(eq(s.shipmentFulfillments.id, partner.fulfillmentId));

    const saved = await updateDispatchDetailPlan({
      ...saveInput(fx, new Date('2026-10-08T10:00:00.000Z')),
      classification: 'DOUBLE',
    });
    assert.ok(saved, 'a Kẹp row must not be blocked by its own partner');
    void partner;
  });

  test('the negative control: a SINGLE row in the same shape is still blocked', async () => {
    // If this goes green the guard was removed rather than narrowed.
    const t0 = new Date('2026-10-08T08:00:00.000Z');
    const fx = await makeFixture(t0);
    const other = await makeFixture(t0);
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: fx.truckPlate })
      .where(eq(s.shipmentFulfillments.id, other.fulfillmentId));

    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-08T10:00:00.000Z'))),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
    );
  });

  test('a DOUBLE row is still blocked by a LIVE trip on the same rig', async () => {
    // The Kẹp carve-out covers the pair's own overlap, not every overlap: an
    // unrelated running trip on that tractor is a genuine conflict.
    const t0 = new Date('2026-10-08T08:00:00.000Z');
    const fx = await makeFixture(t0);
    const live = await makeFixture(t0);
    await insertTrip({
      tripCode: `TRP91100-LIVE-${suffix}`,
      customerId: live.customerId,
      routeId: live.routeId,
      departureDate: '2026-10-08',
      truckId: fx.truckId,
      fulfillmentId: live.fulfillmentId,
      plannedStartAt: new Date('2026-10-08T07:00:00.000Z'),
      plannedEndAt: new Date('2026-10-08T11:00:00.000Z'),
      status: 'IN_TRANSIT',
      createdBy: fx.actor.userId,
    });

    await assert.rejects(
      () => updateDispatchDetailPlan({
        ...saveInput(fx, new Date('2026-10-08T10:00:00.000Z')),
        classification: 'DOUBLE',
      }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
    );
  });
});

describe('card 363 rig-conflict overlap', () => {
  test('061026172804 rework: a completed trip that still rides its fulfillment row warns, not the generic block', async () => {
    // QA FAILED rework spec (staging cut 2087fe5b): the generic plan-row block
    // masked the completed tier whenever the completed trip still carries its
    // plate on its own fulfillment row (the common FCL shape — the reported
    // scenario). The plan-row scan must skip released-rig fulfillments so the
    // completed tier's warning fires.
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    const other = await makeFixture(t0);
    // The completed trip rides `other`'s fulfillment and wears the same plate
    // the dispatcher is assigning — exactly the /trips/135-style FCL shape.
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: fx.truckPlate })
      .where(eq(s.shipmentFulfillments.id, other.fulfillmentId));
    await insertTrip({
      tripCode: `TRP363-DONE-RIDE-${suffix}`,
      customerId: other.customerId,
      routeId: other.routeId,
      departureDate: '2026-10-05',
      truckId: fx.truckId,
      fulfillmentId: other.fulfillmentId,
      plannedStartAt: new Date('2026-10-05T07:00:00.000Z'),
      plannedEndAt: new Date('2026-10-05T11:00:00.000Z'),
      status: 'COMPLETED',
      createdBy: fx.actor.userId,
    });
    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z'))),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', `expected the completed-tier warning, got: ${e.message}`);
        return true;
      },
    );
    // Confirming still lands the assignment.
    const saved = await updateDispatchDetailPlan({
      ...saveInput(fx, new Date('2026-10-05T10:00:00.000Z')),
      rigOverlapCompletedConfirmed: true,
    });
    assert.ok(saved);
  });

  test('061026172804 rework: a soft-deleted COMPLETED trip never releases the rig silently', async () => {
    // Consistency delta: the released-rig exclusion and the warning tier must
    // share ONE definition of "completed trip". A tombstoned trip is no
    // evidence the rig was released — the row must fall back to the generic
    // plan-row block (blocking is safe; a silent save is the bug class here).
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    const other = await makeFixture(t0);
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: fx.truckPlate })
      .where(eq(s.shipmentFulfillments.id, other.fulfillmentId));
    await insertTrip({
      tripCode: `TRP363-DONE-DELETED-${suffix}`,
      customerId: other.customerId,
      routeId: other.routeId,
      departureDate: '2026-10-05',
      truckId: fx.truckId,
      fulfillmentId: other.fulfillmentId,
      plannedStartAt: new Date('2026-10-05T07:00:00.000Z'),
      plannedEndAt: new Date('2026-10-05T11:00:00.000Z'),
      status: 'COMPLETED',
      deletedAt: new Date(),
      createdBy: fx.actor.userId,
    });
    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z'))),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409);
        assert.equal(e.payload?.code, undefined,
          `a tombstoned trip must block with the generic message, not warn: ${e.message}`);
        return true;
      },
    );
  });

  test('363: a COMPLETED trip no longer BLOCKS the rig; the save warns once and the confirmed retry proceeds (card 061026172804)', async () => {
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    await insertTrip({
      tripCode: `TRP363-DONE-${suffix}`,
      customerId: fx.customerId,
      routeId: fx.routeId,
      departureDate: '2026-10-05',
      truckId: fx.truckId,
      plannedStartAt: new Date('2026-10-05T07:00:00.000Z'),
      plannedEndAt: new Date('2026-10-05T11:00:00.000Z'),
      status: 'COMPLETED',
      createdBy: fx.actor.userId,
    });
    // Card 061026172804 (FB-038 / REQ-04): a COMPLETED overlap must not be
    // silent (FB-038's report) nor a hard block (card 363's false-block fix) —
    // it refuses once with the RIG_OVERLAP_COMPLETED warning payload.
    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z'))),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string } };
        assert.equal(e.statusCode, 409);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED');
        return true;
      },
    );
    // The dispatcher confirms in the dialog; the retry rides the flag.
    const saved = await updateDispatchDetailPlan({
      ...saveInput(fx, new Date('2026-10-05T10:00:00.000Z')),
      rigOverlapCompletedConfirmed: true,
    });
    const [row] = await db.select({ plate: s.shipmentFulfillments.plannedVehiclePlateNumber })
      .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fx.fulfillmentId));
    assert.equal(row?.plate, fx.truckPlate);
    assert.ok(saved);
  });

  test('363: an open-ended past trip blocks only within its 8h shift, not forever', async () => {
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    await insertTrip({
      tripCode: `TRP363-OPEN-${suffix}`,
      customerId: fx.customerId,
      routeId: fx.routeId,
      departureDate: '2026-10-04',
      truckId: fx.truckId,
      plannedStartAt: new Date('2026-10-04T06:00:00.000Z'), // 26h before the window
      plannedEndAt: null,
      status: 'IN_TRANSIT',
      createdBy: fx.actor.userId,
    });
    // RED at HEAD: plannedEndAt NULL counts as occupying the rig forever.
    await updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z')));
  });

  test('363: an open-ended plan row blocks only within its 8h shift', async () => {
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    const other = await makeFixture(new Date('2026-10-04T06:00:00.000Z')); // row planned 26h earlier
    await db.update(s.shipmentFulfillments).set({ plannedVehiclePlateNumber: fx.truckPlate, plannedEndAt: null })
      .where(eq(s.shipmentFulfillments.id, other.fulfillmentId));
    // RED at HEAD: the open-ended sibling row blocks every later window.
    await updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z')));
  });

  test('363: a genuine in-progress overlap still blocks with the precise message', async () => {
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    await insertTrip({
      tripCode: `TRP363-LIVE-${suffix}`,
      customerId: fx.customerId,
      routeId: fx.routeId,
      departureDate: '2026-10-05',
      truckId: fx.truckId,
      plannedStartAt: new Date('2026-10-05T07:00:00.000Z'),
      plannedEndAt: new Date('2026-10-05T11:00:00.000Z'),
      status: 'IN_TRANSIT',
      createdBy: fx.actor.userId,
    });
    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z'))),
      /khung giờ trùng lặp/,
    );
  });

  test('363: an open-ended CURRENT trip still blocks within its shift', async () => {
    const t0 = new Date('2026-10-05T08:00:00.000Z');
    const fx = await makeFixture(t0);
    await insertTrip({
      tripCode: `TRP363-CUR-${suffix}`,
      customerId: fx.customerId,
      routeId: fx.routeId,
      departureDate: '2026-10-05',
      truckId: fx.truckId,
      plannedStartAt: new Date('2026-10-05T07:00:00.000Z'), // 1h before the window
      plannedEndAt: null,
      status: 'CREATED',
      createdBy: fx.actor.userId,
    });
    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(fx, new Date('2026-10-05T10:00:00.000Z'))),
      /khung giờ trùng lặp/,
    );
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
      await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
    }
    if (shipmentIds.length) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
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
