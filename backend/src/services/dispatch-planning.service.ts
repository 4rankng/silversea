import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, NotificationType, Role, TripStatus, type FuelMode } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { resolveHandoff } from './dispatch-handoff.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { persistNotificationInTx, sendNotificationPush, type NotificationPayload } from './notification.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import { transitionShipmentStatus } from './shipment.service';
import { createTrip } from './trip-mutations.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DispatchActor = AuthUser & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER };

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
  resource: 'TRUCK' | 'DRIVER' | 'EXTERNAL_CARRIER';
  cursor?: string | null;
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
  pricingRateKey?: string | null;
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
  | 'externalEntityId'
  | 'externalEntityType'
  | 'externalPlateNumber'
  | 'externalDriverName'
  | 'externalDriverPhone'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
>;

type DispatchHandoffStatus = typeof s.dispatchHandoffs.status.enumValues[number];
type DispatchQueueStatus = 'READY' | 'DISPATCHED';
type DispatchFleetResource = ListDispatchFleetInput['resource'];

type DispatchCursorScope = 'dispatch-handoffs' | 'dispatch-queue';

interface DispatchListCursorPayload {
  v: 1;
  scope: DispatchCursorScope;
  id: number;
}

interface DispatchFleetCursorPayload {
  v: 1;
  scope: 'dispatch-fleet';
  resource: DispatchFleetResource;
  sortKey: string;
  id: number;
}

interface IssueOrderMutationResult {
  fulfillment: typeof s.shipmentFulfillments.$inferSelect;
  trip: LiveTripRow;
  notificationPersisted: boolean;
}

const DEFAULT_ROUTE_SERVICE_SPEED_KPH = 35;
const DEFAULT_ROUTE_SERVICE_BUFFER_MINUTES = 30;
const TRAILER_CAPACITY_KG: Record<'20FT' | '40FT', number> = {
  '20FT': 18_000,
  '40FT': 30_000,
};

function assertDispatchReadActor(actor: AuthUser): void {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.DISPATCHER && actor.role !== Role.ACCOUNTANT) {
    throw new ApiError(403, 'Bạn không có quyền xem bảng điều phối.');
  }
}

function assertDispatchActor(actor: AuthUser): asserts actor is DispatchActor {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.DISPATCHER) {
    throw new ApiError(403, 'Chỉ điều vận mới có quyền điều xe.');
  }
}

function accountantCustomerScopeIds(actor: AuthUser): number[] {
  return [...new Set([
    ...(actor.customerIds ?? []),
    actor.customerId,
  ].filter((value): value is number => value != null && Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function requireAccountantDispatchScope(actor: AuthUser): number[] | null {
  if (actor.role !== Role.ACCOUNTANT) return null;
  const customerIds = accountantCustomerScopeIds(actor);
  if (customerIds.length === 0) {
    throw new ApiError(403, 'Tài khoản kế toán chưa có phạm vi khách hàng để xem điều phối.');
  }
  return customerIds;
}

function decodeCursorPayload(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
}

function encodeCursorPayload(payload: DispatchListCursorPayload | DispatchFleetCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parseCursor(raw: string | null | undefined, scope: DispatchCursorScope): number | null {
  if (!raw) return null;
  const payload = decodeCursorPayload(raw);
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
  const parsed = payload as Partial<DispatchListCursorPayload>;
  const id = typeof parsed.id === 'number' ? parsed.id : null;
  if (
    parsed.v !== 1
    || parsed.scope !== scope
    || id == null
    || !Number.isInteger(id)
    || id <= 0
  ) {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
  const value = id;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
  return value;
}

function encodeDescendingIdCursor(scope: DispatchCursorScope, id: number): string {
  return encodeCursorPayload({ v: 1, scope, id });
}

function parseFleetCursor(
  raw: string | null | undefined,
  resource: DispatchFleetResource,
): { sortKey: string; id: number } | null {
  if (!raw) return null;
  const payload = decodeCursorPayload(raw);
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
  const parsed = payload as Partial<DispatchFleetCursorPayload>;
  const id = typeof parsed.id === 'number' ? parsed.id : null;
  if (
    parsed.v !== 1
    || parsed.scope !== 'dispatch-fleet'
    || parsed.resource !== resource
    || typeof parsed.sortKey !== 'string'
    || parsed.sortKey.length === 0
    || id == null
    || !Number.isInteger(id)
    || id <= 0
  ) {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
  return { sortKey: parsed.sortKey, id };
}

function encodeFleetCursor(resource: DispatchFleetResource, sortKey: string, id: number): string {
  return encodeCursorPayload({ v: 1, scope: 'dispatch-fleet', resource, sortKey, id });
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

function unaccentedIlike(column: unknown, pattern: string) {
  return sql`unaccent(${column}) ILIKE unaccent(${pattern})`;
}

function sumSelectedStatusCounts<T extends string>(selected: T[], counts: Partial<Record<T, number>>) {
  return selected.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
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

function routeServiceDurationMinutes(distanceKm: number | null | undefined): number | null {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return Math.ceil((distanceKm / DEFAULT_ROUTE_SERVICE_SPEED_KPH) * 60) + DEFAULT_ROUTE_SERVICE_BUFFER_MINUTES;
}

function redactDispatchSiteForAccountant<T extends {
  id: number | null;
  name: string | null;
  address: string | null;
  googleMapsUrl: string | null;
  strictRules: string | null;
}>(actor: AuthUser, site: T): T {
  if (actor.role !== Role.ACCOUNTANT) return site;
  return {
    ...site,
    address: null,
    googleMapsUrl: null,
    strictRules: null,
  };
}

function inferredVehicleCapacityKg(trailerType: '20FT' | '40FT' | null | undefined): string | null {
  if (!trailerType) return null;
  const capacityKg = TRAILER_CAPACITY_KG[trailerType];
  return capacityKg ? String(capacityKg) : null;
}

function authoritativeCargoWeightKg(args: {
  shipmentCargoWeightKg: string | null;
  containerCargoWeightKg?: string | null;
  shipmentContainerId: number | null;
}): string | null {
  if (args.shipmentContainerId != null) {
    return args.containerCargoWeightKg ?? null;
  }
  return args.shipmentCargoWeightKg ?? null;
}

function dispatchAssignmentChanged(
  trip: LiveTripRow,
  next: {
    plannedStartAt: Date;
    plannedEndAt: Date;
    carrierType: 'OWN' | 'EXTERNAL';
    truckId: number | null;
    trailerId: number | null;
    driverId: number | null;
    externalCarrierId: number | null;
    externalPlateNumber: string | null;
    externalDriverName: string | null;
    externalDriverPhone: string | null;
  },
): boolean {
  return trip.plannedStartAt?.getTime() !== next.plannedStartAt.getTime()
    || trip.plannedEndAt?.getTime() !== next.plannedEndAt.getTime()
    || trip.carrierType !== next.carrierType
    || trip.truckId !== next.truckId
    || trip.trailerId !== next.trailerId
    || trip.driverId !== next.driverId
    || trip.externalEntityId !== next.externalCarrierId
    || trip.externalPlateNumber !== next.externalPlateNumber
    || trip.externalDriverName !== next.externalDriverName
    || trip.externalDriverPhone !== next.externalDriverPhone;
}

function buildNotificationPayload(
  trip: Pick<typeof s.trips.$inferSelect, 'id' | 'tripCode' | 'driverId' | 'fulfillmentId'>,
): NotificationPayload {
  if (trip.fulfillmentId == null) {
    throw new ApiError(409, 'Chuyến điều xe chưa liên kết tác vụ thực hiện.');
  }
  return {
    type: NotificationType.TRIP_DISPATCHED,
    title: 'Lệnh điều xe mới',
    message: trip.tripCode ? `Chuyến ${trip.tripCode} đã được điều xe` : 'Bạn có lệnh điều xe mới',
    relatedEntityType: 'shipment_fulfillments',
    relatedEntityId: trip.fulfillmentId,
    targetDriverId: trip.driverId ?? undefined,
  };
}

function hasExplicitNotificationTarget(payload: NotificationPayload): boolean {
  return payload.targetUserId != null
    || payload.targetDriverId != null
    || (payload.targetRoles?.length ?? 0) > 0;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
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
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const cursor = parseCursor(input.cursor, 'dispatch-handoffs');
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
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
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
    const [statusCounts] = await tx.select({
      unseen: sql<number>`count(*) filter (where ${s.dispatchHandoffs.status} = 'UNSEEN')`,
      seen: sql<number>`count(*) filter (where ${s.dispatchHandoffs.status} = 'SEEN')`,
    }).from(s.dispatchHandoffs)
      .innerJoin(s.shipments, eq(s.dispatchHandoffs.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .where(and(
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(sql`date(${s.dispatchHandoffs.vehicleNeededBy})`, date) : undefined,
        qPattern ? or(
          ilike(s.customers.name, qPattern),
          ilike(s.shipments.shipmentCode, qPattern),
          ilike(s.shipments.bookingRef, qPattern),
          ilike(s.shipments.blNumber, qPattern),
        ) : undefined,
      ));
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
              name: site.name,
              address: site.address,
              googleMapsUrl: site.googleMapsUrl,
              strictRules: site.strictRules,
            });
          })()
          : null,
        summary: {
          containerNumbers: containerMap.get(row.shipmentId) ?? [],
          lclLabel: row.cargoMode === 'LCL' ? 'Lô hàng lẻ' : null,
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
      externalEntityId: s.trips.externalEntityId,
      externalEntityType: s.trips.externalEntityType,
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
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
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
    const carrierIds = rows.map((row) => row.externalEntityId).filter((id): id is number => id != null);
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
    const [filteredCounts] = await tx.select({
      ready: sql<number>`count(*) filter (where ${s.trips.id} is null)`,
      dispatched: sql<number>`count(*) filter (where ${s.trips.id} is not null)`,
    }).from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.dispatchHandoffs, and(
        eq(s.dispatchHandoffs.shipmentId, s.shipments.id),
        eq(s.dispatchHandoffs.status, 'ACCEPTED'),
        isNull(s.dispatchHandoffs.supersededAt),
      ))
      .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        ne(s.trips.status, TripStatus.CANCELED),
        isNull(s.trips.deletedAt),
      ))
      .where(and(
        isNull(s.shipmentFulfillments.canceledAt),
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(sql`date(coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}, ${s.shipments.customsCutoffAt}))`, date) : undefined,
        qPattern ? or(
          ilike(s.customers.name, qPattern),
          ilike(s.shipments.shipmentCode, qPattern),
          ilike(s.shipments.bookingRef, qPattern),
          ilike(s.shipments.blNumber, qPattern),
          ilike(s.shipmentContainers.containerNumber, qPattern),
        ) : undefined,
      ));
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

    const externalCarrierWhere = and(
      eq(s.customers.isCarrier, true),
      isNull(s.customers.deletedAt),
      qPattern ? unaccentedIlike(s.customers.name, qPattern) : undefined,
      cursor ? or(
        gt(s.customers.name, cursor.sortKey),
        and(eq(s.customers.name, cursor.sortKey), gt(s.customers.id, cursor.id)),
      ) : undefined,
    );
    const externalCarrierCountWhere = and(
      eq(s.customers.isCarrier, true),
      isNull(s.customers.deletedAt),
      qPattern ? unaccentedIlike(s.customers.name, qPattern) : undefined,
    );
    const [externalCarrierTotals, externalCarrierRows] = await Promise.all([
      tx.select({ value: count() }).from(s.customers).where(externalCarrierCountWhere),
      tx.select({
        id: s.customers.id,
        name: s.customers.name,
      }).from(s.customers)
        .where(externalCarrierWhere)
        .orderBy(asc(s.customers.name), asc(s.customers.id))
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
    const fulfillments = await ensureShipmentFulfillmentsInTx(tx, {
      shipmentId: input.shipmentId,
      actorId: input.actor.userId,
    });
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
    externalEntityId: s.trips.externalEntityId,
    externalEntityType: s.trips.externalEntityType,
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
  if (shipment.status === 'CANCELED' || shipment.status === 'COMPLETED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc và không thể điều xe.');
  }
  const [route] = shipment.routeId == null
    ? []
    : await tx.select({
      distanceKm: s.routes.distanceKm,
    }).from(s.routes).where(eq(s.routes.id, shipment.routeId)).limit(1);

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
  const serviceDurationMinutes = routeServiceDurationMinutes(route?.distanceKm ?? null);
  const plannedEndAt = serviceDurationMinutes == null
    ? parseIsoWithZone(input.plannedEndAt, 'Giờ kết thúc')
    : new Date(plannedStartAt.getTime() + serviceDurationMinutes * 60_000);
  if (plannedEndAt.getTime() <= plannedStartAt.getTime()) {
    throw new ApiError(400, 'Giờ kết thúc phải sau giờ chạy.');
  }
  if (serviceDurationMinutes == null && !input.endTimeConfirmed) {
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
  let driverUserId: number | null = null;
  let cargoWeightKg: string | null = shipment.cargoWeightKg ?? null;
  let vehicleCapacityKg: string | null = null;

  if (input.carrierType === 'OWN') {
    if (input.truckId == null || input.driverId == null) {
      throw new ApiError(400, 'Điều xe nội bộ phải chọn xe và tài xế.');
    }
    const [truck] = await tx.select({
      id: s.trucks.id,
      currentTrailerId: s.trucks.currentTrailerId,
      status: s.trucks.status,
      trailerType: s.trucks.trailerType,
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
    }).from(s.drivers)
      .where(eq(s.drivers.id, input.driverId))
      .limit(1)
      .for('update');
    const [driverUser] = driver?.userId == null
      ? []
      : await tx.select({
        status: s.users.status,
        role: s.users.role,
        deletedAt: s.users.deletedAt,
      }).from(s.users).where(eq(s.users.id, driver.userId)).limit(1);
    if (
      !driver
      || driver.deletedAt
      || driver.status !== 'ACTIVE'
      || driver.userId == null
      || !driverUser
      || driverUser.deletedAt
      || driverUser.status !== 'ACTIVE'
      || driverUser.role !== Role.DRIVER
    ) {
      throw new ApiError(409, 'Tài xế không còn hiệu lực để nhận lệnh.');
    }
    driverUserId = driver.userId;
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
    vehicleCapacityKg = inferredVehicleCapacityKg(trailer.type ?? truck.trailerType);
    if (fulfillment.shipmentContainerId != null) {
      const [container] = await tx.select({
        code: s.containerTypes.code,
        containerTypeId: s.shipmentContainers.containerTypeId,
        cargoWeightKg: s.shipmentContainers.cargoWeightKg,
      })
        .from(s.shipmentContainers)
        .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
        .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
        .limit(1);
      if (container?.code && trailer.type !== inferTrailerTypeFromContainerCode(container.code)) {
        throw new ApiError(409, 'Rơ-moóc không phù hợp với loại container.');
      }
      containerTypeId = container?.containerTypeId ?? containerTypeId;
      cargoWeightKg = authoritativeCargoWeightKg({
        shipmentCargoWeightKg: shipment.cargoWeightKg,
        containerCargoWeightKg: container?.cargoWeightKg ?? null,
        shipmentContainerId: fulfillment.shipmentContainerId,
      });
    }
    if (
      cargoWeightKg != null
      && vehicleCapacityKg != null
      && Number(cargoWeightKg) > Number(vehicleCapacityKg)
    ) {
      throw new ApiError(409, 'Trọng lượng hàng vượt quá tải trọng xe.');
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
  const previousDriverId = liveTrip?.driverId ?? null;
  const assignmentChanged = liveTrip == null
    ? true
    : dispatchAssignmentChanged(liveTrip, {
      plannedStartAt,
      plannedEndAt,
      carrierType: input.carrierType,
      truckId,
      trailerId,
      driverId,
      externalCarrierId,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
    });

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
      pricingRateKey: input.pricingRateKey ?? null,
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
      externalEntityId: externalCarrierId,
      externalEntityType: externalCarrierId != null ? 'CUSTOMER' : null,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      cargoWeightKg,
      vehicleCapacityKg,
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
      externalEntityId: s.trips.externalEntityId,
      externalEntityType: s.trips.externalEntityType,
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
    const notificationPayload = buildNotificationPayload(trip);
    if (hasExplicitNotificationTarget(notificationPayload)) {
      await persistNotificationInTx(tx, notificationPayload);
      notificationPersisted = true;
    }
  } else {
    const [updatedTrip] = await tx.update(s.trips).set({
      plannedStartAt,
      plannedEndAt,
      truckId,
      trailerId,
      driverId,
      carrierType: input.carrierType,
      externalEntityId: externalCarrierId,
      externalEntityType: externalCarrierId != null ? 'CUSTOMER' : null,
      externalPlateNumber,
      externalDriverName,
      externalDriverPhone,
      sourceShipmentVersion: shipment.version,
      cargoWeightKg,
      vehicleCapacityKg,
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
      externalEntityId: s.trips.externalEntityId,
      externalEntityType: s.trips.externalEntityType,
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
      eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
      eq(s.notifications.relatedEntityId, fulfillment.id),
      driverUserId != null ? eq(s.notifications.userId, driverUserId) : undefined,
    ));
    if (
      assignmentChanged
      && (
        driverUserId == null
          ? Number(existingNotificationCount[0]?.total ?? 0) === 0
          : previousDriverId !== driverId && Number(existingNotificationCount[0]?.total ?? 0) === 0
      )
    ) {
      const notificationPayload = buildNotificationPayload(trip);
      if (hasExplicitNotificationTarget(notificationPayload)) {
        await persistNotificationInTx(tx, notificationPayload);
        notificationPersisted = true;
      }
    }
  }

  const [updatedFulfillment] = await tx.update(s.shipmentFulfillments).set({
    version: sql`${s.shipmentFulfillments.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(s.shipmentFulfillments.id, fulfillment.id)).returning();

  if (canonicalShipmentStatus(shipment.status) === 'NEW') {
    await transitionShipmentStatus(
      shipment.id,
      'DISPATCHED',
      {
        reason: 'Phát hành lệnh điều xe.',
        changedBy: input.actor.userId,
      },
      tx,
    );
  }

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
      pricingRateKey: input.pricingRateKey ?? null,
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

  const notificationPayload = buildNotificationPayload(outcome.result.trip);
  const hasExplicitInAppTarget = hasExplicitNotificationTarget(notificationPayload);

  if (!outcome.replayed && outcome.result.notificationPersisted && hasExplicitInAppTarget) {
    await sendNotificationPush(notificationPayload).catch((error) => {
      console.error('Dispatch push delivery failed after order commit:', error);
    });
  }

  return {
    fulfillmentId: outcome.result.fulfillment.id,
    version: outcome.result.fulfillment.version,
    trip: {
      id: outcome.result.trip.id,
      version: outcome.result.trip.version,
      tripCode: outcome.result.trip.tripCode,
      status: outcome.result.trip.status,
      plannedStartAt: toIsoOrNull(outcome.result.trip.plannedStartAt),
      plannedEndAt: toIsoOrNull(outcome.result.trip.plannedEndAt),
      carrierType: outcome.result.trip.carrierType,
      truckId: outcome.result.trip.truckId,
      trailerId: outcome.result.trip.trailerId,
      driverId: outcome.result.trip.driverId,
      externalCarrierId: outcome.result.trip.externalEntityId,
      externalPlateNumber: outcome.result.trip.externalPlateNumber,
      externalDriverName: outcome.result.trip.externalDriverName,
      externalDriverPhone: outcome.result.trip.externalDriverPhone,
    },
    notification: {
      type: NotificationType.TRIP_DISPATCHED,
      deliveredInApp: hasExplicitInAppTarget,
      pushAttempted: !outcome.replayed && outcome.result.notificationPersisted && hasExplicitInAppTarget,
    },
    replayed: outcome.replayed,
  };
}
