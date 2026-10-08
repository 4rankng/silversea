// FB-038 local fixtures — QA-FB038-MM prefix (lane Agent-MiniMax, local dev DB only).
// Mirrors the round-8 staging shape: target row issued (CREATED trip, both times set),
// conflicting ACTIVE trip on the same truck with plannedEndAt NULL.
import crypto from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db, client as pool } from '../src/db';
import * as s from '../src/db/schema';
import { Role } from '@tingting/shared';

const TAG = 'QA-FB038-MM';

async function main() {
  // idempotent: purge previous run of this exact prefix
  const oldShip = await db.select({ id: s.shipments.id }).from(s.shipments).where(like(s.shipments.shipmentCode, `${TAG}%`));
  for (const sh of oldShip) {
    const fuls = await db.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.shipmentId, sh.id));
    for (const f of fuls) {
      await db.delete(s.trips).where(eq(s.trips.fulfillmentId, f.id));
      await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, f.id));
    }
    await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, sh.id));
    await db.delete(s.shipments).where(eq(s.shipments.id, sh.id));
  }
  // orphan trips from earlier runs
  const orphanTrucks = await db.select({ id: s.trucks.id }).from(s.trucks).where(like(s.trucks.licensePlate, `${TAG}%`));
  for (const t of orphanTrucks) {
    await db.delete(s.trips).where(eq(s.trips.truckId, t.id));
  }
  const driversOld = await db.select({ id: s.drivers.id }).from(s.drivers).where(like(s.drivers.name, `${TAG}%`));
  for (const dr of driversOld) {
    await db.delete(s.truckDriverAssignments).where(eq(s.truckDriverAssignments.driverId, dr.id));
    await db.delete(s.drivers).where(eq(s.drivers.id, dr.id));
  }
  await db.delete(s.trucks).where(like(s.trucks.licensePlate, `${TAG}%`));
  await db.delete(s.trailers).where(like(s.trailers.licensePlate, `${TAG}%`));
  const usersOld = await db.select({ id: s.users.id }).from(s.users).where(like(s.users.username, 'qafb038mm%'));
  for (const u of usersOld) {
    await db.delete(s.users).where(eq(s.users.id, u.id));
  }
  const routesOld = await db.select({ id: s.routes.id }).from(s.routes).where(like(s.routes.name, `${TAG}%`));
  for (const r of routesOld) {
    await db.delete(s.routes).where(eq(s.routes.id, r.id));
  }
  const custOld = await db.select({ id: s.customers.id }).from(s.customers).where(like(s.customers.name, `${TAG}%`));
  for (const c of custOld) {
    await db.delete(s.customers).where(eq(s.customers.id, c.id));
  }

  const [driverUser] = await db.insert(s.users).values({
    username: 'qafb038mm-drv', passwordHash: 'test-only', role: Role.DRIVER,
  }).returning();
  const [customer] = await db.insert(s.customers).values({ name: `${TAG} customer` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `${TAG} route` }).returning();
  let [ctype] = await db.select().from(s.containerTypes).where(eq(s.containerTypes.code, '20DC')).limit(1);
  if (!ctype) {
    [ctype] = await db.insert(s.containerTypes).values({ code: '20DC', name: '20DC QA shared' }).returning();
  }
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `${TAG}-R`, type: '20FT',
  }).returning();
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: TAG, currentTrailerId: trailer.id, trailerType: '20FT',
  }).returning();
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id, name: `${TAG} lái xe`, assignedTruckId: truck.id,
  }).returning();
  await db.insert(s.truckDriverAssignments).values({ truckId: truck.id, driverId: driver.id });

  const now = Date.now();
  const conflictStart = new Date(now + 15 * 60_000);
  const targetStart = new Date(now + 60 * 60_000);
  const targetEnd = new Date(now + 5 * 3600_000);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `${TAG}-S1`,
    cargoMode: 'FCL',
    status: 'DISPATCHED',
    tradeDirection: 'EXPORT',
    routeId: route.id,
  }).returning();
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: ctype.id,
    containerNumber: 'FBMM1000001',
    customerAppointmentAt: targetStart,
    routeId: route.id,
  }).returning();
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
  }).returning();

  // Target row's own issued trip (CREATED — reassignable, driver not acknowledged),
  // originally riding a DIFFERENT truck so the reassign is a real change.
  const [trailerB] = await db.insert(s.trailers).values({
    licensePlate: `${TAG}-R2`, type: '20FT',
  }).returning();
  const [truckB] = await db.insert(s.trucks).values({
    licensePlate: `${TAG}-B`, currentTrailerId: trailerB.id, trailerType: '20FT',
  }).returning();
  const [driverUserB] = await db.insert(s.users).values({
    username: 'qafb038mm-drv2', passwordHash: 'test-only', role: Role.DRIVER,
  }).returning();
  const [driverB] = await db.insert(s.drivers).values({
    userId: driverUserB.id, name: `${TAG} lái xe B`, assignedTruckId: truckB.id,
  }).returning();
  await db.insert(s.truckDriverAssignments).values({ truckId: truckB.id, driverId: driverB.id });
  const [targetTrip] = await db.insert(s.trips).values({
    customerId: customer.id,
    shipmentId: shipment.id,
    routeId: route.id,
    truckId: truckB.id,
    driverId: driverB.id,
    fulfillmentId: fulfillment.id,
    departureDate: targetStart.toISOString().slice(0, 10),
    plannedStartAt: targetStart,
    plannedEndAt: targetEnd,
    status: 'CREATED',
    version: 1,
  }).returning();
  await db.insert(s.tripContainers).values({
    tripId: targetTrip.id,
    containerTypeId: ctype.id,
    containerNumber: container.containerNumber,
  });

  // The conflicting running trip: same truck, ACTIVE, NO plannedEndAt (the hole).
  const [conflictTrip] = await db.insert(s.trips).values({
    customerId: customer.id,
    routeId: route.id,
    truckId: truck.id,
    driverId: driver.id,
    departureDate: conflictStart.toISOString().slice(0, 10),
    plannedStartAt: conflictStart,
    plannedEndAt: null,
    status: 'IN_TRANSIT',
    version: 1,
  }).returning();

  console.log(JSON.stringify({
    tag: TAG,
    shipmentId: shipment.id, shipmentCode: shipment.shipmentCode,
    fulfillmentId: fulfillment.id,
    targetTripId: targetTrip.id, targetTripVersion: targetTrip.version,
    conflictTripId: conflictTrip.id,
    truckId: truck.id, plate: truck.licensePlate,
    driverId: driver.id, driverName: driver.name,
    targetStart: targetStart.toISOString(), targetEnd: targetEnd.toISOString(),
    conflictStart: conflictStart.toISOString(),
  }, null, 2));
  await pool.end();
}

main().catch(async (err) => { console.error(err); process.exit(1); });
void crypto;
