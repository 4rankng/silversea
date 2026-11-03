/**
 * dispatch-planning utils — pure cursor/normalization helpers, actor guards, shared SQL fragments.
 * Extracted from dispatch-planning.service.ts (structure-only split, no behavior change).
 * Layering: utils <- queries <- detail; utils <- commands <- detail (keep acyclic).
 */
import type { Executor, Tx } from '../db';
import { ApiError } from '../errors';


import { type NotificationPayload } from './notification.service';





import { operationalName } from '../db/master-data-name';
import { escapeLikeTerm } from '../lib/format';
import { asc, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { NotificationType, Role, LCL_PICKUP_TRAILER_TYPE } from '@tingting/shared';

import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';

export const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);


export const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

export const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);

export const PORT_OPERATIONAL_NAME = operationalName(s.ports.shortName, s.ports.name);


// Canonical database-handle types live in ../db (the one Executor seam).
// Re-exported here for the dispatch modules that already import Tx from utils;
// import from ../db in new code.
export type { Executor, Tx };

export type LiveTripRow = Pick<
  typeof s.tripsComposite.$inferSelect,
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
  | 'departureDate'
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

/** Shared post-write trip projection — kept identical to LiveTripRow. */

export const LIVE_TRIP_RETURNING = {
  id: s.tripsComposite.id,
  version: s.tripsComposite.version,
  tripCode: s.tripsComposite.tripCode,
  status: s.tripsComposite.status,
  shipmentId: s.tripsComposite.shipmentId,
  fulfillmentId: s.tripsComposite.fulfillmentId,
  carrierType: s.tripsComposite.carrierType,
  truckId: s.tripsComposite.truckId,
  driverId: s.tripsComposite.driverId,
  trailerId: s.tripsComposite.trailerId,
  departureDate: s.tripsComposite.departureDate,
  plannedStartAt: s.tripsComposite.plannedStartAt,
  plannedEndAt: s.tripsComposite.plannedEndAt,
  externalEntityId: s.tripsComposite.externalEntityId,
  externalEntityType: s.tripsComposite.externalEntityType,
  externalPlateNumber: s.tripsComposite.externalPlateNumber,
  externalDriverName: s.tripsComposite.externalDriverName,
  externalDriverPhone: s.tripsComposite.externalDriverPhone,
  createdBy: s.tripsComposite.createdBy,
  createdAt: s.tripsComposite.createdAt,
  updatedAt: s.tripsComposite.updatedAt,
};

export type DispatchActor = AuthUser & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER };


export type DispatchHandoffStatus = typeof s.dispatchHandoffs.status.enumValues[number];

export type DispatchQueueStatus = 'READY' | 'DISPATCHED';

export type DispatchFleetResource = 'TRUCK' | 'DRIVER' | 'EXTERNAL_CARRIER' | 'EXTERNAL_VEHICLE';

export const DEFAULT_DISPATCH_HANDOFF_STATUSES: readonly DispatchHandoffStatus[] = ['UNSEEN', 'SEEN'];


export type DispatchCursorScope = 'dispatch-handoffs' | 'dispatch-queue' | 'dispatch-detail-plan';


export interface DispatchListCursorPayload {
  v: 1;
  scope: DispatchCursorScope;
  id: number;
}


export interface DispatchFleetCursorPayload {
  v: 1;
  scope: 'dispatch-fleet';
  resource: DispatchFleetResource;
  sortKey: string;
  id: number;
}


export function normalizeDispatchHandoffStatuses(
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


export const DEFAULT_ROUTE_SERVICE_SPEED_KPH = 35;
// Matches shipment.service.ts display name for the owned fleet.

// Matches shipment.service.ts display name for the owned fleet.
export const INTERNAL_FLEET_CARRIER_NAME = 'SilverSea';

export const DEFAULT_ROUTE_SERVICE_BUFFER_MINUTES = 30;

export const TRAILER_CAPACITY_KG: Record<'20FT' | '40FT', number> = {
  '20FT': 18_000,
  '40FT': 30_000,
};


export function assertDispatchReadActor(actor: AuthUser): void {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.DISPATCHER && actor.role !== Role.ACCOUNTANT) {
    throw new ApiError(403, 'Bạn không có quyền xem bảng điều phối.');
  }
}


export function assertDispatchActor(actor: AuthUser): asserts actor is DispatchActor {
  if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.DISPATCHER) {
    throw new ApiError(403, 'Chỉ điều vận mới có quyền điều xe.');
  }
}

/**
 * SIL-675 — shared optimistic-concurrency copy for dispatch-planning
 * mutations: the fulfillment row moved between read and write, so the caller
 * must reload before retrying. Single source of truth for the 9 former inline
 * throws (detail-plan ×8, commands ×1).
 */
export const DISPATCH_VERSION_CONFLICT_MESSAGE = 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.';

export function assertExpectedVersion(row: { version: number }, expectedVersion: number): void {
  if (row.version !== expectedVersion) {
    throw new ApiError(409, DISPATCH_VERSION_CONFLICT_MESSAGE);
  }
}

/** A version-guarded UPDATE … RETURNING missing its row means a concurrent
 *  write already bumped the version — same reload contract as above. */
export function assertUpdatedRow<T>(row: T | undefined | null): asserts row is T {
  if (row == null) {
    throw new ApiError(409, DISPATCH_VERSION_CONFLICT_MESSAGE);
  }
}


export function accountantCustomerScopeIds(actor: AuthUser): number[] {
  return [...new Set([
    ...(actor.customerIds ?? []),
    actor.customerId,
  ].filter((value): value is number => value != null && Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}


export function requireAccountantDispatchScope(actor: AuthUser): number[] | null {
  if (actor.role !== Role.ACCOUNTANT) return null;
  const customerIds = accountantCustomerScopeIds(actor);
  if (customerIds.length === 0) {
    throw new ApiError(403, 'Tài khoản kế toán chưa có phạm vi khách hàng để xem điều phối.');
  }
  return customerIds;
}


export function decodeCursorPayload(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ApiError(400, 'cursor không hợp lệ.');
  }
}


export function encodeCursorPayload(payload: DispatchListCursorPayload | DispatchFleetCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}


export function parseCursor(raw: string | null | undefined, scope: DispatchCursorScope): number | null {
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


export function encodeDescendingIdCursor(scope: DispatchCursorScope, id: number): string {
  return encodeCursorPayload({ v: 1, scope, id });
}


export function parseFleetCursor(
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


export function encodeFleetCursor(resource: DispatchFleetResource, sortKey: string, id: number): string {
  return encodeCursorPayload({ v: 1, scope: 'dispatch-fleet', resource, sortKey, id });
}


export function normalizeLimit(raw: number | undefined, max: number): number {
  if (raw == null) return max;
  if (!Number.isInteger(raw) || raw < 1 || raw > max) {
    throw new ApiError(400, `limit phải trong khoảng 1-${max}.`);
  }
  return raw;
}


export function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(400, 'date phải theo định dạng YYYY-MM-DD.');
  }
  return raw;
}


export function buildPattern(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 100) {
    throw new ApiError(400, 'Từ khóa tìm kiếm không được vượt quá 100 ký tự.');
  }
  return `%${escapeLikeTerm(value)}%`;
}


export function unaccentedIlike(column: unknown, pattern: string) {
  return sql`unaccent(${column}) ILIKE unaccent(${pattern})`;
}


/**
 * Shared q-search predicate across dispatch list reads (customer operational
 * name, customer name, shipment code, booking ref, BL number; optionally the
 * container number). One definition so a new searchable column lands in every
 * dispatch list at once.
 */
export function shipmentQSearchPredicate(
  qPattern: string | null,
  opts: { containerNumber?: boolean } = {},
) {
  if (!qPattern) return undefined;
  return or(
    ilike(CUSTOMER_OPERATIONAL_NAME, qPattern),
    ilike(s.customers.name, qPattern),
    ilike(s.shipments.shipmentCode, qPattern),
    ilike(s.shipments.bookingRef, qPattern),
    ilike(s.shipments.blNumber, qPattern),
    ...(opts.containerNumber ? [ilike(s.shipmentContainers.containerNumber, qPattern)] : []),
  );
}

export function sumSelectedStatusCounts<T extends string>(selected: T[], counts: Partial<Record<T, number>>) {
  return selected.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}


export function parseIsoWithZone(value: string, label: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ApiError(400, `${label} phải kèm múi giờ.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${label} không hợp lệ.`);
  }
  return parsed;
}


export function trimBounded(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ApiError(400, `${label} không được vượt quá ${maxLength} ký tự.`);
  }
  return trimmed;
}


/**
 * Trailer the issue gate requires for a fulfillment's own container code.
 *
 * `LCL_PICKUP` ('Lấy Lẻ') is the one classification that ignores the code:
 * the run takes an already-empty 40' shell and closes LCL cargo into it, so
 * the lot's own 20' code must not downgrade the requirement to a 20' moóc.
 * Mirrors `requiredTrailerTypeForContainer` in the plan editor so the picker
 * advisory and this gate can never disagree.
 */
export function requiredTrailerTypeForFulfillment(
  code: string | null | undefined,
  dispatchClassification: string | null | undefined,
): '20FT' | '40FT' {
  if (dispatchClassification === 'LCL_PICKUP') return LCL_PICKUP_TRAILER_TYPE;
  if (dispatchClassification === 'DOUBLE' && code?.trim().toUpperCase().startsWith('20')) return '40FT';
  return inferTrailerTypeFromContainerCode(code);
}

export function inferTrailerTypeFromContainerCode(code: string | null | undefined): '20FT' | '40FT' {
  const normalized = code?.trim().toUpperCase() ?? '';
  return normalized.startsWith('20') ? '20FT' : '40FT';
}


export function routeServiceDurationMinutes(distanceKm: number | null | undefined): number | null {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return Math.ceil((distanceKm / DEFAULT_ROUTE_SERVICE_SPEED_KPH) * 60) + DEFAULT_ROUTE_SERVICE_BUFFER_MINUTES;
}


export function redactDispatchSiteForAccountant<T extends {
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


export function inferredVehicleCapacityKg(trailerType: '20FT' | '40FT' | null | undefined): string | null {
  if (!trailerType) return null;
  const capacityKg = TRAILER_CAPACITY_KG[trailerType];
  return capacityKg ? String(capacityKg) : null;
}


/**
 * SIL-674 — the tractor's spec-sheet towing capacity ("sức kéo", tons) as a
 * kg string. Master-data imports legitimately leave the mooc type blank
 * (trailers.type null), so `inferredVehicleCapacityKg` resolved null for the
 * whole imported fleet and the Kẹp pair weight gate ran unprovable on every
 * issue — QA 03/11: legs 5t+5t on a 33t tractor refused 409
 * KEP_WEIGHT_WARNING while trips.vehicleCapacityKg stayed null
 * (trips 222/223). The tractor's own tow rating is the rig's real limit and
 * fills exactly that hole; a bucket from a declared mooc type still wins
 * (precedence unchanged). Null-safe: null/NaN/nonpositive → null — the
 * unprovable warn-once law ("xe chưa cấu hình tải moóc") keeps owning that
 * shape.
 */
export function truckTowCapacityKg(towCapacityTons: string | number | null | undefined): string | null {
  const tons = Number(towCapacityTons);
  if (!Number.isFinite(tons) || tons <= 0) return null;
  return String(tons * 1000);
}


export function authoritativeCargoWeightKg(args: {
  shipmentCargoWeightKg: string | null;
  containerCargoWeightKg?: string | null;
  shipmentContainerId: number | null;
}): string | null {
  if (args.shipmentContainerId != null) {
    return args.containerCargoWeightKg ?? null;
  }
  return args.shipmentCargoWeightKg ?? null;
}


export function dispatchAssignmentChanged(
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


export function buildNotificationPayload(
  trip: Pick<typeof s.trips.$inferSelect, 'id' | 'tripCode' | 'driverId' | 'fulfillmentId'>,
): NotificationPayload {
  if (trip.fulfillmentId == null) {
    throw new ApiError(409, 'Chuyến điều xe chưa liên kết tác vụ thực hiện.');
  }
  // /my-trips/:id is TRIP-scoped (card 20260915_1: DriverTripDetailPage
  // fetches getDriverTrip(tripId)), so the deep link must key on trip.id.
  // The fulfillmentId is still validated above — issuance requires it — but
  // it no longer rides the notification.
  return {
    type: NotificationType.TRIP_DISPATCHED,
    title: 'Lệnh điều xe mới',
    message: trip.tripCode ? `Chuyến ${trip.tripCode} đã được điều xe` : 'Bạn có lệnh điều xe mới',
    relatedEntityType: 'trips',
    relatedEntityId: trip.id,
    targetDriverId: trip.driverId ?? undefined,
  };
}


export function hasExplicitNotificationTarget(payload: NotificationPayload): boolean {
  return payload.targetUserId != null
    || payload.targetDriverId != null
    || (payload.targetRoles?.length ?? 0) > 0;
}


export function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}


export async function loadPickupSites(tx: Tx, siteIds: number[]) {
  if (siteIds.length === 0) return new Map<number, typeof s.operationalSites.$inferSelect>();
  const rows = await tx.select().from(s.operationalSites)
    .where(inArray(s.operationalSites.id, [...new Set(siteIds)]));
  return new Map(rows.map((row) => [row.id, row]));
}


export async function loadDeclarationNumbers(tx: Tx, shipmentIds: number[]) {
  if (shipmentIds.length === 0) return new Map<number, string[]>();
  const scopedIds = [...new Set(shipmentIds)];
  const rows = await tx.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, scopedIds))
    .orderBy(asc(s.shipmentDeclarations.id));
  // SIL-657 (id 764): the lot's tờ khai list must resolve BOTH stores — the
  // lot-level entity rows (shipment_declarations) AND the per-cont attribute
  // (shipment_containers.declarationNumber, the SIL-521 store the CUS line
  // command / dispatch cells write). The docs-only read hid a number the
  // office saved per-cont, so the dispatch lot payload and the trip page
  // kept reading "—" while the CUS ledger showed it. Merge law mirrors
  // distinctDeclarationNumbers (cus-workspace-builders): per-cont values
  // first in id order (the operational truth the CUS cell shows), entity
  // rows after in id order, DISTINCT case-insensitively, blank-only values
  // skipped.
  const containerRows = await tx.select({
    shipmentId: s.shipmentContainers.shipmentId,
    declarationNumber: s.shipmentContainers.declarationNumber,
  }).from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, scopedIds))
    .orderBy(asc(s.shipmentContainers.id));
  const result = new Map<number, string[]>();
  const seen = new Map<number, Set<string>>();
  const add = (shipmentId: number, raw: string | null | undefined) => {
    const value = raw?.trim();
    if (!value) return;
    const key = value.toLowerCase();
    const seenForLot = seen.get(shipmentId) ?? new Set<string>();
    if (seenForLot.has(key)) return;
    seenForLot.add(key);
    seen.set(shipmentId, seenForLot);
    const bucket = result.get(shipmentId) ?? [];
    bucket.push(value);
    result.set(shipmentId, bucket);
  };
  for (const row of containerRows) add(row.shipmentId, row.declarationNumber);
  for (const row of rows) add(row.shipmentId, row.declarationNumber);
  return result;
}

/**
 * Data-status predicate for the dispatch detail plan (card 20260926_50):
 * "Thiếu dữ liệu" (MISSING) = the row is missing ANY of the three intake
 * signals — bill/booking (either column counts), tờ khai (any non-blank
 * shipment_declarations row), or container number. COMPLETE is its exact
 * complement (all three present). One fragment, shared by the
 * fulfillment-owned query, its count, and the fulfillment-less branch so the
 * page, the pager, and the count can never disagree.
 */
export function dispatchDetailDataStatusSql(status: 'COMPLETE' | 'MISSING'): SQL {
  const missing = sql`(
    (coalesce(btrim(${s.shipments.blNumber}), '') = '' and coalesce(btrim(${s.shipments.bookingRef}), '') = '')
    or (
      not exists (select 1 from ${s.shipmentDeclarations} sd
        where sd.shipment_id = ${s.shipments.id} and coalesce(btrim(sd.declaration_number), '') <> '')
      and not exists (select 1 from ${s.shipmentContainers} sc
        where sc.shipment_id = ${s.shipments.id} and coalesce(btrim(sc.declaration_number), '') <> '')
    )
    or coalesce(btrim(${s.shipmentContainers.containerNumber}), '') = ''
  )`;
  return status === 'MISSING' ? missing : sql`not ${missing}`;
}


export function toFrozenSiteSummary(source: unknown) {
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

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utc = Date.UTC(year!, (month ?? 1) - 1, day ?? 1);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

/** Plain LIKE pattern check for an already-fetched value (search parity with
 *  the SQL `unaccentedIlike` used by the page query). */

export function unaccentedIlikeLike(value: string, pattern: string): boolean {
  const normalize = (text: string) => text.trim().toUpperCase().replace(/\s+/g, '');
  const normalizedValue = normalize(value);
  const normalizedPattern = normalize(pattern.replace(/%/g, ''));
  return normalizedValue.includes(normalizedPattern);
}


// Minute granularity of the run window — coalesce closingAt then plannedReturnAt,
// same precedence the dispatch-queue date filter uses. Pinned to the business
// timezone so the JS-side display hour and the SQL filters agree regardless of
// the Postgres session timezone.
export const DISPATCH_BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';


export function dispatchEffectiveRouteIdSql() {
  return sql<number>`case when ${s.shipments.cargoMode} = 'FCL'
    then ${s.shipmentContainers.routeId}
    else ${s.shipments.routeId} end`;
}


export function dispatchDetailTransportDateSql() {
  // FCL work is planned on each container's own appointment date. The root
  // expectedDeliveryDate is only an earliest-date projection and stays the
  // LCL/legacy fallback.
  return sql<string>`coalesce(
    date(${s.shipmentContainers.customerAppointmentAt} at time zone ${sql.raw(`'${DISPATCH_BUSINESS_TIME_ZONE}'`)}),
    ${s.shipments.expectedDeliveryDate}
  )`;
}

// Display-side hour in the same business timezone (matches the SQL filter).
