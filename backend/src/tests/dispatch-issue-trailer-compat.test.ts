/**
 * Card 091026164500 — issue-time trailer compatibility is a LENGTH FLOOR.
 *
 * Staging lot QADV-R10-B001 (2×20DC): issuing one 20DC onto the Kẹp rig
 * (tractor + 40FT moóc — two 20' boxes clamped on one 40' moóc IS the Kẹp
 * hardware) 409'd "Rơ-moóc không phù hợp với loại container" because the gate
 * exact-matched the container code ('20…' → cần 20FT). A 20' box rides a 40'
 * moóc legally whatever its classification says; the provable impossibility
 * is the reverse — a 40' requirement on a 20' moóc.
 *
 * Matrix (fresh rig per test, all windows on business day 2026-10-06 +07):
 *   T1 SINGLE 20DC on 40FT rig               → issues          [BUG ROW]
 *   T2 DOUBLE 20DC pair on one 40FT rig      → both issue (Kẹp end-to-end)
 *   T3 40HC on 20FT rig                      → 409 trailer-compat
 *   T4 undeclared same-rig same-day 2nd load → 409 trùng lịch (occupancy law)
 *   T5 DOUBLE / LCL_PICKUP 20-code on 20FT   → 409 trailer-compat (floor)
 *   T6 open-ended partner (no plannedEndAt)  → 409 trùng lịch (card
 *      081026230530: an open-ended ACTIVE trip occupies the rig for one
 *      8-hour shift from its start — the fix here must not weaken it)
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { issueOrderCreateOrUpdate } from '../services/dispatch-planning-commands.service';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];
const createdUserIds: number[] = [];
let admin: AuthUser;

type TrailerKind = '20FT' | '40FT';

/** One rig (xe + moóc + lái); the trailer's type drives the gate. */
async function mkFleet(trailerType: TrailerKind) {
  const plateSuffix = suffix.slice(-6);
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51T-${trailerType[0]}${plateSuffix}${createdTrailerIds.length}`.slice(0, 20),
    type: trailerType,
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51F-${trailerType[0]}${plateSuffix}${createdTruckIds.length}`.slice(0, 20),
    currentTrailerId: trailer.id,
    trailerType,
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);
  const [driverUser] = await db.insert(s.users).values({
    username: `trcmp-${suffix}-${createdUserIds.length}`,
    passwordHash: 'test-only',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(driverUser.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `TrailerCompat driver ${suffix}-${createdDriverIds.length}`,
    assignedTruckId: truck.id,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id,
    driverId: driver.id,
    role: 'PRIMARY',
  });
  return { trailer, truck, driver };
}

type Classification = 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL_PICKUP';
type ContainerKind = '20DC' | '40HC';

/** One lot, `containers` container fulfillments of one type/classification. */
async function mkLot(args: { classification: Classification; code: ContainerKind; containers?: number }) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `TrailerCompat customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `TrailerCompat route ${suffix}-${createdRouteIds.length}`, distanceKm: 120 }).returning();
  createdRouteIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `TRCM-${suffix}-${createdShipmentIds.length}`.slice(0, 50),
    bookingRef: `TRCMBOOK-${suffix}-${createdShipmentIds.length}`.slice(0, 50),
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-10-10T08:00:00.000Z'),
    createdBy: admin.userId,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `${args.code}${suffix.replace(/\D/g, '').slice(-8)}${createdContainerTypeIds.length}`.slice(0, 20),
    name: `${args.code}' test`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);

  const fulfillments: Array<typeof s.shipmentFulfillments.$inferSelect> = [];
  for (const index of Array.from({ length: args.containers ?? 1 }, (_, i) => i)) {
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerTypeId: containerType.id,
      containerNumber: `TRCM${suffix.replace(/\D/g, '').slice(-7)}${index}`.slice(0, 50),
      routeId: route.id,
      cargoWeightKg: '12000',
      createdBy: admin.userId,
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      dispatchClassification: args.classification,
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
      createdBy: admin.userId,
    }).returning();
    createdFulfillmentIds.push(fulfillment.id);
    fulfillments.push(fulfillment);
  }
  return { shipment, fulfillments };
}

/** Real issue-path write (same entry point the Phát lệnh route drives). */
async function issue(
  fulfillment: { id: number; version: number },
  shipmentId: number,
  fleet: Awaited<ReturnType<typeof mkFleet>>,
  windowIndex = 0,
) {
  // Hour offsets keep same-day cases overlapping (08:00+07 start) and the
  // disjoint control 10 hours apart — the service duration from 120 km is
  // ~3.5 h, so both windows stay inside business day 2026-10-06 (+07).
  const startHour = 8 + windowIndex * 10;
  const outcome = await db.transaction((tx) => issueOrderCreateOrUpdate(tx, {
    shipmentId,
    fulfillmentId: fulfillment.id,
    expectedVersion: fulfillment.version,
    plannedStartAt: `2026-10-06T${String(startHour).padStart(2, '0')}:00:00+07:00`,
    plannedEndAt: `2026-10-06T${String(startHour + 10).padStart(2, '0')}:00:00+07:00`,
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: fleet.truck.id,
    driverId: fleet.driver.id,
    trailerId: fleet.trailer.id,
    idempotencyKey: `trcmp-${suffix}-${fulfillment.id}-${windowIndex}`,
    actor: { ...admin, role: Role.ADMIN },
  }));
  createdTripIds.push(outcome.trip.id);
  return outcome;
}

async function expectIssue409(
  fulfillment: { id: number; version: number },
  shipmentId: number,
  fleet: Awaited<ReturnType<typeof mkFleet>>,
  message: string,
) {
  await assert.rejects(
    () => issue(fulfillment, shipmentId, fleet),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
      assert.equal(err.statusCode, 409, `expected 409, got ${err.statusCode}: ${err.message}`);
      assert.equal(err.message, message);
      return true;
    },
    `expected issue to reject with "${message}"`,
  );
}

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: `trcmp-admin-${suffix}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  admin = {
    userId: user.id,
    username: user.username,
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };
});

after(async () => {
  for (const id of createdTripIds) {
    await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, id)).catch(() => {});
    await db.delete(s.trips).where(eq(s.trips.id, id)).catch(() => {});
  }
  await db.delete(s.notifications).where(inArray(
    s.notifications.relatedEntityId,
    createdFulfillmentIds.length > 0 ? createdFulfillmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.shipmentFulfillments).where(inArray(
    s.shipmentFulfillments.id,
    createdFulfillmentIds.length > 0 ? createdFulfillmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.shipmentContainers).where(inArray(
    s.shipmentContainers.shipmentId,
    createdShipmentIds.length > 0 ? createdShipmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.shipments).where(inArray(
    s.shipments.id,
    createdShipmentIds.length > 0 ? createdShipmentIds : [-1],
  )).catch(() => {});
  await db.delete(s.truckDriverAssignments).where(inArray(
    s.truckDriverAssignments.truckId,
    createdTruckIds.length > 0 ? createdTruckIds : [-1],
  )).catch(() => {});
  await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds.length > 0 ? createdDriverIds : [-1])).catch(() => {});
  await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds.length > 0 ? createdTruckIds : [-1])).catch(() => {});
  await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds.length > 0 ? createdTrailerIds : [-1])).catch(() => {});
  await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds.length > 0 ? createdContainerTypeIds : [-1])).catch(() => {});
  await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds.length > 0 ? createdRouteIds : [-1])).catch(() => {});
  await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds.length > 0 ? createdCustomerIds : [-1])).catch(() => {});
  await db.delete(s.users).where(inArray(s.users.id, createdUserIds.length > 0 ? createdUserIds : [-1])).catch(() => {});
  await client.end();
  await disconnectRedis();
});

describe('dispatch issue trailer-compat — length floor (card 091026164500)', () => {
  test('T1 unclassified (SINGLE) 20DC issues onto the 40FT Kẹp rig', async () => {
    const lot = await mkLot({ classification: 'SINGLE', code: '20DC' });
    const fleet = await mkFleet('40FT');
    const outcome = await issue(lot.fulfillments[0], lot.shipment.id, fleet);
    assert.ok(outcome.trip.id > 0);
    assert.equal(outcome.trip.trailerId, fleet.trailer.id, 'phải phát lệnh trên moóc 40FT đã chọn');
  });

  test('T2 declared DOUBLE 20DC pair issues on one 40FT rig (Kẹp end-to-end)', async () => {
    const lot = await mkLot({ classification: 'DOUBLE', code: '20DC', containers: 2 });
    const fleet = await mkFleet('40FT');
    const first = await issue(lot.fulfillments[0], lot.shipment.id, fleet);
    const second = await issue(lot.fulfillments[1], lot.shipment.id, fleet);
    assert.ok(first.trip.id > 0 && second.trip.id > 0);
    assert.equal(first.trip.truckId, second.trip.truckId, 'cặp Kẹp phải chung một rig');
  });

  test('T3 40HC on a 20FT rig stays blocked', async () => {
    const lot = await mkLot({ classification: 'SINGLE', code: '40HC' });
    const fleet = await mkFleet('20FT');
    await expectIssue409(
      lot.fulfillments[0], lot.shipment.id, fleet,
      'Rơ-moóc không phù hợp với loại container.',
    );
  });

  test('T4 undeclared same-rig same-day second load still 409s (occupancy law intact)', async () => {
    const lot = await mkLot({ classification: 'SINGLE', code: '20DC', containers: 2 });
    const fleet = await mkFleet('40FT');
    await issue(lot.fulfillments[0], lot.shipment.id, fleet);
    await expectIssue409(
      lot.fulfillments[1], lot.shipment.id, fleet,
      'Xe đầu kéo đã bị trùng lịch kế hoạch.',
    );
  });

  test('T5 declared 40FT requirements still block on a 20FT rig (DOUBLE clamp, LCL_PICKUP shell)', async () => {
    const kep = await mkLot({ classification: 'DOUBLE', code: '20DC' });
    await expectIssue409(
      kep.fulfillments[0], kep.shipment.id, await mkFleet('20FT'),
      'Rơ-moóc không phù hợp với loại container.',
    );
    const shell = await mkLot({ classification: 'LCL_PICKUP', code: '20DC' });
    await expectIssue409(
      shell.fulfillments[0], shell.shipment.id, await mkFleet('20FT'),
      'Rơ-moóc không phù hợp với loại container.',
    );
  });

  test('T6 open-ended partner (no plannedEndAt) still occupies the rig', async () => {
    const lot = await mkLot({ classification: 'SINGLE', code: '20DC', containers: 2 });
    const fleet = await mkFleet('40FT');
    const first = await issue(lot.fulfillments[0], lot.shipment.id, fleet);
    // FB-038 shape: the running trip was issued without an end time.
    await db.update(s.trips).set({ plannedEndAt: null }).where(eq(s.trips.id, first.trip.id));
    await expectIssue409(
      lot.fulfillments[1], lot.shipment.id, fleet,
      'Xe đầu kéo đã bị trùng lịch kế hoạch.',
    );
  });
});
