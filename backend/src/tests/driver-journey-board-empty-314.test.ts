// Card 20261003_314 — driver journey-board 0-items while /driver/me/trips
// serves the same driver's trips (observed on staging 71a9199b, login dvthuc:
// 16 trips vs items: 0, in both CREATED and COMPLETED trip states).
//
// Red-first: a qualifying driver (live driver row + user + a shipment →
// fulfillment → CREATED trip chain with the driver assigned) must receive a
// NON-EMPTY journey board. If this passes at HEAD, the defect lives in the
// staging build/WIP delta, not the landed service.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { getDriverTrips } from '../services/driver.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const ids: Record<string, number[]> = {
  users: [], drivers: [], trucks: [], trailers: [], assignments: [], customers: [],
  routes: [], containerTypes: [], shipments: [], containers: [], fulfillments: [],
  trips: [], tripContainers: [],
};
let driverRowId = 0;
const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: `jboard-${suffix.slice(-10)}`, passwordHash: 'test-only', role: 'DRIVER',
  }).returning();
  ids.users.push(user.id);
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${suffix.slice(-6)}`.slice(0, 20), type: '20FT',
  }).returning();
  ids.trailers.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${suffix.slice(-6)}`.slice(0, 20), currentTrailerId: trailer.id, trailerType: '20FT',
  }).returning();
  ids.trucks.push(truck.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id, name: `Journey board driver ${suffix.slice(-6)}`, assignedTruckId: truck.id,
  }).returning();
  ids.drivers.push(driver.id);
  driverRowId = driver.id;
  const [assignment] = await db.insert(s.truckDriverAssignments).values({
    truckId: truck.id, driverId: driver.id,
  }).returning();
  ids.assignments.push(assignment.id);
  const [customer] = await db.insert(s.customers).values({ name: `Journey board customer ${suffix}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Journey board route ${suffix}` }).returning();
  ids.routes.push(route.id);
  const [type20] = await db.insert(s.containerTypes).values({
    code: `JB${suffix.slice(-6)}`, name: `Journey board ${suffix.slice(-4)}`,
  }).returning();
  ids.containerTypes.push(type20.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `JB-${suffix.slice(-8)}`,
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
  }).returning();
  ids.shipments.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerTypeId: type20.id,
    containerNumber: `JBSU${String(700000 + ids.containers.length).slice(-6)}`,
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
  const start = new Date(`${tomorrow}T02:00:00.000Z`);
  const [trip] = await db.insert(s.trips).values({
    customerId: customer.id,
    routeId: route.id,
    truckId: truck.id,
    trailerId: trailer.id,
    driverId: driver.id,
    fulfillmentId: fulfillment.id,
    departureDate: tomorrow,
    plannedStartAt: start,
    plannedEndAt: new Date(start.getTime() + 4 * 3600_000),
    status: 'CREATED',
  }).returning();
  ids.trips.push(trip.id);
  const [tripContainer] = await db.insert(s.tripContainers).values({
    tripId: trip.id, containerTypeId: type20.id, cargoWeightKg: '10000',
  }).returning();
  ids.tripContainers.push(tripContainer.id);
});

after(async () => {
  try {
    if (ids.tripContainers.length > 0) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, ids.tripContainers));
    if (ids.trips.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.fulfillments.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, ids.fulfillments));
    if (ids.containers.length > 0) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, ids.containers));
    if (ids.shipments.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.containerTypes.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, ids.containerTypes));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.assignments.length > 0) await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, ids.assignments));
    if (ids.trucks.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, ids.trucks));
    if (ids.trailers.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, ids.trailers));
    if (ids.drivers.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, ids.drivers));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('driver journey board (card 20261003_314 red-first)', () => {
  test('a qualifying driver gets a non-empty journey board', async () => {
    const board = await getDriverJourneyBoard(driverRowId);
    const card = (board.items ?? []).find((c) => c.tripId === ids.trips[0]);
    assert.notEqual(card, undefined, `journey board returned 0 items for a driver whose live CREATED trip ${ids.trips[0]} exists; items=${JSON.stringify(board.items)}`);
  });

  test('the trips list agrees with the board (the staging symptom shape)', async () => {
    const trips = await getDriverTrips(driverRowId);
    assert.equal(trips.length, 1);
    const board = await getDriverJourneyBoard(driverRowId);
    assert.equal((board.items ?? []).length, trips.length, 'the two driver surfaces must agree on the same qualifying trips');
  });
});
