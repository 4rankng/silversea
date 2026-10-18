// FB-081 v2 (card 181026003045) — "Phân xe lại — kẹp bị chặn" reopen.
// Regression R1–R5 per testplan/2026-10-18-card-181026003045-fb081-pair-aware-reassign.md:
//   R1  driver change on one KEP leg → PASS, both legs move together
//   R2  rig change on one KEP leg → PASS, partner follows the new rig
//   R3  governed gate: ACTIVE-KEP-pair partner no longer 409s on a 3-way
//       mismatch; a third load still blocks; KET_HOP gets no carve-out (Q4)
//   R4  plan-save: a dispatched KEP row is not blocked by its dispatched
//       partner leg (unpaired LIVE trip still blocks)
//   R5  truck-only move no longer splits the pair silently — partner follows
// Plus the pair-consistency guards the propagate adds:
//   - a driver change onto an acknowledged partner leg stays 409 (FB-081 v1
//     law, both legs)
//   - switching one KEP leg to an external carrier stays 409 (pair split
//     must be an explicit break)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { DriverProgressEventType, Role, TripStatus } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';
import { reassignTrip } from '../services/trip-mutations.service';
import { insertTripComposite } from '../services/trip-composite.service';
import { assertResourceAvailability } from '../services/dispatch-resource-availability.service';
import {
  issueOrderCreateOrUpdate,
  reassignIssuedDispatchWriteCommand,
} from '../services/dispatch-planning-commands.service';
import { assignFulfillmentPlate } from '../services/dispatch-planning-detail-plan.service';
import type { DispatchActor } from '../services/dispatch-planning-utils.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const ids: Record<'users' | 'drivers' | 'trucks' | 'trailers' | 'assignments' | 'customers'
  | 'routes' | 'cargoTypes' | 'containerTypes' | 'shipments' | 'containers' | 'fulfillments'
  | 'trips' | 'tripContainers' | 'tripPairs' | 'events' | 'sites', number[]> = {
  users: [], drivers: [], trucks: [], trailers: [], assignments: [], customers: [],
  routes: [], cargoTypes: [], containerTypes: [], shipments: [], containers: [], fulfillments: [],
  trips: [], tripContainers: [], tripPairs: [], events: [], sites: [],
};

let type20Id = 0;
let seq = 0;

/** Each test owns a business day (VN +07) so shared-rig scans never bleed
 *  between cases; base is past the October windows the older suites use. */
function windows(dayIndex: number) {
  const day = new Date(Date.UTC(2026, 11, 2) + dayIndex * 86400000).toISOString().slice(0, 10);
  return {
    day,
    legStart: new Date(`${day}T01:00:00.000Z`),
    legEnd: new Date(`${day}T09:00:00.000Z`),
    incomingStart: new Date(`${day}T03:00:00.000Z`),
    incomingEnd: new Date(`${day}T11:00:00.000Z`),
  };
}

async function ensureContainerType20(): Promise<number> {
  const [existing] = await db.select({ id: s.containerTypes.id })
    .from(s.containerTypes).where(eq(s.containerTypes.code, '20DC'));
  if (existing != null) return existing.id;
  const [row] = await db.insert(s.containerTypes).values({
    code: '20DC', name: `KP81 20 ${suffix.slice(-4)}`,
  }).returning();
  ids.containerTypes.push(row.id);
  return row.id;
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `kp81-${role}-${suffix}-${ids.users.length}`.slice(0, 40),
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id, username: s.users.username, role: s.users.role });
  ids.users.push(user.id);
  return { id: user.id, userId: user.id, username: user.username, email: null, fullName: `KP81 ${role}`, role };
}

async function mkDriver(label: string) {
  const user = await mkUser(Role.DRIVER);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id, name: `${label} ${suffix.slice(-4)}`, status: 'ACTIVE',
  }).returning({ id: s.drivers.id });
  ids.drivers.push(driver.id);
  return driver;
}

async function mkRig(label: string) {
  const tail = `${label}${seq++}${suffix.slice(-4)}`;
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${tail}`.slice(0, 20), type: '40FT', status: 'ACTIVE',
  }).returning({ id: s.trailers.id });
  ids.trailers.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${tail}`.slice(0, 20),
    currentTrailerId: trailer.id, trailerType: '40FT', status: 'ACTIVE',
  }).returning({ id: s.trucks.id });
  ids.trucks.push(truck.id);
  return { truck, trailer };
}

async function pairTrips(
  firstTripId: number,
  secondTripId: number,
  kind: 'KEP' | 'KET_HOP' = 'KEP',
) {
  const [pair] = await db.insert(s.tripPairs).values({
    status: 'ACTIVE', pairKind: kind, firstTripId, secondTripId,
  }).returning({ id: s.tripPairs.id });
  ids.tripPairs.push(pair.id);
  await db.update(s.trips).set({ activeTripPairId: pair.id })
    .where(inArray(s.trips.id, [firstTripId, secondTripId]));
  return pair;
}

async function acknowledge(tripId: number, driverId: number, userId: number) {
  const [ev] = await db.insert(s.driverProgressEvents).values({
    tripId, driverId,
    eventType: DriverProgressEventType.ORDER_RECEIVED,
    occurredAt: new Date(), recordedBy: userId,
  }).returning({ id: s.driverProgressEvents.id });
  ids.events.push(ev.id);
}

async function tripRow(tripId: number) {
  const [row] = await db.select({
    truckId: s.trips.truckId,
    trailerId: s.trips.trailerId,
    driverId: s.trips.driverId,
    version: s.trips.version,
    activeTripPairId: s.trips.activeTripPairId,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  return row;
}

/** Two KEP-shaped legs (20' container each) on one shared rig + one driver. */
async function mkKepPairFixture(dayIndex: number) {
  const w = windows(dayIndex);
  const d1 = await mkDriver('Kep lái 1');
  const d2 = await mkDriver('Kep lái 2');
  const rigX = await mkRig('X');
  const rigY = await mkRig('Y');
  const manager = await mkUser(Role.MANAGER);
  const [customer] = await db.insert(s.customers).values({ name: `KP81 KH ${suffix}-${ids.customers.length}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `KP81 tuyen ${suffix}-${ids.routes.length}` }).returning();
  ids.routes.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `KP81 cargo ${suffix}-${ids.cargoTypes.length}` }).returning();
  ids.cargoTypes.push(cargoType.id);

  const mkLeg = async (tag: string) => {
    const composed = await insertTripComposite(db, {
      tripCode: `KP81-${tag}-${suffix}-${seq++}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: TripStatus.CREATED,
      version: 1,
      departureDate: w.day,
      revenue: '1000000',
      carrierType: 'OWN',
      truckId: rigX.truck.id,
      trailerId: rigX.trailer.id,
      driverId: d1.id,
      plannedStartAt: w.legStart,
      plannedEndAt: w.legEnd,
      createdBy: manager.userId,
    });
    ids.trips.push(composed.id);
    const [tc] = await db.insert(s.tripContainers).values({
      tripId: composed.id,
      containerTypeId: type20Id,
      containerNumber: `KMU${String(810000 + ids.tripContainers.length).slice(-6)}`,
      cargoWeightKg: '10000',
    }).returning();
    ids.tripContainers.push(tc.id);
    return composed;
  };
  const t1 = await mkLeg('T1');
  const t2 = await mkLeg('T2');
  const pair = await pairTrips(t1.id, t2.id);
  return { w, d1, d2, rigX, rigY, manager, t1, t2, pair, customerId: customer.id, routeId: route.id };
}

// ─── R1 / R2 / R5 + pair-consistency guards — fallback path (reassignTrip) ──

describe('FB-081 R1/R2/R5 — fallback reassign moves the KEP pair as one rig', () => {
  test('R1 driver change on one leg: both legs move to the new driver, one transaction', async () => {
    const fx = await mkKepPairFixture(0);
    const result = await reassignTrip(fx.t1.id, {
      carrierType: 'OWN',
      truckId: fx.rigX.truck.id,
      driverId: fx.d2.id,
      expectedVersion: 1,
    });
    assert.equal(result.driverId, fx.d2.id, 'issuing leg takes the new driver');
    const leg1 = await tripRow(fx.t1.id);
    const leg2 = await tripRow(fx.t2.id);
    assert.equal(leg1.driverId, fx.d2.id);
    assert.equal(leg2.driverId, fx.d2.id, 'R1: partner leg must take the new driver too');
    assert.equal(leg2.truckId, fx.rigX.truck.id);
    assert.equal(leg2.version, 2, 'partner optimistic version must bump with the sync');
    // Audit covers BOTH legs (reason KEP_PAIR_RIG_SYNC on the partner,
    // KEP_PAIR_RIG_SYNC_SOURCE on the issuing leg).
    const audits = await db.select({ entityId: s.auditLogs.entityId })
      .from(s.auditLogs)
      .where(and(
        eq(s.auditLogs.entityType, 'trips'),
        inArray(s.auditLogs.entityId, [fx.t1.id, fx.t2.id]),
      ));
    assert.equal(audits.length, 2, `expected one audit row per leg, got ${audits.length}`);
  });

  test('R2 rig change on one leg: partner follows truck + trailer + driver', async () => {
    const fx = await mkKepPairFixture(1);
    await reassignTrip(fx.t1.id, {
      carrierType: 'OWN',
      truckId: fx.rigY.truck.id,
      driverId: fx.d2.id,
      expectedVersion: 1,
    });
    const leg2 = await tripRow(fx.t2.id);
    assert.equal(leg2.truckId, fx.rigY.truck.id, 'R2: partner must follow the new truck');
    assert.equal(leg2.trailerId, fx.rigY.trailer.id, 'R2: partner must follow the resolved trailer');
    assert.equal(leg2.driverId, fx.d2.id);
  });

  test('R5 truck-only move: partner follows — no silent pair split', async () => {
    const fx = await mkKepPairFixture(2);
    await reassignTrip(fx.t1.id, {
      carrierType: 'OWN',
      truckId: fx.rigY.truck.id,
      driverId: fx.d1.id,
      expectedVersion: 1,
    });
    const leg1 = await tripRow(fx.t1.id);
    const leg2 = await tripRow(fx.t2.id);
    assert.equal(leg1.truckId, fx.rigY.truck.id);
    assert.equal(leg2.truckId, fx.rigY.truck.id, 'R5: the pair must not split across two rigs');
    assert.equal(leg2.driverId, fx.d1.id, 'R5: shared driver is kept on both legs');
    assert.equal(leg2.activeTripPairId, fx.pair.id, 'R5: pair linkage stays intact');
  });

  test('driver change onto an acknowledged partner leg stays blocked (FB-081 v1 law, both legs)', async () => {
    const fx = await mkKepPairFixture(3);
    await acknowledge(fx.t2.id, fx.d1.id, fx.manager.userId);
    await assert.rejects(
      () => reassignTrip(fx.t1.id, {
        carrierType: 'OWN',
        truckId: fx.rigX.truck.id,
        driverId: fx.d2.id,
        expectedVersion: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /chân còn lại của cặp kẹp/);
        return true;
      },
    );
    const leg1 = await tripRow(fx.t1.id);
    const leg2 = await tripRow(fx.t2.id);
    assert.equal(leg1.driverId, fx.d1.id, 'the whole reassign must roll back');
    assert.equal(leg2.driverId, fx.d1.id);
  });

  test('switching one KEP leg to an external carrier stays blocked (explicit pair break required)', async () => {
    const fx = await mkKepPairFixture(4);
    await assert.rejects(
      () => reassignTrip(fx.t1.id, {
        carrierType: 'EXTERNAL',
        externalPlateNumber: '51C-999.99',
        expectedVersion: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Cặp kẹp phải chạy bằng xe nội bộ/);
        return true;
      },
    );
    const leg1 = await tripRow(fx.t1.id);
    assert.equal(leg1.truckId, fx.rigX.truck.id, 'the pair must not be split silently');
  });
});

// ─── R3 — governed gate (assertResourceAvailability) pair-aware carve-out ───

describe('FB-081 R3 — governed gate carves the ACTIVE KEP pair partner', () => {
  test('R3a partner with a 3-way mismatch (transition state) no longer 409s', async () => {
    const fx = await mkKepPairFixture(5);
    // The exact deadlock repro: keep the truck, change the driver. The
    // partner still carries d1 — before the fix this fell out of the
    // declared 3-way-match carve-out and 409'd hard with no confirm code.
    await db.transaction(async (tx) => {
      await assert.doesNotReject(
        () => assertResourceAvailability(tx, {
          tripId: fx.t1.id,
          truckId: fx.rigX.truck.id,
          trailerId: fx.rigX.trailer.id,
          driverId: fx.d2.id,
          plannedStartAt: fx.w.incomingStart,
          plannedEndAt: fx.w.incomingEnd,
          cargoWeightKg: '10000',
          vehicleCapacityKg: '36000',
        }),
        'R3a: the partner of the ACTIVE KEP pair must not block the reassign',
      );
    });
  });

  test('R3b a third overlapping load on the same rig still 409s (never a third load)', async () => {
    const fx = await mkKepPairFixture(6);
    const third = await insertTripComposite(db, {
      tripCode: `KP81-3RD-${suffix}-${seq++}`.slice(0, 50),
      customerId: fx.customerId,
      routeId: fx.routeId,
      status: TripStatus.CREATED,
      version: 1,
      departureDate: fx.w.day,
      carrierType: 'OWN',
      truckId: fx.rigX.truck.id,
      trailerId: fx.rigX.trailer.id,
      driverId: fx.d2.id,
      plannedStartAt: fx.w.legStart,
      plannedEndAt: fx.w.legEnd,
    });
    ids.trips.push(third.id);
    await db.transaction(async (tx) => {
      await assert.rejects(
        () => assertResourceAvailability(tx, {
          tripId: fx.t1.id,
          truckId: fx.rigX.truck.id,
          trailerId: fx.rigX.trailer.id,
          driverId: fx.d2.id,
          plannedStartAt: fx.w.incomingStart,
          plannedEndAt: fx.w.incomingEnd,
          cargoWeightKg: '10000',
          vehicleCapacityKg: '36000',
        }),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 409);
          return true;
        },
        'R3b: carving the partner must not admit a third load',
      );
    });
  });

  test('R3c a KET_HOP pair partner still 409s (owner ruling Q4 — no carve-out)', async () => {
    const fx = await mkKepPairFixture(7);
    // Rebuild the same physical shape but declared sequential.
    await db.update(s.tripPairs).set({ pairKind: 'KET_HOP' }).where(eq(s.tripPairs.id, fx.pair.id));
    await db.transaction(async (tx) => {
      await assert.rejects(
        () => assertResourceAvailability(tx, {
          tripId: fx.t1.id,
          truckId: fx.rigX.truck.id,
          trailerId: fx.rigX.trailer.id,
          driverId: fx.d2.id,
          plannedStartAt: fx.w.incomingStart,
          plannedEndAt: fx.w.incomingEnd,
          cargoWeightKg: '10000',
          vehicleCapacityKg: '36000',
        }),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 409);
          return true;
        },
        'R3c: KET_HOP pairs keep the sequential rule set',
      );
    });
  });
});

// ─── R1/R2 through the governed write command (the QA "Phân xe lại" path) ───

async function mkGovernedPairFixture(dayIndex: number) {
  const w = windows(dayIndex);
  const d1 = await mkDriver('Gov lái 1');
  const d2 = await mkDriver('Gov lái 2');
  const rigA = await mkRig('GA');
  const rigB = await mkRig('GB');
  const actorRow = await mkUser(Role.MANAGER);
  const actor: DispatchActor = { ...actorRow, role: Role.MANAGER };
  const [customer] = await db.insert(s.customers).values({ name: `KP81G KH ${suffix}-${ids.customers.length}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `KP81G tuyen ${suffix}-${ids.routes.length}`, distanceKm: 120 }).returning();
  ids.routes.push(route.id);

  const mkLeg = async (i: number, startIso: string, endIso: string) => {
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      shipmentCode: `KP81G-${suffix}-${seq++}`.slice(0, 50),
      bookingRef: `KP81GBK-${suffix}-${seq++}`.slice(0, 50),
      status: 'DISPATCHED',
      createdBy: actor.userId,
    }).returning();
    ids.shipments.push(shipment.id);
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: type20Id,
      containerNumber: `KPGU${String(820000 + ids.containers.length).slice(-6)}`,
      routeId: route.id,
      cargoWeightKg: '12000',
      createdBy: actor.userId,
    }).returning();
    ids.containers.push(container.id);
    const [ff] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      dispatchClassification: 'DOUBLE',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
      createdBy: actor.userId,
    }).returning();
    ids.fulfillments.push(ff.id);
    const outcome = await db.transaction((tx) => issueOrderCreateOrUpdate(tx, {
      shipmentId: shipment.id,
      fulfillmentId: ff.id,
      expectedVersion: ff.version,
      plannedStartAt: startIso,
      plannedEndAt: endIso,
      endTimeConfirmed: true,
      carrierType: 'OWN',
      truckId: rigA.truck.id,
      driverId: d1.id,
      idempotencyKey: `kp81g-issue-${suffix}-${seq++}`,
      actor,
    }));
    ids.trips.push(outcome.trip.id);
    return { shipment, fulfillment: ff, outcome };
  };

  const leg1 = await mkLeg(1, `${w.day}T08:00:00+07:00`, `${w.day}T18:00:00+07:00`);
  const leg2 = await mkLeg(2, `${w.day}T09:00:00+07:00`, `${w.day}T17:00:00+07:00`);
  const pair = await pairTrips(leg1.outcome.trip.id, leg2.outcome.trip.id);
  return { w, d1, d2, rigA, rigB, actor, leg1, leg2, pair };
}

describe('FB-081 — governed write (reassignIssuedDispatchWriteCommand) moves the pair', () => {
  test('R1g driver change on one issued KEP leg: both legs move together', async () => {
    const fx = await mkGovernedPairFixture(10);
    const [freshFf] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fx.leg1.fulfillment.id)).limit(1);
    const [freshTrip] = await db.select({ version: s.trips.version }).from(s.trips)
      .where(eq(s.trips.id, fx.leg1.outcome.trip.id)).limit(1);
    await db.transaction((_tx) => reassignIssuedDispatchWriteCommand({
      shipmentId: fx.leg1.shipment.id,
      fulfillmentId: fx.leg1.fulfillment.id,
      expectedVersion: freshFf.version,
      expectedTripVersion: freshTrip.version,
      plannedStartAt: `${fx.w.day}T08:00:00+07:00`,
      plannedEndAt: `${fx.w.day}T18:00:00+07:00`,
      endTimeConfirmed: true,
      carrierType: 'OWN',
      truckId: fx.rigA.truck.id,
      driverId: fx.d2.id,
      idempotencyKey: `kp81g-r1-${suffix}`,
      actor: fx.actor,
    }));
    const leg1 = await tripRow(fx.leg1.outcome.trip.id);
    const leg2 = await tripRow(fx.leg2.outcome.trip.id);
    assert.equal(leg1.driverId, fx.d2.id);
    assert.equal(leg2.driverId, fx.d2.id, 'R1g: the issued partner leg must take the new driver in the same tx');
  });

  test('R2g truck change on one issued KEP leg: partner follows the new rig', async () => {
    const fx = await mkGovernedPairFixture(11);
    const [freshFf] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fx.leg1.fulfillment.id)).limit(1);
    const [freshTrip] = await db.select({ version: s.trips.version }).from(s.trips)
      .where(eq(s.trips.id, fx.leg1.outcome.trip.id)).limit(1);
    await db.transaction((_tx) => reassignIssuedDispatchWriteCommand({
      shipmentId: fx.leg1.shipment.id,
      fulfillmentId: fx.leg1.fulfillment.id,
      expectedVersion: freshFf.version,
      expectedTripVersion: freshTrip.version,
      plannedStartAt: `${fx.w.day}T08:00:00+07:00`,
      plannedEndAt: `${fx.w.day}T18:00:00+07:00`,
      endTimeConfirmed: true,
      carrierType: 'OWN',
      truckId: fx.rigB.truck.id,
      driverId: fx.d1.id,
      idempotencyKey: `kp81g-r2-${suffix}`,
      actor: fx.actor,
    }));
    const leg2 = await tripRow(fx.leg2.outcome.trip.id);
    assert.equal(leg2.truckId, fx.rigB.truck.id, 'R2g: partner must follow the new truck');
    assert.equal(leg2.trailerId, fx.rigB.trailer.id);
    assert.equal(leg2.driverId, fx.d1.id);
    // The partner's plan row mirrors the new plate (one physical tractor).
    const [partnerFf] = await db.select({ plate: s.shipmentFulfillments.plannedVehiclePlateNumber })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fx.leg2.fulfillment.id)).limit(1);
    const [rigBPlate] = await db.select({ plate: s.trucks.licensePlate })
      .from(s.trucks).where(eq(s.trucks.id, fx.rigB.truck.id)).limit(1);
    assert.equal(partnerFf?.plate, rigBPlate?.plate, 'partner plan row must carry the new plate');
  });
});

// ─── Route fallback — the QA shape: Kẹp lot whose route lives ONLY on the trip ──
// Staging B2QA-KEP-01/02 (FB-081 reopen): the pair's tuyến lives on
// trips.route_id (stamped at issue) while the lot's mutable
// shipment.route_id / container route_id stay NULL — the governed reassign
// must fall back to the trip's frozen snapshot instead of false-409ing
// "Container chưa có tuyến đường hợp lệ." (179bb9ab landed the payload half
// only and was reverted; this re-lands it completely inside the command).

describe('FB-081 route fallback — governed reassign when the lot-level route is NULL', () => {
  test('R6 driver change succeeds when lot-level route is NULL but the trip carries one', async () => {
    const fx = await mkGovernedPairFixture(12);
    // Strip the mutable lot-level route state to the exact staging shape.
    await db.update(s.shipments).set({ routeId: null }).where(eq(s.shipments.id, fx.leg1.shipment.id));
    await db.update(s.shipmentContainers).set({ routeId: null })
      .where(eq(s.shipmentContainers.shipmentId, fx.leg1.shipment.id));
    const [freshFf] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fx.leg1.fulfillment.id)).limit(1);
    const [freshTrip] = await db.select({ version: s.trips.version, routeId: s.trips.routeId })
      .from(s.trips).where(eq(s.trips.id, fx.leg1.outcome.trip.id)).limit(1);
    assert.ok(freshTrip.routeId != null, 'precondition: the trip itself carries the tuyến');
    await db.transaction((_tx) => reassignIssuedDispatchWriteCommand({
      shipmentId: fx.leg1.shipment.id,
      fulfillmentId: fx.leg1.fulfillment.id,
      expectedVersion: freshFf.version,
      expectedTripVersion: freshTrip.version,
      plannedStartAt: `${fx.w.day}T08:00:00+07:00`,
      plannedEndAt: `${fx.w.day}T18:00:00+07:00`,
      endTimeConfirmed: true,
      carrierType: 'OWN',
      truckId: fx.rigA.truck.id,
      driverId: fx.d2.id,
      idempotencyKey: `kp81g-r6-${suffix}`,
      actor: fx.actor,
    }));
    const leg1 = await tripRow(fx.leg1.outcome.trip.id);
    assert.equal(leg1.driverId, fx.d2.id, 'R6: the reassign must save, not false-409');
  });

  test('R7 a trip route that no longer resolves still 409s (fallback must re-validate)', async () => {
    const fx = await mkGovernedPairFixture(13);
    const [deadRoute] = await db.insert(s.routes).values({
      name: `KP81G dead ${suffix}-${ids.routes.length}`, deletedAt: new Date(),
    }).returning();
    ids.routes.push(deadRoute.id);
    await db.update(s.shipments).set({ routeId: null }).where(eq(s.shipments.id, fx.leg1.shipment.id));
    await db.update(s.shipmentContainers).set({ routeId: null })
      .where(eq(s.shipmentContainers.shipmentId, fx.leg1.shipment.id));
    await db.update(s.trips).set({ routeId: deadRoute.id }).where(eq(s.trips.id, fx.leg1.outcome.trip.id));
    const [freshFf] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fx.leg1.fulfillment.id)).limit(1);
    const [freshTrip] = await db.select({ version: s.trips.version }).from(s.trips)
      .where(eq(s.trips.id, fx.leg1.outcome.trip.id)).limit(1);
    await assert.rejects(
      () => db.transaction((_tx) => reassignIssuedDispatchWriteCommand({
        shipmentId: fx.leg1.shipment.id,
        fulfillmentId: fx.leg1.fulfillment.id,
        expectedVersion: freshFf.version,
        expectedTripVersion: freshTrip.version,
        plannedStartAt: `${fx.w.day}T08:00:00+07:00`,
        plannedEndAt: `${fx.w.day}T18:00:00+07:00`,
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: fx.rigA.truck.id,
        driverId: fx.d2.id,
        idempotencyKey: `kp81g-r7-${suffix}`,
        actor: fx.actor,
      })),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /tuyến đường/);
        return true;
      },
      'R7: a deleted trip route must keep blocking',
    );
  });
});

// ─── R4 — plan-save path: dispatched KEP row vs its dispatched partner ───────

type PlanFixture = {
  actor: { id: number; userId: number; username: string | null; email: null; fullName: string; role: Role.ADMIN };
  customerId: number;
  routeId: number;
  shipmentId: number;
  fulfillmentId: number;
  fulfillmentVersion: number;
  containerId: number;
  truckPlate: string;
  truckId: number;
};

async function mkPlanFixture(t0: Date): Promise<PlanFixture> {
  const actorRow = await mkUser(Role.ADMIN);
  const actor = { ...actorRow, role: Role.ADMIN as const };
  const [customer] = await db.insert(s.customers).values({ name: `KP81P KH ${suffix}-${ids.customers.length}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `KP81P tuyen ${suffix}-${ids.routes.length}` }).returning();
  ids.routes.push(route.id);
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `KP81P-${suffix}-${ids.sites.length}`.slice(0, 20),
    name: `KP81P NM ${suffix}`,
    siteType: 'FACTORY',
    address: 'KCN Sóng Thần, Bình Dương',
  }).returning();
  ids.sites.push(site.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `KP81P-${suffix}-${ids.shipments.length}`.slice(0, 50),
    status: 'READY_FOR_DISPATCH',
    closingAt: t0,
    createdBy: actor.userId,
  }).returning();
  ids.shipments.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    routeId: route.id,
    operationalSiteId: site.id,
    containerTypeId: type20Id,
    containerNumber: `KP81P${ids.containers.length}${suffix.slice(-5)}`.toUpperCase().slice(0, 50),
    customerAppointmentAt: t0,
    createdBy: actor.userId,
  }).returning();
  ids.containers.push(container.id);
  const [ff] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    dispatchClassification: 'DOUBLE',
    plannedCarrierType: 'OWN',
    createdBy: actor.userId,
  }).returning();
  ids.fulfillments.push(ff.id);
  const plate = `81P-${suffix.slice(-5)}-${ids.trucks.length}`.toUpperCase();
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plate, status: 'ACTIVE' }).returning();
  ids.trucks.push(truck.id);
  return {
    actor, customerId: customer.id, routeId: route.id,
    shipmentId: shipment.id, fulfillmentId: ff.id, containerId: container.id,
    truckPlate: plate, truckId: truck.id,
    fulfillmentVersion: ff.version,
  };
}

function plateSaveInput(fx: PlanFixture) {
  return {
    fulfillmentId: fx.fulfillmentId,
    expectedVersion: fx.fulfillmentVersion,
    truckId: fx.truckId,
    idempotencyKey: `kp81p-${suffix}-${seq++}`,
    actor: fx.actor,
  };
}

describe('FB-081 R4 — plan-save: a dispatched KEP row is not blocked by its dispatched partner', () => {
  // The issued row's plate correction rides the single-field plate endpoint
  // (assignFulfillmentPlate) — the atomic editor save refuses issued rows
  // outright with "Không thể sửa kế hoạch sau khi đã phát hành lệnh điều
  // xe.", so the rig guard on that path is what §3d actually hits.
  test('R4 both legs dispatched + paired: the partner trip is carved out and the plate saves', async () => {
    const w = windows(14);
    const t0 = w.incomingStart; // container appointment = row window start
    const fx = await mkPlanFixture(t0);
    const partnerFx = await mkPlanFixture(t0);
    // The partner leg is dispatched on the same plate and overlaps the row
    // window (appointment 03:00Z → row window 03:00–11:00Z default, partner
    // trip 03:00–09:00Z overlaps).
    const [partnerTrip] = await db.insert(s.trips).values({
      tripCode: `KP81P-PT-${suffix}`.slice(0, 50),
      customerId: partnerFx.customerId,
      routeId: partnerFx.routeId,
      departureDate: w.day,
      truckId: fx.truckId,
      fulfillmentId: partnerFx.fulfillmentId,
      plannedStartAt: w.incomingStart,
      plannedEndAt: w.legEnd,
      status: TripStatus.IN_TRANSIT,
      createdBy: fx.actor.userId,
    }).returning({ id: s.trips.id });
    ids.trips.push(partnerTrip.id);
    // The saving row's OWN dispatched leg rides later in the day, outside the
    // row window, so the partner is the only dispatched conflict.
    const [ownTrip] = await db.insert(s.trips).values({
      tripCode: `KP81P-OT-${suffix}`.slice(0, 50),
      customerId: fx.customerId,
      routeId: fx.routeId,
      departureDate: w.day,
      truckId: fx.truckId,
      fulfillmentId: fx.fulfillmentId,
      plannedStartAt: new Date(`${w.day}T12:00:00.000Z`),
      plannedEndAt: new Date(`${w.day}T20:00:00.000Z`),
      status: TripStatus.CREATED,
      createdBy: fx.actor.userId,
    }).returning({ id: s.trips.id });
    ids.trips.push(ownTrip.id);
    await pairTrips(ownTrip.id, partnerTrip.id);

    const saved = await assignFulfillmentPlate(plateSaveInput(fx));
    assert.ok(saved, 'R4: the partner leg must not block its own pair\'s plate correction');
  });

  test('R4 negative: the same dispatched overlap WITHOUT pair linkage still 409s', async () => {
    const w = windows(15);
    const t0 = w.incomingStart;
    const fx = await mkPlanFixture(t0);
    const otherFx = await mkPlanFixture(t0);
    const [otherTrip] = await db.insert(s.trips).values({
      tripCode: `KP81P-NG-${suffix}`.slice(0, 50),
      customerId: otherFx.customerId,
      routeId: otherFx.routeId,
      departureDate: w.day,
      truckId: fx.truckId,
      fulfillmentId: otherFx.fulfillmentId,
      plannedStartAt: w.incomingStart,
      plannedEndAt: w.legEnd,
      status: TripStatus.IN_TRANSIT,
      createdBy: fx.actor.userId,
    }).returning({ id: s.trips.id });
    ids.trips.push(otherTrip.id);

    await assert.rejects(
      () => assignFulfillmentPlate(plateSaveInput(fx)),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
      'an unrelated dispatched trip on the plate must keep blocking',
    );
  });
});

before(async () => {
  type20Id = await ensureContainerType20();
  assert.ok(type20Id > 0);
});

after(async () => {
  try {
    if (ids.trips.length > 0) {
      await db.delete(s.auditLogs).where(and(
        eq(s.auditLogs.entityType, 'trips'),
        inArray(s.auditLogs.entityId, ids.trips),
      ));
      await db.delete(s.notifications).where(inArray(s.notifications.relatedEntityId, ids.trips));
    }
    if (ids.events.length > 0) await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.id, ids.events));
    if (ids.tripPairs.length > 0) await db.delete(s.tripPairs).where(inArray(s.tripPairs.id, ids.tripPairs));
    if (ids.tripContainers.length > 0) await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, ids.trips));
    if (ids.trips.length > 0) {
      await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, ids.trips));
      await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, ids.trips));
      await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    }
    if (ids.fulfillments.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, ids.fulfillments));
    if (ids.containers.length > 0) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, ids.containers));
    if (ids.shipments.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.assignments.length > 0) await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, ids.assignments));
    if (ids.drivers.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, ids.drivers));
    if (ids.trucks.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, ids.trucks));
    if (ids.trailers.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, ids.trailers));
    if (ids.sites.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, ids.sites));
    if (ids.cargoTypes.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
    if (ids.containerTypes.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, ids.containerTypes));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
  await client.end();
});
