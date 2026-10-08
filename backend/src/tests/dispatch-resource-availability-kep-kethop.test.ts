// Card 20261002_271 — dispatch resource-availability gate: Kẹp / Kết hợp matrix.
//
// The write gate false-alarmed 409 "trùng đầu xe" for the Kết hợp sequence
// (the rig runs its two orders back-to-back in one business day): no
// exemption existed for COMBINED at all. The Kẹp clamp (two 20' boxes on one
// mooc) keeps its existing both-declared exemption; both sides must carry
// the matching declaration, so an unrelated single overlap stays blocked
// (the VID-DSP-04 model in dispatch-fulfillment.test.ts).
//
// Matrix — one shared rig; row r occupies business day 2026-10-05+r so rows
// never see each other's conflict windows (the exemption applies only when
// exactly ONE conflict row is found):
//   T1  Kẹp both-declared, partner unpaired        → no throw (control)
//   T2  Kẹp incoming vs partner still SINGLE       → 409 stays (declaration guard)
//   T3  Kẹp incoming while partner is ACTIVE-paired to a third load → 409
//   T4  Kết hợp sequential same-day same-rig       → no throw  [BUG ROW]
//   T5  Đơn + Đơn overlap, independent             → 409 stays
//   T6  Kẹp partner carries a 40' container        → 409 stays (probe guard)
//   T7  Kẹp clamped weight over capacity           → 409 stays (weight cap)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { assertResourceAvailability } from '../services/dispatch-resource-availability.service';
import { ApiError } from '../errors';
import { localDateInBusinessZone, Role, TripStatus } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const ids: Record<'customers' | 'routes' | 'containerTypes' | 'shipments' | 'containers' | 'fulfillments' | 'trips' | 'tripContainers' | 'tripPairs' | 'users' | 'drivers' | 'trucks' | 'trailers' | 'assignments', number[]> = {
  customers: [], routes: [], containerTypes: [], shipments: [], containers: [],
  fulfillments: [], trips: [], tripContainers: [], tripPairs: [], users: [],
  drivers: [], trucks: [], trailers: [], assignments: [],
};

let rigTruckId = 0;
let rigTrailerId = 0;
let rigDriverId = 0;
let type20Id = 0;
let type40Id = 0;

// Row r lives on 2026-10-05+r; partner window 02–10Z, incoming 04–12Z — both
// inside the VN business day (+07) under any ±7h timezone skew.
function windows(dayIndex: number) {
  const day = `2026-10-${String(5 + dayIndex).padStart(2, '0')}`;
  return {
    day,
    partnerStart: new Date(`${day}T02:00:00.000Z`),
    partnerEnd: new Date(`${day}T10:00:00.000Z`),
    incomingStart: new Date(`${day}T04:00:00.000Z`),
    incomingEnd: new Date(`${day}T12:00:00.000Z`),
  };
}

/** Reuse the seeded master row when present; the code is unique repo-wide. */
async function ensureContainerType(code: '20DC' | '40HC'): Promise<number> {
  const [existing] = await db.select({ id: s.containerTypes.id })
    .from(s.containerTypes).where(eq(s.containerTypes.code, code));
  if (existing != null) return existing.id;
  const [row] = await db.insert(s.containerTypes).values({
    code, name: `KepMatrix ${code} ${suffix.slice(-4)}`,
  }).returning();
  ids.containerTypes.push(row.id);
  return row.id;
}

async function mkRig() {
  const tail = suffix.slice(-6);
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${tail}`.slice(0, 20), type: '20FT',
  }).returning();
  ids.trailers.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${tail}`.slice(0, 20), currentTrailerId: trailer.id, trailerType: '20FT',
  }).returning();
  ids.trucks.push(truck.id);
  const [user] = await db.insert(s.users).values({
    username: `kepmx-${suffix.slice(-10)}-${ids.users.length}`,
    passwordHash: 'test-only', role: Role.DRIVER,
  }).returning();
  ids.users.push(user.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id, name: `KepMatrix driver ${tail}`, assignedTruckId: truck.id,
  }).returning();
  ids.drivers.push(driver.id);
  const [assignment] = await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id, driverId: driver.id,
  }).returning();
  ids.assignments.push(assignment.id);
  rigTruckId = truck.id;
  rigTrailerId = trailer.id;
  rigDriverId = driver.id;
}

interface LotOptions {
  tag: string;
  dayIndex: number;
  classification: 'SINGLE' | 'DOUBLE' | 'COMBINED';
  code: '20DC' | '40HC';
  weightKg?: string;
}

/** shipment → container row → fulfillment → trip (+ trip container row). */
async function mkLot(opts: LotOptions) {
  if (ids.customers.length === 0) {
    const [customer] = await db.insert(s.customers).values({
      name: `KepMatrix customer ${suffix}`,
    }).returning();
    ids.customers.push(customer.id);
  }
  if (ids.routes.length === 0) {
    const [route] = await db.insert(s.routes).values({
      name: `KepMatrix route ${suffix}`,
    }).returning();
    ids.routes.push(route.id);
  }
  const [shipment] = await db.insert(s.shipments).values({
    customerId: ids.customers[0],
    shipmentCode: `KPMX-${suffix.slice(-8)}-${ids.shipments.length}`.slice(0, 50),
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
  }).returning();
  ids.shipments.push(shipment.id);
  const containerTypeId = opts.code === '20DC' ? type20Id : type40Id;
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId,
    containerNumber: `KMSU${String(700000 + ids.containers.length).slice(-6)}`,
  }).returning();
  ids.containers.push(container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    dispatchClassification: opts.classification,
  }).returning();
  ids.fulfillments.push(fulfillment.id);
  const w = windows(opts.dayIndex);
  const isPartner = opts.tag.endsWith('-partner');
  const [trip] = await db.insert(s.trips).values({
    customerId: ids.customers[0],
    routeId: ids.routes[0],
    truckId: rigTruckId,
    trailerId: rigTrailerId,
    driverId: rigDriverId,
    fulfillmentId: fulfillment.id,
    departureDate: w.day,
    plannedStartAt: isPartner ? w.partnerStart : w.incomingStart,
    plannedEndAt: isPartner ? w.partnerEnd : w.incomingEnd,
    status: TripStatus.CREATED,
    cargoWeightKg: opts.weightKg ?? '10000',
    vehicleCapacityKg: '36000',
  }).returning();
  ids.trips.push(trip.id);
  const [tripContainer] = await db.insert(s.tripContainers).values({
    tripId: trip.id,
    containerTypeId,
    containerNumber: container.containerNumber,
    cargoWeightKg: opts.weightKg ?? '10000',
  }).returning();
  ids.tripContainers.push(tripContainer.id);
  return { shipment, container, fulfillment, trip };
}

interface GateOptions {
  tripId: number;
  code: string;
  classification: string;
  start: Date;
  end: Date;
  cargoWeightKg?: string;
  vehicleCapacityKg?: string;
}

function gateArgs(o: GateOptions) {
  return {
    tripId: o.tripId,
    truckId: rigTruckId,
    trailerId: rigTrailerId,
    driverId: rigDriverId,
    plannedStartAt: o.start,
    plannedEndAt: o.end,
    cargoWeightKg: o.cargoWeightKg ?? '10000',
    vehicleCapacityKg: o.vehicleCapacityKg ?? '36000',
    kepContext: {
      issuingContainerIsTwentyFoot: o.code.startsWith('20'),
      classification: o.classification,
      departureDate: localDateInBusinessZone(o.start),
    },
  };
}

async function expectNoConflict(label: string, o: GateOptions) {
  await db.transaction(async (tx) => {
    await assert.doesNotReject(
      () => assertResourceAvailability(tx, gateArgs(o)),
      `${label}: expected no 409`,
    );
  });
}

async function expectConflict(label: string, o: GateOptions) {
  await db.transaction(async (tx) => {
    await assert.rejects(
      () => assertResourceAvailability(tx, gateArgs(o)),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `${label}: expected ApiError, got ${String(err)}`);
        assert.equal((err as ApiError).statusCode, 409, `${label}: expected 409, got ${String((err as ApiError).statusCode)}`);
        return true;
      },
      `${label}: expected a 409 conflict`,
    );
  });
}

after(async () => {
  try {
    if (ids.tripPairs.length > 0) await db.delete(s.tripPairs).where(inArray(s.tripPairs.id, ids.tripPairs));
    if (ids.tripContainers.length > 0) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, ids.tripContainers));
    if (ids.trips.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.fulfillments.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, ids.fulfillments));
    if (ids.containers.length > 0) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, ids.containers));
    if (ids.shipments.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.assignments.length > 0) await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, ids.assignments));
    if (ids.drivers.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, ids.drivers));
    if (ids.trucks.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, ids.trucks));
    if (ids.trailers.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, ids.trailers));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
    if (ids.containerTypes.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, ids.containerTypes));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('dispatch resource availability — Kẹp / Kết hợp same-rig matrix', () => {
  // Shared fixtures in before(): node:test does not serialize sibling test()
  // blocks around each other, so a fellow test cannot be relied on as an
  // ordered predecessor — the rig and container-type ids must exist before
  // any mkLot runs.
  before(async () => {
    await mkRig();
    type20Id = await ensureContainerType('20DC');
    type40Id = await ensureContainerType('40HC');
    assert.ok(rigTruckId > 0 && type20Id > 0 && type40Id > 0);
  });

  test('T1 Kẹp both-declared clamp passes', async () => {
    const partner = await mkLot({ tag: 't1-partner', dayIndex: 0, classification: 'DOUBLE', code: '20DC' });
    const incoming = await mkLot({ tag: 't1-incoming', dayIndex: 0, classification: 'DOUBLE', code: '20DC' });
    await expectNoConflict('T1', {
      tripId: incoming.trip.id, code: '20DC', classification: 'DOUBLE',
      start: windows(0).incomingStart, end: windows(0).incomingEnd,
    });
    assert.ok(partner.trip.id > 0);
  });

  test('T2 Kẹp incoming vs partner still declared SINGLE stays blocked', async () => {
    await mkLot({ tag: 't2-partner', dayIndex: 1, classification: 'SINGLE', code: '20DC' });
    const incoming = await mkLot({ tag: 't2-incoming', dayIndex: 1, classification: 'DOUBLE', code: '20DC' });
    await expectConflict('T2', {
      tripId: incoming.trip.id, code: '20DC', classification: 'DOUBLE',
      start: windows(1).incomingStart, end: windows(1).incomingEnd,
    });
  });

  test('T3 Kẹp third load into an active pair still conflicts', async () => {
    const partner = await mkLot({ tag: 't3-partner', dayIndex: 2, classification: 'DOUBLE', code: '20DC' });
    const third = await mkLot({ tag: 't3-third', dayIndex: 2, classification: 'DOUBLE', code: '20DC' });
    const incoming = await mkLot({ tag: 't3-incoming', dayIndex: 2, classification: 'DOUBLE', code: '20DC' });
    const [pair] = await db.insert(s.tripPairs).values({
      firstTripId: partner.trip.id, secondTripId: third.trip.id,
    }).returning();
    ids.tripPairs.push(pair.id);
    await db.update(s.trips).set({ activeTripPairId: pair.id }).where(eq(s.trips.id, partner.trip.id));
    await expectConflict('T3', {
      tripId: incoming.trip.id, code: '20DC', classification: 'DOUBLE',
      start: windows(2).incomingStart, end: windows(2).incomingEnd,
    });
  });

  test('T4 Kết hợp sequential same-day run passes', async () => {
    await mkLot({ tag: 't4-partner', dayIndex: 3, classification: 'COMBINED', code: '20DC' });
    const incoming = await mkLot({ tag: 't4-incoming', dayIndex: 3, classification: 'COMBINED', code: '20DC' });
    await expectNoConflict('T4', {
      tripId: incoming.trip.id, code: '20DC', classification: 'COMBINED',
      start: windows(3).incomingStart, end: windows(3).incomingEnd,
    });
  });

  test('T5 Đơn + Đơn overlap still conflicts', async () => {
    await mkLot({ tag: 't5-partner', dayIndex: 4, classification: 'SINGLE', code: '20DC' });
    const incoming = await mkLot({ tag: 't5-incoming', dayIndex: 4, classification: 'SINGLE', code: '20DC' });
    await expectConflict('T5', {
      tripId: incoming.trip.id, code: '20DC', classification: 'SINGLE',
      start: windows(4).incomingStart, end: windows(4).incomingEnd,
    });
  });

  test('T6 Kẹp partner carries a 40ft container still conflicts', async () => {
    await mkLot({ tag: 't6-partner', dayIndex: 5, classification: 'DOUBLE', code: '40HC' });
    const incoming = await mkLot({ tag: '6-incoming', dayIndex: 5, classification: 'DOUBLE', code: '20DC' });
    await expectConflict('T6', {
      tripId: incoming.trip.id, code: '20DC', classification: 'DOUBLE',
      start: windows(5).incomingStart, end: windows(5).incomingEnd,
    });
  });

  test('T7 Kẹp clamped weight over capacity still conflicts', async () => {
    await mkLot({ tag: 't7-partner', dayIndex: 6, classification: 'DOUBLE', code: '20DC', weightKg: '12000' });
    const incoming = await mkLot({ tag: 't7-incoming', dayIndex: 6, classification: 'DOUBLE', code: '20DC' });
    await expectConflict('T7', {
      tripId: incoming.trip.id, code: '20DC', classification: 'DOUBLE',
      start: windows(6).incomingStart, end: windows(6).incomingEnd,
      cargoWeightKg: '12000',
      vehicleCapacityKg: '20000',
    });
  });

  // Card 081026230530 (FB-038 round 8): the availability scan demanded
  // plannedEndAt on the CONFLICTING trip, so a running trip issued without an
  // end time was invisible to the gate and the governed reassign saved a
  // same-rig double-booking silently. The plan-row guard already bounds an
  // open-ended window at one 8-hour shift from its start (card 061026172804
  // law) — T8 pins that the issue/reassign gate must follow the same rule.
  test('T8 ACTIVE trip without plannedEndAt still conflicts inside its 8h bound', async () => {
    const partner = await mkLot({ tag: 't8-partner', dayIndex: 7, classification: 'SINGLE', code: '20DC' });
    await db.update(s.trips).set({ plannedEndAt: null }).where(eq(s.trips.id, partner.trip.id));
    const incoming = await mkLot({ tag: 't8-incoming', dayIndex: 7, classification: 'SINGLE', code: '20DC' });
    await expectConflict('T8', {
      tripId: incoming.trip.id, code: '20DC', classification: 'SINGLE',
      start: windows(7).incomingStart, end: windows(7).incomingEnd,
    });
  });

  test('T9 ACTIVE trip without plannedStartAt stays skipped (cannot prove overlap)', async () => {
    const partner = await mkLot({ tag: 't9-partner', dayIndex: 8, classification: 'SINGLE', code: '20DC' });
    await db.update(s.trips).set({ plannedStartAt: null }).where(eq(s.trips.id, partner.trip.id));
    const incoming = await mkLot({ tag: 't9-incoming', dayIndex: 8, classification: 'SINGLE', code: '20DC' });
    await expectNoConflict('T9', {
      tripId: incoming.trip.id, code: '20DC', classification: 'SINGLE',
      start: windows(8).incomingStart, end: windows(8).incomingEnd,
    });
  });

  test('T10 open-ended trip releases the rig after its 8h default bound', async () => {
    const partner = await mkLot({ tag: 't10-partner', dayIndex: 9, classification: 'SINGLE', code: '20DC' });
    await db.update(s.trips).set({ plannedEndAt: null }).where(eq(s.trips.id, partner.trip.id));
    const incoming = await mkLot({ tag: 't10-incoming', dayIndex: 9, classification: 'SINGLE', code: '20DC' });
    // Partner start 02:00Z + 8h bound = 10:00Z; incoming 04:00–12:00Z overlaps
    // the bound, so shift the incoming window to 12:00–20:00Z same day.
    const day9 = windows(9).day;
    await expectNoConflict('T10', {
      tripId: incoming.trip.id, code: '20DC', classification: 'SINGLE',
      start: new Date(`${day9}T12:00:00.000Z`), end: new Date(`${day9}T20:00:00.000Z`),
    });
    assert.ok(partner.trip.id > 0);
  });

  test('T11 a rig slot 7 days away stays allowed', async () => {
    await mkLot({ tag: 't11-partner', dayIndex: 10, classification: 'SINGLE', code: '20DC' });
    const incoming = await mkLot({ tag: 't11-incoming', dayIndex: 17, classification: 'SINGLE', code: '20DC' });
    await expectNoConflict('T11', {
      tripId: incoming.trip.id, code: '20DC', classification: 'SINGLE',
      start: windows(17).incomingStart, end: windows(17).incomingEnd,
    });
  });
});
