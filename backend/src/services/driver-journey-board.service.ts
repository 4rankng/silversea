import { and, desc, eq, inArray, isNull, aliasedTable } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

// Driver-app spec (260827) "Hành trình" screen: unlike work-inbox.service's
// driverWorkInbox (one row per trip, state-keyed for the shared RoleWorkInbox
// component used by driver/ops/customer alike), this is a driver-only,
// purpose-built board with exactly the Layer-1 summary-card fields the spec
// calls for, bucketed into the spec's three literal tabs. Deliberately
// separate from driverWorkInbox — zero risk to that shared query or its
// existing callers/tests.
export type DriverJourneyBucket = 'NEW' | 'RUNNING' | 'HISTORY';
export type DriverJourneyClassification = 'SINGLE' | 'CLAMP';

export interface DriverJourneyCard {
  fulfillmentId: number;
  tripId: number;
  shipmentId: number;
  tripCode: string | null;
  shipmentCode: string | null;
  bucket: DriverJourneyBucket;
  classification: DriverJourneyClassification;
  scheduledAt: string | null;
  factoryName: string | null;
  loadingPortName: string | null;
  routeName: string | null;
  dropPortName: string | null;
  containerNumber: string | null;
  containerTypeName: string | null;
}

function bucketForStatus(status: typeof s.trips.$inferSelect.status): DriverJourneyBucket {
  if (status === 'COMPLETED') return 'HISTORY';
  if (status === 'IN_TRANSIT') return 'RUNNING';
  return 'NEW';
}

/**
 * One card per driver-owned fulfillment (CREATED/IN_TRANSIT/COMPLETED,
 * non-canceled). A shipment marked `isCombined` with 2+ of the driver's own
 * fulfillments sharing it (the "kẹp" case — this system models multiple
 * containers on a combined order as sibling fulfillments/trips sharing one
 * shipment, not multiple trip_containers rows on a single trip) is tagged
 * CLAMP so the frontend renders its cards linked; everything else is SINGLE.
 */
export async function getDriverJourneyBoard(driverId: number): Promise<DriverJourneyCard[]> {
  const pickupPort = aliasedTable(s.ports, 'journey_pickup_port');
  const dropoffPort = aliasedTable(s.ports, 'journey_dropoff_port');
  const containerFactory = aliasedTable(s.operationalSites, 'journey_container_factory');

  const rows = await db.select({
    fulfillmentId: s.trips.fulfillmentId,
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    plannedStartAt: s.trips.plannedStartAt,
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    isCombined: s.shipments.isCombined,
    factoryName: s.shipments.factoryName,
    pickupLocation: s.shipments.pickupLocation,
    deliveryLocation: s.shipments.deliveryLocation,
    routeName: s.routes.name,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeName: s.containerTypes.name,
    containerPickupPortName: pickupPort.name,
    containerDropoffPortName: dropoffPort.name,
    containerFactoryName: containerFactory.name,
  }).from(s.trips)
    .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .leftJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .leftJoin(pickupPort, eq(pickupPort.id, s.shipmentContainers.pickupPortId))
    .leftJoin(dropoffPort, eq(dropoffPort.id, s.shipmentContainers.dropoffPortId))
    .leftJoin(containerFactory, eq(containerFactory.id, s.shipmentContainers.operationalSiteId))
    .where(and(
      eq(s.trips.driverId, driverId),
      isNull(s.trips.deletedAt),
      isNull(s.shipmentFulfillments.canceledAt),
      inArray(s.trips.status, ['CREATED', 'IN_TRANSIT', 'COMPLETED']),
    ))
    .orderBy(desc(s.trips.plannedStartAt));

  const shipmentCardCounts = new Map<number, number>();
  for (const row of rows) {
    shipmentCardCounts.set(row.shipmentId, (shipmentCardCounts.get(row.shipmentId) ?? 0) + 1);
  }

  return rows
    .filter((row): row is typeof row & { fulfillmentId: number } => row.fulfillmentId != null)
    .map((row) => ({
      fulfillmentId: row.fulfillmentId,
      tripId: row.tripId,
      shipmentId: row.shipmentId,
      tripCode: row.tripCode,
      shipmentCode: row.shipmentCode,
      bucket: bucketForStatus(row.tripStatus),
      classification: row.isCombined && (shipmentCardCounts.get(row.shipmentId) ?? 0) >= 2 ? 'CLAMP' : 'SINGLE',
      scheduledAt: row.plannedStartAt?.toISOString() ?? null,
      factoryName: row.factoryName ?? row.containerFactoryName,
      loadingPortName: row.pickupLocation ?? row.containerPickupPortName,
      routeName: row.routeName,
      dropPortName: row.deliveryLocation ?? row.containerDropoffPortName,
      containerNumber: row.containerNumber,
      containerTypeName: row.containerTypeName,
    }));
}
