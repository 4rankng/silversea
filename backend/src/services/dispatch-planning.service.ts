import { and, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { NotificationType, Role, TripStatus, type FuelMode } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { resolveHandoff } from './dispatch-handoff.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { persistNotificationInTx, sendNotificationPush, type NotificationPayload } from './notification.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { createTrip } from './trip-mutations.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DispatchActor = AuthUser & { role: Role.ADMIN | Role.MANAGER };

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
  limit?: number;
  q?: string;
}

export interface AcceptDispatchHandoffInput {
  shipmentId: number;
  handoffId: number;
  expectedVersion: number;
  actor: DispatchActor;
}

export interface IssueFulfillmentDispatchOrderInput {
  shipmentId: number;
  fulfillmentId: number;
  expectedVersion: number;
  plannedStartAt: string;
  plannedEndAt: string;
  endTimeConfirmed: boolean;
  carrierType: 'OWN' | 'EXTERNAL';
  cargoTypeId?: number | null;
  truckId?: number | null;
  driverId?: number | null;
  trailerId?: number | null;
  containerTypeId?: number | null;
  externalCarrierId?: number | null;
  externalPlateNumber?: string | null;
  externalDriverName?: string | null;
  externalDriverPhone?: string | null;
  fuelMode?: FuelMode;
  idempotencyKey: string;
  actor: DispatchActor;
}

type LiveTripRow = Pick<
  typeof s.trips.$inferSelect,
  | 'id'
  | 'version'
  | 'tripCode'
  | 'status'
  | 'shipmentId'
  | 'fulfillmentId'
  | 'carrierType'
  | 'truckId'
  | 'driverId'
  | 'trailerId'
  | 'plannedStartAt'
  | 'plannedEndAt'
  | 'externalCarrierId'
  | 'externalPlateNumber'
  | 'externalDriverName'
  | 'externalDriverPhone'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
>;

type DispatchHandoffStatus = typeof s.dispatchHandoffs.status.enumValues[number];
type DispatchQueueStatus = 'READY' | 'DISPATCHED';

interface IssueOrderMutationResult {
  fulfillment: typeof s.shipmentFulfillments.$inferSelect;
  trip: LiveTripRow;
  notificationPersisted: boolean;
}

function assertDispatchReadActor(actor: AuthUser): void {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.ACCOUNTANT) {
    throw new ApiError(403, 'Bạn không có quyền xem bảng điều phối.');
  }
}

function assertDispatchActor(actor: AuthUser): asserts actor is DispatchActor {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ điều vận mới có quyền điều xe.');
  }
}

function parseCursor(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
  return value;
}

function normalizeLimit(raw: number | undefined, max: number): number {
  if (raw == null) return max;
  if (!Number.isInteger(raw) || raw < 1 || raw > max) {
    throw new ApiError(400, `limit phải trong khoảng 1-${max}.`);
  }
  return raw;
}

function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(400, 'date phải theo định dạng YYYY-MM-DD.');
  }
  return raw;
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildPattern(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 100) {
    throw new ApiError(400, 'Từ khóa tìm kiếm không được vượt quá 100 ký tự.');
  }
  return `%${escapeLikeTerm(value)}%`;
}

function parseIsoWithZone(value: string, label: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ApiError(400, `${label} phải kèm múi giờ.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${label} không hợp lệ.`);
  }
  return parsed;
}

function trimBounded(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ApiError(400, `${label} không được vượt quá ${maxLength} ký tự.`);
  }
  return trimmed;
}

function inferTrailerTypeFromContainerCode(code: string | null | undefined): '20FT' | '40FT' {
  const normalized = code?.trim().toUpperCase() ?? '';
  return normalized.startsWith('20') ? '20FT' : '40FT';
}

function routeServiceDurationMinutes(): number | null {
  return null;
}

function buildNotificationPayload(trip: Pick<typeof s.trips.$inferSelect, 'id' | 'tripCode' | 'driverId'>): NotificationPayload {
  return {
    type: NotificationType.TRIP_DISPATCHED,
    title: 'Lệnh điều xe mới',
    message: trip.tripCode ? `Chuyến ${trip.tripCode} đã được điều xe` : 'Bạn có lệnh điều xe mới',
    relatedEntityType: 'trips',
    relatedEntityId: trip.id,
    targetDriverId: trip.driverId ?? undefined,
  };
}

async function ensureFulfillmentsInTx(
  tx: Tx,
  shipmentId: number,
  actorId: number,
): Promise<Array<typeof s.shipmentFulfillments.$inferSelect>> {
  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1)
    .for('update');
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  if (shipment.cargoMode !== 'FCL' && shipment.cargoMode !== 'LCL') {
    throw new ApiError(409, 'Lô hàng chưa xác định hình thức FCL/LCL.');
  }

  const existing = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipment.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(s.shipmentFulfillments.id);
  if (existing.length > 0) return existing;

  const containers = await tx.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipment.id))
    .orderBy(s.shipmentContainers.id);
  if (shipment.cargoMode === 'FCL' && containers.length === 0) {
    throw new ApiError(409, 'Lô hàng FCL phải có ít nhất một container.');
  }
  if (shipment.cargoMode === 'LCL' && containers.length > 0) {
    throw new ApiError(409, 'Lô hàng LCL không được có container giả.');
  }

  const siteIds = [shipment.operationalSiteId, shipment.pickupWarehouseSiteId]
    .filter((id): id is number => id != null);
  const sites = siteIds.length === 0
    ? []
    : await tx.select().from(s.operationalSites)
      .where(and(
        inArray(s.operationalSites.id, siteIds),
        eq(s.operationalSites.customerId, shipment.customerId),
        eq(s.operationalSites.isActive, true),
        isNull(s.operationalSites.deletedAt),
      ));
  const bySiteId = new Map(sites.map((site) => [site.id, {
    id: site.id,
    code: site.code,
    name: site.name,
    siteType: site.siteType,
    address: site.address,
    googleMapsUrl: site.googleMapsUrl,
    contactName: site.contactName,
    contactPhone: site.contactPhone,
    liftFeeInvoiceName: site.liftFeeInvoiceName,
    liftFeeInvoiceAddress: site.liftFeeInvoiceAddress,
    liftFeeTaxCode: site.liftFeeTaxCode,
    strictRules: site.strictRules,
    sourceVersion: site.version,
  }]));
  const siteSnapshot = {
    deliverySite: shipment.operationalSiteId ? bySiteId.get(shipment.operationalSiteId) ?? null : null,
    pickupWarehouse: shipment.pickupWarehouseSiteId ? bySiteId.get(shipment.pickupWarehouseSiteId) ?? null : null,
  };

  const values: Array<typeof s.shipmentFulfillments.$inferInsert> = shipment.cargoMode === 'FCL'
    ? containers.map((container) => ({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot,
      createdBy: actorId,
    }))
    : [{
      shipmentId: shipment.id,
      fulfillmentType: 'LCL_SHIPMENT',
      cargoMode: 'LCL',
      shipmentContainerId: null,
      sourceShipmentVersion: shipment.version,
      siteSnapshot,
      createdBy: actorId,
    }];
  return tx.insert(s.shipmentFulfillments).values(values).returning();
}

async function loadPickupSites(tx: Tx, siteIds: number[]) {
  if (siteIds.length === 0) return new Map<number, typeof s.operationalSites.$inferSelect>();
  const rows = await tx.select().from(s.operationalSites)
    .where(inArray(s.operationalSites.id, [...new Set(siteIds)]));
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadDeclarationNumbers(tx: Tx, shipmentIds: number[]) {
  if (shipmentIds.length === 0) return new Map<number, string[]>();
  const rows = await tx.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, [...new Set(shipmentIds)]));
  const result = new Map<number, string[]>();
  for (const row of rows) {
    const value = row.declarationNumber?.trim();
    if (!value) continue;
    const bucket = result.get(row.shipmentId) ?? [];
    bucket.push(value);
    result.set(row.shipmentId, bucket);
  }
  return result;
}

function toFrozenSiteSummary(source: unknown) {
  const site = source && typeof source === 'object' && !Array.isArray(source)
    ? source as Record<string, unknown>
    : null;
  return {
    id: typeof site?.id === 'number' ? site.id : null,
    name: typeof site?.name === 'string' ? site.name : null,
    address: typeof site?.address === 'string' ? site.address : null,
    googleMapsUrl: typeof site?.googleMapsUrl === 'string' ? site.googleMapsUrl : null,
    strictRules: typeof site?.strictRules === 'string' ? site.strictRules : null,
  };
}

export async function listDispatchHandoffs(input: ListDispatchHandoffsInput) {
  assertDispatchReadActor(input.actor);
  const cursor = parseCursor(input.cursor);
  const limit = normalizeLimit(input.limit, 50);
  const statuses: DispatchHandoffStatus[] = input.status?.length ? input.status : ['UNSEEN', 'SEEN'];
  const qPattern = buildPattern(input.q);
  const date = normalizeDate(input.date);

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
      customerName: s.customers.name,
      routeId: s.routes.id,
      routeName: s.routes.name,
      routeDistanceKm: s.routes.distanceKm,
    }).from(s.dispatchHandoffs)
      .innerJoin(s.shipments, eq(s.dispatchHandoffs.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
      .where(and(
        inArray(s.dispatchHandoffs.status, statuses),
        cursor ? lt(s.dispatchHandoffs.id, cursor) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(sql`date(${s.dispatchHandoffs.vehicleNeededBy})`, date) : undefined,
        qPattern ? or(
          ilike(s.customers.name, qPattern),
          ilike(s.shipments.shipmentCode, qPattern),
          ilike(s.shipments.bookingRef, qPattern),
          ilike(s.shipments.blNumber, qPattern),
        ) : undefined,
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
    const [unseenRows, seenRows] = await Promise.all([
      tx.select({ total: count() }).from(s.dispatchHandoffs).where(eq(s.dispatchHandoffs.status, 'UNSEEN')),
      tx.select({ total: count() }).from(s.dispatchHandoffs).where(eq(s.dispatchHandoffs.status, 'SEEN')),
    ]);
    const unseenCount = Number(unseenRows[0]?.total ?? 0);
    const seenCount = Number(seenRows[0]?.total ?? 0);

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
        operationalNote: row.operationalNote,
        dispatchedAt: row.dispatchedAt.toISOString(),
        seenAt: row.seenAt?.toISOString() ?? null,
        customer: { id: row.customerId, name: row.customerName },
        route: {
          id: row.routeId,
          name: row.routeName,
          distanceKm: row.routeDistanceKm,
          serviceDurationMinutes: routeServiceDurationMinutes(),
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
          operationalNotes: row.shipmentOperationalNotes,
        },
        operationalSite: row.operationalSiteId ? { id: row.operationalSiteId } : null,
        pickupWarehouse: row.pickupWarehouseSiteId
          ? (() => {
            const site = pickupSites.get(row.pickupWarehouseSiteId);
            return site ? {
              id: site.id,
              name: site.name,
              address: site.address,
              googleMapsUrl: site.googleMapsUrl,
              strictRules: site.strictRules,
            } : { id: row.pickupWarehouseSiteId };
          })()
          : null,
        summary: {
          containerNumbers: containerMap.get(row.shipmentId) ?? [],
          lclLabel: row.cargoMode === 'LCL' ? 'Lô hàng lẻ' : null,
        },
      })),
      page: {
        limit,
        nextCursor: rows.length > limit ? String(pageRows.at(-1)!.handoffId) : null,
        total: unseenCount + seenCount,
        unseenCount,
        seenCount,
      },
    };
  });
}

export async function listDispatchQueue(input: ListDispatchQueueInput) {
  assertDispatchReadActor(input.actor);
  const cursor = parseCursor(input.cursor);
  const limit = normalizeLimit(input.limit, 50);
  const qPattern = buildPattern(input.q);
  const date = normalizeDate(input.date);
  const statuses: DispatchQueueStatus[] = input.status?.length ? input.status : ['READY', 'DISPATCHED'];

  return db.transaction(async (tx) => {
    const rows = await tx.select({
      fulfillmentId: s.shipmentFulfillments.id,
      fulfillmentVersion: s.shipmentFulfillments.version,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
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
      customerName: s.customers.name,
      routeId: s.routes.id,
      routeName: s.routes.name,
      routeDistanceKm: s.routes.distanceKm,
      priority: s.dispatchHandoffs.priority,
      handoffId: s.dispatchHandoffs.id,
      handoffVersion: s.dispatchHandoffs.version,
      containerNumber: s.shipmentContainers.containerNumber,
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
      externalCarrierId: s.trips.externalCarrierId,
      externalPlateNumber: s.trips.externalPlateNumber,
      externalDriverName: s.trips.externalDriverName,
      externalDriverPhone: s.trips.externalDriverPhone,
    }).from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
      .leftJoin(s.dispatchHandoffs, and(
        eq(s.dispatchHandoffs.shipmentId, s.shipments.id),
        eq(s.dispatchHandoffs.status, 'ACCEPTED'),
        isNull(s.dispatchHandoffs.supersededAt),
      ))
      .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        ne(s.trips.status, TripStatus.CANCELED),
        isNull(s.trips.deletedAt),
      ))
      .where(and(
        isNull(s.shipmentFulfillments.canceledAt),
        cursor ? lt(s.shipmentFulfillments.id, cursor) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(sql`date(coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}, ${s.shipments.customsCutoffAt}))`, date) : undefined,
        qPattern ? or(
          ilike(s.customers.name, qPattern),
          ilike(s.shipments.shipmentCode, qPattern),
          ilike(s.shipments.bookingRef, qPattern),
          ilike(s.shipments.blNumber, qPattern),
          ilike(s.shipmentContainers.containerNumber, qPattern),
        ) : undefined,
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
    const carrierIds = rows.map((row) => row.externalCarrierId).filter((id): id is number => id != null);
    const portIds = rows.flatMap((row) => [row.pickupPortId, row.dropoffPortId]).filter((id): id is number => id != null);
    const [trucks, drivers, trailers, carriers, ports] = await Promise.all([
      truckIds.length === 0 ? [] : tx.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate }).from(s.trucks).where(inArray(s.trucks.id, [...new Set(truckIds)])),
      driverIds.length === 0 ? [] : tx.select({ id: s.drivers.id, name: s.drivers.name, phone: s.drivers.phone }).from(s.drivers).where(inArray(s.drivers.id, [...new Set(driverIds)])),
      trailerIds.length === 0 ? [] : tx.select({ id: s.trailers.id, licensePlate: s.trailers.licensePlate }).from(s.trailers).where(inArray(s.trailers.id, [...new Set(trailerIds)])),
      carrierIds.length === 0 ? [] : tx.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(inArray(s.customers.id, [...new Set(carrierIds)])),
      portIds.length === 0 ? [] : tx.select({ id: s.ports.id, name: s.ports.name }).from(s.ports).where(inArray(s.ports.id, [...new Set(portIds)])),
    ]);
    const trucksById = new Map(trucks.map((row) => [row.id, row]));
    const driversById = new Map(drivers.map((row) => [row.id, row]));
    const trailersById = new Map(trailers.map((row) => [row.id, row]));
    const carriersById = new Map(carriers.map((row) => [row.id, row]));
    const portsById = new Map(ports.map((row) => [row.id, row]));
    const [readyRows, dispatchedRows] = await Promise.all([
      tx.select({ total: count() }).from(s.shipmentFulfillments)
        .where(and(
          isNull(s.shipmentFulfillments.canceledAt),
          sql`not exists (
            select 1 from ${s.trips}
            where ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id}
              and ${s.trips.status} <> 'CANCELED'
              and ${s.trips.deletedAt} is null
          )`,
        )),
      tx.select({ total: count() }).from(s.shipmentFulfillments)
        .where(and(
          isNull(s.shipmentFulfillments.canceledAt),
          sql`exists (
            select 1 from ${s.trips}
            where ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id}
              and ${s.trips.status} <> 'CANCELED'
              and ${s.trips.deletedAt} is null
          )`,
        )),
    ]);
    const readyCount = Number(readyRows[0]?.total ?? 0);
    const dispatchedCount = Number(dispatchedRows[0]?.total ?? 0);

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
            serviceDurationMinutes: routeServiceDurationMinutes(),
          },
          shipment: {
            code: row.shipmentCode,
            bookingRef: row.bookingRef,
            blNumber: row.blNumber,
            declarationNumbers: declarations.get(row.shipmentId) ?? [],
            closingAt: row.closingAt?.toISOString() ?? null,
            plannedReturnAt: row.plannedReturnAt?.toISOString() ?? null,
            customsCutoffAt: row.customsCutoffAt?.toISOString() ?? null,
            operationalNotes: row.shipmentOperationalNotes,
          },
          operationalSite: toFrozenSiteSummary(snapshot.deliverySite),
          pickupWarehouse: toFrozenSiteSummary(snapshot.pickupWarehouse),
          unitSummary: {
            label: row.cargoMode === 'FCL' ? 'Container' : 'Lô hàng lẻ',
            containerNumber: row.containerNumber,
            containerTypeLabel: row.containerTypeName ?? row.containerTypeCode ?? null,
            shippingLineName: row.shippingLineName,
            pickupPortName: row.pickupPortId ? portsById.get(row.pickupPortId)?.name ?? null : null,
            dropoffPortName: row.dropoffPortId ? portsById.get(row.dropoffPortId)?.name ?? null : null,
            packageType: row.packageType,
            packageCount: row.packageCount,
            cargoWeightKg: row.cargoWeightKg,
            cargoVolumeCbm: row.cargoVolumeCbm,
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
            driverPhone: row.driverId ? driversById.get(row.driverId)?.phone ?? null : null,
            externalCarrierId: row.externalCarrierId,
            externalCarrierName: row.externalCarrierId ? carriersById.get(row.externalCarrierId)?.name ?? null : null,
            externalPlateNumber: row.externalPlateNumber,
            externalDriverName: row.externalDriverName,
            externalDriverPhone: row.externalDriverPhone,
          } : null,
        };
      }),
      page: {
        limit,
        nextCursor: rows.length > limit ? String(pageRows.at(-1)!.fulfillmentId) : null,
        total: readyCount + dispatchedCount,
        readyCount,
        dispatchedCount,
      },
    };
  });
}

export async function listDispatchFleet(input: ListDispatchFleetInput) {
  assertDispatchReadActor(input.actor);
  const limit = normalizeLimit(input.limit, 100);
  const qPattern = buildPattern(input.q);

  return db.transaction(async (tx) => {
    const [trucks, drivers, externalCarriers] = await Promise.all([
      tx.select({
        id: s.trucks.id,
        licensePlate: s.trucks.licensePlate,
        trailerType: s.trucks.trailerType,
        currentTrailerId: s.trucks.currentTrailerId,
        status: s.trucks.status,
      }).from(s.trucks)
        .where(and(
          isNull(s.trucks.deletedAt),
          qPattern ? ilike(s.trucks.licensePlate, qPattern) : undefined,
        ))
        .orderBy(s.trucks.licensePlate)
        .limit(limit),
      tx.select({
        id: s.drivers.id,
        name: s.drivers.name,
        phone: s.drivers.phone,
        assignedTruckId: s.drivers.assignedTruckId,
        status: s.drivers.status,
        userId: s.drivers.userId,
      }).from(s.drivers)
        .where(and(
          isNull(s.drivers.deletedAt),
          qPattern ? ilike(s.drivers.name, qPattern) : undefined,
        ))
        .orderBy(s.drivers.name)
        .limit(limit),
      tx.select({
        id: s.customers.id,
        name: s.customers.name,
      }).from(s.customers)
        .where(and(
          eq(s.customers.isCarrier, true),
          isNull(s.customers.deletedAt),
          qPattern ? ilike(s.customers.name, qPattern) : undefined,
        ))
        .orderBy(s.customers.name)
        .limit(limit),
    ]);
    const trailerIds = trucks.map((row) => row.currentTrailerId).filter((id): id is number => id != null);
    const assignedTruckIds = drivers.map((row) => row.assignedTruckId).filter((id): id is number => id != null);
    const [trailers, assignedTrucks] = await Promise.all([
      trailerIds.length === 0 ? [] : tx.select({ id: s.trailers.id, licensePlate: s.trailers.licensePlate }).from(s.trailers).where(inArray(s.trailers.id, [...new Set(trailerIds)])),
      assignedTruckIds.length === 0 ? [] : tx.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate }).from(s.trucks).where(inArray(s.trucks.id, [...new Set(assignedTruckIds)])),
    ]);
    const trailerById = new Map(trailers.map((row) => [row.id, row]));
    const truckById = new Map(assignedTrucks.map((row) => [row.id, row]));

    return {
      trucks: trucks.map((row) => ({
        id: row.id,
        licensePlate: row.licensePlate,
        trailerType: row.trailerType,
        currentTrailerId: row.currentTrailerId,
        currentTrailerPlate: row.currentTrailerId ? trailerById.get(row.currentTrailerId)?.licensePlate ?? null : null,
        status: row.status,
      })),
      drivers: drivers.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        assignedTruckId: row.assignedTruckId,
        assignedTruckPlate: row.assignedTruckId ? truckById.get(row.assignedTruckId)?.licensePlate ?? null : null,
        status: row.status,
        userId: row.userId,
      })),
      externalCarriers,
      page: {
        limit,
        totalTrucks: trucks.length,
        totalDrivers: drivers.length,
        totalExternalCarriers: externalCarriers.length,
      },
    };
  });
}

export async function acceptDispatchHandoff(input: AcceptDispatchHandoffInput) {
  assertDispatchActor(input.actor);
  const outcome = await db.transaction(async (tx) => {
    await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
    const handoff = await resolveHandoff(
      input.handoffId,
      'ACCEPTED',
      input.actor.userId,
      input.expectedVersion,
      { expectedShipmentId: input.shipmentId, transaction: tx },
    );
    const fulfillments = await ensureFulfillmentsInTx(tx, input.shipmentId, input.actor.userId);
    return { handoff, fulfillments };
  });
  return {
    handoff: outcome.handoff,
    fulfillments: outcome.fulfillments,
  };
}

async function loadLiveTripForFulfillment(tx: Tx, fulfillmentId: number): Promise<LiveTripRow | null> {
  const [row] = await tx.select({
    id: s.trips.id,
    version: s.trips.version,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    shipmentId: s.trips.shipmentId,
    fulfillmentId: s.trips.fulfillmentId,
    carrierType: s.trips.carrierType,
    truckId: s.trips.truckId,
    driverId: s.trips.driverId,
    trailerId: s.trips.trailerId,
    plannedStartAt: s.trips.plannedStartAt,
    plannedEndAt: s.trips.plannedEndAt,
    externalCarrierId: s.trips.externalCarrierId,
    externalPlateNumber: s.trips.externalPlateNumber,
    externalDriverName: s.trips.externalDriverName,
    externalDriverPhone: s.trips.externalDriverPhone,
    createdBy: s.trips.createdBy,
    createdAt: s.trips.createdAt,
    updatedAt: s.trips.updatedAt,
  }).from(s.trips)
    .where(and(
      eq(s.trips.fulfillmentId, fulfillmentId),
      ne(s.trips.status, TripStatus.CANCELED),
      isNull(s.trips.deletedAt),
    ))
    .limit(1)
    .for('update');
  return row ?? null;
}

async function replaceTripContainersForFulfillment(
  tx: Tx,
  tripId: number,
  shipment: typeof s.shipments.$inferSelect,
  fulfillment: typeof s.shipmentFulfillments.$inferSelect,
  actorId: number,
) {
  await tx.delete(s.tripContainerSeals)
    .where(inArray(
      s.tripContainerSeals.tripContainerId,
      tx.select({ id: s.tripContainers.id }).from(s.tripContainers).where(eq(s.tripContainers.tripId, tripId)),
    ));
  await tx.delete(s.tripContainers).where(eq(s.tripContainers.tripId, tripId));

  if (fulfillment.shipmentContainerId == null) {
    await tx.insert(s.tripContainers).values({
      tripId,
      sourceShipmentId: shipment.id,
      sourceShipmentVersion: shipment.version,
      containerTypeId: null,
      containerNumber: null,
      sealNumber: null,
      cargoWeightKg: shipment.cargoWeightKg,
      notes: `__fulfillment_lcl:${fulfillment.id}`,
      createdBy: actorId,
    });
    return;
  }

  const [container] = await tx.select().from(s.shipmentContainers)
    .where(and(
      eq(s.shipmentContainers.id, fulfillment.shipmentContainerId),
      eq(s.shipmentContainers.shipmentId, shipment.id),
    ))
    .limit(1);
  if (!container) {
    throw new ApiError(409, 'Container nguồn của tác vụ không còn hợp lệ.');
  }
  await tx.insert(s.tripContainers).values({
    tripId,
    sourceShipmentId: shipment.id,
    sourceShipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    containerTypeId: container.containerTypeId,
    containerNumber: container.containerNumber,
    sealNumber: container.sealNumber,
    cargoWeightKg: container.cargoWeightKg,
    notes: `__fulfillment_snapshot:${fulfillment.id}`,
    createdBy: actorId,
  });
}

async function assertResourceAvailability(
  tx: Tx,
  args: {
    tripId: number | null;
    truckId: number | null;
    trailerId: number | null;
    driverId: number | null;
    plannedStartAt: Date;
    plannedEndAt: Date;
  },
) {
  const predicates = [];
  if (args.truckId != null) predicates.push(eq(s.trips.truckId, args.truckId));
  if (args.trailerId != null) predicates.push(eq(s.trips.trailerId, args.trailerId));
  if (args.driverId != null) predicates.push(eq(s.trips.driverId, args.driverId));
  if (predicates.length === 0) return;

  const conflicts = await tx.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    truckId: s.trips.truckId,
    trailerId: s.trips.trailerId,
    driverId: s.trips.driverId,
  }).from(s.trips)
    .where(and(
      or(...predicates)!,
      isNull(s.trips.deletedAt),
      inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
      args.tripId != null ? ne(s.trips.id, args.tripId) : undefined,
      isNotNull(s.trips.plannedStartAt),
      isNotNull(s.trips.plannedEndAt),
      lt(s.trips.plannedStartAt, args.plannedEndAt),
      gt(s.trips.plannedEndAt, args.plannedStartAt),
    ));
  if (conflicts.find((row) => args.truckId != null && row.truckId === args.truckId)) {
    throw new ApiError(409, 'Xe đầu kéo đã bị trùng lịch kế hoạch.');
  }
  if (conflicts.find((row) => args.trailerId != null && row.trailerId === args.trailerId)) {
    throw new ApiError(409, 'Rơ-moóc đã bị trùng lịch kế hoạch.');
  }
  if (conflicts.find((row) => args.driverId != null && row.driverId === args.driverId)) {
    throw new ApiError(409, 'Tài xế đã bị trùng lịch kế hoạch.');
  }
}

async function issueOrderCreateOrUpdate(
  tx: Tx,
  input: IssueFulfillmentDispatchOrderInput,
): Promise<IssueOrderMutationResult> {
  await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1)
    .for('update');
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  if (shipment.status === 'CANCELED' || shipment.status === 'CLOSED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc và không thể điều xe.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      eq(s.shipmentFulfillments.shipmentId, shipment.id),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.canceledAt) throw new ApiError(409, 'Tác vụ đã bị hủy.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }

  const plannedStartAt = parseIsoWithZone(input.plannedStartAt, 'Giờ chạy');
  const plannedEndAt = parseIsoWithZone(input.plannedEndAt, 'Giờ kết thúc');
  if (plannedEndAt.getTime() <= plannedStartAt.getTime()) {
    throw new ApiError(400, 'Giờ kết thúc phải sau giờ chạy.');
  }
  if (routeServiceDurationMinutes() == null && !input.endTimeConfirmed) {
    throw new ApiError(409, 'Tuyến chưa có thời lượng chuẩn. Vui lòng xác nhận giờ kết thúc.');
  }

  const cargoTypeId = shipment.cargoTypeId ?? null;

  let truckId: number | null = null;
  let trailerId: number | null = null;
  let driverId: number | null = null;
  let externalCarrierId: number | null = null;
  let externalPlateNumber: string | null = null;
  let externalDriverName: string | null = null;
  let externalDriverPhone: string | null = null;
  let containerTypeId: number | null = input.containerTypeId ?? null;

  if (input.carrierType === 'OWN') {
    if (input.truckId == null || input.driverId == null) {
      throw new ApiError(400, 'Điều xe nội bộ phải chọn xe và tài xế.');
    }
    const [truck] = await tx.select({
      id: s.trucks.id,
      currentTrailerId: s.trucks.currentTrailerId,
      status: s.trucks.status,
      deletedAt: s.trucks.deletedAt,
    }).from(s.trucks).where(eq(s.trucks.id, input.truckId)).limit(1);
    if (!truck || truck.deletedAt || truck.status !== 'ACTIVE') {
      throw new ApiError(409, 'Xe đầu kéo không còn hiệu lực.');
    }
    const [driver] = await tx.select({
      id: s.drivers.id,
      userId: s.drivers.userId,
      status: s.drivers.status,
      deletedAt: s.drivers.deletedAt,
    }).from(s.drivers).where(eq(s.drivers.id, input.driverId)).limit(1);
    if (!driver || driver.deletedAt || driver.status !== 'ACTIVE' || driver.userId == null) {
      throw new ApiError(409, 'Tài xế không còn hiệu lực để nhận lệnh.');
    }
    const trailerCandidateId = input.trailerId ?? truck.currentTrailerId ?? null;
    if (trailerCandidateId == null) {
      throw new ApiError(409, 'Xe đầu kéo chưa có rơ-moóc khả dụng.');
    }
    const [trailer] = await tx.select({
      id: s.trailers.id,
      type: s.trailers.type,
      status: s.trailers.status,
      deletedAt: s.trailers.deletedAt,
    }).from(s.trailers).where(eq(s.trailers.id, trailerCandidateId)).limit(1);
    if (!trailer || trailer.deletedAt || trailer.status !== 'ACTIVE') {
      throw new ApiError(409, 'Rơ-moóc không còn hiệu lực.');
    }
    if (fulfillment.shipmentContainerId != null) {
      const [container] = await tx.select({ code: s.containerTypes.code, containerTypeId: s.shipmentContainers.containerTypeId })
        .from(s.shipmentContainers)
        .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
        .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
        .limit(1);
      if (container?.code && trailer.type !== inferTrailerTypeFromContainerCode(container.code)) {
        throw new ApiError(409, 'Rơ-moóc không phù hợp với loại container.');
      }
      containerTypeId = container?.containerTypeId ?? containerTypeId;
    }
    truckId = truck.id;
    trailerId = trailer.id;
    driverId = driver.id;
  } else {
    externalCarrierId = input.externalCarrierId ?? null;
    if (externalCarrierId == null) throw new ApiError(400, 'Điều xe ngoài phải chọn nhà xe.');
    const [carrier] = await tx.select({
      id: s.customers.id,
      isCarrier: s.customers.isCarrier,
      deletedAt: s.customers.deletedAt,
    }).from(s.customers).where(eq(s.customers.id, externalCarrierId)).limit(1);
    if (!carrier || carrier.deletedAt || !carrier.isCarrier) {
      throw new ApiError(409, 'Nhà xe ngoài không còn hiệu lực.');
    }
    externalPlateNumber = trimBounded(input.externalPlateNumber, 'Biển số ngoài', 20);
    externalDriverName = trimBounded(input.externalDriverName, 'Tên tài xế ngoài', 100);
    externalDriverPhone = trimBounded(input.externalDriverPhone, 'Số điện thoại tài xế ngoài', 20);
    if (!externalPlateNumber || !externalDriverName) {
      throw new ApiError(400, 'Điều xe ngoài phải nhập biển số và tên tài xế.');
    }
  }

  const lockIds = [truckId, trailerId, driverId].filter((id): id is number => id != null).sort((a, b) => a - b);
  for (const resourceId of [...new Set(lockIds)]) {
    await tx.execute(sql`select pg_advisory_xact_lock(6201, ${resourceId})`);
  }

  const liveTrip = await loadLiveTripForFulfillment(tx, fulfillment.id);
  if (liveTrip && liveTrip.status !== TripStatus.CREATED) {
    throw new ApiError(409, 'Không thể điều chỉnh tác vụ đã xuất phát.');
  }

  await assertResourceAvailability(tx, {
    tripId: liveTrip?.id ?? null,
    truckId,
    trailerId,
    driverId,
    plannedStartAt,
    plannedEndAt,
  });

  let trip = liveTrip;
  let notificationPersisted = false;

  if (!trip) {
    const createdTrip = await createTrip({
      customerId: shipment.customerId,
      routeId: shipment.routeId ?? (() => { throw new ApiError(409, 'Lô hàng chưa có tuyến đường.'); })(),
      truckId,
      driverId,
      cargoTypeId,
      departureDate: plannedStartAt.toISOString().slice(0, 10),
      customerReference: shipment.bookingRef ?? shipment.blNumber ?? undefined,
      containerCount: 1,
      containerTypeId,
      fuelMode: input.fuelMode,
      createdBy: input.actor.userId,
      carrierType: input.carrierType,
      externalCarrierId,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
    }, tx);
    const [linked] = await tx.update(s.trips).set({
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
      sourceShipmentVersion: shipment.version,
      plannedStartAt,
      plannedEndAt,
      truckId,
      trailerId,
      driverId,
      carrierType: input.carrierType,
      externalCarrierId,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, createdTrip.id)).returning({
      id: s.trips.id,
      version: s.trips.version,
      tripCode: s.trips.tripCode,
      status: s.trips.status,
      shipmentId: s.trips.shipmentId,
      fulfillmentId: s.trips.fulfillmentId,
      carrierType: s.trips.carrierType,
      truckId: s.trips.truckId,
      driverId: s.trips.driverId,
      trailerId: s.trips.trailerId,
      plannedStartAt: s.trips.plannedStartAt,
      plannedEndAt: s.trips.plannedEndAt,
      externalCarrierId: s.trips.externalCarrierId,
      externalPlateNumber: s.trips.externalPlateNumber,
      externalDriverName: s.trips.externalDriverName,
      externalDriverPhone: s.trips.externalDriverPhone,
      createdBy: s.trips.createdBy,
      createdAt: s.trips.createdAt,
      updatedAt: s.trips.updatedAt,
    });
    trip = linked ?? null;
    if (!trip) throw new ApiError(409, 'Không thể liên kết chuyến với tác vụ.');
    await replaceTripContainersForFulfillment(tx, trip.id, shipment, fulfillment, input.actor.userId);
    await persistNotificationInTx(tx, buildNotificationPayload(trip));
    notificationPersisted = true;
  } else {
    const [updatedTrip] = await tx.update(s.trips).set({
      plannedStartAt,
      plannedEndAt,
      truckId,
      trailerId,
      driverId,
      carrierType: input.carrierType,
      externalCarrierId,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      sourceShipmentVersion: shipment.version,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, trip.id)).returning({
      id: s.trips.id,
      version: s.trips.version,
      tripCode: s.trips.tripCode,
      status: s.trips.status,
      shipmentId: s.trips.shipmentId,
      fulfillmentId: s.trips.fulfillmentId,
      carrierType: s.trips.carrierType,
      truckId: s.trips.truckId,
      driverId: s.trips.driverId,
      trailerId: s.trips.trailerId,
      plannedStartAt: s.trips.plannedStartAt,
      plannedEndAt: s.trips.plannedEndAt,
      externalCarrierId: s.trips.externalCarrierId,
      externalPlateNumber: s.trips.externalPlateNumber,
      externalDriverName: s.trips.externalDriverName,
      externalDriverPhone: s.trips.externalDriverPhone,
      createdBy: s.trips.createdBy,
      createdAt: s.trips.createdAt,
      updatedAt: s.trips.updatedAt,
    });
    trip = updatedTrip ?? trip;
    await replaceTripContainersForFulfillment(tx, trip.id, shipment, fulfillment, input.actor.userId);
    const existingNotificationCount = await tx.select({ total: count() }).from(s.notifications).where(and(
      eq(s.notifications.type, 'TRIP_DISPATCHED'),
      eq(s.notifications.relatedEntityType, 'trips'),
      eq(s.notifications.relatedEntityId, trip.id),
    ));
    if (Number(existingNotificationCount[0]?.total ?? 0) === 0) {
      await persistNotificationInTx(tx, buildNotificationPayload(trip));
      notificationPersisted = true;
    }
  }

  const [updatedFulfillment] = await tx.update(s.shipmentFulfillments).set({
    version: sql`${s.shipmentFulfillments.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(s.shipmentFulfillments.id, fulfillment.id)).returning();

  return {
    fulfillment: updatedFulfillment ?? fulfillment,
    trip,
    notificationPersisted,
  };
}

export async function issueFulfillmentDispatchOrder(input: IssueFulfillmentDispatchOrderInput) {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<IssueOrderMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DISPATCH,
    idempotencyKey: input.idempotencyKey,
    payload: {
      shipmentId: input.shipmentId,
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      endTimeConfirmed: input.endTimeConfirmed,
      carrierType: input.carrierType,
      cargoTypeId: input.cargoTypeId ?? null,
      truckId: input.truckId ?? null,
      driverId: input.driverId ?? null,
      trailerId: input.trailerId ?? null,
      containerTypeId: input.containerTypeId ?? null,
      externalCarrierId: input.externalCarrierId ?? null,
      externalPlateNumber: input.externalPlateNumber ?? null,
      externalDriverName: input.externalDriverName ?? null,
      externalDriverPhone: input.externalDriverPhone ?? null,
    },
    createdBy: input.actor.userId,
    entityType: 'trip',
    getEntityId: (result) => result.trip.id,
    create: (tx) => issueOrderCreateOrUpdate(tx, input),
  });

  if (!outcome.replayed && outcome.result.notificationPersisted) {
    await sendNotificationPush(buildNotificationPayload(outcome.result.trip));
  }

  return {
    fulfillmentId: outcome.result.fulfillment.id,
    version: outcome.result.fulfillment.version,
    trip: {
      id: outcome.result.trip.id,
      version: outcome.result.trip.version,
      tripCode: outcome.result.trip.tripCode,
      status: outcome.result.trip.status,
      plannedStartAt: outcome.result.trip.plannedStartAt?.toISOString() ?? null,
      plannedEndAt: outcome.result.trip.plannedEndAt?.toISOString() ?? null,
      carrierType: outcome.result.trip.carrierType,
      truckId: outcome.result.trip.truckId,
      trailerId: outcome.result.trip.trailerId,
      driverId: outcome.result.trip.driverId,
      externalCarrierId: outcome.result.trip.externalCarrierId,
      externalPlateNumber: outcome.result.trip.externalPlateNumber,
      externalDriverName: outcome.result.trip.externalDriverName,
      externalDriverPhone: outcome.result.trip.externalDriverPhone,
    },
    notification: {
      type: NotificationType.TRIP_DISPATCHED,
      deliveredInApp: true,
      pushAttempted: !outcome.replayed && outcome.result.notificationPersisted,
    },
    replayed: outcome.replayed,
  };
}
