import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, NotificationType, Role, TripStatus, type DispatchClassification, type FuelMode, type TruckSuggestion } from '@tingting/shared';

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
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { operationalName } from '../db/master-data-name';
import { escapeLikeTerm } from '../lib/format';

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);
const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);

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
  resource: 'TRUCK' | 'DRIVER' | 'EXTERNAL_CARRIER' | 'EXTERNAL_VEHICLE';
  carrierId?: number;
  cursor?: string | null;
  limit?: number;
  q?: string;
  /** Target row context for own-truck suggestions (resource=TRUCK only). */
  fulfillmentId?: number;
}

export interface ListDispatchDetailPlanRowsInput {
  actor: AuthUser;
  page?: number;
  limit?: number;
  q?: string;
  date?: string;
  direction?: 'IMPORT' | 'EXPORT';
  assignmentStatus?: 'UNASSIGNED' | 'ASSIGNED';
  pickupIds?: number[];
  dropoffIds?: number[];
  deliveryPointIds?: number[];
  hourFrom?: string;
  hourTo?: string;
  /** Only rows whose container picks up or drops off at a port in this zone. */
  zone?: string;
}

/**
 * One atomic editor save: carrier + vehicle + estimates + classification +
 * isCombined in a single fulfillment-plus-shipment transaction. The editor
 * always sends every field and both row versions, so a partially-stale tab
 * cannot silently erase concurrent work.
 */
export interface UpdateDispatchDetailPlanInput {
  fulfillmentId: number;
  expectedFulfillmentVersion: number;
  expectedShipmentVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clearVehicle?: boolean;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  classification: DispatchClassification;
  isCombined: boolean;
  idempotencyKey: string;
  actor: DispatchActor;
}

export interface DispatchDetailPlanMutationResult {
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentId: number;
  shipmentVersion: number;
  classification: DispatchClassification;
  isCombined: boolean;
  dispatch: {
    carrierType: 'OWN' | 'EXTERNAL';
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
  };
  estimates: {
    plannedRevenue: string | null;
    plannedCarrierCost: string | null;
  };
  lotFullyPlated: boolean;
  driverNotified: boolean;
  driverHint: string | null;
}

export interface AssignFulfillmentPlateInput {
  fulfillmentId: number;
  expectedVersion: number;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clear?: boolean;
  idempotencyKey: string;
  actor: DispatchActor;
}

export interface AssignFulfillmentCarrierInput {
  fulfillmentId: number;
  expectedVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  idempotencyKey: string;
  actor: DispatchActor;
}

/** Operational revenue/cost estimates; never a ledger or accounting entry. */
export interface UpdateFulfillmentEstimatesInput {
  fulfillmentId: number;
  expectedVersion: number;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  idempotencyKey: string;
  actor: DispatchActor;
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
  /** Required when correcting a published trip to prevent a silent overwrite. */
  expectedTripVersion?: number;
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
  externalCarrierVehicleId?: number | null;
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
const DEFAULT_DISPATCH_HANDOFF_STATUSES: readonly DispatchHandoffStatus[] = ['UNSEEN', 'SEEN'];

type DispatchCursorScope = 'dispatch-handoffs' | 'dispatch-queue' | 'dispatch-detail-plan';

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

function normalizeDispatchHandoffStatuses(
  input: readonly string[] | null | undefined,
): DispatchHandoffStatus[] {
  if (!input?.length) return [...DEFAULT_DISPATCH_HANDOFF_STATUSES];
  const normalized: DispatchHandoffStatus[] = [];
  const seen = new Set<DispatchHandoffStatus>();
  for (const raw of input) {
    const value = (() => {
      switch (raw.trim().toUpperCase()) {
        case 'UNSEEN':
          return 'UNSEEN';
        case 'SEEN':
          return 'SEEN';
        case 'ACCEPTED':
          return 'ACCEPTED';
        case 'REJECTED':
          return 'REJECTED';
        default:
          return null;
      }
    })();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_DISPATCH_HANDOFF_STATUSES];
}

interface IssueOrderMutationResult {
  fulfillment: typeof s.shipmentFulfillments.$inferSelect;
  trip: LiveTripRow;
  notificationPersisted: boolean;
}

const DEFAULT_ROUTE_SERVICE_SPEED_KPH = 35;
// Matches shipment.service.ts display name for the owned fleet.
const INTERNAL_FLEET_CARRIER_NAME = 'SilverSea';
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
    name: typeof site?.shortName === 'string'
      ? site.shortName
      : typeof site?.name === 'string' ? site.name : null,
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
  const statuses = normalizeDispatchHandoffStatuses(input.status);
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
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeId: s.routes.id,
      routeName: ROUTE_OPERATIONAL_NAME,
      routeDistanceKm: s.routes.distanceKm,
    }).from(s.dispatchHandoffs)
      .innerJoin(s.shipments, eq(s.dispatchHandoffs.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.routes, eq(s.shipments.routeId, s.routes.id))
      .where(and(
        inArray(s.dispatchHandoffs.status, statuses),
        eq(s.shipments.status, 'READY_FOR_DISPATCH'),
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
        cursor ? lt(s.dispatchHandoffs.id, cursor) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(sql`date(${s.dispatchHandoffs.vehicleNeededBy})`, date) : undefined,
        qPattern ? or(
          ilike(CUSTOMER_OPERATIONAL_NAME, qPattern),
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
        eq(s.shipments.status, 'READY_FOR_DISPATCH'),
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(sql`date(${s.dispatchHandoffs.vehicleNeededBy})`, date) : undefined,
        qPattern ? or(
          ilike(CUSTOMER_OPERATIONAL_NAME, qPattern),
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
              name: site.shortName || site.name,
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
        isNull(s.shipmentFulfillments.canceledAt),
        isNotNull(s.dispatchHandoffs.id),
        inArray(s.shipments.status, ['READY_FOR_DISPATCH', 'DISPATCHED']),
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
        cursor ? lt(s.shipmentFulfillments.id, cursor) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(dispatchDetailTransportDateSql(), date) : undefined,
        qPattern ? or(
          ilike(CUSTOMER_OPERATIONAL_NAME, qPattern),
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
      .where(and(
        isNull(s.shipmentFulfillments.canceledAt),
        isNotNull(s.dispatchHandoffs.id),
        inArray(s.shipments.status, ['READY_FOR_DISPATCH', 'DISPATCHED']),
        accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
        input.urgency ? eq(s.dispatchHandoffs.priority, input.urgency) : undefined,
        date ? eq(dispatchDetailTransportDateSql(), date) : undefined,
        qPattern ? or(
          ilike(CUSTOMER_OPERATIONAL_NAME, qPattern),
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
async function buildZoneTruckSuggestions(tx: Tx, args: {
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
function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utc = Date.UTC(year!, (month ?? 1) - 1, day ?? 1);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

/** Plain LIKE pattern check for an already-fetched value (search parity with
 *  the SQL `unaccentedIlike` used by the page query). */
function unaccentedIlikeLike(value: string, pattern: string): boolean {
  const normalize = (text: string) => text.trim().toUpperCase().replace(/\s+/g, '');
  const normalizedValue = normalize(value);
  const normalizedPattern = normalize(pattern.replace(/%/g, ''));
  return normalizedValue.includes(normalizedPattern);
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

export async function acceptDispatchHandoff(input: AcceptDispatchHandoffInput) {
  assertDispatchActor(input.actor);
  const outcome = await db.transaction(async (tx) => {
    await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
    await assertShipmentAccountingUnlocked(tx, input.shipmentId);
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
    if (fulfillments.some((row) => row.cargoMode === 'FCL' && row.plannedCarrierType == null)) {
      throw new ApiError(409, 'CUS chưa gán đủ nhà xe cho các container.');
    }
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
      // No debug marker here: this note is user-visible in the forwarder UI.
      // The LCL synthetic scope uses a `__fulfillment_lcl:` prefix that is
      // functionally read by shipment completion logic; FCL containers need no
      // such linkage marker, so we leave notes empty for operator use.
      notes: null,
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
  await assertShipmentAccountingUnlocked(tx, input.shipmentId);
  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1)
    .for('update');
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  const shipmentStatus = canonicalShipmentStatus(shipment.status);
  if (shipmentStatus !== 'READY_FOR_DISPATCH' && shipmentStatus !== 'DISPATCHED') {
    throw new ApiError(409, 'Lô hàng chưa sẵn sàng điều xe hoặc đã kết thúc.');
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
  const [containerRoute] = fulfillment.shipmentContainerId == null
    ? []
    : await tx.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.id, fulfillment.shipmentContainerId))
      .limit(1);
  const effectiveRouteId = fulfillment.cargoMode === 'FCL'
    ? containerRoute?.routeId ?? null
    : shipment.routeId;
  const [route] = effectiveRouteId == null
    ? []
    : await tx.select({ distanceKm: s.routes.distanceKm })
      .from(s.routes)
      .where(and(eq(s.routes.id, effectiveRouteId), isNull(s.routes.deletedAt)))
      .limit(1);
  if (effectiveRouteId == null || !route) {
    throw new ApiError(409, 'Container chưa có tuyến đường hợp lệ.');
  }
  const requiresPlannedCarrier = fulfillment.cargoMode === 'FCL';
  if (requiresPlannedCarrier) {
    if (fulfillment.plannedCarrierType !== 'OWN' && fulfillment.plannedCarrierType !== 'EXTERNAL') {
      throw new ApiError(409, 'CUS chưa gán nhà xe cho tác vụ này.');
    }
    if (input.carrierType !== fulfillment.plannedCarrierType) {
      throw new ApiError(409, 'Không thể đổi nhà xe đã được CUS gán tại bước điều xe.');
    }
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
  let externalCarrierVehicleId: number | null = null;
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
    externalCarrierId = requiresPlannedCarrier
      ? fulfillment.plannedExternalCarrierId
      : (input.externalCarrierId ?? null);
    if (externalCarrierId == null) throw new ApiError(409, 'Tác vụ chưa có nhà xe ngoài hợp lệ.');
    const [carrier] = await tx.select({
      id: s.customers.id,
      isCarrier: s.customers.isCarrier,
      status: s.customers.status,
      deletedAt: s.customers.deletedAt,
    }).from(s.customers).where(eq(s.customers.id, externalCarrierId)).limit(1);
    if (!carrier || carrier.deletedAt || carrier.status !== 'ACTIVE' || !carrier.isCarrier) {
      throw new ApiError(409, 'Nhà xe ngoài không còn hiệu lực.');
    }
    externalCarrierVehicleId = input.externalCarrierVehicleId ?? null;
    if (requiresPlannedCarrier && externalCarrierVehicleId == null) {
      throw new ApiError(400, 'Vui lòng chọn xe của nhà xe.');
    }
    const [carrierVehicle] = externalCarrierVehicleId == null
      ? []
      : await tx.select().from(s.carrierFleetVehicles)
        .where(and(
          eq(s.carrierFleetVehicles.id, externalCarrierVehicleId),
          eq(s.carrierFleetVehicles.carrierId, externalCarrierId),
          eq(s.carrierFleetVehicles.isActive, true),
          isNull(s.carrierFleetVehicles.deletedAt),
        ))
        .limit(1)
        .for('update');
    if (externalCarrierVehicleId != null && !carrierVehicle) {
      throw new ApiError(409, 'Xe không thuộc nhà xe đã gán hoặc không còn hoạt động.');
    }
    externalPlateNumber = carrierVehicle?.licensePlate
      ?? trimBounded(input.externalPlateNumber, 'Biển số xe ngoài', 20);
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
  if (liveTrip && input.expectedTripVersion !== undefined && liveTrip.version !== input.expectedTripVersion) {
    throw new ApiError(409, 'Lệnh điều xe đã thay đổi. Vui lòng tải lại.');
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
      routeId: effectiveRouteId,
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
      externalCarrierVehicleId,
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
      externalCarrierVehicleId,
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
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId: externalCarrierId,
    plannedExternalCarrierVehicleId: externalCarrierVehicleId,
    plannedVehiclePlateNumber: input.carrierType === 'OWN'
      ? (await tx.select({ licensePlate: s.trucks.licensePlate }).from(s.trucks).where(eq(s.trucks.id, truckId!)).limit(1))[0]?.licensePlate ?? null
      : externalPlateNumber,
    version: sql`${s.shipmentFulfillments.version} + 1`,
    updatedAt: new Date(),
  }).where(eq(s.shipmentFulfillments.id, fulfillment.id)).returning();

  if (canonicalShipmentStatus(shipment.status) === 'READY_FOR_DISPATCH') {
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
      expectedTripVersion: input.expectedTripVersion ?? null,
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
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
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

/**
 * Command boundary for correcting a published fulfillment before departure.
 * It deliberately reuses the issuance transaction so reassignment keeps the
 * same validation, optimistic locking, fulfillment projection, and durable
 * notification guarantees as first-time dispatch.
 */
export async function reassignIssuedDispatchWriteCommand(input: IssueFulfillmentDispatchOrderInput) {
  return issueFulfillmentDispatchOrder(input);
}

// ─── Dispatch detail plan grid ("Kế hoạch Chi tiết Xe") ─────────────────────
// One row per active fulfillment (container or LCL shipment). Rows exist as
// soon as CUS allocates a carrier on the master-plan screen (READY_FOR_DISPATCH
// with plannedCarrierType set), before any handoff resolution or trip — so
// unlike listDispatchQueue there is NO accepted-handoff join here.

const DISPATCH_DETAIL_PLAN_CARRIER_TYPES = ['OWN', 'EXTERNAL'] as const;

function normalizeIdList(raw: readonly (number | string)[] | null | undefined, label: string): number[] | null {
  if (!raw?.length) return null;
  const result: number[] = [];
  const seen = new Set<number>();
  for (const value of raw) {
    const id = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, `${label} không hợp lệ.`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.length > 0 ? result : null;
}

function normalizeTimeMinutes(raw: string | undefined, label: string): number | null {
  if (raw == null) return null;
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(raw);
  if (!match) {
    throw new ApiError(400, `${label} phải có định dạng HH:MM.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

// Minute granularity of the run window — coalesce closingAt then plannedReturnAt,
// same precedence the dispatch-queue date filter uses. Pinned to the business
// timezone so the JS-side display hour and the SQL filters agree regardless of
// the Postgres session timezone.
const DISPATCH_BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function dispatchEffectiveRouteIdSql() {
  return sql<number>`case when ${s.shipments.cargoMode} = 'FCL'
    then ${s.shipmentContainers.routeId}
    else ${s.shipments.routeId} end`;
}

function dispatchDetailRunMinutesSql() {
  return sql<number>`(
    extract(hour from coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) at time zone ${sql.raw(`'${DISPATCH_BUSINESS_TIME_ZONE}'`)}) * 60
    + extract(minute from coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) at time zone ${sql.raw(`'${DISPATCH_BUSINESS_TIME_ZONE}'`)})
  )`;
}

function dispatchDetailTransportDateSql() {
  // FCL work is planned on each container's own appointment date. The root
  // expectedDeliveryDate is only an earliest-date projection and stays the
  // LCL/legacy fallback.
  return sql<string>`coalesce(
    date(${s.shipmentContainers.customerAppointmentAt} at time zone ${sql.raw(`'${DISPATCH_BUSINESS_TIME_ZONE}'`)}),
    ${s.shipments.expectedDeliveryDate}
  )`;
}

// Display-side hour in the same business timezone (matches the SQL filter).
function dispatchDetailDisplayHour(closingAt: Date | null, plannedReturnAt: Date | null): number | null {
  const value = closingAt ?? plannedReturnAt;
  if (value == null) return null;
  // 7 = Asia/Ho_Chi_Minh offset (+07, no DST).
  return new Date(value.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
}

/**
 * Server-owned default priority order for the detailed-plan grid. The editor
 * may layer explicit sorting on top, but pagination always follows this
 * canonical order so page boundaries stay stable. Buckets are derived from
 * canonical container codes / fulfillment type — never translated labels.
 *
 * 1. Cargo priority: 20-foot, 40-foot, LCL, everything else.
 * 2. Direction: Import, Export, unknown.
 * 3. Transport date ascending, nulls last (same date the grid filters on).
 * 4. Fulfillment id ascending — stable tie-break.
 */
function dispatchDetailPriorityOrderSql() {
  const cargoRank = sql<number>`case
    when ${s.shipmentFulfillments.fulfillmentType} = 'LCL_SHIPMENT' then 3
    when ${s.containerTypes.code} like '20%' then 1
    when ${s.containerTypes.code} like '40%' then 2
    else 4
  end`;
  const directionRank = sql<number>`case
    when ${s.shipments.tradeDirection} = 'IMPORT' then 1
    when ${s.shipments.tradeDirection} = 'EXPORT' then 2
    else 3
  end`;
  return [
    sql`${cargoRank} asc`,
    sql`${directionRank} asc`,
    sql`coalesce(${dispatchDetailTransportDateSql()}, '9999-12-31') asc`,
    sql`${s.shipmentFulfillments.id} asc`,
  ];
}

export async function listDispatchDetailPlanRows(input: ListDispatchDetailPlanRowsInput) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const limit = normalizeLimit(input.limit, 50);
  const page = Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page as number)) : 1;
  const qPattern = buildPattern(input.q);
  const date = normalizeDate(input.date);
  const pickupIds = normalizeIdList(input.pickupIds, 'pickupIds');
  const dropoffIds = normalizeIdList(input.dropoffIds, 'dropoffIds');
  const deliveryPointIds = normalizeIdList(input.deliveryPointIds, 'deliveryPointIds');
  const hourFrom = normalizeTimeMinutes(input.hourFrom, 'hourFrom');
  const hourTo = normalizeTimeMinutes(input.hourTo, 'hourTo');
  // Zone filter takes its code from the DB taxonomy — unknown codes are a
  // client error, not an empty result (stale client, not silent nothing).
  if (input.zone != null) await requireDispatchZone(input.zone);

  return db.transaction(async (tx) => {
    // Shared filter so the rows page and the total count stay consistent
    // within one transaction.
    const filters = and(
      isNull(s.shipmentFulfillments.canceledAt),
      isNull(s.shipments.deletedAt),
      eq(s.shipments.status, 'READY_FOR_DISPATCH'),
      inArray(s.shipmentFulfillments.plannedCarrierType, [...DISPATCH_DETAIL_PLAN_CARRIER_TYPES]),
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      input.direction ? eq(s.shipments.tradeDirection, input.direction) : undefined,
      date ? eq(dispatchDetailTransportDateSql(), date) : undefined,
      pickupIds ? inArray(s.shipmentContainers.pickupPortId, pickupIds) : undefined,
      dropoffIds ? inArray(s.shipmentContainers.dropoffPortId, dropoffIds) : undefined,
      deliveryPointIds ? inArray(s.shipments.operationalSiteId, deliveryPointIds) : undefined,
      hourFrom != null ? sql`${dispatchDetailRunMinutesSql()} >= ${hourFrom}` : undefined,
      hourTo != null ? sql`${dispatchDetailRunMinutesSql()} <= ${hourTo}` : undefined,
      // Zone is stored authority: match the row's own container ports, either
      // side, against live ports in the requested zone (facet parity with the
      // master-plan per-zone port filter, zone-wide instead of per-port).
      input.zone ? or(
        sql`exists (select 1 from ${s.ports} pz where pz.id = ${s.shipmentContainers.pickupPortId} and pz.dispatch_zone = ${input.zone} and pz.deleted_at is null)`,
        sql`exists (select 1 from ${s.ports} pz where pz.id = ${s.shipmentContainers.dropoffPortId} and pz.dispatch_zone = ${input.zone} and pz.deleted_at is null)`,
      ) : undefined,
      input.assignmentStatus === 'UNASSIGNED'
        ? sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is null or ${s.shipmentFulfillments.plannedVehiclePlateNumber} = '')`
        : undefined,
      input.assignmentStatus === 'ASSIGNED'
        ? sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`
        : undefined,
      qPattern ? or(
        ilike(CUSTOMER_OPERATIONAL_NAME, qPattern),
        ilike(s.customers.name, qPattern),
        ilike(s.shipments.shipmentCode, qPattern),
        ilike(s.shipments.bookingRef, qPattern),
        ilike(s.shipments.blNumber, qPattern),
        ilike(s.shipmentContainers.containerNumber, qPattern),
      ) : undefined,
    );

    const [rows, totals] = await Promise.all([
      tx.select({
      fulfillmentId: s.shipmentFulfillments.id,
      fulfillmentVersion: s.shipmentFulfillments.version,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
      cargoMode: s.shipmentFulfillments.cargoMode,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      plannedExternalCarrierVehicleId: s.shipmentFulfillments.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
      plannedRevenue: s.shipmentFulfillments.plannedRevenue,
      plannedCarrierCost: s.shipmentFulfillments.plannedCarrierCost,
      classification: s.shipmentFulfillments.dispatchClassification,
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
      shipmentId: s.shipments.id,
      shipmentVersion: s.shipments.version,
      shipmentCode: s.shipments.shipmentCode,
      isCombined: s.shipments.isCombined,
      bookingRef: s.shipments.bookingRef,
      blNumber: s.shipments.blNumber,
      tradeDirection: s.shipments.tradeDirection,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
      closingAt: s.shipments.closingAt,
      plannedReturnAt: s.shipments.plannedReturnAt,
      transportDate: dispatchDetailTransportDateSql(),
      operationalNotes: s.shipments.operationalNotes,
      customerNotes: s.shipments.customerNotes,
      packageType: s.shipments.packageType,
      packageCount: s.shipments.packageCount,
      cargoWeightKg: s.shipments.cargoWeightKg,
      customerId: s.customers.id,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeName: ROUTE_OPERATIONAL_NAME,
      operationalSiteId: s.shipments.operationalSiteId,
      containerNumber: s.shipmentContainers.containerNumber,
      containerCargoWeightKg: s.shipmentContainers.cargoWeightKg,
      containerTypeId: s.shipmentContainers.containerTypeId,
      containerTypeName: s.containerTypes.name,
      containerTypeCode: s.containerTypes.code,
      pickupPortId: s.shipmentContainers.pickupPortId,
      dropoffPortId: s.shipmentContainers.dropoffPortId,
      tripId: s.trips.id,
      tripStatus: s.trips.status,
    }).from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
      .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
      .leftJoin(s.routes, eq(s.routes.id, dispatchEffectiveRouteIdSql()))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        ne(s.trips.status, TripStatus.CANCELED),
        isNull(s.trips.deletedAt),
      ))
      .where(filters)
      .orderBy(...dispatchDetailPriorityOrderSql())
      .limit(limit)
      .offset((page - 1) * limit),
      tx.select({ total: sql<number>`count(*)` })
        .from(s.shipmentFulfillments)
        .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
        .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
        .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
        .where(filters),
    ]);

    const pageRows = rows;
    const shipmentIds = pageRows.map((row) => row.shipmentId);
    const carrierIds = pageRows
      .map((row) => row.plannedExternalCarrierId)
      .filter((id): id is number => id != null);
    const portIds = pageRows.flatMap((row) => [row.pickupPortId, row.dropoffPortId]).filter((id): id is number => id != null);
    const [declarations, carriers, ports, platedCounts] = await Promise.all([
      loadDeclarationNumbers(tx, shipmentIds),
      carrierIds.length === 0 ? [] : tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME }).from(s.customers).where(inArray(s.customers.id, [...new Set(carrierIds)])),
      portIds.length === 0 ? [] : tx.select({ id: s.ports.id, name: s.ports.name }).from(s.ports).where(inArray(s.ports.id, [...new Set(portIds)])),
      shipmentIds.length === 0 ? [] : tx.select({
        shipmentId: s.shipmentFulfillments.shipmentId,
        total: sql<number>`count(*)`,
        plated: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`,
      }).from(s.shipmentFulfillments)
        .where(and(
          inArray(s.shipmentFulfillments.shipmentId, [...new Set(shipmentIds)]),
          isNull(s.shipmentFulfillments.canceledAt),
        ))
        .groupBy(s.shipmentFulfillments.shipmentId),
    ]);
    const carriersById = new Map(carriers.map((row) => [row.id, row]));
    const portsById = new Map(ports.map((row) => [row.id, row]));
    const platedByShipment = new Map(platedCounts.map((row) => [row.shipmentId, { total: Number(row.total), plated: Number(row.plated) }]));

    return {
      items: pageRows.map((row) => {
        const snapshot = (row.siteSnapshot ?? {}) as Record<string, unknown>;
        const deliverySite = redactDispatchSiteForAccountant(input.actor, toFrozenSiteSummary(snapshot.deliverySite));
        const plated = platedByShipment.get(row.shipmentId);
        return {
          fulfillmentId: row.fulfillmentId,
          version: row.fulfillmentVersion,
          shipmentId: row.shipmentId,
          shipmentVersion: row.shipmentVersion,
          shipmentCode: row.shipmentCode,
          isCombined: row.isCombined,
          fulfillmentType: row.fulfillmentType,
          cargoMode: row.cargoMode,
          taskStatus: row.tripId ? 'DISPATCHED' : 'READY',
          time: {
            deliveryDate: row.transportDate,
            runHour: dispatchDetailDisplayHour(row.customerAppointmentAt, row.closingAt ?? row.plannedReturnAt),
          },
          customerRoute: {
            customerName: row.customerName,
            factoryName: deliverySite.name,
            deliveryPoint: deliverySite.address,
            routeName: row.routeName,
          },
          docs: {
            billNumber: row.blNumber || row.bookingRef,
            tradeDirection: row.tradeDirection,
            declarationNumbers: declarations.get(row.shipmentId) ?? [],
          },
          container: {
            containerNumber: row.containerNumber,
            containerTypeLabel: row.containerTypeName ?? row.containerTypeCode ?? null,
            cargoWeightKg: row.containerCargoWeightKg ?? row.cargoWeightKg,
          },
          notes: {
            vehicleNote: input.actor.role === Role.ACCOUNTANT ? null : row.operationalNotes,
            customerNote: row.customerNotes,
          },
          dispatch: {
            tripId: row.tripId,
            tripStatus: row.tripStatus,
            carrierType: row.plannedCarrierType,
            carrierName: row.plannedCarrierType === 'OWN'
              ? INTERNAL_FLEET_CARRIER_NAME
              : row.plannedExternalCarrierId
                ? carriersById.get(row.plannedExternalCarrierId)?.name ?? null
                : null,
            externalCarrierId: row.plannedExternalCarrierId,
            externalCarrierVehicleId: row.plannedExternalCarrierVehicleId,
            assignedPlate: row.plannedVehiclePlateNumber,
          },
          estimates: {
            plannedRevenue: row.plannedRevenue,
            plannedCarrierCost: row.plannedCarrierCost,
          },
          // NOT NULL DEFAULT 'SINGLE': fresh containers surface as "Đơn"
          // until dispatch reclassifies them.
          classification: row.classification,
          ports: {
            pickupPortId: row.pickupPortId,
            pickupPortName: row.pickupPortId ? portsById.get(row.pickupPortId)?.name ?? null : null,
            dropoffPortId: row.dropoffPortId,
            dropoffPortName: row.dropoffPortId ? portsById.get(row.dropoffPortId)?.name ?? null : null,
          },
          lotFullyPlated: plated != null && plated.total > 0 && plated.plated === plated.total,
        };
      }),
      limit,
      total: Number(totals[0]?.total ?? 0),
      page,
      pageSize: limit,
    };
  });
}

// Distinct dropoff delivery points for the filter-bar multi-select facet.
// Scoped to the accountant's customer set like the rows endpoint.
export async function listDispatchDeliveryPointFacets(input: { actor: AuthUser; q?: string }) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const qPattern = buildPattern(input.q);
  const rows = await db.selectDistinct({ id: s.operationalSites.id, name: SITE_OPERATIONAL_NAME })
    .from(s.shipments)
    .innerJoin(s.shipmentFulfillments, and(
      eq(s.shipmentFulfillments.shipmentId, s.shipments.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .innerJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
    .where(and(
      isNull(s.shipments.deletedAt),
      eq(s.shipments.status, 'READY_FOR_DISPATCH'),
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      qPattern ? or(ilike(SITE_OPERATIONAL_NAME, qPattern), ilike(s.operationalSites.name, qPattern)) : undefined,
    ))
    .orderBy(asc(SITE_OPERATIONAL_NAME))
    .limit(100);
  return { items: rows };
}

// Distinct pickup/dropoff ports for the filter-bar multi-select facets
// (spec §2 "Điểm Nâng / Hạ / Trả"). Scoped to the accountant's customer set
// like the rows endpoint.
export async function listDispatchPortFacets(
  input: { actor: AuthUser; q?: string },
  kind: 'pickup' | 'dropoff',
) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const qPattern = buildPattern(input.q);
  const portColumn = kind === 'pickup' ? s.shipmentContainers.pickupPortId : s.shipmentContainers.dropoffPortId;
  const rows = await db.selectDistinct({ id: s.ports.id, name: s.ports.name })
    .from(s.shipments)
    .innerJoin(s.shipmentFulfillments, and(
      eq(s.shipmentFulfillments.shipmentId, s.shipments.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .innerJoin(s.shipmentContainers, and(
      eq(s.shipmentContainers.shipmentId, s.shipments.id),
      isNotNull(portColumn),
    ))
    .innerJoin(s.ports, eq(s.ports.id, portColumn))
    .where(and(
      isNull(s.shipments.deletedAt),
      eq(s.shipments.status, 'READY_FOR_DISPATCH'),
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      qPattern ? ilike(s.ports.name, qPattern) : undefined,
    ))
    .orderBy(asc(s.ports.name))
    .limit(100);
  return { items: rows };
}

interface PlateMutationResult {
  fulfillmentId: number;
  version: number;
  lotFullyPlated: boolean;
  driverNotified: boolean;
  assignedPlate: string | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
}

interface CarrierMutationResult {
  fulfillmentId: number;
  version: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName: string;
  externalCarrierVehicleId: null;
  assignedPlate: null;
  lotFullyPlated: boolean;
}

// Same display normalization the carrier vehicle catalog uses
// (carrier-fleet-vehicle.service.ts formatPlate): trim, uppercase, collapse
// internal whitespace.
function normalizeFreeTextPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Reassign exactly one ready fulfillment from the detailed vehicle workspace.
 * The master-plan allocation remains the aggregate planning surface; this
 * command only changes the selected operational task and atomically removes
 * its now-incompatible vehicle/plate assignment.
 */
export async function assignFulfillmentCarrierWriteCommand(input: AssignFulfillmentCarrierInput): Promise<CarrierMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<CarrierMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CARRIER_ASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      carrierType: input.carrierType,
      externalCarrierId: input.externalCarrierId,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => assignFulfillmentCarrierInTx(tx, input),
  });
  return { ...outcome.result, replayed: outcome.replayed };
}

async function assignFulfillmentCarrierInTx(tx: Tx, input: AssignFulfillmentCarrierInput): Promise<CarrierMutationResult> {
  // Read the parent id first, then use the same shipment → fulfillment lock
  // order as dispatch issuance so this mutation cannot deadlock with it.
  const [candidate] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .limit(1);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');

  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, candidate.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  await assertActorCanAccessShipment(tx, shipment.id, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  if (canonicalShipmentStatus(shipment.status) !== 'READY_FOR_DISPATCH') {
    throw new ApiError(409, 'Chỉ được đổi nhà xe khi lô đang sẵn sàng điều xe.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .for('update')
    .limit(1);
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  if (await loadLiveTripForFulfillment(tx, fulfillment.id)) {
    throw new ApiError(409, 'Không thể đổi nhà xe sau khi đã phát hành lệnh điều xe.');
  }

  let carrierName = INTERNAL_FLEET_CARRIER_NAME;
  if (input.carrierType === 'OWN') {
    if (input.externalCarrierId != null) throw new ApiError(400, 'Xe nội bộ không dùng mã nhà xe ngoài.');
  } else {
    if (input.externalCarrierId == null) throw new ApiError(400, 'Nhà xe ngoài là bắt buộc.');
    const [carrier] = await tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.externalCarrierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
    carrierName = carrier.name;
  }

  const [updated] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId: input.carrierType === 'EXTERNAL' ? input.externalCarrierId : null,
    plannedExternalCarrierVehicleId: null,
    plannedVehiclePlateNumber: null,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  return {
    fulfillmentId: updated.id,
    version: updated.version,
    carrierType: input.carrierType,
    externalCarrierId: input.carrierType === 'EXTERNAL' ? input.externalCarrierId : null,
    carrierName,
    externalCarrierVehicleId: null,
    assignedPlate: null,
    lotFullyPlated: await recomputeLotFullyPlated(tx, shipment.id),
  };
}

export async function assignFulfillmentPlate(input: AssignFulfillmentPlateInput): Promise<PlateMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<PlateMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLATE_ASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clear: input.clear === true,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => assignFulfillmentPlateInTx(tx, input),
  });

  const result = outcome.result;
  if (!outcome.replayed && result.driverNotified) {
    const notificationPayload = buildPlateAssignmentNotificationPayload(result);
    if (hasExplicitNotificationTarget(notificationPayload)) {
      await sendNotificationPush(notificationPayload).catch((error) => {
        console.error('Plate-assignment push delivery failed after commit:', error);
      });
    }
  }
  return { ...result, replayed: outcome.replayed };
}

function buildPlateAssignmentNotificationPayload(result: PlateMutationResult): NotificationPayload {
  return {
    type: NotificationType.TRIP_DISPATCHED,
    title: 'Phân công chạy mới',
    message: result.assignedPlate
      ? `Bạn được phân công chạy xe biển ${result.assignedPlate}`
      : 'Bạn có phân công chạy mới',
    relatedEntityType: 'shipment_fulfillments',
    relatedEntityId: result.fulfillmentId,
    targetDriverId: result.assignedDriverId ?? undefined,
  };
}

interface DispatchVehicleResolution {
  plannedVehiclePlateNumber: string | null;
  plannedExternalCarrierVehicleId: number | null;
  assignedTruckId: number | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
}

/**
 * Resolve the editor's vehicle selection into fulfillment columns. Shared by
 * the legacy plate endpoint and the atomic plan save. Vehicle ownership is
 * validated against the passed carrier — for the atomic save that is the
 * incoming carrier, so carrier and vehicle can switch together without
 * stranding a stale carrier-vehicle link.
 */
async function resolveDispatchVehicleAssignment(tx: Tx, args: {
  carrierType: 'OWN' | 'EXTERNAL';
  plannedExternalCarrierId: number | null;
  truckId: number | null;
  externalCarrierVehicleId: number | null;
  plateNumber: string | null;
  clear: boolean;
}): Promise<DispatchVehicleResolution> {
  let plannedVehiclePlateNumber: string | null = null;
  let plannedExternalCarrierVehicleId: number | null = null;
  let assignedTruckId: number | null = null;
  let assignedDriverId: number | null = null;
  let assignedDriverName: string | null = null;
  let driverHint: string | null = null;

  if (args.clear) {
    // Clear path: both carrier types allowed; un-assign everything.
  } else if (args.carrierType === 'OWN') {
    if (args.truckId == null) {
      throw new ApiError(400, 'Xe nội bộ phải chọn biển số từ đội xe công ty.');
    }
    if (args.plateNumber != null || args.externalCarrierVehicleId != null) {
      throw new ApiError(400, 'Nhà xe nội bộ không dùng biển số tự do hoặc xe nhà thầu.');
    }
    const [truck] = await tx.select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      status: s.trucks.status,
      deletedAt: s.trucks.deletedAt,
    }).from(s.trucks).where(eq(s.trucks.id, args.truckId)).limit(1);
    if (!truck || truck.deletedAt || truck.status !== 'ACTIVE') {
      throw new ApiError(409, 'Xe đầu kéo không còn hiệu lực.');
    }
    const [driver] = await tx.select({
      id: s.drivers.id,
      name: s.drivers.name,
      userId: s.drivers.userId,
      status: s.drivers.status,
      deletedAt: s.drivers.deletedAt,
    }).from(s.drivers)
      .where(and(
        eq(s.drivers.assignedTruckId, truck.id),
        isNull(s.drivers.deletedAt),
        eq(s.drivers.status, 'ACTIVE'),
      ))
      .limit(1);
    plannedVehiclePlateNumber = truck.licensePlate;
    assignedTruckId = truck.id;
    if (driver) {
      assignedDriverId = driver.id;
      assignedDriverName = driver.name;
      if (driver.userId == null) driverHint = 'Lái xe chưa có tài khoản đăng nhập.';
    } else {
      driverHint = 'Chưa có lái xe gắn với xe.';
    }
  } else {
    // EXTERNAL: catalog pick, free text, or empty (CUS fills later).
    if (args.externalCarrierVehicleId != null) {
      if (args.plateNumber != null) {
        throw new ApiError(400, 'Chỉ chọn một nguồn biển số: xe nhà thầu hoặc nhập tay.');
      }
      const [vehicle] = await tx.select({
        id: s.carrierFleetVehicles.id,
        carrierId: s.carrierFleetVehicles.carrierId,
        licensePlate: s.carrierFleetVehicles.licensePlate,
        isActive: s.carrierFleetVehicles.isActive,
        deletedAt: s.carrierFleetVehicles.deletedAt,
      }).from(s.carrierFleetVehicles)
        .where(eq(s.carrierFleetVehicles.id, args.externalCarrierVehicleId))
        .limit(1);
      if (!vehicle || vehicle.deletedAt || !vehicle.isActive) {
        throw new ApiError(409, 'Xe nhà thầu không còn hiệu lực.');
      }
      if (args.plannedExternalCarrierId != null && vehicle.carrierId !== args.plannedExternalCarrierId) {
        throw new ApiError(409, 'Xe không thuộc nhà xe được phân công.');
      }
      plannedVehiclePlateNumber = vehicle.licensePlate;
      plannedExternalCarrierVehicleId = vehicle.id;
    } else if (args.plateNumber != null) {
      const normalized = normalizeFreeTextPlate(args.plateNumber);
      const trimmed = args.plateNumber.trim();
      if (trimmed.length < 4 || trimmed.length > 20) {
        throw new ApiError(400, 'Biển số xe không hợp lệ.');
      }
      plannedVehiclePlateNumber = normalized;
      // Match against the vendor catalog so a typed plate matching an existing
      // entry links to it instead of creating a phantom free-text plate.
      if (args.plannedExternalCarrierId != null) {
        const normalizedCatalogKey = normalized.replace(/[^A-Z0-9]/g, '');
        const [match] = await tx.select({
          id: s.carrierFleetVehicles.id,
        }).from(s.carrierFleetVehicles)
          .where(and(
            eq(s.carrierFleetVehicles.carrierId, args.plannedExternalCarrierId),
            eq(s.carrierFleetVehicles.normalizedPlate, normalizedCatalogKey),
            isNull(s.carrierFleetVehicles.deletedAt),
          ))
          .limit(1);
        plannedExternalCarrierVehicleId = match?.id ?? null;
      }
    }
    // else: empty assignment (bypass) — plate stays null, allowed for EXTERNAL.
  }

  return {
    plannedVehiclePlateNumber,
    plannedExternalCarrierVehicleId,
    assignedTruckId,
    assignedDriverId,
    assignedDriverName,
    driverHint,
  };
}

/**
 * Notify only when the truck actually changes (dedupe re-assign of same
 * truck): skip when the stored plate/vehicle is already identical, OR when a
 * notification for this fulfillment+driver+plate pair was already delivered
 * (covers clear → re-assign of the same truck). Shared by the legacy plate
 * endpoint and the atomic plan save.
 */
async function decideDispatchDriverNotification(tx: Tx, args: {
  fulfillment: typeof s.shipmentFulfillments.$inferSelect;
  carrierType: 'OWN' | 'EXTERNAL';
  clear: boolean;
  vehicle: DispatchVehicleResolution;
}): Promise<boolean> {
  const { fulfillment, vehicle } = args;
  const sameTruck = vehicle.assignedTruckId != null
    && fulfillment.plannedVehiclePlateNumber === vehicle.plannedVehiclePlateNumber
    && fulfillment.plannedExternalCarrierVehicleId === vehicle.plannedExternalCarrierVehicleId;
  let previouslyNotified = false;
  if (!sameTruck && vehicle.assignedDriverId != null && vehicle.plannedVehiclePlateNumber != null) {
    // Notifications are user-keyed; resolve the assigned driver's login user.
    const [driverRow] = await tx.select({ userId: s.drivers.userId }).from(s.drivers)
      .where(eq(s.drivers.id, vehicle.assignedDriverId))
      .limit(1);
    if (driverRow?.userId != null) {
      const [prior] = await tx.select({ id: s.notifications.id }).from(s.notifications)
        .where(and(
          eq(s.notifications.type, NotificationType.TRIP_DISPATCHED),
          eq(s.notifications.relatedEntityType, 'shipment_fulfillments'),
          eq(s.notifications.relatedEntityId, fulfillment.id),
          eq(s.notifications.userId, driverRow.userId),
          sql`${s.notifications.message} like ${`%${vehicle.plannedVehiclePlateNumber}%`}`,
        ))
        .limit(1);
      previouslyNotified = prior != null;
    }
  }
  return args.carrierType === 'OWN'
    && !args.clear
    && vehicle.assignedTruckId != null
    && !sameTruck
    && !previouslyNotified
    && vehicle.assignedDriverId != null;
}

async function assignFulfillmentPlateInTx(tx: Tx, input: AssignFulfillmentPlateInput): Promise<PlateMutationResult> {
  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  const carrierType = fulfillment.plannedCarrierType;
  if (carrierType !== 'OWN' && carrierType !== 'EXTERNAL') {
    throw new ApiError(409, 'CUS chưa gán nhà xe cho tác vụ này.');
  }

  await assertShipmentAccountingUnlocked(tx, fulfillment.shipmentId);

  const vehicle = await resolveDispatchVehicleAssignment(tx, {
    carrierType,
    plannedExternalCarrierId: fulfillment.plannedExternalCarrierId,
    truckId: input.truckId ?? null,
    externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
    plateNumber: input.plateNumber ?? null,
    clear: input.clear === true,
  });

  const shouldNotifyDriver = await decideDispatchDriverNotification(tx, {
    fulfillment,
    carrierType,
    clear: input.clear === true,
    vehicle,
  });

  const [updated] = await tx.update(s.shipmentFulfillments).set({
    plannedVehiclePlateNumber: vehicle.plannedVehiclePlateNumber,
    plannedExternalCarrierVehicleId: vehicle.plannedExternalCarrierVehicleId,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  const lotFullyPlated = await recomputeLotFullyPlated(tx, fulfillment.shipmentId);

  if (shouldNotifyDriver) {
    await persistNotificationInTx(tx, buildPlateAssignmentNotificationPayload({
      fulfillmentId: fulfillment.id,
      version: updated.version,
      lotFullyPlated,
      driverNotified: true,
      assignedPlate: vehicle.plannedVehiclePlateNumber,
      assignedDriverId: vehicle.assignedDriverId,
      assignedDriverName: vehicle.assignedDriverName,
      driverHint: vehicle.driverHint,
    }));
  }

  return {
    fulfillmentId: fulfillment.id,
    version: updated.version,
    lotFullyPlated,
    driverNotified: shouldNotifyDriver,
    assignedPlate: vehicle.plannedVehiclePlateNumber,
    assignedDriverId: vehicle.assignedDriverId,
    assignedDriverName: vehicle.assignedDriverName,
    driverHint: vehicle.driverHint,
  };
}

interface FulfillmentEstimatesMutationResult {
  fulfillmentId: number;
  version: number;
  plannedRevenue: string | null;
  plannedCarrierCost: string | null;
}

/**
 * Saves an operational estimate only.  Financial postings stay exclusively in
 * the accounting workflow, and the accounting lock also protects this plan.
 */
export async function updateFulfillmentEstimates(
  input: UpdateFulfillmentEstimatesInput,
): Promise<FulfillmentEstimatesMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<FulfillmentEstimatesMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_ESTIMATES_UPDATE,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      plannedRevenue: input.plannedRevenue,
      plannedCarrierCost: input.plannedCarrierCost,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: async (tx) => {
      const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
        .where(and(
          eq(s.shipmentFulfillments.id, input.fulfillmentId),
          isNull(s.shipmentFulfillments.canceledAt),
        ))
        .limit(1)
        .for('update');
      if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
      if (fulfillment.version !== input.expectedVersion) {
        throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      }

      await assertShipmentAccountingUnlocked(tx, fulfillment.shipmentId);
      const [updated] = await tx.update(s.shipmentFulfillments).set({
        plannedRevenue: input.plannedRevenue == null ? null : String(input.plannedRevenue),
        plannedCarrierCost: input.plannedCarrierCost == null ? null : String(input.plannedCarrierCost),
        version: fulfillment.version + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(s.shipmentFulfillments.id, fulfillment.id),
        eq(s.shipmentFulfillments.version, fulfillment.version),
      )).returning();
      if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      return {
        fulfillmentId: updated.id,
        version: updated.version,
        plannedRevenue: updated.plannedRevenue,
        plannedCarrierCost: updated.plannedCarrierCost,
      };
    },
  });
  return { ...outcome.result, replayed: outcome.replayed };
}

/**
 * Atomic editor save for one detailed-plan row. Locks shipment then
 * fulfillment (the same order as dispatch issuance, so this cannot deadlock
 * with it), applies the union of the strongest legacy guards, updates both
 * versioned rows in one transaction, persists the in-app driver notification
 * transactionally, and returns the complete row state. Web Push stays a
 * best-effort post-commit side effect — only attempted on a new own-truck
 * transition, never on replay.
 */
export async function updateDispatchDetailPlan(input: UpdateDispatchDetailPlanInput): Promise<DispatchDetailPlanMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<DispatchDetailPlanMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLAN_UPDATE,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedFulfillmentVersion: input.expectedFulfillmentVersion,
      expectedShipmentVersion: input.expectedShipmentVersion,
      carrierType: input.carrierType,
      externalCarrierId: input.externalCarrierId ?? null,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clearVehicle: input.clearVehicle === true,
      plannedRevenue: input.plannedRevenue,
      plannedCarrierCost: input.plannedCarrierCost,
      classification: input.classification,
      isCombined: input.isCombined,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => updateDispatchDetailPlanInTx(tx, input),
  });

  const result = outcome.result;
  // Best-effort post-commit push — mirrors the legacy plate endpoint. The
  // durable in-app row (persisted in-tx) is the delivery guarantee; this
  // surface ping may fail silently without affecting the write.
  if (!outcome.replayed && result.driverNotified) {
    const notificationPayload = buildPlateAssignmentNotificationPayload({
      fulfillmentId: result.fulfillmentId,
      version: result.fulfillmentVersion,
      lotFullyPlated: result.lotFullyPlated,
      driverNotified: true,
      assignedPlate: result.dispatch.assignedPlate,
      assignedDriverId: null,
      assignedDriverName: null,
      driverHint: result.driverHint,
    });
    if (hasExplicitNotificationTarget(notificationPayload)) {
      await sendNotificationPush(notificationPayload).catch((error) => {
        console.error('Atomic plan-save push delivery failed after commit:', error);
      });
    }
  }
  return { ...result, replayed: outcome.replayed };
}

async function updateDispatchDetailPlanInTx(tx: Tx, input: UpdateDispatchDetailPlanInput): Promise<DispatchDetailPlanMutationResult> {
  // Lock shipment first, then fulfillment — the dispatch-issuance lock order.
  const [candidate] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .limit(1);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');

  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, candidate.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');

  // Union of the strongest guards from every legacy single-field endpoint.
  await assertActorCanAccessShipment(tx, shipment.id, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  if (canonicalShipmentStatus(shipment.status) !== 'READY_FOR_DISPATCH') {
    throw new ApiError(409, 'Chỉ được lưu kế hoạch khi lô đang sẵn sàng điều xe.');
  }
  if (shipment.version !== input.expectedShipmentVersion) {
    throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedFulfillmentVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  if (await loadLiveTripForFulfillment(tx, fulfillment.id)) {
    throw new ApiError(409, 'Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe.');
  }

  // Carrier resolution — validated before any write, so an invalid carrier
  // changes nothing (all-or-nothing).
  let carrierName = INTERNAL_FLEET_CARRIER_NAME;
  let plannedExternalCarrierId: number | null = null;
  if (input.carrierType === 'OWN') {
    if (input.externalCarrierId != null) throw new ApiError(400, 'Xe nội bộ không dùng mã nhà xe ngoài.');
  } else {
    if (input.externalCarrierId == null) throw new ApiError(400, 'Nhà xe ngoài là bắt buộc.');
    const [carrier] = await tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.externalCarrierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
    carrierName = carrier.name;
    plannedExternalCarrierId = carrier.id;
  }

  // Vehicle resolution validates ownership against the incoming carrier. In
  // the atomic save the vehicle block is optional for both carrier types: an
  // editor save that changes only estimates/classification sends no vehicle
  // fields and leaves the plate untouched (null → keep stored columns) —
  // EXCEPT on a carrier switch, where an unspecified vehicle means "none for
  // the new carrier" and the previous carrier's vehicle/plate columns are
  // cleared, mirroring the legacy carrier endpoint.
  const carrierSwitched = fulfillment.plannedCarrierType !== input.carrierType;
  const vehicleSelected = input.truckId != null
    || input.externalCarrierVehicleId != null
    || input.plateNumber != null
    || input.clearVehicle === true
    || carrierSwitched;
  let vehicle: DispatchVehicleResolution | null = null;
  if (vehicleSelected) {
    vehicle = await resolveDispatchVehicleAssignment(tx, {
      carrierType: input.carrierType,
      plannedExternalCarrierId,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clear: input.clearVehicle === true || (carrierSwitched && input.truckId == null && input.externalCarrierVehicleId == null && input.plateNumber == null),
    });
  }

  const shouldNotifyDriver = vehicle != null && await decideDispatchDriverNotification(tx, {
    fulfillment,
    carrierType: input.carrierType,
    clear: input.clearVehicle === true,
    vehicle,
  });

  // Fulfillment row: assignment snapshot + estimates + classification.
  // Without a vehicle block the stored vehicle columns keep their values.
  const [updatedFulfillment] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId,
    ...(vehicle != null ? {
      plannedExternalCarrierVehicleId: vehicle.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: vehicle.plannedVehiclePlateNumber,
    } : {}),
    plannedRevenue: input.plannedRevenue == null ? null : String(input.plannedRevenue),
    plannedCarrierCost: input.plannedCarrierCost == null ? null : String(input.plannedCarrierCost),
    dispatchClassification: input.classification,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updatedFulfillment) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  // Shipment row: isCombined is lot-level and independent of classification.
  // Version bumps only when the flag actually changes — a save that keeps the
  // current value must not invalidate other tabs' shipment version.
  let shipmentVersion = shipment.version;
  if (shipment.isCombined !== input.isCombined) {
    const [updatedShipment] = await tx.update(s.shipments).set({
      isCombined: input.isCombined,
      version: shipment.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(s.shipments.id, shipment.id),
      eq(s.shipments.version, shipment.version),
    )).returning();
    if (!updatedShipment) throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
    shipmentVersion = updatedShipment.version;
  }

  const lotFullyPlated = await recomputeLotFullyPlated(tx, shipment.id);

  // In-app assignment notification lives inside the transaction — exactly
  // once per actual transition, never on replay.
  if (shouldNotifyDriver && vehicle != null) {
    await persistNotificationInTx(tx, buildPlateAssignmentNotificationPayload({
      fulfillmentId: fulfillment.id,
      version: updatedFulfillment.version,
      lotFullyPlated,
      driverNotified: true,
      assignedPlate: vehicle.plannedVehiclePlateNumber,
      assignedDriverId: vehicle.assignedDriverId,
      assignedDriverName: vehicle.assignedDriverName,
      driverHint: vehicle.driverHint,
    }));
  }

  return {
    fulfillmentId: updatedFulfillment.id,
    fulfillmentVersion: updatedFulfillment.version,
    shipmentId: shipment.id,
    shipmentVersion,
    classification: updatedFulfillment.dispatchClassification,
    isCombined: input.isCombined,
    dispatch: {
      carrierType: input.carrierType,
      carrierName,
      externalCarrierId: plannedExternalCarrierId,
      externalCarrierVehicleId: vehicle?.plannedExternalCarrierVehicleId ?? updatedFulfillment.plannedExternalCarrierVehicleId,
      assignedPlate: vehicle?.plannedVehiclePlateNumber ?? updatedFulfillment.plannedVehiclePlateNumber,
    },
    estimates: {
      plannedRevenue: updatedFulfillment.plannedRevenue,
      plannedCarrierCost: updatedFulfillment.plannedCarrierCost,
    },
    lotFullyPlated,
    driverNotified: shouldNotifyDriver,
    driverHint: vehicle?.driverHint ?? null,
  };
}

async function recomputeLotFullyPlated(tx: Tx, shipmentId: number): Promise<boolean> {
  const [counts] = await tx.select({
    total: sql<number>`count(*)`,
    plated: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
  const total = Number(counts?.total ?? 0);
  const plated = Number(counts?.plated ?? 0);
  return total > 0 && plated === total;
}

// ─── Master-plan per-zone port facet (phase-02) ────────────────────────────────

/**
 * Port options for the master-plan zone multi-select: ports whose PERSISTED
 * dispatch_zone equals the requested code. Zone membership is stored
 * authority, never inferred from names at request time. Scoped to the actor
 * like every other dispatch read.
 */
export async function listZonePortFacets(input: { actor: AuthUser; zone: string; q?: string }) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const qPattern = buildPattern(input.q);
  void accountantCustomerIds; // catalog read; actor scoping happens on the row set, not the port list
  // Container-direct like the portIds facet predicate: the master grid lists
  // all statuses and fulfillments only exist from READY_FOR_DISPATCH onward.
  const rows = await db.selectDistinct({ id: s.ports.id, name: s.ports.name, code: s.ports.code })
    .from(s.shipments)
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.shipmentId, s.shipments.id))
    .innerJoin(s.ports, and(
      or(
        eq(s.ports.id, s.shipmentContainers.pickupPortId),
        eq(s.ports.id, s.shipmentContainers.dropoffPortId),
      ),
      eq(s.ports.dispatchZone, input.zone),
      isNull(s.ports.deletedAt),
    ))
    .where(and(
      isNull(s.shipments.deletedAt),
      qPattern ? ilike(s.ports.name, qPattern) : undefined,
    ))
    .orderBy(asc(s.ports.name))
    .limit(100);
  return { items: rows };
}

// ─── Zone truck presence (detail plan panel) ──────────────────────────────────

/** Evidence that one truck has zone work on a given day. */
export interface ZoneTruckPresenceEvidence {
  reason: 'D-1_DROP' | 'D+1_PICKUP';
  date: string;
  containerNumber: string | null;
  portName: string;
}

/** One truck with its zone evidence around the viewing date. */
export interface ZoneTruckPresenceItem {
  truckId: number;
  plateNumber: string;
  evidence: ZoneTruckPresenceEvidence[];
}

/**
 * Resolve a zone code against the live taxonomy and return its operator label.
 * Unknown/inactive zones are a client error — every zone-scoped surface takes
 * its zone from the /dispatch-zones list, so an unknown code means a stale
 * client, not an empty result.
 */
export async function requireDispatchZone(zone: string): Promise<string> {
  const [row] = await db.select({ label: s.dispatchZones.label })
    .from(s.dispatchZones)
    .where(and(eq(s.dispatchZones.code, zone), eq(s.dispatchZones.isActive, true)))
    .limit(1);
  if (!row) throw new ApiError(400, 'Khu vực điều phối không hợp lệ.');
  return row.label;
}

/**
 * Which OWN trucks have work in `zone` around a viewing date D: a truck that
 * drops a container at a zone port on D-1 (ready for a zone order on D) or
 * picks one up from the zone on D+1 (already committed there). The
 * fleet-picker suggestion engine inverted: instead of tagging trucks for one
 * fulfillment's dropdown, return every truck with evidence for the day being
 * planned.
 *
 * Semantics identical to `buildZoneTruckSuggestions` (single source of truth
 * for plate matching and work-date coalescing): evidence comes from active
 * planned fulfillments joined to zoned ports via containers, matched to owned
 * trucks by normalized plate; workDate = the live trip's departureDate
 * falling back to the shipment's expected delivery date. Advisory only —
 * evidence exposes containerNumber + portName, never customer or shipment.
 */
export async function listZoneTruckPresence(input: { actor: AuthUser; zone: string; date?: string }) {
  assertDispatchReadActor(input.actor);
  // Same accountant scoping as the detail rows this panel sits beside: the
  // evidence exposes container numbers, not just catalog data.
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const zoneLabel = await requireDispatchZone(input.zone);
  // Default viewing date = today in the dispatch business timezone. 7 =
  // Asia/Ho_Chi_Minh offset (+07, no DST).
  const date = normalizeDate(input.date)
    ?? new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const dayBefore = addCalendarDays(date, -1);
  const dayAfter = addCalendarDays(date, 1);

  // Planned work date: live trip's departure date when present, else the
  // shipment's expected delivery date. Canceled/deleted trips never count.
  const workDateSql = sql<string>`coalesce(${s.trips.departureDate}, ${s.shipments.expectedDeliveryDate})`;

  const evidence = await db.select({
    truckId: s.trucks.id,
    plateNumber: s.trucks.licensePlate,
    // Whether the JOINED LH port is the container's dropoff (vs pickup) —
    // with an OR port join this distinguishes which side matched.
    isDropoff: sql<boolean>`(${s.shipmentContainers.dropoffPortId} = ${s.ports.id})`,
    workDate: workDateSql,
    containerNumber: s.shipmentContainers.containerNumber,
    portName: s.ports.name,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
    .innerJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
    .innerJoin(s.ports, and(
      or(
        eq(s.shipmentContainers.dropoffPortId, s.ports.id),
        eq(s.shipmentContainers.pickupPortId, s.ports.id),
      ),
      isNull(s.ports.deletedAt),
      eq(s.ports.dispatchZone, input.zone),
    ))
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
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      // Only D-1 / D+1 work dates can ever produce evidence.
      sql`${workDateSql} in (${dayBefore}, ${dayAfter})`,
    ))
    .limit(500);

  const byTruck = new Map<number, ZoneTruckPresenceItem>();
  for (const row of evidence) {
    const workDay = String(row.workDate).slice(0, 10);
    let reason: ZoneTruckPresenceEvidence['reason'] | null = null;
    // Dropoff in the zone on D-1 → the truck is near the zone the day before.
    if (row.isDropoff && workDay === dayBefore) reason = 'D-1_DROP';
    // Pickup from the zone on D+1 → the truck must be there the day after.
    if (!row.isDropoff && workDay === dayAfter) reason = 'D+1_PICKUP';
    if (reason == null) continue;
    const entry = byTruck.get(row.truckId) ?? {
      truckId: row.truckId,
      plateNumber: row.plateNumber ?? '',
      evidence: [],
    };
    entry.evidence.push({ reason, date: workDay, containerNumber: row.containerNumber, portName: row.portName });
    byTruck.set(row.truckId, entry);
  }

  // Both signals first, then D-1, then D+1; plate tie-break — same merged
  // visible order as the fleet-picker suggestions.
  const rank = (ev: ZoneTruckPresenceEvidence[]) => {
    const hasDrop = ev.some((e) => e.reason === 'D-1_DROP');
    const hasPickup = ev.some((e) => e.reason === 'D+1_PICKUP');
    return hasDrop && hasPickup ? 0 : hasDrop ? 1 : 2;
  };
  const items = [...byTruck.values()]
    .sort((a, b) =>
      rank(a.evidence) - rank(b.evidence)
      || a.plateNumber.localeCompare(b.plateNumber, 'vi'));
  return { date, zone: input.zone, zoneLabel, items };
}
