/**
 * Local-dev only UI-regression seeder v2 (flows 09 — TC-GHEP-001..011):
 * UNPAIRED candidate trips so the dispatch-detail "Ghép chuyến" dialog can
 * create pairs through the browser, plus block-case fixtures (40'/20', diff
 * driver, overlapping KET_HOP) and toll fields for the /trip cost readout.
 * Re-runnable; rows tagged PAIRUI are removed first. Never run outside local.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '../src/db';
import * as s from '../src/db/schema';
import { insertTripComposite } from '../src/services/trip-composite.service';

const TAG = 'PAIRUI';
const DAY = '2026-09-07';

async function main() {
  const oldTrips = await db.select({ id: s.trips.id }).from(s.trips).where(like(s.trips.tripCode, `${TAG}-%`));
  const oldTripIds = oldTrips.map((row) => row.id);
  if (oldTripIds.length > 0) {
    await db.update(s.trips).set({ activeTripPairId: null, activeTripPairOrder: null })
      .where(inArray(s.trips.id, oldTripIds));
    await db.delete(s.tripPairs).where(inArray(s.tripPairs.firstTripId, oldTripIds));
    await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.tripId, oldTripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, oldTripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, oldTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, oldTripIds));
    const oldFulfillments = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
      .where(like(s.shipments.bookingRef, `${TAG}-%`));
    if (oldFulfillments.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, oldFulfillments.map((row) => row.id)));
    }
    await db.delete(s.shipmentContainers).where(like(s.shipmentContainers.containerNumber, `${TAG}%`));
    await db.delete(s.shipments).where(like(s.shipments.bookingRef, `${TAG}-%`));
    console.log(`cleaned ${oldTripIds.length} previous trips`);
  }
  if (process.env.CLEAN) {
    console.log('CLEAN mode: exiting');
    return;
  }

  const byUser = async (username: string) =>
    (await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.username, username)).limit(1))[0];
  const laixeUser = await byUser('laixe');
  const thuUser = await byUser('thu');
  if (!laixeUser || !thuUser) throw new Error('seed users laixe/thu missing');

  const driverFor = async (userId: number) =>
    (await db.select({ id: s.drivers.id }).from(s.drivers)
      .where(and(eq(s.drivers.userId, userId), sql`${s.drivers.deletedAt} is null`)).limit(1))[0];
  const laixeDriver = await driverFor(laixeUser.id);
  const thuDriver = await driverFor(thuUser.id);
  if (!laixeDriver || !thuDriver) throw new Error('drivers rows missing for laixe/thu');

  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [cargoType] = await db.select({ id: s.cargoTypes.id }).from(s.cargoTypes).limit(1);
  const [ct20] = await db.select({ id: s.containerTypes.id }).from(s.containerTypes).where(like(s.containerTypes.code, '20%')).limit(1);
  const [ct40] = await db.select({ id: s.containerTypes.id }).from(s.containerTypes).where(like(s.containerTypes.code, '40%')).limit(1);
  const [truck] = await db.select({ id: s.trucks.id }).from(s.trucks).where(sql`${s.trucks.deletedAt} is null`).limit(1);
  if (!customer || !route || !cargoType || !ct20 || !ct40 || !truck) {
    throw new Error('local master data incomplete');
  }

  let made = 0;
  async function mkLô(args: {
    code: string; shell: string; containerTypeId: number;
    window: { start: string; end: string };
    origin: string; destination: string; driverId: number;
    withTolls?: boolean;
  }) {
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
      cargoMode: 'FCL', status: 'DISPATCHED', bookingRef: `${TAG}-${args.code}`,
      factoryName: 'Nhà máy UI Demo',
    }).returning();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerTypeId: args.containerTypeId,
      containerNumber: args.shell, cargoWeightKg: '11000',
      customerAppointmentAt: new Date(args.window.start),
    }).returning();
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL',
      shipmentContainerId: container.id, sourceShipmentVersion: shipment.version,
      plannedCarrierType: 'OWN', siteSnapshot: {}, dispatchClassification: 'SINGLE',
    }).returning();
    const trip = await insertTripComposite(db, {
      tripCode: `${TAG}-${args.code}`,
      customerId: customer.id, truckId: truck.id, driverId: args.driverId,
      routeId: route.id, cargoTypeId: cargoType.id,
      shipmentId: shipment.id, fulfillmentId: fulfillment.id,
      status: 'CREATED', departureDate: DAY, carrierType: 'OWN',
      revenue: '1500000', totalCost: '900000', driverSalary: '350000',
      plannedStartAt: new Date(args.window.start), plannedEndAt: new Date(args.window.end),
      canonicalOrigin: args.origin, canonicalDestination: args.destination,
      cargoWeightKg: '11000', vehicleCapacityKg: '18000',
      ...(args.withTolls ? { tollsStations: 2, tollPerStationApplied: '55000' } : {}),
    });
    made += 1;
    return trip;
  }

  const W = {
    morning: { start: `${DAY}T08:00:00`, end: `${DAY}T12:00:00` },
    afternoon: { start: `${DAY}T13:00:00`, end: `${DAY}T17:00:00` },
    overlapB: { start: `${DAY}T10:00:00`, end: `${DAY}T14:00:00` },
  };
  const out: Record<string, number> = {};

  // KEP success candidates (tolls on, so the UI-created pair shows VETC-once).
  out.kepA = (await mkLô({ code: 'KEP-A', shell: `${TAG}K111111`, containerTypeId: ct20.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: laixeDriver.id, withTolls: true })).id;
  out.kepB = (await mkLô({ code: 'KEP-B', shell: `${TAG}K222222`, containerTypeId: ct20.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: laixeDriver.id, withTolls: true })).id;
  // Block 40'/20'.
  out.forty = (await mkLô({ code: 'BLK-40', shell: `${TAG}F444444`, containerTypeId: ct40.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: laixeDriver.id })).id;
  out.twenty = (await mkLô({ code: 'BLK-20', shell: `${TAG}T555555`, containerTypeId: ct20.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: laixeDriver.id })).id;
  // Diff-driver block (thu vs laixe, same truck, same day).
  out.thuKep = (await mkLô({ code: 'THU-1', shell: `${TAG}U666666`, containerTypeId: ct20.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: thuDriver.id })).id;
  // KET_HOP overlap block (same shell, overlapping windows).
  out.ovA = (await mkLô({ code: 'OVL-A', shell: `${TAG}O777777`, containerTypeId: ct20.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: laixeDriver.id })).id;
  out.ovB = (await mkLô({ code: 'OVL-B', shell: `${TAG}O777777`, containerTypeId: ct20.id, window: W.overlapB, origin: 'Kho Bình Dương', destination: 'Cảng Cát Lái', driverId: laixeDriver.id })).id;
  // KET_HOP success candidates (same shell, sequential).
  out.ketA = (await mkLô({ code: 'KET-A', shell: `${TAG}H888888`, containerTypeId: ct20.id, window: W.morning, origin: 'Cảng Cát Lái', destination: 'Kho Bình Dương', driverId: laixeDriver.id })).id;
  out.ketB = (await mkLô({ code: 'KET-B', shell: `${TAG}H888888`, containerTypeId: ct20.id, window: W.afternoon, origin: 'Kho Bình Dương', destination: 'Cảng Cát Lái', driverId: laixeDriver.id })).id;

  console.log(`✅ seeded ${made} UNPAIRED trips: ${JSON.stringify(out)}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
