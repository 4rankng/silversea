/**
 * dispatch-planning queries — handoff/queue/fleet list reads.
 * Extracted from dispatch-planning.service.ts (structure-only split, no behavior change).
 * Layering: utils <- queries <- detail; utils <- commands <- detail (keep acyclic).
 */
import { DispatchFleetResource, shipmentQSearchPredicate } from './dispatch-planning-utils.service';
import { CUSTOMER_OPERATIONAL_NAME, ROUTE_OPERATIONAL_NAME, SITE_OPERATIONAL_NAME, DispatchQueueStatus, Tx, addCalendarDays, assertDispatchReadActor, buildPattern, dispatchDetailTransportDateSql, dispatchEffectiveRouteIdSql, encodeDescendingIdCursor, encodeFleetCursor, inferredVehicleCapacityKg, loadDeclarationNumbers, loadPickupSites, normalizeDate, normalizeDispatchHandoffStatuses, normalizeLimit, parseCursor, parseFleetCursor, redactDispatchSiteForAccountant, requireAccountantDispatchScope, routeServiceDurationMinutes, sumSelectedStatusCounts, toFrozenSiteSummary, unaccentedIlike, unaccentedIlikeLike } from './dispatch-planning-utils.service';
import { db } from '../db';
import { ApiError } from '../errors';
import { resolveHandoff } from './dispatch-handoff.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { persistNotificationInTx, sendNotificationPush, type NotificationPayload } from './notification.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import { transitionShipmentStatus } from './shipment.service';
import { createTrip } from './trip-mutations.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { operationalName } from '../db/master-data-name';
import { escapeLikeTerm } from '../lib/format';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, NotificationType, Role, TripStatus, type DispatchClassification, type FuelMode, type TruckSuggestion } from '@tingting/shared';

import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import type { AuthUser } from '../middleware/auth';



export interface ListDispatchHandoffsInput {
  actor: AuthUser;
  cursor?: string | null;
  limit?: number;
  status?: Array<'UNSEEN' | 'SEEN'>;
  urgency?: 'NORMAL' | 'URGENT';
  q?: string;
  date?: string;
}


export interface ListDispatchQueueInput {
  actor: AuthUser;
  cursor?: string | null;
  limit?: number;
  status?: Array<'READY' | 'DISPATCHED'>;
  urgency?: 'NORMAL' | 'URGENT';
  q?: string;
  date?: string;
}


export interface ListDispatchFleetInput {
  actor: AuthUser;
  resource: DispatchFleetResource;
  carrierId?: number;
  cursor?: string | null;
  limit?: number;
  q?: string;
  /** Target row context for own-truck suggestions (resource=TRUCK only). */
  fulfillmentId?: number;
}


export async function listDispatchHandoffs(input: ListDispatchHandoffsInput) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const cursor = parseCursor(input.cursor, 'dispatch-handoffs');
  const limit = normalizeLimit(input.limit, 50);
  const statuses = normalizeDispatchHandoffStatuses(input.status);
  const qPattern = buildPattern(input.q);
  const date = normalizeDate(input.date);

  // Filter set shared by the page query and the status-count query so the
  // two can never skew apart (count must describe the same filtered set).
  const filters = [
    eq(s.shipments.status, 'READY_FOR_DISPATCH'),
    accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
    input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
    date ? eq(sql`date(${s.dispatchHandoffs.vehicleNeededBy})`, date) : undefined,
    shipmentQSearchPredicate(qPattern),
  ];

  return db.transaction(async (tx) => {
    const rows = await tx.select({
      handoffId: s.dispatchHandoffs.id,
      version: s.dispatchHandoffs.version,
      status: s.dispatchHandoffs.status,
      shipmentId: s.shipments.id,
      shipmentVersion: s.shipments.version,
      priority: s.dispatchHandoffs.priority,
      vehicleNeededBy: s.dispatchHandoffs.vehicleNeededBy,
      operationalNote: s.dispatchHandoffs.operationalNote,
      dispatchedAt: s.dispatchHandoffs.dispatchedAt,
      seenAt: s.dispatchHandoffs.seenAt,
      shipmentCode: s.shipments.shipmentCode,
      bookingRef: s.shipments.bookingRef,
      blNumber: s.shipments.blNumber,
      cargoMode: s.shipments.cargoMode,
      closingAt: s.shipments.closingAt,
      plannedReturnAt: s.shipments.plannedReturnAt,
      customsCutoffAt: s.shipments.customsCutoffAt,
      shipmentOperationalNotes: s.shipments.operationalNotes,
      operationalSiteId: s.shipments.operationalSiteId,
      pickupWarehouseSiteId: s.shipments.pickupWarehouseSiteId,
      customerId: s.customers.id,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeId: s.routes.id,
      routeName: ROUTE_OPERATIONAL_NAME,
      routeDistanceKm: s.routes.distanceKm,
    }).from(s.dispatchHandoffs)
      .innerJoin(s.shipments, eq(s.dispatchHandoffs.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
      .where(and(
        // Shared filter set — the status-count query below reuses `filters`
        // so the two can never skew apart.
        ...filters,
        inArray(s.dispatchHandoffs.status, statuses),
        cursor ? lt(s.dispatchHandoffs.id, cursor) : undefined,
      ))
      .orderBy(desc(s.dispatchHandoffs.id))
      .limit(limit + 1);

    const shipmentIds = rows.map((row) => row.shipmentId);
    const declarations = await loadDeclarationNumbers(tx, shipmentIds);
    const pickupSites = await loadPickupSites(
      tx,
      rows.map((row) => row.pickupWarehouseSiteId).filter((id): id is number => id != null),
    );
    const containerRows = shipmentIds.length === 0
      ? []
      : await tx.select({
        shipmentId: s.shipmentContainers.shipmentId,
        containerNumber: s.shipmentContainers.containerNumber,
      }).from(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, [...new Set(shipmentIds)]));
    const containerMap = new Map<number, string[]>();
    for (const row of containerRows) {
      const value = row.containerNumber?.trim();
      if (!value) continue;
      const bucket = containerMap.get(row.shipmentId) ?? [];
      bucket.push(value);
      containerMap.set(row.shipmentId, bucket);
    }
    const [statusCounts] = await tx.select({
      unseen: sql<number>`count(*) filter (where ${s.dispatchHandoffs.status} = 'UNSEEN')`,
      seen: sql<number>`count(*) filter (where ${s.dispatchHandoffs.status} = 'SEEN')`,
    }).from(s.dispatchHandoffs)
      .innerJoin(s.shipments, eq(s.dispatchHandoffs.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .where(and(...filters));
    const unseenCount = Number(statusCounts?.unseen ?? 0);
    const seenCount = Number(statusCounts?.seen ?? 0);
    const total = sumSelectedStatusCounts(statuses, {
      UNSEEN: unseenCount,
      SEEN: seenCount,
    });

    const pageRows = rows.slice(0, limit);
    return {
      items: pageRows.map((row) => ({
        handoffId: row.handoffId,
        version: row.version,
        status: row.status,
        shipmentId: row.shipmentId,
        shipmentVersion: row.shipmentVersion,
        urgency: row.priority,
        vehicleNeededBy: row.vehicleNeededBy?.toISOString() ?? null,
        operationalNote: input.actor.role === Role.ACCOUNTANT ? null : row.operationalNote,
        dispatchedAt: row.dispatchedAt.toISOString(),
        seenAt: row.seenAt?.toISOString() ?? null,
        customer: { id: row.customerId, name: row.customerName },
        route: {
          id: row.routeId,
          name: row.routeName,
          distanceKm: row.routeDistanceKm,
          serviceDurationMinutes: routeServiceDurationMinutes(row.routeDistanceKm),
        },
        shipment: {
          code: row.shipmentCode,
          bookingRef: row.bookingRef,
          blNumber: row.blNumber,
          cargoMode: row.cargoMode,
          declarationNumbers: declarations.get(row.shipmentId) ?? [],
          closingAt: row.closingAt?.toISOString() ?? null,
          plannedReturnAt: row.plannedReturnAt?.toISOString() ?? null,
          customsCutoffAt: row.customsCutoffAt?.toISOString() ?? null,
          operationalNotes: input.actor.role === Role.ACCOUNTANT ? null : row.shipmentOperationalNotes,
        },
        operationalSite: row.operationalSiteId ? { id: row.operationalSiteId } : null,
        pickupWarehouse: row.pickupWarehouseSiteId
          ? (() => {
            const site = pickupSites.get(row.pickupWarehouseSiteId);
            if (!site) {
              return redactDispatchSiteForAccountant(input.actor, {
                id: row.pickupWarehouseSiteId,
                name: null,
                address: null,
                googleMapsUrl: null,
                strictRules: null,
              });
            }
            return redactDispatchSiteForAccountant(input.actor, {
              id: site.id,
              name: site.shortName || site.name,
              address: site.address,
              googleMapsUrl: site.googleMapsUrl,
              strictRules: site.strictRules,
            });
          })()
          : null,
        summary: {
          containerNumbers: containerMap.get(row.shipmentId) ?? [],
          lclLabel: row.cargoMode === CARGO_MODE.LCL ? 'Lô hàng lẻ' : null,
        },
      })),
      total,
      limit,
      nextCursor: rows.length > limit ? encodeDescendingIdCursor('dispatch-handoffs', pageRows.at(-1)!.handoffId) : null,
      unseenCount,
      seenCount,
    };
  });
}


export async function listDispatchQueue(input: ListDispatchQueueInput) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const cursor = parseCursor(input.cursor, 'dispatch-queue');
  const limit = normalizeLimit(input.limit, 50);
  const qPattern = buildPattern(input.q);
  const date = normalizeDate(input.date);
  const statuses: DispatchQueueStatus[] = input.status?.length ? input.status : ['READY', 'DISPATCHED'];

  // Filter set shared by the page query and the status-count query so the
  // two can never skew apart (count must describe the same filtered set).
  const filters = [
    isNull(s.shipmentFulfillments.canceledAt),
    isNotNull(s.dispatchHandoffs.id),
    inArray(s.shipments.status, ['READY_FOR_DISPATCH', 'DISPATCHED']),
    accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
    input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
    date ? eq(dispatchDetailTransportDateSql(), date) : undefined,
    shipmentQSearchPredicate(qPattern, { containerNumber: true }),
  ];

  return db.transaction(async (tx) => {
    const rows = await tx.select({
      fulfillmentId: s.shipmentFulfillments.id,
      fulfillmentVersion: s.shipmentFulfillments.version,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      cargoMode: s.shipmentFulfillments.cargoMode,
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
      shipmentId: s.shipments.id,
      shipmentVersion: s.shipments.version,
      shipmentCode: s.shipments.shipmentCode,
      bookingRef: s.shipments.bookingRef,
      blNumber: s.shipments.blNumber,
      closingAt: s.shipments.closingAt,
      plannedReturnAt: s.shipments.plannedReturnAt,
      customsCutoffAt: s.shipments.customsCutoffAt,
      shipmentOperationalNotes: s.shipments.operationalNotes,
      packageType: s.shipments.packageType,
      packageCount: s.shipments.packageCount,
      cargoWeightKg: s.shipments.cargoWeightKg,
      cargoVolumeCbm: s.shipments.cargoVolumeCbm,
      customerId: s.customers.id,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeId: s.routes.id,
      routeName: ROUTE_OPERATIONAL_NAME,
      routeDistanceKm: s.routes.distanceKm,
      priority: s.dispatchHandoffs.priority,
      handoffId: s.dispatchHandoffs.id,
      handoffVersion: s.dispatchHandoffs.version,
      containerNumber: s.shipmentContainers.containerNumber,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
      shippingLineName: s.shipmentContainers.shippingLineName,
      pickupPortId: s.shipmentContainers.pickupPortId,
      dropoffPortId: s.shipmentContainers.dropoffPortId,
      containerTypeName: s.containerTypes.name,
      containerTypeCode: s.containerTypes.code,
      tripId: s.trips.id,
      tripVersion: s.trips.version,
      tripCode: s.trips.tripCode,
      tripStatus: s.trips.status,
      carrierType: s.trips.carrierType,
      truckId: s.trips.truckId,
      driverId: s.trips.driverId,
      trailerId: s.trips.trailerId,
      plannedStartAt: s.trips.plannedStartAt,
      plannedEndAt: s.trips.plannedEndAt,
      externalEntityId: s.trips.externalEntityId,
      externalEntityType: s.trips.externalEntityType,
      externalPlateNumber: s.trips.externalPlateNumber,
      externalDriverName: s.trips.externalDriverName,
      externalDriverPhone: s.trips.externalDriverPhone,
    }).from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .innerJoin(s.routes, eq(s.routes.id, dispatchEffectiveRouteIdSql()))
      .leftJoin(s.dispatchHandoffs, and(
        eq(s.dispatchHandoffs.shipmentId, s.shipments.id),
        eq(s.dispatchHandoffs.status, 'ACCEPTED'),
        isNull(s.dispatchHandoffs.supersededAt),
      ))
      .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        ne(s.trips.status, TripStatus.CANCELED),
        isNull(s.trips.deletedAt),
      ))
      .where(and(
        ...filters,
        cursor ? lt(s.shipmentFulfillments.id, cursor) : undefined,
        statuses.includes('DISPATCHED') && statuses.includes('READY')
          ? undefined
          : statuses.includes('DISPATCHED')
            ? sql`${s.trips.id} is not null`
            : sql`${s.trips.id} is null`,
      ))
      .orderBy(desc(s.shipmentFulfillments.id))
      .limit(limit + 1);

    const shipmentIds = rows.map((row) => row.shipmentId);
    const declarations = await loadDeclarationNumbers(tx, shipmentIds);
    const truckIds = rows.map((row) => row.truckId).filter((id): id is number => id != null);
    const driverIds = rows.map((row) => row.driverId).filter((id): id is number => id != null);
    const trailerIds = rows.map((row) => row.trailerId).filter((id): id is number => id != null);
    const carrierIds = rows.flatMap((row) => [row.externalEntityId, row.plannedExternalCarrierId]).filter((id): id is number => id != null);
    const portIds = rows.flatMap((row) => [row.pickupPortId, row.dropoffPortId]).filter((id): id is number => id != null);
    const [trucks, drivers, trailers, carriers, ports] = await Promise.all([
      truckIds.length === 0 ? [] : tx.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate }).from(s.trucks).where(inArray(s.trucks.id, [...new Set(truckIds)])),
      driverIds.length === 0 ? [] : tx.select({ id: s.drivers.id, name: s.drivers.name, phone: s.drivers.phone }).from(s.drivers).where(inArray(s.drivers.id, [...new Set(driverIds)])),
      trailerIds.length === 0 ? [] : tx.select({ id: s.trailers.id, licensePlate: s.trailers.licensePlate }).from(s.trailers).where(inArray(s.trailers.id, [...new Set(trailerIds)])),
      carrierIds.length === 0 ? [] : tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME }).from(s.customers).where(inArray(s.customers.id, [...new Set(carrierIds)])),
      portIds.length === 0 ? [] : tx.select({ id: s.ports.id, name: s.ports.name }).from(s.ports).where(inArray(s.ports.id, [...new Set(portIds)])),
    ]);
    const trucksById = new Map(trucks.map((row) => [row.id, row]));
    const driversById = new Map(drivers.map((row) => [row.id, row]));
    const trailersById = new Map(trailers.map((row) => [row.id, row]));
    const carriersById = new Map(carriers.map((row) => [row.id, row]));
    const portsById = new Map(ports.map((row) => [row.id, row]));
    const [filteredCounts] = await tx.select({
      ready: sql<number>`count(*) filter (where ${s.trips.id} is null)`,
      dispatched: sql<number>`count(*) filter (where ${s.trips.id} is not null)`,
    }).from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .innerJoin(s.routes, eq(s.routes.id, dispatchEffectiveRouteIdSql()))
      .leftJoin(s.dispatchHandoffs, and(
        eq(s.dispatchHandoffs.shipmentId, s.shipments.id),
        eq(s.dispatchHandoffs.status, 'ACCEPTED'),
        isNull(s.dispatchHandoffs.supersededAt),
      ))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        ne(s.trips.status, TripStatus.CANCELED),
        isNull(s.trips.deletedAt),
      ))
      .where(and(...filters));
    const filteredReadyCount = Number(filteredCounts?.ready ?? 0);
    const filteredDispatchedCount = Number(filteredCounts?.dispatched ?? 0);
    const total = sumSelectedStatusCounts(statuses, {
      READY: filteredReadyCount,
      DISPATCHED: filteredDispatchedCount,
    });

    const pageRows = rows.slice(0, limit);
    return {
      items: pageRows.map((row) => {
        const snapshot = (row.siteSnapshot ?? {}) as Record<string, unknown>;
        return {
          fulfillmentId: row.fulfillmentId,
          fulfillmentVersion: row.fulfillmentVersion,
          shipmentId: row.shipmentId,
          shipmentVersion: row.shipmentVersion,
          handoffId: row.handoffId,
          handoffVersion: row.handoffVersion,
          taskStatus: row.tripId ? 'DISPATCHED' : 'READY',
          urgency: row.priority ?? 'NORMAL',
          cargoMode: row.cargoMode,
          fulfillmentType: row.fulfillmentType,
          customer: { id: row.customerId, name: row.customerName },
          route: {
            id: row.routeId,
            name: row.routeName,
            distanceKm: row.routeDistanceKm,
            serviceDurationMinutes: routeServiceDurationMinutes(row.routeDistanceKm),
          },
          shipment: {
            code: row.shipmentCode,
            bookingRef: row.bookingRef,
            blNumber: row.blNumber,
            declarationNumbers: declarations.get(row.shipmentId) ?? [],
            closingAt: row.closingAt?.toISOString() ?? null,
            plannedReturnAt: row.plannedReturnAt?.toISOString() ?? null,
            customsCutoffAt: row.customsCutoffAt?.toISOString() ?? null,
            operationalNotes: input.actor.role === Role.ACCOUNTANT ? null : row.shipmentOperationalNotes,
          },
          operationalSite: redactDispatchSiteForAccountant(input.actor, toFrozenSiteSummary(snapshot.deliverySite)),
          pickupWarehouse: redactDispatchSiteForAccountant(input.actor, toFrozenSiteSummary(snapshot.pickupWarehouse)),
          unitSummary: {
            label: row.cargoMode === CARGO_MODE.FCL ? 'Container' : 'Lô hàng lẻ',
            containerNumber: row.containerNumber,
            containerTypeLabel: row.containerTypeName ?? row.containerTypeCode ?? null,
            shippingLineName: row.shippingLineName,
            customerAppointmentAt: row.customerAppointmentAt?.toISOString() ?? null,
            pickupPortName: row.pickupPortId ? portsById.get(row.pickupPortId)?.name ?? null : null,
            dropoffPortName: row.dropoffPortId ? portsById.get(row.dropoffPortId)?.name ?? null : null,
            packageType: row.packageType,
            packageCount: row.packageCount,
            cargoWeightKg: row.cargoWeightKg,
            cargoVolumeCbm: row.cargoVolumeCbm,
          },
          plannedCarrier: row.plannedCarrierType == null ? null : {
            carrierType: row.plannedCarrierType,
            externalCarrierId: row.plannedExternalCarrierId,
            carrierName: row.plannedCarrierType === 'OWN'
              ? 'SilverSea'
              : row.plannedExternalCarrierId
                ? carriersById.get(row.plannedExternalCarrierId)?.name ?? null
                : null,
          },
          dispatch: row.tripId ? {
            tripId: row.tripId,
            tripVersion: row.tripVersion,
            tripCode: row.tripCode,
            tripStatus: row.tripStatus,
            plannedStartAt: row.plannedStartAt?.toISOString() ?? null,
            plannedEndAt: row.plannedEndAt?.toISOString() ?? null,
            carrierType: row.carrierType,
            truckId: row.truckId,
            truckPlate: row.truckId ? trucksById.get(row.truckId)?.licensePlate ?? null : null,
            trailerId: row.trailerId,
            trailerPlate: row.trailerId ? trailersById.get(row.trailerId)?.licensePlate ?? null : null,
            driverId: row.driverId,
            driverName: row.driverId ? driversById.get(row.driverId)?.name ?? null : null,
            externalCarrierId: row.externalEntityId,
            externalCarrierName: row.externalEntityId ? carriersById.get(row.externalEntityId)?.name ?? null : null,
            externalPlateNumber: row.externalPlateNumber,
            externalDriverName: row.externalDriverName,
            externalDriverPhone: input.actor.role === Role.ACCOUNTANT ? null : row.externalDriverPhone,
          } : null,
        };
      }),
      total,
      limit,
      nextCursor: rows.length > limit ? encodeDescendingIdCursor('dispatch-queue', pageRows.at(-1)!.fulfillmentId) : null,
      readyCount: filteredReadyCount,
      dispatchedCount: filteredDispatchedCount,
    };
  });
}

/**
 * Set-based Lạch Huyện D-1/D+1 own-truck suggestions for the fleet picker.
 *
 * For an authorized target fulfillment on date D (shipment expected delivery
 * date, Asia/Ho_Chi_Minh): a truck whose planned work includes an LH dropoff
 * on D-1 gets `D-1_DROP`; an LH pickup on D+1 gets `D+1_PICKUP`. Evidence
 * comes from active planned fulfillments (non-canceled, non-deleted) joined to
 * zoned ports via containers, matched to owned trucks by normalized plate —
 * the fulfillment stores a plate snapshot, not a truck id. Prefer the live
 * trip's `departureDate`, fall back to the shipment's delivery date.
 *
 * Advisory only: reasons never gate eligibility and never expose other
 * shipments/customers. One bounded query for the whole suggestion set — no
 * per-truck lookups.
 */

export async function buildZoneTruckSuggestions(tx: Tx, args: {
  actor: AuthUser;
  fulfillmentId: number;
  qPattern: string | null;
}): Promise<TruckSuggestion[]> {
  const [target] = await tx.select({
    fulfillmentId: s.shipmentFulfillments.id,
    shipmentId: s.shipmentFulfillments.shipmentId,
    deliveryDate: sql<string | null>`coalesce(date(${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh'), ${s.shipments.expectedDeliveryDate})`,
    // Zone of the fulfillment's own container ports (either side) — the
    // suggestion set is scoped to the SAME zone the order touches, whatever
    // cluster that is; no zone is hard-coded. When both ports are zoned
    // differently, prefer the DROPOFF side deterministically: the truck ends
    // D-1 there, which is what the D-1_DROP "ready at zone" tag claims.
    zone: sql<string | null>`(select pz.dispatch_zone from ${s.ports} pz
      where (pz.id = ${s.shipmentContainers.pickupPortId} or pz.id = ${s.shipmentContainers.dropoffPortId})
        and pz.dispatch_zone is not null and pz.deleted_at is null
      order by (pz.id = ${s.shipmentContainers.dropoffPortId}) desc, pz.id asc
      limit 1)`,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
    .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
    .where(and(
      eq(s.shipmentFulfillments.id, args.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
      isNull(s.shipments.deletedAt),
    ))
    .limit(1);
  // Inaccessible/deleted/canceled target → no suggestions, not an error: the
  // picker stays usable while the row context is stale.
  if (!target) return [];
  try {
    await assertActorCanAccessShipment(tx, target.shipmentId, args.actor, { write: true });
  } catch {
    return [];
  }
  if (target.deliveryDate == null || target.zone == null) return [];

  // Planned work date: live trip's departure date when present, else the
  // shipment's expected delivery date. Canceled/deleted trips never count.
  const workDateSql = sql<string>`coalesce(${s.trips.departureDate}, date(${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh'), ${s.shipments.expectedDeliveryDate})`;

  const targetDate = String(target.deliveryDate).slice(0, 10);
  const dayBefore = addCalendarDays(targetDate, -1);
  const dayAfter = addCalendarDays(targetDate, 1);

  // Date-bound evidence in SQL, not just JS: the LIMIT below must never act
  // as a biased sample that silently swallows one side's D-1/D+1 rows.
  const evidence = await tx.select({
    truckId: s.trucks.id,
    plateNumber: s.trucks.licensePlate,
    // Whether the JOINED LH port is the container's dropoff (vs pickup) —
    // with an OR port join this distinguishes which side matched.
    isDropoff: sql<boolean>`(${s.shipmentContainers.dropoffPortId} = ${s.ports.id})`,
    workDate: workDateSql,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
    .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
    .innerJoin(s.ports, and(
      or(
        eq(s.shipmentContainers.dropoffPortId, s.ports.id),
        eq(s.shipmentContainers.pickupPortId, s.ports.id),
      ),
      // Soft-deleted ports stop generating suggestions (facet parity).
      isNull(s.ports.deletedAt),
    ))
    // Canonical plate normalizer on BOTH sides (strip every non-alphanumeric,
    // uppercase) — identical to the write-path `normalizePlate` semantics, so
    // hyphen/space formatting differences never break the match.
    .innerJoin(s.trucks, eq(
      sql`upper(regexp_replace(${s.trucks.licensePlate}, '[^A-Za-z0-9]', '', 'g'))`,
      sql`upper(regexp_replace(${s.shipmentFulfillments.plannedVehiclePlateNumber}, '[^A-Za-z0-9]', '', 'g'))`,
    ))
    .leftJoin(s.trips, and(
      eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
      ne(s.trips.status, TripStatus.CANCELED),
      isNull(s.trips.deletedAt),
    ))
    .where(and(
      isNull(s.shipmentFulfillments.canceledAt),
      isNull(s.shipments.deletedAt),
      eq(s.shipmentFulfillments.plannedCarrierType, 'OWN'),
      sql`${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null`,
      eq(s.ports.dispatchZone, target.zone),
      // Only D-1 / D+1 work dates can ever produce a reason.
      sql`${workDateSql} in (${dayBefore}, ${dayAfter})`,
    ))
    .limit(500);

  const reasonByTruck = new Map<number, { plateNumber: string; reasons: Set<'D-1_DROP' | 'D+1_PICKUP'> }>();
  for (const row of evidence) {
    const workDay = String(row.workDate).slice(0, 10);
    let reason: 'D-1_DROP' | 'D+1_PICKUP' | null = null;
    // Dropoff at LH on D-1 → the truck is near LH the day before.
    if (row.isDropoff && workDay === dayBefore) reason = 'D-1_DROP';
    // Pickup from LH on D+1 → the truck must be at LH the day after.
    if (!row.isDropoff && workDay === dayAfter) reason = 'D+1_PICKUP';
    if (reason == null) continue;
    // Search applies to suggestions too — plate must match the typed query.
    if (args.qPattern) {
      const plateMatch = row.plateNumber != null
        && unaccentedIlikeLike(row.plateNumber, args.qPattern);
      if (!plateMatch) continue;
    }
    const entry = reasonByTruck.get(row.truckId) ?? { plateNumber: row.plateNumber ?? '', reasons: new Set<'D-1_DROP' | 'D+1_PICKUP'>() };
    entry.reasons.add(reason);
    reasonByTruck.set(row.truckId, entry);
  }

  // Merged visible order: both signals, D-1, D+1, then plate tie-break.
  const rank = (reasons: Set<'D-1_DROP' | 'D+1_PICKUP'>) =>
    (reasons.has('D-1_DROP') && reasons.has('D+1_PICKUP') ? 0
      : reasons.has('D-1_DROP') ? 1
      : 2);
  return [...reasonByTruck.entries()]
    .map(([truckId, entry]) => ({
      truckId,
      plateNumber: entry.plateNumber,
      reasons: rank(entry.reasons) === 0
        ? ['D-1_DROP', 'D+1_PICKUP'] as Array<'D-1_DROP' | 'D+1_PICKUP'>
        : [...entry.reasons],
    }))
    .sort((a, b) =>
      rank(new Set(a.reasons)) - rank(new Set(b.reasons))
      || a.plateNumber.localeCompare(b.plateNumber, 'vi'),
    )
    .slice(0, 20);
}

/** Calendar-day arithmetic on YYYY-MM-DD strings, timezone-free. */


export async function listDispatchFleet(input: ListDispatchFleetInput) {
  assertDispatchReadActor(input.actor);
  if (input.actor.role === Role.ACCOUNTANT) {
    throw new ApiError(403, 'Kế toán không được xem đội xe điều phối.');
  }
  const cursor = parseFleetCursor(input.cursor, input.resource);
  const limit = normalizeLimit(input.limit, 100);
  const qPattern = buildPattern(input.q);

  return db.transaction(async (tx) => {
    if (input.resource === 'TRUCK') {
      const truckWhere = and(
        isNull(s.trucks.deletedAt),
        qPattern ? unaccentedIlike(s.trucks.licensePlate, qPattern) : undefined,
        cursor ? or(
          gt(s.trucks.licensePlate, cursor.sortKey),
          and(eq(s.trucks.licensePlate, cursor.sortKey), gt(s.trucks.id, cursor.id)),
        ) : undefined,
      );
      const truckCountWhere = and(
        isNull(s.trucks.deletedAt),
        qPattern ? unaccentedIlike(s.trucks.licensePlate, qPattern) : undefined,
      );
      const [truckTotals, truckRows] = await Promise.all([
        tx.select({ value: count() }).from(s.trucks).where(truckCountWhere),
        tx.select({
          id: s.trucks.id,
          licensePlate: s.trucks.licensePlate,
          trailerType: s.trucks.trailerType,
          currentTrailerId: s.trucks.currentTrailerId,
          status: s.trucks.status,
        }).from(s.trucks)
          .where(truckWhere)
          .orderBy(asc(s.trucks.licensePlate), asc(s.trucks.id))
          .limit(limit + 1),
      ]);
      const pageRows = truckRows.slice(0, limit);
      const trailerIds = pageRows.map((row) => row.currentTrailerId).filter((id): id is number => id != null);
      const truckIds = pageRows.map((row) => row.id);
      const [trailers, assignedDrivers] = await Promise.all([
        trailerIds.length === 0
          ? []
          : tx.select({ id: s.trailers.id, licensePlate: s.trailers.licensePlate })
            .from(s.trailers)
            .where(inArray(s.trailers.id, [...new Set(trailerIds)])),
        truckIds.length === 0
          ? []
          : tx.select({ id: s.drivers.id, name: s.drivers.name, assignedTruckId: s.drivers.assignedTruckId })
            .from(s.drivers)
            .where(and(
              isNull(s.drivers.deletedAt),
              inArray(s.drivers.assignedTruckId, truckIds),
            ))
            .orderBy(asc(s.drivers.id)),
      ]);
      const trailerById = new Map(trailers.map((row) => [row.id, row]));
      const assignedDriverByTruckId = new Map<number, { id: number; name: string }>();
      for (const row of assignedDrivers) {
        if (row.assignedTruckId == null || assignedDriverByTruckId.has(row.assignedTruckId)) continue;
        assignedDriverByTruckId.set(row.assignedTruckId, { id: row.id, name: row.name });
      }

      // Advisory same-zone suggestions ride beside the cursor page — never
      // inside it, so pagination semantics stay byte-compatible for callers.
      const suggestedItems: TruckSuggestion[] = input.fulfillmentId != null
        ? await buildZoneTruckSuggestions(tx, { actor: input.actor, fulfillmentId: input.fulfillmentId, qPattern })
        : [];

      return {
        items: pageRows.map((row) => ({
          id: row.id,
          licensePlate: row.licensePlate,
          trailerType: row.trailerType,
          currentTrailerId: row.currentTrailerId,
          currentTrailerPlate: row.currentTrailerId ? trailerById.get(row.currentTrailerId)?.licensePlate ?? null : null,
          capacityKg: inferredVehicleCapacityKg(row.trailerType),
          status: row.status,
          assignedDriverId: assignedDriverByTruckId.get(row.id)?.id ?? null,
          assignedDriverName: assignedDriverByTruckId.get(row.id)?.name ?? null,
        })),
        suggestedItems,
        total: Number(truckTotals[0]?.value ?? 0),
        limit,
        nextCursor: truckRows.length > limit
          ? encodeFleetCursor('TRUCK', pageRows.at(-1)!.licensePlate, pageRows.at(-1)!.id)
          : null,
      };
    }

    if (input.resource === 'DRIVER') {
      const driverWhere = and(
        isNull(s.drivers.deletedAt),
        qPattern ? unaccentedIlike(s.drivers.name, qPattern) : undefined,
        cursor ? or(
          gt(s.drivers.name, cursor.sortKey),
          and(eq(s.drivers.name, cursor.sortKey), gt(s.drivers.id, cursor.id)),
        ) : undefined,
      );
      const driverCountWhere = and(
        isNull(s.drivers.deletedAt),
        qPattern ? unaccentedIlike(s.drivers.name, qPattern) : undefined,
      );
      const [driverTotals, driverRows] = await Promise.all([
        tx.select({ value: count() }).from(s.drivers).where(driverCountWhere),
        tx.select({
          id: s.drivers.id,
          name: s.drivers.name,
          phone: s.drivers.phone,
          assignedTruckId: s.drivers.assignedTruckId,
          status: s.drivers.status,
          userId: s.drivers.userId,
        }).from(s.drivers)
          .where(driverWhere)
          .orderBy(asc(s.drivers.name), asc(s.drivers.id))
          .limit(limit + 1),
      ]);
      const pageRows = driverRows.slice(0, limit);
      const assignedTruckIds = pageRows.map((row) => row.assignedTruckId).filter((id): id is number => id != null);
      const assignedTrucks = assignedTruckIds.length === 0
        ? []
        : await tx.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate })
          .from(s.trucks)
          .where(inArray(s.trucks.id, [...new Set(assignedTruckIds)]));
      const truckById = new Map(assignedTrucks.map((row) => [row.id, row]));

      return {
        items: pageRows.map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          assignedTruckId: row.assignedTruckId,
          assignedTruckPlate: row.assignedTruckId ? truckById.get(row.assignedTruckId)?.licensePlate ?? null : null,
          status: row.status,
          userId: row.userId,
        })),
        total: Number(driverTotals[0]?.value ?? 0),
        limit,
        nextCursor: driverRows.length > limit
          ? encodeFleetCursor('DRIVER', pageRows.at(-1)!.name, pageRows.at(-1)!.id)
          : null,
      };
    }

    if (input.resource === 'EXTERNAL_VEHICLE') {
      if (!Number.isInteger(input.carrierId) || (input.carrierId ?? 0) < 1) {
        throw new ApiError(400, 'carrierId là bắt buộc khi tải xe của nhà xe.');
      }
      const carrierId = input.carrierId as number;
      const [carrier] = await tx.select({ id: s.customers.id, status: s.customers.status })
        .from(s.customers)
        .where(and(
          eq(s.customers.id, carrierId),
          eq(s.customers.isCarrier, true),
          isNull(s.customers.deletedAt),
        ))
        .limit(1);
      // Detailed plans retain historical carrier assignments. A missing,
      // deleted, non-carrier, or locked record has no assignable live fleet,
      // but is not an error when the dispatcher opens that row's selector.
      if (!carrier || carrier.status !== 'ACTIVE') {
        return { items: [], total: 0, limit, nextCursor: null };
      }
      const vehicleWhere = and(
        eq(s.carrierFleetVehicles.carrierId, carrierId),
        eq(s.carrierFleetVehicles.isActive, true),
        isNull(s.carrierFleetVehicles.deletedAt),
        qPattern ? unaccentedIlike(s.carrierFleetVehicles.licensePlate, qPattern) : undefined,
        cursor ? or(
          gt(s.carrierFleetVehicles.licensePlate, cursor.sortKey),
          and(eq(s.carrierFleetVehicles.licensePlate, cursor.sortKey), gt(s.carrierFleetVehicles.id, cursor.id)),
        ) : undefined,
      );
      const vehicleCountWhere = and(
        eq(s.carrierFleetVehicles.carrierId, carrierId),
        eq(s.carrierFleetVehicles.isActive, true),
        isNull(s.carrierFleetVehicles.deletedAt),
        qPattern ? unaccentedIlike(s.carrierFleetVehicles.licensePlate, qPattern) : undefined,
      );
      const [totals, rows] = await Promise.all([
        tx.select({ value: count() }).from(s.carrierFleetVehicles).where(vehicleCountWhere),
        tx.select({
          id: s.carrierFleetVehicles.id,
          carrierId: s.carrierFleetVehicles.carrierId,
          licensePlate: s.carrierFleetVehicles.licensePlate,
          isActive: s.carrierFleetVehicles.isActive,
        }).from(s.carrierFleetVehicles)
          .where(vehicleWhere)
          .orderBy(asc(s.carrierFleetVehicles.licensePlate), asc(s.carrierFleetVehicles.id))
          .limit(limit + 1),
      ]);
      const pageRows = rows.slice(0, limit);
      return {
        items: pageRows,
        total: Number(totals[0]?.value ?? 0),
        limit,
        nextCursor: rows.length > limit
          ? encodeFleetCursor('EXTERNAL_VEHICLE', pageRows.at(-1)!.licensePlate, pageRows.at(-1)!.id)
          : null,
      };
    }

    const externalCarrierWhere = and(
      eq(s.customers.isCarrier, true),
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
      qPattern ? or(unaccentedIlike(CUSTOMER_OPERATIONAL_NAME, qPattern), unaccentedIlike(s.customers.name, qPattern)) : undefined,
      cursor ? or(
        gt(CUSTOMER_OPERATIONAL_NAME, cursor.sortKey),
        and(eq(CUSTOMER_OPERATIONAL_NAME, cursor.sortKey), gt(s.customers.id, cursor.id)),
      ) : undefined,
    );
    const externalCarrierCountWhere = and(
      eq(s.customers.isCarrier, true),
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
      qPattern ? or(unaccentedIlike(CUSTOMER_OPERATIONAL_NAME, qPattern), unaccentedIlike(s.customers.name, qPattern)) : undefined,
    );
    const [externalCarrierTotals, externalCarrierRows] = await Promise.all([
      tx.select({ value: count() }).from(s.customers).where(externalCarrierCountWhere),
      tx.select({
        id: s.customers.id,
        name: CUSTOMER_OPERATIONAL_NAME,
        isActive: sql<boolean>`${s.customers.status} = 'ACTIVE'`,
      }).from(s.customers)
        .where(externalCarrierWhere)
        .orderBy(asc(CUSTOMER_OPERATIONAL_NAME), asc(s.customers.id))
        .limit(limit + 1),
    ]);
    const pageRows = externalCarrierRows.slice(0, limit);

    return {
      items: pageRows,
      total: Number(externalCarrierTotals[0]?.value ?? 0),
      limit,
      nextCursor: externalCarrierRows.length > limit
        ? encodeFleetCursor('EXTERNAL_CARRIER', pageRows.at(-1)!.name, pageRows.at(-1)!.id)
        : null,
    };
  });
}
