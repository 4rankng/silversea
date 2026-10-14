/**
 * Round-19 review B1 (route-level pin): the reassignment route's
 * externalCarrierVehicleId guard must accept `null` — the FE dialog always
 * sends the key, and null is its legal "OWN reassign / free-text plate"
 * signal. The pre-fix guard (`!== undefined`) 400'd every OWN reassign and
 * every free-text plate. Also pins: a provided id must be a positive
 * integer (or numeric string), and the OWN flow through the real route
 * works with the dialog's null key.
 *
 * Harness: real express app + the reassignment router + req.user injection
 * (supplier-carrier-link.test.ts pattern); fixtures follow
 * trip-reassign-acceptance.test.ts.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { globalErrorHandler } from '../middleware/errorHandler';
import reassignmentRoutes from '../routes/trips/reassignment';
import type { AuthUser } from '../middleware/auth';

const suffix = `r19r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
let server: http.Server;
let baseUrl = '';
const created = {
  userIds: [] as number[],
  driverIds: [] as number[],
  truckIds: [] as number[],
  trailerIds: [] as number[],
  customerIds: [] as number[],
  vehicleIds: [] as number[],
  routeIds: [] as number[],
  shipmentIds: [] as number[],
  containerIds: [] as number[],
  fulfillmentIds: [] as number[],
  tripIds: [] as number[],
};

async function patch(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      // Material writes require the idempotency header (route middleware).
      'Idempotency-Key': `r19r-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** Lot scaffolding for one governed trip: shipment + container + fulfillment + carrier. */
async function fixtureLot(plate: string) {
  const [carrier] = await db.insert(s.customers).values({ name: `R19R carrier ${suffix} ${plate}`, isCarrier: true, status: 'ACTIVE' }).returning();
  created.customerIds.push(carrier.id);
  const [vehicle] = await db.insert(s.carrierFleetVehicles).values({
    carrierId: carrier.id,
    licensePlate: plate,
    normalizedPlate: plate.replace(/[^A-Z0-9]/g, ''),
    isActive: true,
  }).returning();
  created.vehicleIds.push(vehicle.id);
  const [route] = await db.insert(s.routes).values({ name: `R19R route ${suffix} ${plate}`, distanceKm: 42 }).returning();
  created.routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: carrier.id,
    routeId: route.id,
    blNumber: `R19R-BL-${suffix}-${plate.replace(/\W/g, '')}`.slice(0, 60),
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
  }).returning();
  created.shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerNumber: 'QKGR0000017',
  }).returning();
  created.containerIds.push(container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    dispatchClassification: 'SINGLE',
  }).returning();
  created.fulfillmentIds.push(fulfillment.id);
  return { carrier, vehicle, route, shipment, container, fulfillment };
}

/** An EXTERNAL governed trip on its own lot (one live trip per fulfillment). */
async function fixtureExternalTrip(plate: string) {
  const lot = await fixtureLot(plate);
  const trip = await insertTripComposite(db, {
    tripCode: `R19R-${suffix}-${plate.replace(/\W/g, '')}`.slice(0, 50),
    customerId: lot.carrier.id,
    routeId: lot.route.id,
    status: TripStatus.CREATED,
    version: 1,
    departureDate: '2026-10-20',
    plannedStartAt: new Date('2026-10-20T01:00:00Z'),
    plannedEndAt: new Date('2026-10-20T09:00:00Z'),
    shipmentId: lot.shipment.id,
    fulfillmentId: lot.fulfillment.id,
    carrierType: 'EXTERNAL',
    externalEntityId: lot.carrier.id,
    externalEntityType: 'CUSTOMER',
    externalPlateNumber: plate,
    externalCarrierVehicleId: lot.vehicle.id,
    externalDriverName: 'Anh R19R',
    externalDriverPhone: '0987',
  });
  created.tripIds.push(trip.id);
  return { ...lot, trip };
}

/** An OWN governed trip on its own lot, with an ACTIVE truck/trailer/driver. */
async function fixtureOwnTrip() {
  const lot = await fixtureLot('18H-018.18');
  const [user] = await db.insert(s.users).values({
    username: `r19r-own-${suffix}`.slice(0, 40),
    passwordHash: 'x',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  created.userIds.push(user.id);
  const [driver] = await db.insert(s.drivers).values({ userId: user.id, name: `Lái R19R ${suffix}`, status: 'ACTIVE' }).returning();
  created.driverIds.push(driver.id);
  const [trailer] = await db.insert(s.trailers).values({ licensePlate: `15R-${suffix}`.slice(0, 20), type: '40FT', status: 'ACTIVE' }).returning();
  created.trailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `15H-${suffix}`.slice(0, 20),
    trailerType: '40FT',
    status: 'ACTIVE',
    currentTrailerId: trailer.id,
  }).returning();
  created.truckIds.push(truck.id);
  const trip = await insertTripComposite(db, {
    tripCode: `R19RO-${suffix}`.slice(0, 50),
    customerId: lot.carrier.id,
    routeId: lot.route.id,
    status: TripStatus.CREATED,
    version: 1,
    departureDate: '2026-10-20',
    plannedStartAt: new Date('2026-10-20T01:00:00Z'),
    plannedEndAt: new Date('2026-10-20T09:00:00Z'),
    shipmentId: lot.shipment.id,
    fulfillmentId: lot.fulfillment.id,
    carrierType: 'OWN',
    truckId: truck.id,
    driverId: driver.id,
    trailerId: trailer.id,
  });
  created.tripIds.push(trip.id);
  return { truck, driver, trailer, trip, shipment: lot.shipment };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: 0,
      username: `r19r-disp-${suffix}`.slice(0, 40),
      email: null,
      fullName: null,
      role: Role.DISPATCHER,
    } as AuthUser;
    next();
  });
  app.use('/api/trips', reassignmentRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await db.delete(s.trips).where(inArray(s.trips.id, created.tripIds));
  await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, created.tripIds)).catch(() => {});
  await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, created.fulfillmentIds));
  await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, created.containerIds));
  await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipmentIds));
  await db.delete(s.carrierFleetVehicles).where(inArray(s.carrierFleetVehicles.id, created.vehicleIds));
  await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
  await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await db.delete(s.trucks).where(inArray(s.trucks.id, created.truckIds));
  await db.delete(s.trailers).where(inArray(s.trailers.id, created.trailerIds));
  await db.delete(s.drivers).where(inArray(s.drivers.id, created.driverIds));
  await db.delete(s.users).where(inArray(s.users.id, created.userIds));
  await client.end();
});

describe('PATCH /api/trips/:id/reassign — externalCarrierVehicleId guard (round-19 B1)', () => {
  test('null vehicle id + free-text plate reassigns the same carrier successfully', async () => {
    const { carrier, vehicle, trip } = await fixtureExternalTrip('19H-118.11');
    const response = await patch(`/api/trips/${trip.id}/reassign`, {
      carrierType: 'EXTERNAL',
      externalCarrierId: carrier.id,
      externalPlateNumber: '19H-999.99',
      externalCarrierVehicleId: null,
      reason: 'r19r: doi bien so',
      expectedVersion: 1,
    });
    assert.equal(response.status, 201);
    // Free text won: the new plate persisted and the old carrier's vehicle
    // linkage did NOT ride along.
    const [carrierRow] = await db.select().from(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, trip.id));
    assert.equal(carrierRow.externalPlateNumber, '19H-999.99');
    assert.equal(carrierRow.externalCarrierVehicleId, null);
    assert.ok(vehicle.id > 0);
  });

  test('OWN reassign with the dialog\'s null vehicle id passes the guard', async () => {
    const { truck, driver, trailer, trip } = await fixtureOwnTrip();
    const response = await patch(`/api/trips/${trip.id}/reassign`, {
      carrierType: 'OWN',
      truckId: truck.id,
      driverId: driver.id,
      externalCarrierVehicleId: null,
      reason: 'r19r: doi xe noi',
      expectedVersion: 1,
    });
    assert.equal(response.status, 201);
    assert.notEqual(response.body.error, 'Xe của nhà xe ngoài không hợp lệ.');
    const [opsRow] = await db.select({ truckId: s.trips.truckId, driverId: s.trips.driverId }).from(s.trips).where(eq(s.trips.id, trip.id));
    assert.equal(opsRow.truckId, truck.id);
    assert.equal(opsRow.driverId, driver.id);
    assert.ok(trailer.id > 0);
  });

  test('a provided vehicle id must be a positive integer (numeric strings coerce)', async () => {
    const { trip } = await fixtureExternalTrip('19H-118.22');
    const invalid = await patch(`/api/trips/${trip.id}/reassign`, {
      carrierType: 'EXTERNAL',
      externalCarrierId: 1,
      externalPlateNumber: '19H-000.00',
      externalCarrierVehicleId: -3,
      reason: 'r19r: id am',
      expectedVersion: 1,
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Xe của nhà xe ngoài không hợp lệ.');

    const zero = await patch(`/api/trips/${trip.id}/reassign`, {
      carrierType: 'EXTERNAL',
      externalCarrierId: 1,
      externalPlateNumber: '19H-000.00',
      externalCarrierVehicleId: '0',
      reason: 'r19r: id 0',
      expectedVersion: 1,
    });
    assert.equal(zero.status, 400);
    assert.equal(zero.body.error, 'Xe của nhà xe ngoài không hợp lệ.');
  });

  test('a valid picker vehicle id rides into the carrier sidecar', async () => {
    const { carrier, vehicle, trip } = await fixtureExternalTrip('19H-118.33');
    const response = await patch(`/api/trips/${trip.id}/reassign`, {
      carrierType: 'EXTERNAL',
      externalCarrierId: carrier.id,
      externalPlateNumber: vehicle.licensePlate,
      externalCarrierVehicleId: String(vehicle.id),
      reason: 'r19r: chon xe trong danh muc',
      expectedVersion: 1,
    });
    assert.equal(response.status, 201);
    const [carrierRow] = await db.select().from(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, trip.id));
    assert.equal(carrierRow.externalCarrierVehicleId, vehicle.id);
    assert.equal(carrierRow.externalPlateNumber, vehicle.licensePlate);
  });
});
