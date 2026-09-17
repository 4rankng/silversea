import { and, desc, eq, inArray, isNull, aliasedTable, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';
import { listDispatchTaskTags } from './dispatch-task-tags.service';
import { readSnapshotDeliverySiteName, resolveDeliveryStage } from './delivery-stage';
import { getDriverCompletionEvidenceStatus } from './trip-pod.service';

// Driver-app spec (260827) "Hành trình" screen: unlike work-inbox.service's
// driverWorkInbox (one row per trip, state-keyed for the shared RoleWorkInbox
// component used by driver/ops/customer alike), this is a driver-only,
// purpose-built board with exactly the Layer-1 summary-card fields the spec
// calls for, bucketed into the spec's three literal tabs. Deliberately
// separate from driverWorkInbox — zero risk to that shared query or its
// existing callers/tests.
export type DriverJourneyBucket = 'NEW' | 'RUNNING' | 'HISTORY';
// Spec tags are ĐƠN/KẸP/KẾT HỢP (+LCL's LẺ): the raw fulfillment-owned
// dispatchClassification carries that label; `linked` carries the pairing
// signal (kẹp/kết-hợp cards stick together), derived below from the shipment.
export type DriverJourneyClassification = 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL';

export interface DriverJourneyCard {
  fulfillmentId: number;
  tripId: number;
  shipmentId: number;
  tripCode: string | null;
  shipmentCode: string | null;
  /** Lệnh chạy ngoài (MDN §4.4) — drives the "Chạy ngoài" label on the card. */
  isAdHoc: boolean;
  bucket: DriverJourneyBucket;
  classification: DriverJourneyClassification;
  linked: boolean;
  /** ACTIVE trip-pair this card's trip belongs to (kẹp/kết-hợp grouping). */
  pairId: number | null;
  pairKind: 'KEP' | 'KET_HOP' | null;
  pairOrder: 1 | 2 | null;
  /**
   * KẾT HỢP sequencing lock (TC-GHEP-010): true on the second card while the
   * first order is still unfinished — the app shows it locked and the progress
   * endpoint rejects with a Vietnamese explanation until Lệnh 1 completes.
   */
  pairLocked: boolean;
  scheduledAt: string | null;
  /** Completion date for history; legacy records fall back to their trip date. */
  historyAt: string | null;
  factoryName: string | null;
  factoryShortName: string | null;
  // 3a0bd5af: factory site street address, kept for detail; the card uses routeName.
  factoryAddress: string | null;
  loadingPortName: string | null;
  routeName: string | null;
  dropPortName: string | null;
  /** Canonical container dropoff port for IMPORT, including same-place delivery;
   *  for other directions only a distinct return stage is exposed. */
  returnDepotName: string | null;
  containerNumber: string | null;
  containerTypeName: string | null;
  sealNumber: string | null;
  // 3a0bd5af: loại hình cell — the trip's LAST leg ĐÓNG/TRẢ (destination
  // semantics, same rule the billing draft applies); null when no legs.
  loadingType: string | null;
  // shipments.trade_direction — drives the card's container-row 3rd column
  // (EXPORT → ĐÓNG, IMPORT → TRẢ, null → '—'). The handling-type loadingType
  // (HANG/VO) is a different axis and must not drive that pill.
  tradeDirection: string | null;
  contactName: string | null;
  contactPhone: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  operationalNotes: string | null;
}

/**
 * Completed trips appear in History. For an acknowledged IN_TRANSIT trip,
 * complete submitted evidence also makes the card historical; finance
 * readiness is independent from the driver's evidence workflow.
 */
function bucketForStatus(
  status: typeof s.trips.$inferSelect.status,
  evidenceReady: boolean,
  acknowledged: boolean,
): DriverJourneyBucket {
  if (status === 'COMPLETED') return 'HISTORY';
  if (status === 'IN_TRANSIT') {
    // Docx4 BUG2: ops "Phát lệnh" can flip a trip to IN_TRANSIT before the
    // driver acknowledges (the same premise as the reassignment relaxation).
    // Status alone must not mark the order "Đã nhận" — without the driver's
    // ORDER_RECEIVED milestone the card belongs in Lệnh mới so the accept
    // bar stays reachable.
    if (!acknowledged) return 'NEW';
    return evidenceReady ? 'HISTORY' : 'RUNNING';
  }
  return 'NEW';
}

/**
 * One card per driver-owned fulfillment (CREATED/IN_TRANSIT/COMPLETED,
 * non-canceled). A shipment marked `isCombined` with 2+ of the driver's own
 * fulfillments sharing it (the "kẹp" case — this system models multiple
 * containers on a combined order as sibling fulfillments/trips sharing one
 * shipment, not multiple trip_containers rows on a single trip) sets
 * `linked` so the frontend renders its cards stuck together; the tag itself
 * is the fulfillment's own dispatchClassification (ĐƠN/KẸP/KẾT HỢP/LẺ).
 */
/**
 * The board response embeds the operation-tag pool the driver page needs to
 * resolve shipments.operationalNotes into chips — one round-trip instead of
 * a second tag-pool fetch (ticket 53a536f9), which also lets the driver
 * portal drop its pages→detailed-plan imports (the M1 coupling).
 */
export interface DriverJourneyBoard {
  items: DriverJourneyCard[];
  knownTagLabels: string[];
}

export async function getDriverJourneyBoard(driverId: number): Promise<DriverJourneyBoard> {
  const pickupPort = aliasedTable(s.ports, 'journey_pickup_port');
  const dropoffPort = aliasedTable(s.ports, 'journey_dropoff_port');
  const containerFactory = aliasedTable(s.operationalSites, 'journey_container_factory');

  // Tags ride along in parallel with the card query; same source query the
  // composer uses, so the canonical display_order ordering comes free.
  const tagsPromise = listDispatchTaskTags();
  const rows = await db.select({
    fulfillmentId: s.trips.fulfillmentId,
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    activeTripPairId: s.trips.activeTripPairId,
    activeTripPairOrder: s.trips.activeTripPairOrder,
    plannedStartAt: s.trips.plannedStartAt,
    completedAt: s.trips.completedAt,
    departureDate: s.trips.departureDate,
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    isAdHoc: s.shipments.isAdHoc,
    isCombined: s.shipments.isCombined,
    dispatchClassification: s.shipmentFulfillments.dispatchClassification,
    siteSnapshot: s.shipmentFulfillments.siteSnapshot,
    factoryName: s.shipments.factoryName,
    operationalNotes: s.shipments.operationalNotes,
    pickupLocation: s.shipments.pickupLocation,
    deliveryLocation: s.shipments.deliveryLocation,
    routeName: s.routes.name,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeName: s.containerTypes.name,
    sealNumber: s.shipmentContainers.sealNumber,
    // 3a0bd5af: HÀNG ĐÓNG/TRẢ badge source — the trip's last leg loadingType.
    // Scalar subquery keeps one row per fulfillment (a trip_legs join would
    // fan out multi-leg trips into duplicate cards).
    loadingType: sql<string | null>`(
      select tl.loading_type
      from ${s.tripLegs} tl
      where tl.trip_id = ${s.trips.id}
      order by tl.sequence desc
      limit 1
    )`,
    tradeDirection: s.shipments.tradeDirection,
    contactName: s.shipments.contactName,
    contactPhone: s.shipments.contactPhone,
    truckPlate: s.trucks.licensePlate,
    trailerPlate: s.trailers.licensePlate,
    containerPickupPortName: pickupPort.name,
    containerDropoffPortName: dropoffPort.name,
    containerFactoryName: containerFactory.name,
    // Factory address is retained separately from the configured route name.
    containerFactoryAddress: containerFactory.address,
    // Blank-safe site label: operational_sites.short_name is notNull with ''
    // default, so a raw ?? fallback would never fire on unfilled rows.
    containerFactoryShortName: operationalName(containerFactory.shortName, containerFactory.name),
  }).from(s.trips)
    .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .leftJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.trailers, eq(s.trailers.id, s.trucks.currentTrailerId))
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

  // Only IN_TRANSIT trips can possibly need the readiness check (CREATED
  // hasn't started; COMPLETED is already HISTORY) — skip the extra query for
  // everything else. The acknowledgement lookup shares the same filter: only
  // an IN_TRANSIT trip can carry an ORDER_RECEIVED milestone (recording it
  // is what flips CREATED → IN_TRANSIT on the driver path, and the
  // reassignment guard keeps accepted trips from changing drivers).
  const inTransitRows = rows.filter((row) => row.tripStatus === 'IN_TRANSIT');
  const evidenceByTripId = new Map<number, boolean>();
  await Promise.all(
    inTransitRows.map(async (row) => {
      const status = await getDriverCompletionEvidenceStatus(row.tripId);
      evidenceByTripId.set(row.tripId, status.ready);
    }),
  );
  const acknowledgedTripIds = new Set(
    inTransitRows.length === 0 ? [] : (await db.select({ tripId: s.driverProgressEvents.tripId })
      .from(s.driverProgressEvents)
      .where(and(
        inArray(s.driverProgressEvents.tripId, inTransitRows.map((row) => row.tripId)),
        eq(s.driverProgressEvents.eventType, 'ORDER_RECEIVED'),
      ))).map((row) => row.tripId),
  );

  // Ghép chuyến pairs (kẹp/kết-hợp): ACTIVE pairs drive grouping + tags. KẾT
  // HỢP additionally locks the second card until the first order is finished
  // (COMPLETED or evidence-ready — the same signal the buckets use).
  const pairIds = [...new Set(rows.flatMap((row) => (row.activeTripPairId != null ? [row.activeTripPairId] : [])))];
  const pairById = new Map<number, { pairKind: string; status: string; firstTripId: number; secondTripId: number }>();
  if (pairIds.length > 0) {
    const pairRows = await db.select({
      id: s.tripPairs.id,
      pairKind: s.tripPairs.pairKind,
      status: s.tripPairs.status,
      firstTripId: s.tripPairs.firstTripId,
      secondTripId: s.tripPairs.secondTripId,
    }).from(s.tripPairs).where(inArray(s.tripPairs.id, pairIds));
    for (const pair of pairRows) pairById.set(pair.id, pair);
  }
  const statusByTripId = new Map(rows.map((row) => [row.tripId, row.tripStatus]));
  const isTripFinished = (tripId: number): boolean =>
    statusByTripId.get(tripId) === 'COMPLETED'
    || (evidenceByTripId.get(tripId) ?? false);

  const cards: DriverJourneyCard[] = rows
    .filter((row): row is typeof row & { fulfillmentId: number } => row.fulfillmentId != null)
    .map((row) => {
      const pair = row.activeTripPairId != null ? pairById.get(row.activeTripPairId) : undefined;
      const pairActive = pair?.status === 'ACTIVE';
      const pairOrder = pairActive && row.activeTripPairOrder === 2 ? 2
        : pairActive && row.activeTripPairOrder === 1 ? 1
        : null;
      const firstTripId = pair?.firstTripId ?? null;
      // One delivery-stage chain shared with the driver detail and the CUS
      // ledger cell (delivery-stage.ts); stage 2 names the empty-container
      // return depot when it differs from the delivery point.
      const deliveryStage = resolveDeliveryStage(
        readSnapshotDeliverySiteName(row.siteSnapshot),
        row.deliveryLocation,
        row.containerDropoffPortName,
        row.tradeDirection,
      );
      return {
      fulfillmentId: row.fulfillmentId,
      tripId: row.tripId,
      shipmentId: row.shipmentId,
      tripCode: row.tripCode,
      shipmentCode: row.shipmentCode,
      isAdHoc: row.isAdHoc,
      bucket: bucketForStatus(
        row.tripStatus,
        evidenceByTripId.get(row.tripId) ?? false,
        acknowledgedTripIds.has(row.tripId),
      ),
      classification: row.dispatchClassification,
      linked: pairActive || (row.isCombined && (shipmentCardCounts.get(row.shipmentId) ?? 0) >= 2),
      pairId: pairActive && row.activeTripPairId != null ? row.activeTripPairId : null,
      pairKind: pairActive ? (pair!.pairKind as 'KEP' | 'KET_HOP') : null,
      pairOrder,
      pairLocked: pairActive
        && pair!.pairKind === 'KET_HOP'
        && pairOrder === 2
        && firstTripId != null
        && !isTripFinished(firstTripId),
      scheduledAt: row.plannedStartAt?.toISOString() ?? null,
      historyAt: row.completedAt?.toISOString() ?? row.plannedStartAt?.toISOString() ?? `${row.departureDate}T00:00:00+07:00`,
      factoryName: row.factoryName ?? row.containerFactoryName,
      factoryShortName: row.containerFactoryShortName ?? row.factoryName,
      factoryAddress: row.containerFactoryAddress,
      loadingPortName: row.pickupLocation ?? row.containerPickupPortName,
      routeName: row.routeName,
      dropPortName: deliveryStage.deliveryName,
      // IMPORT Hạ is the configured empty return port, including when it
      // equals the delivery label. Never infer it from a delivery factory.
      returnDepotName: row.tradeDirection === 'IMPORT'
        ? (row.containerDropoffPortName?.trim() || null)
        : deliveryStage.returnDepotName,
      containerNumber: row.containerNumber,
      containerTypeName: row.containerTypeName,
      sealNumber: row.sealNumber,
      loadingType: row.loadingType,
      tradeDirection: row.tradeDirection,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      truckPlate: row.truckPlate,
      trailerPlate: row.trailerPlate,
      operationalNotes: row.operationalNotes,
    };
  });

  const { items: tagRows } = await tagsPromise;
  return { items: cards, knownTagLabels: tagRows.map((tag) => tag.label) };
}
