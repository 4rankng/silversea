// Shipment Service — Wave 0 foundation for the `shipments` (lô hàng) entity.
//
// Provides the core domain operations every later Wave (router, dispatch, portal)
// builds on:
//
//   - CRUD (create / get / list / update / soft-delete) with `version`-based
//     optimistic locking, mirroring `trips`.
//   - A small, explicit status-transition state machine that writes an append-only
//     `shipment_status_history` row on every transition.
//   - `shipmentCode` generation (PK-backed, stable, unique). Format pending PRD
//     M3.1 §5; see `generateShipmentCode` for the assumption note.
//   - `snapshotContainersIntoTrip` — the phase-01 architecture's container
//     snapshot: copy `shipment_containers` → `trip_containers` once per trip,
//     idempotent across retries.
//
// Conventions follow `trip-status-machine.service.ts` and `trip-mutations.service.ts`:
//   - All user-facing messages in Vietnamese (PRD Mxx-HT-01).
//   - Optimistic-lock conflict returns 409 with a clear message.
//   - Status transitions only allow the legal edges; same-status is idempotent.
//   - Transaction-scoped; callers may pass an outer tx (e.g. dispatch flow) or
//     rely on the per-call transaction.

import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import {
  canonicalShipmentStatus,
  NotificationType,
  Role,
  TripStatus,
  shipmentContainerBatchSchema,
  TripPodStatus,
  TRIP_POD_REQUIRED_FILE_TYPES,
  updateShipmentSchema,
  validateContainerNumber,
} from '@tingting/shared';
import { resolveFreightPrice, resolveShipmentPricingProjection } from './pricing.service';
import { persistNotificationInTx, sendNotificationPush, type NotificationPayload } from './notification.service';
import type { AuthUser } from '../middleware/auth';
import {
  assertClerkCanAccessShipment,
  assertClerkCanCreateForCustomer,
  buildShipmentScopeWhere,
  isClerkScopedUser,
  loadClerkShipmentScope,
  resolveClerkResponsibleUnitId,
} from './clerk-shipment-scope.service';
import {
  classifyClerkContainerChange,
  classifyClerkShipmentPatch,
  createShipmentChangeRequest,
  persistChangeRequestDecisionNotification,
} from './shipment-edit-boundary.service';
import { isFulfillmentRequired } from './shipment-fulfillment.service';
import {
  getShipmentPodFileForDownload,
  listShipmentPodReviewItems,
  type ShipmentPodReviewItemView,
} from './trip-pod.service';
import { transitionTripStatus } from './trip-status-machine.service';
import {
  assertActorCanAccessShipment,
  createCustomerVisibleEvent,
} from './shipment-coordination.service';
import {
  assertShipmentAccountingUnlocked,
  getShipmentAccountingLock,
} from './shipment-accounting-lock.service';

// ─── Status machine ─────────────────────────────────────────────────────────
//
// Mirrors the lifecycle implied by the `shipment_status` enum + phase-01
// "booking → documents → dispatch → delivery → debit-note":
//
//   PENDING_DATE ──► READY_FOR_DISPATCH ──► DISPATCHED ──► IN_TRANSIT
//                                                    ──► PENDING_EXPENSE_APPROVAL
//                                                    ──► COMPLETED
//                            ▲                    │
//                            └────────────────────┘
//                                               └──► CANCELED
//
// Operational regressions are allowed before COMPLETED when the underlying
// dispatch/evidence state changes (for example a rejected e-POD moves a
// shipment back out of pending approval). COMPLETED and CANCELED remain
// terminal.
const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  NEW: ['READY_FOR_DISPATCH', 'CANCELED'],
  PENDING_DATE: ['READY_FOR_DISPATCH', 'CANCELED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELED'],
  DISPATCHED: ['IN_TRANSIT', 'CANCELED'],
  IN_TRANSIT: ['DISPATCHED', 'PENDING_EXPENSE_APPROVAL', 'CANCELED'],
  PENDING_EXPENSE_APPROVAL: ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

export type ShipmentStatus =
  | 'NEW'
  | 'PENDING_DATE'
  | 'READY_FOR_DISPATCH'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'PENDING_EXPENSE_APPROVAL'
  | 'COMPLETED'
  | 'CANCELED';

const CUSTOMER_VISIBLE_SHIPMENT_STATUS_COPY: Partial<Record<ShipmentStatus, {
  title: string;
  message: string;
}>> = {
  IN_TRANSIT: {
    title: 'Đang vận chuyển',
    message: 'Lô hàng đang được vận chuyển.',
  },
  COMPLETED: {
    title: 'Đã giao hàng',
    message: 'Lô hàng đã được giao.',
  },
};

const SYNTHETIC_LCL_FULFILLMENT_SCOPE_PREFIX = '__fulfillment_lcl:';
type ShipmentDocumentTypeValue = (typeof s.shipmentDocuments.type.enumValues)[number];
type ShipmentDeclarationScopeValue = (typeof s.shipmentDeclarations.scope.enumValues)[number];
const DEFAULT_SHIPMENT_DECLARATION_SCOPE: ShipmentDeclarationScopeValue = 'SINGLE';

function normalizeShipmentStatusValue(status: string | null | undefined): ShipmentStatus | null {
  return canonicalShipmentStatus(status);
}

function hasDispatchDate(shipment: Pick<typeof s.shipments.$inferSelect, 'expectedDeliveryDate' | 'closingAt' | 'plannedReturnAt'>): boolean {
  return shipment.expectedDeliveryDate != null || shipment.closingAt != null || shipment.plannedReturnAt != null;
}

function isDirectlyEditableIntakeStatus(status: string | null | undefined): boolean {
  const canonical = canonicalShipmentStatus(status);
  return canonical === 'PENDING_DATE' || canonical === 'READY_FOR_DISPATCH';
}

async function ensureReadyShipmentHandoff(
  tx: Tx,
  shipment: Pick<typeof s.shipments.$inferSelect, 'id' | 'version' | 'expectedDeliveryDate' | 'closingAt' | 'plannedReturnAt'>,
  createdBy: number | null,
) {
  if (!hasDispatchDate(shipment)) return;
  const [existing] = await tx.select({ id: s.dispatchHandoffs.id })
    .from(s.dispatchHandoffs)
    .where(and(
      eq(s.dispatchHandoffs.shipmentId, shipment.id),
      sql`${s.dispatchHandoffs.status} <> 'REJECTED'`,
    ))
    .orderBy(desc(s.dispatchHandoffs.id))
    .limit(1);
  if (existing) return;
  await tx.insert(s.dispatchHandoffs).values({
    shipmentId: shipment.id,
    handoffVersion: shipment.version,
    createdBy,
    status: 'UNSEEN',
  });
}

function normalizeShipmentDocumentType(input: unknown): ShipmentDocumentTypeValue | null {
  if (typeof input !== 'string') return null;
  switch (input.trim().toUpperCase()) {
    case 'BOOKING':
      return 'BOOKING';
    case 'BL':
      return 'BL';
    case 'DO':
      return 'DO';
    case 'DECLARATION':
      return 'DECLARATION';
    case 'OTHER':
      return 'OTHER';
    default:
      return null;
  }
}

function normalizeShipmentDeclarationScope(input: unknown): ShipmentDeclarationScopeValue | null {
  if (typeof input !== 'string') return null;
  switch (input.trim().toUpperCase()) {
    case 'SINGLE':
      return 'SINGLE';
    case 'SHARED':
      return 'SHARED';
    default:
      return null;
  }
}

function isSyntheticLclFulfillmentScope(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && notes.startsWith(SYNTHETIC_LCL_FULFILLMENT_SCOPE_PREFIX);
}

type TripExpenseScopeContainerRow = {
  tripId: number;
  id: number;
  notes: string | null;
};

type TripExpenseScopeCompletionRow = {
  tripId: number;
  tripContainerId: number | null;
  status: typeof s.tripExpenseCompletionScopes.$inferSelect['status'];
};

function buildCompletedExpenseScopeKeys(
  scopes: readonly TripExpenseScopeCompletionRow[],
): Set<string> {
  return new Set(
    scopes
      .filter((scope) => scope.status === 'COMPLETED')
      .map((scope) => `${scope.tripId}:${scope.tripContainerId ?? 'general'}`),
  );
}

function hasCompletedExpenseScopes(
  tripId: number,
  tripContainers: readonly Pick<TripExpenseScopeContainerRow, 'id' | 'notes'>[],
  completedExpenseScopeKeys: ReadonlySet<string>,
): boolean {
  if (
    tripContainers.length === 1
    && isSyntheticLclFulfillmentScope(tripContainers[0]?.notes)
  ) {
    return completedExpenseScopeKeys.has(`${tripId}:${tripContainers[0]!.id}`);
  }
  return completedExpenseScopeKeys.has(`${tripId}:general`)
    && tripContainers.every((container) => (
      completedExpenseScopeKeys.has(`${tripId}:${container.id}`)
    ));
}

async function loadTripExpenseScopeState(tx: Tx, tripIds: number[]) {
  if (tripIds.length === 0) {
    return {
      completedExpenseScopeKeys: new Set<string>(),
      containersByTrip: new Map<number, { id: number; notes: string | null }[]>(),
    };
  }
  const [tripContainerRows, expenseScopeRows] = await Promise.all([
    tx.select({
      tripId: s.tripContainers.tripId,
      id: s.tripContainers.id,
      notes: s.tripContainers.notes,
    })
      .from(s.tripContainers)
      .where(inArray(s.tripContainers.tripId, tripIds))
      .for('update'),
    tx.select({
      tripId: s.tripExpenseCompletionScopes.tripId,
      tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
      status: s.tripExpenseCompletionScopes.status,
    }).from(s.tripExpenseCompletionScopes)
      .where(inArray(s.tripExpenseCompletionScopes.tripId, tripIds))
      .for('update'),
  ]);
  const containersByTrip = new Map<number, { id: number; notes: string | null }[]>();
  for (const container of tripContainerRows) {
    const current = containersByTrip.get(container.tripId) ?? [];
    current.push({ id: container.id, notes: container.notes });
    containersByTrip.set(container.tripId, current);
  }
  return {
    completedExpenseScopeKeys: buildCompletedExpenseScopeKeys(expenseScopeRows),
    containersByTrip,
  };
}

async function assertShipmentDirectCloseTripReadiness(
  tx: Tx,
  tripId: number,
  scopeState?: Awaited<ReturnType<typeof loadTripExpenseScopeState>>,
): Promise<void> {
  const [currentPod] = await tx.select({
    status: s.tripPodSubmissions.status,
  }).from(s.tripPodSubmissions)
    .where(eq(s.tripPodSubmissions.tripId, tripId))
    .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
    .limit(1)
    .for('update');
  if (!currentPod || currentPod.status !== TripPodStatus.ACCEPTED) {
    throw new ApiError(409, 'e-POD hiện tại chưa được duyệt. Không thể chốt tài chính chuyến đi.');
  }
  const resolvedScopeState = scopeState ?? await loadTripExpenseScopeState(tx, [tripId]);
  if (
    !hasCompletedExpenseScopes(
      tripId,
      resolvedScopeState.containersByTrip.get(tripId) ?? [],
      resolvedScopeState.completedExpenseScopeKeys,
    )
  ) {
    throw new ApiError(
      409,
      'Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ container.',
    );
  }
}

function normalizeShipmentRow<T extends { status: string | null }>(shipment: T): T {
  const normalizedStatus = normalizeShipmentStatusValue(shipment.status);
  return normalizedStatus == null
    ? shipment
    : { ...shipment, status: normalizedStatus } as T;
}

function normalizeShipmentStatusHistoryRow<
  T extends { fromStatus: string | null; toStatus: string },
>(row: T): T {
  const fromStatus = normalizeShipmentStatusValue(row.fromStatus);
  const toStatus = normalizeShipmentStatusValue(row.toStatus);
  return {
    ...row,
    fromStatus,
    toStatus: toStatus ?? row.toStatus,
  };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateShipmentInput {
  customerId: number;
  routeId?: number | null;
  cargoTypeId?: number | null;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  tradeDirection?: typeof s.shipmentTradeDirectionEnum.enumValues[number] | null;
  cargoMode?: typeof s.shipmentCargoModeEnum.enumValues[number] | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  expectedDeliveryDate?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  operationalNotes?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  createdBy?: number | null;
}

export interface UpdateShipmentInput {
  expectedVersion?: number; // Required for optimistic-lock check
  version?: number;
  customerId?: number;
  routeId?: number | null;
  cargoTypeId?: number | null;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  tradeDirection?: typeof s.shipmentTradeDirectionEnum.enumValues[number] | null;
  cargoMode?: typeof s.shipmentCargoModeEnum.enumValues[number] | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  expectedDeliveryDate?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  operationalNotes?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  updatedBy?: number | null;
}

export interface ShipmentContainerInput {
  id?: number;
  containerTypeId?: number | null;
  containerNumber?: string | null;
  sealNumber?: string | null;
  cargoWeightKg?: string | number | null;
  shippingLineName?: string | null;
  pickupPortId?: number | null;
  dropoffPortId?: number | null;
  notes?: string | null;
}

export interface ListShipmentsOptions {
  customerId?: number;
  customerIds?: number[];
  status?: ShipmentStatus;
  q?: string;
  /** W4 20260805_03 filter: limit to one trade direction. */
  tradeDirection?: 'IMPORT' | 'EXPORT';
  /** W4 20260805_03 filter: lower bound on customsCutoffAt (Ngày đóng/trả). */
  dateFrom?: string;
  /** W4 20240805_03 filter: upper bound on customsCutoffAt. */
  dateTo?: string;
  /** W4 20260805_03 filter: exact-ish match on blNumber. */
  blNumber?: string;
  limit?: number;
  offset?: number;
  actor?: AuthUser;
}

export type ShipmentUpdateResult = typeof s.shipments.$inferSelect & {
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
};

type ShipmentAuthorityTripRow = Pick<
  typeof s.trips.$inferSelect,
  'id'
  | 'fulfillmentId'
  | 'version'
  | 'shipmentId'
  | 'customerId'
  | 'routeId'
  | 'cargoTypeId'
  | 'departureDate'
  | 'containerCount'
  | 'vatRate'
  | 'status'
  | 'pricingSource'
  | 'pricingFormula'
  | 'pricingSnapshot'
  | 'revenue'
  | 'revenueOriginal'
  | 'revenueEmptyReturn'
  | 'podRecoveredAt'
>;

type ShipmentFulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

type ShipmentCloseAuthorityContext = {
  fulfillmentRows: ShipmentFulfillmentRow[];
  requiredFulfillments: ShipmentFulfillmentRow[];
};

function extractPricingSelectorFromSnapshot(snapshot: unknown): {
  containerTypeId: number | null;
  pricingRateKey: string | null;
} {
  if (!snapshot || typeof snapshot !== 'object') {
    return { containerTypeId: null, pricingRateKey: null };
  }
  const record = snapshot as Record<string, unknown>;
  const rawContainerTypeId = record.matchedContainerTypeId ?? record.requestedContainerTypeId;
  const rawRateKey = record.matchedRateKey ?? record.requestedRateKey;
  return {
    containerTypeId: typeof rawContainerTypeId === 'number' ? rawContainerTypeId : null,
    pricingRateKey: typeof rawRateKey === 'string' && rawRateKey.trim().length > 0 ? rawRateKey : null,
  };
}

export interface ShipmentContainerMutationResult {
  items: Awaited<ReturnType<typeof listShipmentContainers>>;
  upsertedIds: number[];
  shipmentVersion: number;
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
}

export type ShipmentChangeRequestRow = typeof s.shipmentChangeRequests.$inferSelect;

export type ShipmentChangeRequestSummary = ShipmentChangeRequestRow & {
  requester: {
    id: number;
    fullName: string | null;
    username: string | null;
  } | null;
};

export interface ShipmentChangeRequestReviewResult {
  shipment: Awaited<ReturnType<typeof getShipment>>;
  resolution: 'APPLIED' | 'REJECTED';
  changeRequestId: number;
  shipmentVersion: number;
  notificationDelivered: boolean;
  message: string;
}

function toNullableFixedDecimal(
  value: string | number | null | undefined,
  integerDigits: number,
  scale: number,
  fieldLabel: string,
): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match || match[1].length > integerDigits || (match[2]?.length ?? 0) > scale) {
    throw new ApiError(400, `${fieldLabel} không hợp lệ.`);
  }
  return `${match[1]}.${(match[2] ?? '').padEnd(scale, '0')}`;
}

function toNullableTimestamp(
  value: string | Date | null | undefined,
  fieldLabel: string,
): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ApiError(400, `${fieldLabel} phải kèm múi giờ.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${fieldLabel} không hợp lệ.`);
  }
  return parsed;
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildShipmentSearchPredicate(search: string | undefined) {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  const pattern = `%${escapeLikeTerm(trimmed)}%`;
  return or(
    ilike(s.shipments.shipmentCode, pattern),
    ilike(s.shipments.blNumber, pattern),
    ilike(s.shipments.bookingRef, pattern),
    ilike(s.customers.name, pattern),
    ilike(s.shipments.factoryName, pattern),
    ilike(s.shipments.shippingLineName, pattern),
  );
}

const INTERNAL_FLEET_CARRIER_NAME = 'SilverSea';

type ShipmentListSummary = {
  cargoSummary: string | null;
  shippingLineSummary: string | null;
  carrierSummary: string | null;
  vehiclePlateSummary: string | null;
};

function normalizeSummaryValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function appendUniqueSummaryValue(target: string[], seen: Set<string>, value: string | null | undefined) {
  const normalized = normalizeSummaryValue(value);
  if (!normalized) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function summarizeCargo(
  shipment: Pick<typeof s.shipments.$inferSelect, 'cargoMode' | 'packageCount' | 'packageType'>,
  containerRows: Array<{ containerNumber: string | null }>,
): string | null {
  if (shipment.cargoMode === 'LCL') {
    if (shipment.packageCount != null) {
      return `${shipment.packageCount} ${normalizeSummaryValue(shipment.packageType) ?? 'kiện'}`;
    }
    return normalizeSummaryValue(shipment.packageType);
  }

  const containerCount = containerRows.length;
  if (containerCount === 0) return null;

  const numbers: string[] = [];
  const seenNumbers = new Set<string>();
  for (const row of containerRows) {
    appendUniqueSummaryValue(numbers, seenNumbers, row.containerNumber);
  }
  return numbers.length > 0
    ? `${containerCount} cont: ${numbers.join(', ')}`
    : `${containerCount} cont`;
}

function carrierNameFromPlannedAuthority(fulfillment: {
  plannedCarrierType: string | null;
  plannedExternalCarrierId: number | null;
}, carriersById: Map<number, string>): string | null {
  if (fulfillment.plannedCarrierType === 'OWN') return INTERNAL_FLEET_CARRIER_NAME;
  if (fulfillment.plannedCarrierType === 'EXTERNAL' && fulfillment.plannedExternalCarrierId != null) {
    return carriersById.get(fulfillment.plannedExternalCarrierId) ?? null;
  }
  return null;
}

function carrierNameFromTripAuthority(trip: {
  carrierType: string | null;
  externalCarrierName: string | null;
}): string | null {
  if (trip.carrierType === 'OWN') return INTERNAL_FLEET_CARRIER_NAME;
  if (trip.carrierType === 'EXTERNAL') return normalizeSummaryValue(trip.externalCarrierName);
  return null;
}

async function loadShipmentListDeclarationNumbers(
  shipmentIds: number[],
): Promise<Map<number, string>> {
  if (shipmentIds.length === 0) return new Map();
  const rows = await db.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
    id: s.shipmentDeclarations.id,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds))
    .orderBy(asc(s.shipmentDeclarations.shipmentId), desc(s.shipmentDeclarations.id));
  const map = new Map<number, string>();
  for (const row of rows) {
    if (!row.declarationNumber) continue;
    if (!map.has(row.shipmentId)) map.set(row.shipmentId, row.declarationNumber);
  }
  return map;
}

async function loadShipmentListSummaries(
  shipments: Array<typeof s.shipments.$inferSelect>,
): Promise<Map<number, ShipmentListSummary>> {
  const shipmentIds = [...new Set(shipments.map((shipment) => shipment.id))];
  if (shipmentIds.length === 0) return new Map();

  const [containerRows, fulfillmentRows, tripRows] = await Promise.all([
    db.select({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
      containerNumber: s.shipmentContainers.containerNumber,
      shippingLineName: s.shipmentContainers.shippingLineName,
    }).from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, shipmentIds))
      .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id)),
    db.select({
      id: s.shipmentFulfillments.id,
      shipmentId: s.shipmentFulfillments.shipmentId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
    }).from(s.shipmentFulfillments)
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
        isNull(s.shipmentFulfillments.canceledAt),
      ))
      .orderBy(asc(s.shipmentFulfillments.shipmentId), asc(s.shipmentFulfillments.id)),
    db.select({
      id: s.trips.id,
      shipmentId: s.trips.shipmentId,
      fulfillmentId: s.trips.fulfillmentId,
      carrierType: s.trips.carrierType,
      truckPlate: s.trucks.licensePlate,
      externalCarrierName: s.customers.name,
      externalPlateNumber: s.trips.externalPlateNumber,
    }).from(s.trips)
      .leftJoin(s.trucks, and(
        eq(s.trucks.id, s.trips.truckId),
        isNull(s.trucks.deletedAt),
      ))
      .leftJoin(s.customers, and(
        eq(s.customers.id, s.trips.externalEntityId),
        eq(s.trips.externalEntityType, 'CUSTOMER'),
        isNull(s.customers.deletedAt),
      ))
      .where(and(
        inArray(s.trips.shipmentId, shipmentIds),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, TripStatus.CANCELED),
      ))
      .orderBy(asc(s.trips.shipmentId), asc(s.trips.id)),
  ]);

  const plannedCarrierIds = [...new Set(
    fulfillmentRows
      .map((row) => row.plannedExternalCarrierId)
      .filter((value): value is number => value != null),
  )];
  const carriersById = plannedCarrierIds.length > 0
    ? new Map((await db.select({
      id: s.customers.id,
      name: s.customers.name,
    }).from(s.customers)
      .where(and(
        inArray(s.customers.id, plannedCarrierIds),
        isNull(s.customers.deletedAt),
      ))).map((row) => [row.id, row.name]))
    : new Map<number, string | null>();

  const containersByShipment = new Map<number, typeof containerRows>();
  for (const row of containerRows) {
    const bucket = containersByShipment.get(row.shipmentId);
    if (bucket) bucket.push(row);
    else containersByShipment.set(row.shipmentId, [row]);
  }

  const fulfillmentsByShipment = new Map<number, typeof fulfillmentRows>();
  for (const row of fulfillmentRows) {
    const bucket = fulfillmentsByShipment.get(row.shipmentId);
    if (bucket) bucket.push(row);
    else fulfillmentsByShipment.set(row.shipmentId, [row]);
  }

  const tripsByShipment = new Map<number, typeof tripRows>();
  const tripsByFulfillment = new Map<number, typeof tripRows>();
  for (const row of tripRows) {
    if (row.shipmentId == null) continue;
    const shipmentBucket = tripsByShipment.get(row.shipmentId);
    if (shipmentBucket) shipmentBucket.push(row);
    else tripsByShipment.set(row.shipmentId, [row]);

    if (row.fulfillmentId != null) {
      const fulfillmentBucket = tripsByFulfillment.get(row.fulfillmentId);
      if (fulfillmentBucket) fulfillmentBucket.push(row);
      else tripsByFulfillment.set(row.fulfillmentId, [row]);
    }
  }

  const summaries = new Map<number, ShipmentListSummary>();
  for (const shipment of shipments) {
    const shipmentContainerRows = containersByShipment.get(shipment.id) ?? [];
    const shippingLineValues: string[] = [];
    const seenShippingLines = new Set<string>();
    appendUniqueSummaryValue(shippingLineValues, seenShippingLines, shipment.shippingLineName);
    for (const row of shipmentContainerRows) {
      appendUniqueSummaryValue(shippingLineValues, seenShippingLines, row.shippingLineName);
    }

    const carrierValues: string[] = [];
    const seenCarriers = new Set<string>();
    const vehicleValues: string[] = [];
    const seenVehicles = new Set<string>();
    const consumedTripIds = new Set<number>();

    for (const fulfillment of fulfillmentsByShipment.get(shipment.id) ?? []) {
      const liveTrips = tripsByFulfillment.get(fulfillment.id) ?? [];
      if (liveTrips.length > 0) {
        for (const trip of liveTrips) {
          consumedTripIds.add(trip.id);
          appendUniqueSummaryValue(
            carrierValues,
            seenCarriers,
            carrierNameFromTripAuthority(trip),
          );
          appendUniqueSummaryValue(
            vehicleValues,
            seenVehicles,
            trip.carrierType === 'OWN' ? trip.truckPlate : trip.externalPlateNumber,
          );
        }
        continue;
      }
      appendUniqueSummaryValue(
        carrierValues,
        seenCarriers,
        carrierNameFromPlannedAuthority(fulfillment, carriersById as Map<number, string>),
      );
    }

    for (const trip of tripsByShipment.get(shipment.id) ?? []) {
      if (consumedTripIds.has(trip.id)) continue;
      // Fulfillment-linked trips are authoritative only through the active
      // fulfillment loop above. This excludes trips left live on a canceled
      // fulfillment while preserving truly unlinked legacy trips.
      if (trip.fulfillmentId != null) continue;
      appendUniqueSummaryValue(
        carrierValues,
        seenCarriers,
        carrierNameFromTripAuthority(trip),
      );
      appendUniqueSummaryValue(
        vehicleValues,
        seenVehicles,
        trip.carrierType === 'OWN' ? trip.truckPlate : trip.externalPlateNumber,
      );
    }

    summaries.set(shipment.id, {
      cargoSummary: summarizeCargo(shipment, shipmentContainerRows),
      shippingLineSummary: shippingLineValues.length > 0 ? shippingLineValues.join(', ') : null,
      carrierSummary: carrierValues.length > 0 ? carrierValues.join(', ') : null,
      vehiclePlateSummary: vehicleValues.length > 0 ? vehicleValues.join(', ') : null,
    });
  }

  return summaries;
}

type ShipmentDeclarationMutationInput = {
  id?: number;
  declarationNumber?: string | null;
  issuedAt?: string | null;
  scope?: typeof s.shipmentDeclarations.scope.enumValues[number];
  note?: string | null;
  updatedBy?: number | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a stable, unique shipment code. Format: `SHP-<YYMM>-<NNNNN>` where
 * NNNNN is the shipment row id, zero-padded. PK-backed so it is unique by
 * construction and free of races (no separate counter table needed).
 *
 * Material assumption: the PRD-proposed format is
 * `{customerCode}-{YYMMDD}-{NNN}` (M3.1 §5, still open). Customers have no
 * `code` column yet, so the customer-code prefix is impossible without a
 * schema change outside this task's scope. `SHP-<YYMM>-<NNNNN>` is a stable
 * placeholder that is unique, sortable, and easy to re-format later (the
 * `shipments.shipmentCode` column is unique but not the source of truth for
 * business identity).
 */
export function formatShipmentCode(id: number, createdAt: Date = new Date()): string {
  const yy = String(createdAt.getFullYear()).slice(-2);
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  return `SHP-${yy}${mm}-${String(id).padStart(5, '0')}`;
}

function buildFullPricingFormula(freightFormula: string, freightPrice: number, vatRate: number): string {
  const vatPct = Math.round(vatRate * 1000) / 10;
  return `${freightFormula} = ${freightPrice.toLocaleString('vi-VN')}đ; VAT ${vatPct}%`;
}

async function loadShipmentCloseAuthorityContext(tx: Tx, shipmentId: number): Promise<ShipmentCloseAuthorityContext> {
  const fulfillmentRows = await tx.select().from(s.shipmentFulfillments)
    .where(eq(s.shipmentFulfillments.shipmentId, shipmentId))
    .orderBy(asc(s.shipmentFulfillments.id))
    .for('update');
  const fulfillmentById = new Map(fulfillmentRows.map((row) => [row.id, row]));
  const requiredFulfillments = fulfillmentRows.filter((row) => isFulfillmentRequired(
    row,
    row.replacementFulfillmentId != null
      ? fulfillmentById.get(row.replacementFulfillmentId) ?? null
      : null,
  ));
  return { fulfillmentRows, requiredFulfillments };
}

async function listLiveShipmentAuthorityTrips(
  tx: Tx,
  shipmentId: number,
): Promise<ShipmentAuthorityTripRow[]> {
  return tx.select({
    id: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    version: s.trips.version,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId,
    routeId: s.trips.routeId,
    cargoTypeId: s.trips.cargoTypeId,
    departureDate: s.trips.departureDate,
    containerCount: s.trips.containerCount,
    vatRate: s.trips.vatRate,
    status: s.trips.status,
    pricingSource: s.trips.pricingSource,
    pricingFormula: s.trips.pricingFormula,
    pricingSnapshot: s.trips.pricingSnapshot,
    revenue: s.trips.revenue,
    revenueOriginal: s.trips.revenueOriginal,
    revenueEmptyReturn: s.trips.revenueEmptyReturn,
    podRecoveredAt: s.trips.podRecoveredAt,
  }).from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      sql`${s.trips.status} <> 'CANCELED'`,
      isNull(s.trips.deletedAt),
    ))
    .orderBy(asc(s.trips.id))
    .for('update');
}

async function listRequiredShipmentAuthorityTrips(
  tx: Tx,
  requiredFulfillmentIds: number[],
): Promise<ShipmentAuthorityTripRow[]> {
  if (requiredFulfillmentIds.length === 0) {
    return [];
  }

  return tx.select({
    id: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    version: s.trips.version,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId,
    routeId: s.trips.routeId,
    cargoTypeId: s.trips.cargoTypeId,
    departureDate: s.trips.departureDate,
    containerCount: s.trips.containerCount,
    vatRate: s.trips.vatRate,
    status: s.trips.status,
    pricingSource: s.trips.pricingSource,
    pricingFormula: s.trips.pricingFormula,
    pricingSnapshot: s.trips.pricingSnapshot,
    revenue: s.trips.revenue,
    revenueOriginal: s.trips.revenueOriginal,
    revenueEmptyReturn: s.trips.revenueEmptyReturn,
    podRecoveredAt: s.trips.podRecoveredAt,
  })
    .from(s.trips)
    .where(and(
      inArray(s.trips.fulfillmentId, requiredFulfillmentIds),
      sql`${s.trips.status} <> 'CANCELED'`,
      isNull(s.trips.deletedAt),
    ))
    .orderBy(asc(s.trips.id))
    .for('update');
}

async function syncShipmentAuthorityToTrips(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
): Promise<void> {
  const linkedTrips = await listLiveShipmentAuthorityTrips(tx, shipment.id);
  if (linkedTrips.length === 0) return;

  for (const trip of linkedTrips) {
    const authoritativeCargoTypeId = shipment.cargoTypeId ?? trip.cargoTypeId;
    if (authoritativeCargoTypeId == null) {
      await tx.update(s.trips).set({
        customerId: shipment.customerId,
        sourceShipmentVersion: shipment.version,
        version: trip.version + 1,
        updatedAt: new Date(),
      }).where(eq(s.trips.id, trip.id));
      continue;
    }

    const freightPrice = await resolveFreightPrice({
      customerId: shipment.customerId,
      routeId: trip.routeId,
      cargoTypeId: authoritativeCargoTypeId,
      date: trip.departureDate,
      containerCount: trip.containerCount ?? 1,
      ...extractPricingSelectorFromSnapshot(trip.pricingSnapshot),
    });
    const revenue = freightPrice.price;
    const vatRate = Number(trip.vatRate ?? 0);

    await tx.update(s.trips).set({
      customerId: shipment.customerId,
      cargoTypeId: authoritativeCargoTypeId,
      sourceShipmentVersion: shipment.version,
      revenue: String(revenue),
      revenueOriginal: String(revenue),
      revenueEmptyReturn: String(revenue),
      pricingSource: freightPrice.source,
      pricingFormula: freightPrice.source === 'MANUAL'
        ? freightPrice.formula
        : buildFullPricingFormula(freightPrice.formula, revenue, vatRate),
      pricingSnapshot: freightPrice.snapshot,
      version: trip.version + 1,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, trip.id));
  }
}

function assertLegalTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (from === to) return; // Idempotent — transitionShipmentStatus handles same-status no-op before calling.
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      409,
      `Không thể chuyển lô hàng từ "${from}" sang "${to}".`,
    );
  }
}

async function createShipmentStatusCustomerVisibleEvent(
  tx: Tx,
  shipmentId: number,
  statusHistoryId: number,
  targetStatus: ShipmentStatus,
  createdBy: number,
  occurredAt: Date,
): Promise<void> {
  const copy = CUSTOMER_VISIBLE_SHIPMENT_STATUS_COPY[targetStatus];
  if (!copy) return;

  await createCustomerVisibleEvent({
    shipmentId,
    eventKey: `shipment:${shipmentId}:status-history:${statusHistoryId}`,
    eventType: 'MILESTONE',
    title: copy.title,
    message: copy.message,
    occurredAt,
    createdBy,
  }, undefined, tx);
}

// ─── Create ─────────────────────────────────────────────────────────────────

async function createShipmentTx(tx: Tx, input: CreateShipmentInput, actor?: AuthUser) {
  let responsibleUnitId = input.responsibleUnitId ?? null;
  if (actor && isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId, tx);
    assertClerkCanCreateForCustomer(scope, input.customerId);
    responsibleUnitId = resolveClerkResponsibleUnitId(scope, input.responsibleUnitId);
  }

  const closingAt = toNullableTimestamp(input.closingAt, 'Giờ closing');
  const plannedReturnAt = toNullableTimestamp(input.plannedReturnAt, 'Ngày trả rỗng kế hoạch');
  const initialStatus: ShipmentStatus = input.expectedDeliveryDate != null || closingAt != null || plannedReturnAt != null
    ? 'READY_FOR_DISPATCH'
    : 'PENDING_DATE';

  // 1. Insert the shipment row with date-derived readiness.
  const [shipment] = await tx.insert(s.shipments).values({
    customerId: input.customerId,
    routeId: input.routeId ?? null,
    cargoTypeId: input.cargoTypeId ?? null,
    responsibleUnitId,
    bookingRef: input.bookingRef ?? null,
    blNumber: input.blNumber ?? null,
    tradeDirection: input.tradeDirection ?? null,
    cargoMode: input.cargoMode ?? null,
    operationalSiteId: input.operationalSiteId ?? null,
    pickupWarehouseSiteId: input.pickupWarehouseSiteId ?? null,
    factoryName: input.factoryName ?? null,
    shippingLineName: input.shippingLineName ?? null,
    expectedDeliveryDate: input.expectedDeliveryDate ?? null,
    customsCutoffAt: toNullableTimestamp(input.customsCutoffAt, 'Hạn hải quan'),
    closingAt,
    plannedReturnAt,
    cargoWeightKg: toNullableFixedDecimal(input.cargoWeightKg, 8, 2, 'Trọng lượng'),
    cargoVolumeCbm: toNullableFixedDecimal(input.cargoVolumeCbm, 7, 3, 'Thể tích'),
    packageCount: input.packageCount ?? null,
    packageType: input.packageType ?? null,
    operationalNotes: input.operationalNotes ?? null,
    pickupLocation: input.pickupLocation ?? null,
    deliveryLocation: input.deliveryLocation ?? null,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    createdBy: input.createdBy ?? null,
    updatedBy: input.createdBy ?? null,
    status: initialStatus,
    version: 1,
  }).returning();

  // 2. Backfill the unique shipmentCode from the row id. Same tx ⇒ atomic.
  const shipmentCode = formatShipmentCode(shipment.id, shipment.createdAt);
  const [finalized] = await tx.update(s.shipments)
    .set({ shipmentCode })
    .where(eq(s.shipments.id, shipment.id))
    .returning();

  // 3. Append the initial status-history row (fromStatus = null = creation).
  await tx.insert(s.shipmentStatusHistory).values({
    shipmentId: shipment.id,
    fromStatus: null,
    toStatus: initialStatus,
    reason: 'Tạo lô hàng',
    changedBy: input.createdBy ?? null,
  });

  const bookingEventCreatorId = input.createdBy ?? actor?.userId ?? null;
  if (bookingEventCreatorId != null) {
    await createCustomerVisibleEvent({
      shipmentId: shipment.id,
      eventKey: `shipment:${shipment.id}:booking-received`,
      eventType: 'MILESTONE',
      title: 'Đã tiếp nhận booking',
      message: 'Thông tin booking của lô hàng đã được tiếp nhận.',
      occurredAt: shipment.createdAt,
      createdBy: bookingEventCreatorId,
    }, undefined, tx);
  }

  if (initialStatus === 'READY_FOR_DISPATCH') {
    await ensureReadyShipmentHandoff(tx, finalized, input.createdBy ?? actor?.userId ?? null);
  }

  return finalized;
}

export async function createShipment(input: CreateShipmentInput, actor?: AuthUser, transaction?: Tx) {
  return transaction
    ? createShipmentTx(transaction, input, actor)
    : db.transaction((tx) => createShipmentTx(tx, input, actor));
}

// ─── Quick create (M10.1) ───────────────────────────────────────────────────
//
// Clerk-facing mobile entry point. Wraps `createShipment` with server-side
// idempotency so a flaky-network resubmit (same `Idempotency-Key`) returns
// the original shipment instead of creating a duplicate (PRD M10-01-03,
// Q23 proposal). The minimum data set is just `customerId` (the only
// NOT NULL column on `shipments`); every other field is optional and
// typically filled in later from the M10.2 doc-entry page.
export async function createShipmentIdempotent(
  input: CreateShipmentInput,
  idempotencyKey: string | undefined,
  actor?: AuthUser,
): Promise<{ shipment: Awaited<ReturnType<typeof createShipment>>; replayed: boolean }> {
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_QUICK_CREATE,
    idempotencyKey,
    payload: input,
    createdBy: input.createdBy ?? null,
    entityType: 'shipment',
    create: async (tx) => createShipmentTx(tx, input, actor),
    load: async (id, tx) => getShipment(id, tx),
  });
  return { shipment: result, replayed };
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getShipment(id: number, tx?: Tx) {
  const executor = tx ?? db;
  const [shipment] = await executor.select().from(s.shipments)
    .where(and(eq(s.shipments.id, id), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  return normalizeShipmentRow(shipment);
}

export async function listShipments(options: ListShipmentsOptions = {}) {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (options.customerIds?.length) {
    conditions.push(inArray(s.shipments.customerId, options.customerIds));
  } else if (options.customerId != null) {
    conditions.push(eq(s.shipments.customerId, options.customerId));
  }
  if (options.status != null) {
    conditions.push(options.status === 'PENDING_DATE'
      ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE'])
      : options.status === 'NEW'
        ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH'])
        : eq(s.shipments.status, options.status));
  }
  const searchPredicate = buildShipmentSearchPredicate(options.q);
  if (searchPredicate) {
    conditions.push(searchPredicate);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await db.select({ shipment: s.shipments }).from(s.shipments)
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .where(and(...conditions))
    .orderBy(desc(s.shipments.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => normalizeShipmentRow(row.shipment));
}

/**
 * Paginated list with total count — the response shape the route layer needs
 * (`{ items, total, page, limit }`). Kept separate from `listShipments` so the
 * service-test suite's array-style assertions stay intact.
 */
export async function listShipmentsPaginated(options: ListShipmentsOptions & { page?: number }) {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * limit;

  const conditions = [isNull(s.shipments.deletedAt)];
  if (options.actor && isClerkScopedUser(options.actor)) {
    const scope = await loadClerkShipmentScope(options.actor.userId);
    conditions.push(buildShipmentScopeWhere(scope));
  }
  if (options.customerIds?.length) {
    conditions.push(inArray(s.shipments.customerId, options.customerIds));
  } else if (options.customerId != null) {
    conditions.push(eq(s.shipments.customerId, options.customerId));
  }
  if (options.status != null) {
    conditions.push(options.status === 'PENDING_DATE'
      ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE'])
      : options.status === 'NEW'
        ? inArray(s.shipments.status, ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH'])
        : eq(s.shipments.status, options.status));
  }
  const searchPredicate = buildShipmentSearchPredicate(options.q);
  if (searchPredicate) {
    conditions.push(searchPredicate);
  }
  if (options.tradeDirection) {
    conditions.push(eq(s.shipments.tradeDirection, options.tradeDirection));
  }
  if (options.blNumber) {
    // Exact match on trimmed value; empty strings are ignored by the route layer.
    conditions.push(eq(s.shipments.blNumber, options.blNumber.trim()));
  }
  if (options.dateFrom) {
    const from = new Date(options.dateFrom);
    if (!isNaN(from.getTime())) {
      conditions.push(gte(s.shipments.customsCutoffAt, from));
    }
  }
  if (options.dateTo) {
    const to = new Date(options.dateTo);
    if (!isNaN(to.getTime())) {
      // Inclusive end-of-day: bump to T23:59:59.999Z if user gave a date-only.
      const inclusive = options.dateTo.length === 10
        ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)
        : to;
      conditions.push(lte(s.shipments.customsCutoffAt, inclusive));
    }
  }

  // Join customers so the list can show a human-readable customer name
  // instead of a bare `customerId` ("KH #2698" is meaningless to users).
  // leftJoin (not innerJoin): a shipment whose customer was hard-deleted
  // must still appear, with customerName = null.
  const [items, totalRows] = await Promise.all([
    db.select({
      shipment: s.shipments,
      customerName: s.customers.name,
    }).from(s.shipments)
      .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .where(and(...conditions))
      .orderBy(desc(s.shipments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(s.shipments)
      .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
      .where(and(...conditions)),
  ]);
  const total = Number(totalRows[0]?.value ?? 0);
  const summariesByShipmentId = await loadShipmentListSummaries(items.map((row) => row.shipment));
  // W4 20260805_03: also fetch the first declaration number per shipment so
  // the CUS grid can show "Số tờ khai" without a second roundtrip.
  const declarationByShipmentId = await loadShipmentListDeclarationNumbers(
    items.map((row) => row.shipment.id),
  );
  // Flatten `shipment` + `customerName` into a single object so the route
  // layer returns `{ ...shipmentColumns, customerName }` directly.
  const flatItems = items.map((row) => ({
    ...normalizeShipmentRow(row.shipment),
    customerName: row.customerName,
    cargoSummary: summariesByShipmentId.get(row.shipment.id)?.cargoSummary ?? null,
    shippingLineSummary: summariesByShipmentId.get(row.shipment.id)?.shippingLineSummary ?? null,
    carrierSummary: summariesByShipmentId.get(row.shipment.id)?.carrierSummary ?? null,
    vehiclePlateSummary: summariesByShipmentId.get(row.shipment.id)?.vehiclePlateSummary ?? null,
    declarationNumber: declarationByShipmentId.get(row.shipment.id) ?? null,
  }));
  return { items: flatItems, total, page, limit };
}

// ─── Update (optimistic-lock) ───────────────────────────────────────────────

export async function updateShipment(
  id: number,
  input: UpdateShipmentInput,
  actor?: AuthUser,
  transaction?: Tx,
): Promise<ShipmentUpdateResult> {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, id), isNull(s.shipments.deletedAt)))
      .for('update') // pessimistic row lock so the version bump is race-free
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, id);

    let clerkScope = null;
    if (actor && isClerkScopedUser(actor)) {
      clerkScope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(clerkScope, existing);
      if (input.customerId !== undefined) {
        assertClerkCanCreateForCustomer(clerkScope, input.customerId);
      }
      if (input.responsibleUnitId != null) {
        resolveClerkResponsibleUnitId(clerkScope, input.responsibleUnitId);
      }
    }

    const expectedVersion = input.expectedVersion ?? input.version;
    if (expectedVersion == null || existing.version !== expectedVersion) {
      throw new ApiError(
        409,
        'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.',
      );
    }

    if (existing.cargoMode === 'FCL' && input.cargoMode === 'LCL') {
      const fulfillmentRows = await tx.select({
        id: s.shipmentFulfillments.id,
      }).from(s.shipmentFulfillments)
        .where(eq(s.shipmentFulfillments.shipmentId, id))
        .for('update');
      if (fulfillmentRows.length > 0) {
        throw new ApiError(
          409,
          'Không thể chuyển lô hàng từ FCL sang LCL sau khi đã phát sinh tác vụ điều phối.',
        );
      }
      await tx.delete(s.shipmentContainers)
        .where(eq(s.shipmentContainers.shipmentId, id));
    }

    const planClassification = classifyClerkShipmentPatch(existing, {
      customerId: input.customerId,
      routeId: input.routeId,
      cargoTypeId: input.cargoTypeId,
      responsibleUnitId: input.responsibleUnitId,
      bookingRef: input.bookingRef,
      blNumber: input.blNumber,
      tradeDirection: input.tradeDirection,
      cargoMode: input.cargoMode,
      operationalSiteId: input.operationalSiteId,
      pickupWarehouseSiteId: input.pickupWarehouseSiteId,
      factoryName: input.factoryName,
      shippingLineName: input.shippingLineName,
      expectedDeliveryDate: input.expectedDeliveryDate,
      customsCutoffAt: input.customsCutoffAt,
      closingAt: input.closingAt,
      plannedReturnAt: input.plannedReturnAt,
      cargoWeightKg: input.cargoWeightKg,
      cargoVolumeCbm: input.cargoVolumeCbm,
      packageCount: input.packageCount,
      packageType: input.packageType,
      operationalNotes: input.operationalNotes,
      pickupLocation: input.pickupLocation,
      deliveryLocation: input.deliveryLocation,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
    });
    const shipmentAuthorityChanged = planClassification.changedFields.some(
      (field) => field === 'customerId' || field === 'cargoTypeId',
    );

    if (shipmentAuthorityChanged && !isDirectlyEditableIntakeStatus(existing.status)) {
      const requesterId = actor?.userId ?? input.updatedBy ?? existing.updatedBy ?? existing.createdBy;
      if (requesterId == null) {
        throw new ApiError(400, 'Thiếu người gửi yêu cầu thay đổi lô hàng.');
      }
      const changeRequestId = await createShipmentChangeRequest(tx, {
        shipment: existing,
        sourceVersion: existing.version,
        requestKind: 'PLAN_UPDATE',
        requestedBy: requesterId,
        beforeSnapshot: planClassification.beforeSnapshot,
        afterSnapshot: planClassification.afterSnapshot,
      });
      return {
        ...existing,
        changeMode: 'REQUESTED' as const,
        changeRequestId,
        notificationDelivered: false,
        message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch.',
      };
    }

    if (actor && isClerkScopedUser(actor)) {
      if (planClassification.mode === 'NOOP') {
        return {
          ...existing,
          changeMode: 'NOOP' as const,
          changeRequestId: null,
          notificationDelivered: true,
        };
      }

      if (planClassification.mode === 'REQUESTED') {
        const changeRequestId = await createShipmentChangeRequest(tx, {
          shipment: existing,
          sourceVersion: existing.version,
          requestKind: 'PLAN_UPDATE',
          requestedBy: actor.userId,
          beforeSnapshot: planClassification.beforeSnapshot,
          afterSnapshot: planClassification.afterSnapshot,
        });
        return {
          ...existing,
          changeMode: 'REQUESTED' as const,
          changeRequestId,
          notificationDelivered: false,
          message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch.',
        };
      }
    }

    const nextExpectedDeliveryDate = input.expectedDeliveryDate !== undefined
      ? input.expectedDeliveryDate
      : existing.expectedDeliveryDate;
    const nextClosingAt = input.closingAt !== undefined
      ? toNullableTimestamp(input.closingAt, 'Giờ closing')
      : existing.closingAt;
    const nextPlannedReturnAt = input.plannedReturnAt !== undefined
      ? toNullableTimestamp(input.plannedReturnAt, 'Ngày trả rỗng kế hoạch')
      : existing.plannedReturnAt;
    const currentCanonicalStatus = canonicalShipmentStatus(existing.status);
    if (currentCanonicalStatus === 'READY_FOR_DISPATCH' && !hasDispatchDate({
      expectedDeliveryDate: nextExpectedDeliveryDate,
      closingAt: nextClosingAt,
      plannedReturnAt: nextPlannedReturnAt,
    })) {
      throw new ApiError(409, 'Lô hàng đã sẵn sàng điều xe nên phải giữ ngày vận chuyển, giờ đóng hoặc thời gian trả hàng.');
    }
    const becomesReady = currentCanonicalStatus === 'PENDING_DATE'
      && hasDispatchDate({
        expectedDeliveryDate: nextExpectedDeliveryDate,
        closingAt: nextClosingAt,
        plannedReturnAt: nextPlannedReturnAt,
      });
    const nextVersion = existing.version + 1;
    const [updated] = await tx.update(s.shipments).set({
      version: nextVersion,
      ...(input.customerId != null ? { customerId: input.customerId } : {}),
      ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
      ...(input.cargoTypeId !== undefined ? { cargoTypeId: input.cargoTypeId } : {}),
      ...(input.responsibleUnitId !== undefined ? { responsibleUnitId: input.responsibleUnitId } : {}),
      ...(input.bookingRef !== undefined ? { bookingRef: input.bookingRef } : {}),
      ...(input.blNumber !== undefined ? { blNumber: input.blNumber } : {}),
      ...(input.tradeDirection !== undefined ? { tradeDirection: input.tradeDirection } : {}),
      ...(input.cargoMode !== undefined ? { cargoMode: input.cargoMode } : {}),
      ...(input.operationalSiteId !== undefined ? { operationalSiteId: input.operationalSiteId } : {}),
      ...(input.pickupWarehouseSiteId !== undefined ? { pickupWarehouseSiteId: input.pickupWarehouseSiteId } : {}),
      ...(input.factoryName !== undefined ? { factoryName: input.factoryName } : {}),
      ...(input.shippingLineName !== undefined ? { shippingLineName: input.shippingLineName } : {}),
      ...(input.expectedDeliveryDate !== undefined
        ? { expectedDeliveryDate: input.expectedDeliveryDate }
        : {}),
      ...(input.customsCutoffAt !== undefined ? { customsCutoffAt: toNullableTimestamp(input.customsCutoffAt, 'Hạn hải quan') } : {}),
      ...(input.closingAt !== undefined ? { closingAt: nextClosingAt } : {}),
      ...(input.plannedReturnAt !== undefined ? { plannedReturnAt: nextPlannedReturnAt } : {}),
      ...(becomesReady ? { status: 'READY_FOR_DISPATCH' as const } : {}),
      ...(input.cargoWeightKg !== undefined ? { cargoWeightKg: toNullableFixedDecimal(input.cargoWeightKg, 8, 2, 'Trọng lượng') } : {}),
      ...(input.cargoVolumeCbm !== undefined ? { cargoVolumeCbm: toNullableFixedDecimal(input.cargoVolumeCbm, 7, 3, 'Thể tích') } : {}),
      ...(input.packageCount !== undefined ? { packageCount: input.packageCount } : {}),
      ...(input.packageType !== undefined ? { packageType: input.packageType } : {}),
      ...(input.operationalNotes !== undefined ? { operationalNotes: input.operationalNotes } : {}),
      ...(input.pickupLocation !== undefined
        ? { pickupLocation: input.pickupLocation }
        : {}),
      ...(input.deliveryLocation !== undefined
        ? { deliveryLocation: input.deliveryLocation }
        : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, id)).returning();

    if (becomesReady) {
      await tx.insert(s.shipmentStatusHistory).values({
        shipmentId: id,
        fromStatus: existing.status ?? 'PENDING_DATE',
        toStatus: 'READY_FOR_DISPATCH',
        reason: 'Đã bổ sung ngày vận chuyển, giờ đóng hoặc thời gian trả hàng và sẵn sàng điều xe.',
        changedBy: input.updatedBy ?? actor?.userId ?? null,
      });
      await ensureReadyShipmentHandoff(tx, updated, input.updatedBy ?? actor?.userId ?? null);
    }
    if (shipmentAuthorityChanged && isDirectlyEditableIntakeStatus(updated.status)) {
      await syncShipmentAuthorityToTrips(tx, updated);
    }

    return {
      ...updated,
      changeMode: 'DIRECT' as const,
      changeRequestId: null,
      notificationDelivered: true,
    };
  };
  const result = transaction ? await execute(transaction) : await db.transaction(execute);
  if (result.changeMode === 'REQUESTED') {
    return {
      ...result,
      notificationDelivered: true,
      message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch và thông báo điều vận.',
    };
  }
  return result;
}

// ─── Status transitions ─────────────────────────────────────────────────────

export async function transitionShipmentStatus(
  shipmentId: number,
  targetStatus: ShipmentStatus,
  options: { reason?: string | null; changedBy?: number | null } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);

    const currentStatus = canonicalShipmentStatus(shipment.status);
    if (!currentStatus) {
      throw new ApiError(409, 'Trạng thái lô hàng không hợp lệ.');
    }

    // Idempotent: same target → no-op, return current row without writing a
    // duplicate history row (mirrors trip-status-machine's short-circuit).
    if (currentStatus === targetStatus) return shipment;

    if (targetStatus === 'READY_FOR_DISPATCH' && !hasDispatchDate(shipment)) {
      throw new ApiError(409, 'Cần nhập ngày vận chuyển, giờ đóng hoặc thời gian trả hàng trước khi sẵn sàng điều xe.');
    }

    assertLegalTransition(currentStatus, targetStatus);
    const transitionedAt = new Date();

    // Conditional update guards against concurrent transition races.
    const [updated] = await tx.update(s.shipments).set({
      status: targetStatus,
      version: sql`${s.shipments.version} + 1`,
      updatedAt: transitionedAt,
    })
      .where(and(eq(s.shipments.id, shipmentId), eq(s.shipments.status, shipment.status ?? currentStatus)))
      .returning();

    if (!updated) {
      throw new ApiError(
        409,
        'Trạng thái lô hàng đã bị thay đổi bởi người khác. Vui lòng tải lại.',
      );
    }

    const [historyRow] = await tx.insert(s.shipmentStatusHistory).values({
      shipmentId,
      fromStatus: shipment.status ?? currentStatus,
      toStatus: targetStatus,
      reason: options.reason ?? null,
      changedBy: options.changedBy ?? null,
      changedAt: transitionedAt,
    }).returning({ id: s.shipmentStatusHistory.id });
    const eventActorId = options.changedBy ?? null;
    if (eventActorId != null && historyRow) {
      await createShipmentStatusCustomerVisibleEvent(
        tx,
        shipmentId,
        historyRow.id,
        targetStatus,
        eventActorId,
        transitionedAt,
      );
    }
    if (targetStatus === 'READY_FOR_DISPATCH') {
      await ensureReadyShipmentHandoff(tx, updated, eventActorId);
    }

    return updated;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

function isPodReviewWriter(actor: AuthUser): boolean {
  return actor.role === Role.CUS;
}

function isRoutineShipmentCloseWriter(actor: AuthUser): boolean {
  return actor.role === Role.ACCOUNTANT;
}

const ROUTINE_SHIPMENT_CLOSE_VAT_RATES = new Set<number>([0, 0.05, 0.08, 0.10]);

function normalizeRoutineShipmentCloseVatRate(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  if (!ROUTINE_SHIPMENT_CLOSE_VAT_RATES.has(rounded)) {
    throw new ApiError(400, 'Thuế suất VAT chỉ được chọn 0%, 5%, 8% hoặc 10%.');
  }
  return rounded;
}

type ShipmentDirectCloseTripVersionInput = {
  tripId: number;
  expectedVersion: number;
};

type ShipmentDirectCloseResult = {
  shipment: Pick<typeof s.shipments.$inferSelect, 'id' | 'shipmentCode' | 'status' | 'version'>;
  completedTripIds: number[];
  vatRate: number;
};

type ShipmentPricingProjectionView = Awaited<ReturnType<typeof resolveShipmentPricingProjection>>;

async function buildShipmentPricingProjection(
  shipment: Pick<
    typeof s.shipments.$inferSelect,
    'customerId'
    | 'routeId'
    | 'cargoTypeId'
    | 'cargoMode'
    | 'expectedDeliveryDate'
    | 'cargoWeightKg'
  >,
  containers: ReadonlyArray<Pick<typeof s.shipmentContainers.$inferSelect, 'containerTypeId'>>,
): Promise<ShipmentPricingProjectionView> {
  return resolveShipmentPricingProjection({
    customerId: shipment.customerId,
    routeId: shipment.routeId,
    cargoMode: shipment.cargoMode,
    cargoTypeId: shipment.cargoTypeId,
    date: shipment.expectedDeliveryDate,
    cargoWeightKg: shipment.cargoWeightKg,
    containerCount: containers.length,
    containerTypeIds: containers.map((container) => container.containerTypeId),
  });
}

async function assertRoutineShipmentCloseCheckerSeparation(
  tx: Tx,
  tripIds: number[],
  completerUserId: number,
): Promise<void> {
  const acceptedRows = await tx.select({
    tripId: s.tripPodSubmissions.tripId,
    reviewedBy: s.tripPodSubmissions.reviewedBy,
  }).from(s.tripPodSubmissions)
    .where(and(
      inArray(s.tripPodSubmissions.tripId, tripIds),
      eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
    ))
    .orderBy(desc(s.tripPodSubmissions.tripId), desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
    .for('update');

  const reviewerIds = [...new Set(acceptedRows.flatMap((row) => row.reviewedBy == null ? [] : [row.reviewedBy]))];
  const reviewerRoles = reviewerIds.length === 0
    ? new Map<number, string>()
    : new Map((await tx.select({ id: s.users.id, role: s.users.role })
      .from(s.users)
      .where(inArray(s.users.id, reviewerIds)))
      .map((row) => [row.id, row.role]));

  const latestAcceptedByTrip = new Map<number, { reviewedBy: number | null; reviewerRole: string | null }>();
  for (const row of acceptedRows) {
    if (!latestAcceptedByTrip.has(row.tripId)) {
      latestAcceptedByTrip.set(row.tripId, {
        reviewedBy: row.reviewedBy,
        reviewerRole: row.reviewedBy == null ? null : reviewerRoles.get(row.reviewedBy) ?? null,
      });
    }
  }

  for (const tripId of tripIds) {
    const checker = latestAcceptedByTrip.get(tripId);
    if (checker?.reviewedBy == null) {
      throw new ApiError(409, 'Chuyến chưa có người CUS/CLERK kiểm tra POD và hồ sơ chi phí.');
    }
    if (checker.reviewerRole !== Role.CUS) {
      throw new ApiError(409, 'Người kiểm tra POD và hồ sơ chi phí phải là CUS/CLERK.');
    }
    if (checker.reviewedBy === completerUserId) {
      throw new ApiError(409, 'Tài khoản Kế toán hoàn thành phải khác tài khoản CUS/CLERK đã kiểm tra hồ sơ.');
    }
  }
}

async function loadReviewTripPodResult(
  tx: Tx,
  shipmentId: number,
  submissionId: number,
): Promise<ReviewTripPodResult> {
  const [row] = await tx.select({
    shipment: s.shipments,
    submissionId: s.tripPodSubmissions.id,
    submissionStatus: s.tripPodSubmissions.status,
    tripId: s.trips.id,
    tripStatus: s.trips.status,
  }).from(s.tripPodSubmissions)
    .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.tripPodSubmissions.fulfillmentId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .innerJoin(s.trips, eq(s.trips.id, s.tripPodSubmissions.tripId))
    .where(and(
      eq(s.tripPodSubmissions.id, submissionId),
      eq(s.shipments.id, shipmentId),
      isNull(s.shipments.deletedAt),
      isNull(s.trips.deletedAt),
    ))
    .limit(1);
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy e-POD cần xử lý.');
  }
  return {
    shipment: row.shipment,
    submissionId: row.submissionId,
    submissionStatus: row.submissionStatus as TripPodStatus,
    tripId: row.tripId,
    tripStatus: row.tripStatus,
    shipmentVersion: row.shipment.version,
  };
}

async function loadShipmentDirectCloseResult(
  tx: Tx,
  shipmentId: number,
  tripIds?: number[],
): Promise<ShipmentDirectCloseResult> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    status: s.shipments.status,
    version: s.shipments.version,
  }).from(s.shipments)
    .where(and(
      eq(s.shipments.id, shipmentId),
      isNull(s.shipments.deletedAt),
    ))
    .limit(1);
  if (!shipment) {
    throw new ApiError(404, 'Không tìm thấy lô hàng.');
  }

  const trips = await tx.select({
    id: s.trips.id,
    vatRate: s.trips.vatRate,
  }).from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      isNull(s.trips.deletedAt),
      eq(s.trips.status, TripStatus.COMPLETED),
      ...(tripIds && tripIds.length > 0 ? [inArray(s.trips.id, tripIds)] : []),
    ))
    .orderBy(asc(s.trips.id));

  return {
    shipment: normalizeShipmentRow(shipment),
    completedTripIds: trips.map((trip) => trip.id),
    vatRate: trips.length > 0 ? Number(trips[0]?.vatRate ?? 0) : 0,
  };
}

export async function recomputeShipmentCompletion(
  shipmentId: number,
  options: { changedBy?: number | null } = {},
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) {
      throw new ApiError(404, 'Không tìm thấy lô hàng.');
    }
    const currentShipmentStatus = canonicalShipmentStatus(shipment.status);
    if (currentShipmentStatus === 'CANCELED' || currentShipmentStatus === 'COMPLETED') {
      return shipment;
    }

    const { fulfillmentRows, requiredFulfillments } = await loadShipmentCloseAuthorityContext(tx, shipmentId);
    if (fulfillmentRows.length === 0) {
      return shipment;
    }
    if (requiredFulfillments.length === 0) {
      if (
        currentShipmentStatus === 'PENDING_DATE'
        || currentShipmentStatus === 'READY_FOR_DISPATCH'
        || currentShipmentStatus === 'DISPATCHED'
      ) {
        return shipment;
      }
      return transitionShipmentStatus(
        shipmentId,
        'DISPATCHED',
        {
          reason: 'Tự động giữ trạng thái Đã điều xe vì lô hàng chưa còn tác vụ bắt buộc.',
          changedBy: options.changedBy ?? null,
        },
        tx,
      );
    }

    const requiredFulfillmentIds = requiredFulfillments.map((row) => row.id);
    const trips = await listRequiredShipmentAuthorityTrips(tx, requiredFulfillmentIds);
    const tripsByFulfillment = new Map<number, typeof trips>();
    for (const trip of trips) {
      const fulfillmentId = trip.fulfillmentId;
      if (fulfillmentId == null) continue;
      const existing = tripsByFulfillment.get(fulfillmentId) ?? [];
      existing.push(trip);
      tripsByFulfillment.set(fulfillmentId, existing);
    }

    const latestSubmissionRows = trips.length === 0
      ? []
      : await tx.select({
        tripId: s.tripPodSubmissions.tripId,
        status: s.tripPodSubmissions.status,
      }).from(s.tripPodSubmissions)
        .where(inArray(s.tripPodSubmissions.tripId, trips.map((trip) => trip.id)))
        .orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id))
        .for('update');
    const latestSubmissionByTripId = new Map<number, TripPodStatus>();
    for (const row of latestSubmissionRows) {
      if (!latestSubmissionByTripId.has(row.tripId)) {
        latestSubmissionByTripId.set(row.tripId, row.status as TripPodStatus);
      }
    }

    const acceptedSubmissions = trips.length === 0
      ? []
      : await tx.select({
        tripId: s.tripPodSubmissions.tripId,
      }).from(s.tripPodSubmissions)
        .where(and(
          inArray(s.tripPodSubmissions.tripId, trips.map((trip) => trip.id)),
          eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
        ))
        .for('update');
    const acceptedTripIds = new Set(acceptedSubmissions.map((row) => row.tripId));

    const tripIds = trips.map((trip) => trip.id);
    const {
      completedExpenseScopeKeys,
      containersByTrip,
    } = await loadTripExpenseScopeState(tx, tripIds);

    const allRequiredTripsPresent = requiredFulfillments.every((row) => {
      const linkedTrips = tripsByFulfillment.get(row.id) ?? [];
      return linkedTrips.length === 1;
    });
    if (!allRequiredTripsPresent) {
      if (
        currentShipmentStatus === 'PENDING_DATE'
        || currentShipmentStatus === 'READY_FOR_DISPATCH'
        || currentShipmentStatus === 'DISPATCHED'
      ) {
        return shipment;
      }
      return transitionShipmentStatus(
          shipmentId,
          'DISPATCHED',
          {
            reason: 'Tự động quay về Đã điều xe vì tác vụ bắt buộc chưa xuất phát hoặc cần điều phối lại.',
            changedBy: options.changedBy ?? null,
          },
          tx,
        );
    }

    const allCompleted = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && trip.status === 'COMPLETED';
    });
    const allExpenseScopesComplete = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && hasCompletedExpenseScopes(
        trip.id,
        containersByTrip.get(trip.id) ?? [],
        completedExpenseScopeKeys,
      );
    });
    const anyInTransit = trips.some((trip) => trip.status === TripStatus.IN_TRANSIT);
    const allAwaitingApproval = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      const latestSubmissionStatus = trip == null ? null : latestSubmissionByTripId.get(trip.id) ?? null;
      return trip != null
        && latestSubmissionStatus != null
        && hasCompletedExpenseScopes(
          trip.id,
          containersByTrip.get(trip.id) ?? [],
          completedExpenseScopeKeys,
        )
        && (latestSubmissionStatus === TripPodStatus.SUBMITTED || latestSubmissionStatus === TripPodStatus.ACCEPTED);
    });
    const allCompletedAndAccepted = requiredFulfillments.every((row) => {
      const trip = tripsByFulfillment.get(row.id)?.[0];
      return trip != null && trip.status === 'COMPLETED'
        && hasCompletedExpenseScopes(
          trip.id,
          containersByTrip.get(trip.id) ?? [],
          completedExpenseScopeKeys,
        )
        && acceptedTripIds.has(trip.id)
        && trip.podRecoveredAt != null;
    });

    let targetStatus: ShipmentStatus = 'DISPATCHED';
    let reason = 'Tự động cập nhật theo tình trạng điều xe hiện tại.';
    if (allCompletedAndAccepted) {
      targetStatus = 'COMPLETED';
      reason = 'Tự động hoàn thành khi mọi tác vụ đã duyệt e-POD, thu hồi POD gốc và chốt xong.';
    } else if (allAwaitingApproval || (allCompleted && allExpenseScopesComplete)) {
      targetStatus = 'PENDING_EXPENSE_APPROVAL';
      reason = 'Tự động chuyển sang Chờ duyệt phí khi mọi tác vụ đã nộp đủ hồ sơ chờ kế toán/CUS duyệt.';
    } else if (anyInTransit) {
      targetStatus = 'IN_TRANSIT';
      reason = 'Tự động chuyển sang Đang chạy khi đã có chuyến xuất phát.';
    }

    if (currentShipmentStatus === targetStatus) return shipment;

    // Never skip a PRD lifecycle state, including when legacy data or a
    // replayed event arrives after downstream evidence has already been
    // submitted. Each intermediate transition is auditable in status history.
    let current: ShipmentStatus = currentShipmentStatus as ShipmentStatus;
    let currentRow = shipment;
    if (current === 'READY_FOR_DISPATCH') {
      currentRow = await transitionShipmentStatus(shipmentId, 'DISPATCHED', {
        reason: 'Khôi phục trạng thái Đã điều xe trước khi ghi nhận kết quả vận hành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'DISPATCHED';
    }
    if (
      current === 'DISPATCHED'
      && (targetStatus === 'PENDING_EXPENSE_APPROVAL' || targetStatus === 'COMPLETED')
    ) {
      currentRow = await transitionShipmentStatus(shipmentId, 'IN_TRANSIT', {
        reason: 'Khôi phục trạng thái Đang chạy trước khi ghi nhận hồ sơ vận hành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'IN_TRANSIT';
    }
    if (current === 'IN_TRANSIT' && targetStatus === 'COMPLETED') {
      currentRow = await transitionShipmentStatus(shipmentId, 'PENDING_EXPENSE_APPROVAL', {
        reason: 'Ghi nhận bước Chờ duyệt phí trước khi hoàn thành.',
        changedBy: options.changedBy ?? null,
      }, tx);
      current = 'PENDING_EXPENSE_APPROVAL';
    }
    if (current === targetStatus) return currentRow;
    return transitionShipmentStatus(shipmentId, targetStatus, {
      reason,
      changedBy: options.changedBy ?? null,
    }, tx);
  };

  return transaction ? execute(transaction) : db.transaction(execute);
}

export async function reviewTripPodSubmission(args: {
  shipmentId: number;
  submissionId: number;
  expectedVersion: number;
  resolution: 'ACCEPT' | 'REJECT';
  rejectionReason?: string | null;
  idempotencyKey: string;
  actor: AuthUser;
  // O2C C1: the PRD says the accountant ticks "Đã thu hồi chứng từ gốc (POD)"
  // on the same screen as e-POD acceptance. This flag sets podRecoveredAt
  // inside the transaction, immediately before the completion transition,
  // so the POD-recovery gate passes without a separate API call.
  podRecovered?: boolean;
}) {
  if (!isPodReviewWriter(args.actor)) {
    throw new ApiError(403, 'Chỉ CUS/CLERK mới được kiểm tra e-POD và hồ sơ chi phí.');
  }
  if (args.resolution === 'REJECT' && !args.rejectionReason?.trim()) {
    throw new ApiError(400, 'Cần nhập lý do từ chối e-POD.');
  }
  // O2C C1: if accepting and the trip doesn't yet have podRecoveredAt, the
  // caller MUST pass podRecovered=true to confirm paper POD is in hand. This
  // matches the PRD's "Kế toán/CUS đã tích chọn 'Đã thu hồi chứng từ gốc'".
  if (args.resolution === 'ACCEPT' && !args.podRecovered) {
    throw new ApiError(
      400,
      'Vui lòng xác nhận đã thu hồi chứng từ gốc (POD) trước khi duyệt e-POD.',
    );
  }

  const normalizedReason = args.rejectionReason?.trim() || null;
  let pushPayload: NotificationPayload | null = null;
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_REVIEW,
    idempotencyKey: args.idempotencyKey,
    payload: {
      shipmentId: args.shipmentId,
      submissionId: args.submissionId,
      expectedVersion: args.expectedVersion,
      resolution: args.resolution,
      rejectionReason: normalizedReason,
    },
    createdBy: args.actor.userId,
    entityType: 'trip_pod_submission',
    responseStatusCode: 200,
    serializeResult: () => null,
    load: async (entityId, tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      return loadReviewTripPodResult(tx, args.shipmentId, entityId);
    },
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      await assertShipmentAccountingUnlocked(tx, args.shipmentId);

      // Cancellation, POD review, and aggregate recomputation all serialize on
      // the shipment first. Keeping this shared lock order prevents a review
      // from holding trip/fulfillment rows while cancellation holds shipment.
      const [lockedShipment] = await tx.select({ id: s.shipments.id })
        .from(s.shipments)
        .where(and(
          eq(s.shipments.id, args.shipmentId),
          isNull(s.shipments.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!lockedShipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng.');
      }

      const [row] = await tx.select({
        submission: s.tripPodSubmissions,
        trip: s.trips,
        fulfillment: s.shipmentFulfillments,
      }).from(s.tripPodSubmissions)
        .innerJoin(s.trips, eq(s.trips.id, s.tripPodSubmissions.tripId))
        .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.tripPodSubmissions.fulfillmentId))
        .where(and(
          eq(s.tripPodSubmissions.id, args.submissionId),
          eq(s.shipmentFulfillments.shipmentId, args.shipmentId),
          isNull(s.trips.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!row) {
        throw new ApiError(404, 'Không tìm thấy e-POD cần xử lý.');
      }
      if (row.submission.version !== args.expectedVersion) {
        throw new ApiError(409, 'Phiên bản e-POD đã thay đổi. Vui lòng tải lại.');
      }
      if (row.submission.status !== TripPodStatus.SUBMITTED) {
        throw new ApiError(409, 'e-POD này đã được người khác xử lý.');
      }
      if (row.trip.status !== 'IN_TRANSIT') {
        throw new ApiError(409, 'Chỉ có thể duyệt e-POD của chuyến đang chạy.');
      }

      const files = await tx.select({
        fileType: s.tripPodFiles.fileType,
      }).from(s.tripPodFiles)
        .where(eq(s.tripPodFiles.submissionId, row.submission.id));
      const availableFileTypes = new Set(files.map((file) => file.fileType as typeof TRIP_POD_REQUIRED_FILE_TYPES[number]));
      const missingRequired = TRIP_POD_REQUIRED_FILE_TYPES.filter((fileType) => !availableFileTypes.has(fileType));
      if (missingRequired.length > 0) {
        throw new ApiError(409, 'e-POD chưa đủ hồ sơ bắt buộc để duyệt.');
      }

      const [updatedSubmission] = await tx.update(s.tripPodSubmissions).set({
        status: args.resolution === 'ACCEPT' ? TripPodStatus.ACCEPTED : TripPodStatus.REJECTED,
        reviewedBy: args.actor.userId,
        reviewedAt: new Date(),
        rejectionReason: args.resolution === 'REJECT' ? normalizedReason : null,
        version: sql`${s.tripPodSubmissions.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(s.tripPodSubmissions.id, row.submission.id),
        eq(s.tripPodSubmissions.status, TripPodStatus.SUBMITTED),
        eq(s.tripPodSubmissions.version, args.expectedVersion),
      )).returning({ id: s.tripPodSubmissions.id });
      if (!updatedSubmission) {
        throw new ApiError(409, 'e-POD này đã được người khác xử lý.');
      }

      if (args.resolution === 'ACCEPT') {
        // O2C C1: set podRecoveredAt inside the same tx so the POD-recovery
        // gate in transitionTripStatus passes. Only set if not already set
        // (idempotent — a prior /pod-recovered call may have done it).
        if (row.trip.podRecoveredAt == null) {
          await tx.update(s.trips).set({
            podRecoveredAt: new Date(),
            podRecoveredBy: args.actor.userId,
          }).where(eq(s.trips.id, row.trip.id));
        }
        // Accepting e-POD and confirming the original paper POD makes the
        // shipment ready for completion, but does not complete it. Financial
        // posting can then happen either through the routine Accountant/CUS
        // close path or the separate governed exception path.
        await recomputeShipmentCompletion(args.shipmentId, { changedBy: args.actor.userId }, tx);
        if (row.trip.driverId != null) {
          pushPayload = {
            type: NotificationType.TRIP_COMPLETED,
            title: 'e-POD đã được duyệt',
            message: `Chuyến ${row.trip.tripCode ?? 'chưa có mã'} đã đủ hồ sơ và đang chờ phê duyệt hoàn thành.`,
            relatedEntityType: 'shipment_fulfillments',
            relatedEntityId: row.fulfillment.id,
            targetDriverId: row.trip.driverId,
          };
          await persistNotificationInTx(tx, pushPayload);
        }
      } else {
        if (row.trip.driverId != null) {
          pushPayload = {
            type: NotificationType.SYSTEM_ANNOUNCEMENT,
            title: 'e-POD cần bổ sung',
            message: `e-POD của chuyến ${row.trip.tripCode ?? 'chưa có mã'} đã bị từ chối${normalizedReason ? `: ${normalizedReason}` : '.'} Vui lòng tạo phiên bản mới để gửi lại.`,
            relatedEntityType: 'shipment_fulfillments',
            relatedEntityId: row.fulfillment.id,
            targetDriverId: row.trip.driverId,
          };
          await persistNotificationInTx(tx, pushPayload);
        }
      }

      return loadReviewTripPodResult(tx, args.shipmentId, row.submission.id);
    },
    getEntityId: (result) => result.submissionId,
  });

  if (!outcome.replayed && pushPayload) {
    await sendNotificationPush(pushPayload).catch((error) => {
      console.error('POD review push delivery failed:', error);
    });
  }

  return {
    ...outcome.result,
    replayed: outcome.replayed,
  };
}

export async function completeShipmentDirect(args: {
  shipmentId: number;
  expectedVersion: number;
  vatRate: number;
  trips: ShipmentDirectCloseTripVersionInput[];
  confirmZeroRevenue?: boolean;
  confirmNoPhoto?: boolean;
  idempotencyKey: string;
  actor: AuthUser;
}): Promise<ShipmentDirectCloseResult & { replayed: boolean }> {
  if (!isRoutineShipmentCloseWriter(args.actor)) {
    throw new ApiError(403, 'Chỉ Kế toán mới được hoàn thành trực tiếp lô hàng.');
  }
  const vatRate = normalizeRoutineShipmentCloseVatRate(args.vatRate);
  const normalizedTripVersions = [...args.trips]
    .map((item) => ({
      tripId: item.tripId,
      expectedVersion: item.expectedVersion,
    }))
    .sort((left, right) => left.tripId - right.tripId);
  if (normalizedTripVersions.length === 0) {
    throw new ApiError(400, 'Danh sách phiên bản chuyến đi là bắt buộc.');
  }
  const maxTripVersions = 100;
  if (normalizedTripVersions.length > maxTripVersions) {
    throw new ApiError(400, `Danh sách phiên bản chuyến đi không được vượt quá ${maxTripVersions}.`);
  }
  const duplicateTripIds = normalizedTripVersions
    .filter((item, index, all) => index > 0 && item.tripId === all[index - 1]?.tripId)
    .map((item) => item.tripId);
  if (duplicateTripIds.length > 0) {
    throw new ApiError(400, 'Danh sách phiên bản chuyến đi bị trùng.');
  }

  const outcome = await runIdempotent<ShipmentDirectCloseResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_COMPLETE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      shipmentId: args.shipmentId,
      expectedVersion: args.expectedVersion,
      vatRate,
      confirmZeroRevenue: args.confirmZeroRevenue === true,
      trips: normalizedTripVersions,
    },
    createdBy: args.actor.userId,
    entityType: 'shipment',
    responseStatusCode: 200,
    getEntityKey: (result) => result.shipment.shipmentCode,
    load: async (entityId, tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      return loadShipmentDirectCloseResult(tx, entityId);
    },
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      await assertShipmentAccountingUnlocked(tx, args.shipmentId);

      const [shipment] = await tx.select({
        id: s.shipments.id,
        version: s.shipments.version,
        status: s.shipments.status,
      }).from(s.shipments)
        .where(and(
          eq(s.shipments.id, args.shipmentId),
          isNull(s.shipments.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!shipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng.');
      }
      if (shipment.version !== args.expectedVersion) {
        throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
      }
      if (canonicalShipmentStatus(shipment.status) !== 'PENDING_EXPENSE_APPROVAL') {
        throw new ApiError(409, 'Chỉ có thể chốt trực tiếp lô hàng đang chờ duyệt phí.');
      }

      const { requiredFulfillments } = await loadShipmentCloseAuthorityContext(tx, shipment.id);
      if (requiredFulfillments.length === 0) {
        throw new ApiError(409, 'Lô hàng chưa có tác vụ bắt buộc để chốt.');
      }

      const expectedTripVersionById = new Map(
        normalizedTripVersions.map((item) => [item.tripId, item.expectedVersion]),
      );
      const requiredTrips = await listRequiredShipmentAuthorityTrips(
        tx,
        requiredFulfillments.map((row) => row.id),
      );
      const tripsByFulfillment = new Map<number, ShipmentAuthorityTripRow[]>();
      for (const trip of requiredTrips) {
        if (trip.fulfillmentId == null) {
          continue;
        }
        const existing = tripsByFulfillment.get(trip.fulfillmentId) ?? [];
        existing.push(trip);
        tripsByFulfillment.set(trip.fulfillmentId, existing);
      }
      const missingRequiredTripIds = requiredFulfillments
        .map((row) => row.id)
        .filter((fulfillmentId) => (tripsByFulfillment.get(fulfillmentId) ?? []).length === 0);
      if (missingRequiredTripIds.length > 0) {
        throw new ApiError(409, 'Lô hàng chưa có đủ chuyến hiệu lực để chốt.');
      }
      const duplicateRequiredTripIds = requiredFulfillments
        .map((row) => row.id)
        .filter((fulfillmentId) => (tripsByFulfillment.get(fulfillmentId) ?? []).length > 1);
      if (duplicateRequiredTripIds.length > 0) {
        throw new ApiError(409, 'Lô hàng có nhiều chuyến hiệu lực cho cùng một tác vụ bắt buộc.');
      }

      if (
        requiredTrips.length !== normalizedTripVersions.length
        || requiredTrips.some((trip) => !expectedTripVersionById.has(trip.id))
      ) {
        throw new ApiError(409, 'Danh sách chuyến đi của lô hàng đã thay đổi. Vui lòng tải lại.');
      }

      const scopeState = await loadTripExpenseScopeState(
        tx,
        requiredTrips.map((trip) => trip.id),
      );
      await assertRoutineShipmentCloseCheckerSeparation(
        tx,
        requiredTrips.map((trip) => trip.id),
        args.actor.userId,
      );

      for (const trip of [...requiredTrips].sort((left, right) => left.id - right.id)) {
        const expectedTripVersion = expectedTripVersionById.get(trip.id);
        if (expectedTripVersion == null || trip.version !== expectedTripVersion) {
          throw new ApiError(409, 'Chuyến đi đã được thay đổi. Vui lòng tải lại.');
        }
        await assertShipmentDirectCloseTripReadiness(tx, trip.id, scopeState);
        await transitionTripStatus(
          trip.id,
          TripStatus.COMPLETED,
          args.actor.userId,
          args.actor.role,
          args.confirmZeroRevenue === true,
          args.confirmNoPhoto === true,
          {
            expectedVersion: trip.version,
            transaction: tx,
            routineShipmentClose: true,
            vatRateOverride: vatRate,
            strictApSnapshot: true,
          },
        );
      }

      return loadShipmentDirectCloseResult(
        tx,
        shipment.id,
        requiredTrips.map((trip) => trip.id),
      );
    },
    getEntityId: (result) => result.shipment.id,
  });

  return {
    ...outcome.result,
    replayed: outcome.replayed,
  };
}

export async function cancelShipmentFulfillment(args: {
  shipmentId: number;
  fulfillmentId: number;
  expectedVersion: number;
  disposition: 'REPLACED' | 'NOT_REQUIRED';
  reason: string;
  actor: AuthUser;
  idempotencyKey: string;
}): Promise<CancelShipmentFulfillmentResult & { replayed: boolean }> {
  if (args.actor.role !== Role.ADMIN && args.actor.role !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ quản lý hoặc quản trị viên được hủy tác vụ điều phối.');
  }
  const normalizedReason = args.reason.trim();
  if (!normalizedReason) {
    throw new ApiError(400, 'Lý do hủy tác vụ là bắt buộc.');
  }

  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CANCEL,
    idempotencyKey: args.idempotencyKey,
    payload: {
      shipmentId: args.shipmentId,
      fulfillmentId: args.fulfillmentId,
      expectedVersion: args.expectedVersion,
      disposition: args.disposition,
      reason: normalizedReason,
    },
    createdBy: args.actor.userId,
    entityType: 'shipment_fulfillment',
    responseStatusCode: 200,
    create: async (tx) => {
      await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { write: true });
      await assertShipmentAccountingUnlocked(tx, args.shipmentId);
      const [shipment] = await tx.select().from(s.shipments)
        .where(and(
          eq(s.shipments.id, args.shipmentId),
          isNull(s.shipments.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!shipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng.');
      }
      const shipmentStatus = canonicalShipmentStatus(shipment.status);
      if (shipmentStatus === 'COMPLETED' || shipmentStatus === 'CANCELED') {
        throw new ApiError(409, 'Không thể hủy tác vụ của lô hàng đã kết thúc.');
      }

      const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
        .where(and(
          eq(s.shipmentFulfillments.id, args.fulfillmentId),
          eq(s.shipmentFulfillments.shipmentId, shipment.id),
        ))
        .for('update')
        .limit(1);
      if (!fulfillment) {
        throw new ApiError(404, 'Không tìm thấy tác vụ thực hiện.');
      }
      if (fulfillment.version !== args.expectedVersion) {
        throw new ApiError(409, 'Tác vụ đã thay đổi. Vui lòng tải lại.');
      }
      if (fulfillment.cancellationDisposition != null) {
        throw new ApiError(409, 'Tác vụ đã được xử lý hủy trước đó.');
      }

      const activeTrips = await tx.select().from(s.trips)
        .where(and(
          eq(s.trips.fulfillmentId, fulfillment.id),
          isNull(s.trips.deletedAt),
        ))
        .for('update');
      const liveTrips = activeTrips.filter((trip) => trip.status !== TripStatus.CANCELED);
      if (liveTrips.length > 1) {
        throw new ApiError(409, 'Tác vụ đang gắn nhiều chuyến hiệu lực. Vui lòng kiểm tra lại điều phối.');
      }

      const linkedTrip = liveTrips[0] ?? null;
      if (linkedTrip?.status === TripStatus.COMPLETED) {
        throw new ApiError(409, 'Chuyến đã hoàn thành. Vui lòng xử lý luồng hủy chuyến trước khi hủy tác vụ.');
      }
      if (linkedTrip != null) {
        const [acceptedPod] = await tx.select({ id: s.tripPodSubmissions.id })
          .from(s.tripPodSubmissions)
          .where(and(
            eq(s.tripPodSubmissions.tripId, linkedTrip.id),
            eq(s.tripPodSubmissions.status, TripPodStatus.ACCEPTED),
          ))
          .limit(1);
        if (acceptedPod) {
          throw new ApiError(409, 'e-POD đã được duyệt. Vui lòng xử lý yêu cầu điều chỉnh trước khi hủy tác vụ.');
        }
      }
      if (linkedTrip != null) {
        await transitionTripStatus(
          linkedTrip.id,
          TripStatus.CANCELED,
          args.actor.userId,
          args.actor.role,
          undefined,
          undefined,
          {
            expectedVersion: linkedTrip.version,
            transaction: tx,
          },
        );
      }

      const now = new Date();
      if (fulfillment.canceledAt == null) {
        await tx.update(s.shipmentFulfillments).set({
          canceledAt: now,
          canceledBy: args.actor.userId,
          cancellationReason: normalizedReason,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      }

      let replacementFulfillmentId: number | null = null;
      if (args.disposition === 'REPLACED') {
        const [replacement] = await tx.insert(s.shipmentFulfillments).values({
          shipmentId: fulfillment.shipmentId,
          fulfillmentType: fulfillment.fulfillmentType,
          cargoMode: fulfillment.cargoMode,
          shipmentContainerId: fulfillment.shipmentContainerId,
          sourceShipmentVersion: shipment.version,
          siteSnapshot: fulfillment.siteSnapshot,
          createdBy: args.actor.userId,
        }).returning();
        if (!replacement) {
          throw new ApiError(409, 'Không thể tạo tác vụ thay thế. Vui lòng thử lại.');
        }
        replacementFulfillmentId = replacement.id;
      }

      await tx.update(s.shipmentFulfillments).set({
        canceledAt: fulfillment.canceledAt ?? now,
        canceledBy: fulfillment.canceledBy ?? args.actor.userId,
        cancellationReason: fulfillment.cancellationReason ?? normalizedReason,
        cancellationDisposition: args.disposition,
        replacementFulfillmentId,
        notRequiredApprovedBy: args.disposition === 'NOT_REQUIRED' ? args.actor.userId : null,
        notRequiredApprovedAt: args.disposition === 'NOT_REQUIRED' ? now : null,
        notRequiredReason: args.disposition === 'NOT_REQUIRED' ? normalizedReason : null,
        version: sql`${s.shipmentFulfillments.version} + 1`,
        updatedAt: now,
      }).where(eq(s.shipmentFulfillments.id, fulfillment.id));

      const shipmentAfterRecompute = await recomputeShipmentCompletion(
        shipment.id,
        { changedBy: args.actor.userId },
        tx,
      );
      return {
        shipment: shipmentAfterRecompute,
        fulfillmentId: fulfillment.id,
        replacementFulfillmentId,
        shipmentVersion: shipmentAfterRecompute.version,
      };
    },
  });

  return {
    ...outcome.result,
    replayed: outcome.replayed,
  };
}

// ─── Soft delete ────────────────────────────────────────────────────────────
//
// Only date-pending or CANCELED shipments may be tombstoned — once work has started
// (DISPATCHED / IN_TRANSIT / PENDING_EXPENSE_APPROVAL / COMPLETED), the audit trail and linked trips must be
// preserved. Callers should prefer CANCELED for an in-flight cancellation;
// soft-delete is the "remove a mistakenly-created draft" path.

export async function softDeleteShipment(
  shipmentId: number,
  options: { deletedBy?: number | null; version: number },
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);

    if (existing.version !== options.version) {
      throw new ApiError(
        409,
        'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.',
      );
    }

    const currentStatus = canonicalShipmentStatus(existing.status);
    if (currentStatus !== 'PENDING_DATE' && currentStatus !== 'CANCELED') {
      throw new ApiError(
        409,
        'Chỉ có thể xóa lô hàng ở trạng thái Mới tạo hoặc Đã hủy.',
      );
    }

    const [updated] = await tx.update(s.shipments).set({
      deletedAt: new Date(),
      version: sql`${s.shipments.version} + 1`,
      updatedBy: options.deletedBy ?? null,
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, shipmentId)).returning();

    return updated;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── Container snapshot into trip ───────────────────────────────────────────
//
// phase-01 architecture: a shipment exists before any trip; on dispatch, the
// shipment's containers are snapshotted into `trip_containers` (which is
// tightly coupled to trip expense photos, geotags, multi-seal). Reusing
// `trip_containers` for the shipment side is explicitly wrong.
//
// Idempotency: if the trip already has any container row whose `createdBy`
// matches this snapshot path (signalled via `notes` marker), the call is a
// no-op. This makes dispatch retries safe.
//
// Marker convention: a snapshot row carries `notes = '__shipment_snapshot:<sid>'`
// so we can detect existing snapshots without a schema change in this slice.

const SNAPSHOT_MARKER = (shipmentId: number) => `__shipment_snapshot:${shipmentId}`;

export async function snapshotContainersIntoTrip(
  shipmentId: number,
  tripId: number,
  createdBy?: number | null,
  tx?: Tx,
): Promise<{ copied: number; skipped: boolean }> {
  // Allow callers to pass an outer transaction (e.g. the dispatch flow) or rely
  // on the top-level client. Matches the `listTripContainers(tripId, tx?: Tx)`
  // convention in forwarder-container.service.ts.
  const client = tx ?? db;

  // 1. Idempotency: if any trip_container for this trip already carries the
  //    shipment-snapshot marker, treat the snapshot as already done.
  const [existing] = await client.select({ id: s.tripContainers.id })
    .from(s.tripContainers)
    .where(
      and(
        eq(s.tripContainers.tripId, tripId),
        or(
          eq(s.tripContainers.notes, SNAPSHOT_MARKER(shipmentId)),
          eq(s.tripContainers.sourceShipmentId, shipmentId),
        ),
      ),
    )
    .limit(1);
  if (existing) return { copied: 0, skipped: true };

  const [shipment] = await client.select({
    id: s.shipments.id,
    version: s.shipments.version,
  })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) {
    throw new ApiError(404, 'Không tìm thấy lô hàng');
  }

  // 2. Pull the shipment's containers (only non-deleted shipment).
  const containers = await client.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId));

  if (containers.length === 0) return { copied: 0, skipped: false };

  // 3. Bulk-insert into trip_containers with the snapshot marker. We snapshot
  //    the immutable fields (type, number, seal, weight). trip_container_seals
  //    (multi-seal) are populated by the dispatch/trip layer when the trip is
  //    actually built out — this slice only carries the primary seal forward.
  const rows = containers.map((c) => ({
    tripId,
    sourceShipmentId: shipment.id,
    sourceShipmentContainerId: c.id,
    sourceShipmentVersion: shipment.version,
    containerTypeId: c.containerTypeId,
    containerNumber: c.containerNumber,
    sealNumber: c.sealNumber,
    cargoWeightKg: c.cargoWeightKg,
    notes: SNAPSHOT_MARKER(shipmentId),
    createdBy: createdBy ?? null,
  }));

  const inserted = await client.insert(s.tripContainers).values(rows).returning({ id: s.tripContainers.id });
  return { copied: inserted.length, skipped: false };
}

// ─── Detail assembler (read model) ──────────────────────────────────────────
//
// `getShipment` returns the bare row; the route detail endpoint wants the full
// picture — containers, documents, declarations, status history — assembled in
// a single response. Each child query is a single indexed lookup by shipmentId,
// so there is no N+1.

export interface ShipmentDetail {
  // Raw shipment row + the joined customer name (nullable: leftJoin, so a
  // hard-deleted customer yields customerName = null).
  shipment: Awaited<ReturnType<typeof getShipment>> & {
    customerName: string | null;
    cargoTypeName: string | null;
    pricingProjection: ShipmentPricingProjectionView;
  };
  containers: Awaited<ReturnType<typeof listShipmentContainers>>;
  documents: Awaited<ReturnType<typeof listShipmentDocuments>>;
  declarations: Awaited<ReturnType<typeof listShipmentDeclarations>>;
  statusHistory: Awaited<ReturnType<typeof listShipmentStatusHistory>>;
  pendingChangeRequests: Awaited<ReturnType<typeof listPendingShipmentChangeRequests>>;
  podReviews: ShipmentPodReviewItemView[];
  carrierAssignments: Awaited<ReturnType<typeof listShipmentCarrierAssignments>>;
  accountingLock: Awaited<ReturnType<typeof getShipmentAccountingLock>>;
}

export async function listShipmentCarrierAssignments(shipmentId: number, tx?: Tx) {
  const executor = tx ?? db;
  return executor.select({
    fulfillmentId: s.shipmentFulfillments.id,
    fulfillmentVersion: s.shipmentFulfillments.version,
    shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
    carrierType: s.shipmentFulfillments.plannedCarrierType,
    externalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
    externalCarrierName: s.customers.name,
  })
    .from(s.shipmentFulfillments)
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipmentFulfillments.plannedExternalCarrierId))
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id));
}

export interface ReviewTripPodResult {
  shipment: Awaited<ReturnType<typeof getShipment>>;
  submissionId: number;
  submissionStatus: TripPodStatus;
  tripId: number;
  tripStatus: typeof s.trips.$inferSelect.status;
  shipmentVersion: number;
}

export interface CancelShipmentFulfillmentResult {
  shipment: Awaited<ReturnType<typeof getShipment>>;
  fulfillmentId: number;
  replacementFulfillmentId: number | null;
  shipmentVersion: number;
}

export async function listShipmentContainers(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  return await client.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentContainers.createdAt));
}

export async function listShipmentDocuments(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  return await client.select().from(s.shipmentDocuments)
    .where(eq(s.shipmentDocuments.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentDocuments.createdAt));
}

export async function listShipmentDeclarations(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  return await client.select().from(s.shipmentDeclarations)
    .where(eq(s.shipmentDeclarations.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentDeclarations.createdAt));
}

export async function listShipmentStatusHistory(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  const rows = await client.select().from(s.shipmentStatusHistory)
    .where(eq(s.shipmentStatusHistory.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentStatusHistory.changedAt));
  return rows.map((row) => normalizeShipmentStatusHistoryRow(row));
}

export async function listPendingShipmentChangeRequests(
  shipmentId: number,
  tx?: Tx,
): Promise<ShipmentChangeRequestSummary[]> {
  const client = tx ?? db;
  const rows = await client.select({
    request: s.shipmentChangeRequests,
    requesterId: s.users.id,
    requesterFullName: s.users.fullName,
    requesterUsername: s.users.username,
  }).from(s.shipmentChangeRequests)
    .leftJoin(s.users, eq(s.shipmentChangeRequests.requestedBy, s.users.id))
    .where(eq(s.shipmentChangeRequests.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentChangeRequests.createdAt));
  return rows.map((row) => ({
    ...row.request,
    requester: row.requesterId == null
      ? null
      : {
          id: row.requesterId,
          fullName: row.requesterFullName,
          username: row.requesterUsername,
        },
  }));
}

export async function getShipmentDetail(id: number, actor?: AuthUser): Promise<ShipmentDetail> {
  // Fetch the shipment first so a missing row 404s cleanly rather than
  // returning an empty payload.
  const shipment = await getShipment(id);
  if (actor && isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId);
    assertClerkCanAccessShipment(scope, shipment);
  }
  // Join the customer name so the detail page can show a readable label.
  // leftJoin keeps the row even if the
  // customer was hard-deleted (customerName = null in that case).
  const [joined] = await db.select({
    customerName: s.customers.name,
    cargoTypeName: s.cargoTypes.name,
  })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.shipments.cargoTypeId, s.cargoTypes.id))
    .where(eq(s.shipments.id, id));
  const shipmentWithCustomer = {
    ...shipment,
    customerName: joined?.customerName ?? null,
    cargoTypeName: joined?.cargoTypeName ?? null,
  };
  const [containers, documents, declarations, statusHistory, pendingChangeRequests, podReviews, carrierAssignments, accountingLock] = await Promise.all([
    listShipmentContainers(id),
    listShipmentDocuments(id),
    listShipmentDeclarations(id),
    listShipmentStatusHistory(id),
    listPendingShipmentChangeRequests(id),
    listShipmentPodReviewItems(id),
    listShipmentCarrierAssignments(id),
    getShipmentAccountingLock(id),
  ]);
  return {
    shipment: {
      ...shipmentWithCustomer,
      pricingProjection: await buildShipmentPricingProjection(shipment, containers),
    },
    containers,
    documents,
    declarations,
    statusHistory,
    pendingChangeRequests,
    podReviews,
    carrierAssignments,
    accountingLock,
  };
}

export async function downloadShipmentPodFile(
  shipmentId: number,
  fileId: number,
  actor?: AuthUser,
) {
  try {
    await getShipmentDetail(shipmentId, actor);
  } catch (error) {
    if (actor?.role === Role.CUS && error instanceof ApiError && error.statusCode === 403) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }
    throw error;
  }
  return getShipmentPodFileForDownload({ shipmentId, fileId });
}

async function reconcileShipmentContainersInTx(
  tx: Tx,
  shipmentId: number,
  userId: number | null,
  containers: ShipmentContainerInput[],
) {
  const current = await tx.select()
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId));
  const existingIds = new Set(current.map((row) => row.id));
  const incomingIds = new Set(containers.filter((row) => row.id).map((row) => row.id as number));

  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    await tx.delete(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.id, toDelete));
  }

  const upserted: Array<{ id: number }> = [];
  for (const container of containers) {
    const payload = {
      shipmentId,
      containerTypeId: container.containerTypeId ?? null,
      containerNumber: container.containerNumber?.trim() || null,
      sealNumber: container.sealNumber?.trim() || null,
      cargoWeightKg: container.cargoWeightKg != null ? String(container.cargoWeightKg) : null,
      shippingLineName: container.shippingLineName?.trim() || null,
      pickupPortId: container.pickupPortId ?? null,
      dropoffPortId: container.dropoffPortId ?? null,
      notes: container.notes ?? null,
      updatedAt: new Date(),
    };
    if (container.id && existingIds.has(container.id)) {
      const [updated] = await tx.update(s.shipmentContainers)
        .set(payload)
        .where(eq(s.shipmentContainers.id, container.id))
        .returning({ id: s.shipmentContainers.id });
      if (updated) upserted.push(updated);
    } else {
      const [inserted] = await tx.insert(s.shipmentContainers)
        .values({ ...payload, createdBy: userId })
        .returning({ id: s.shipmentContainers.id });
      if (inserted) upserted.push(inserted);
    }
  }

  return {
    items: await listShipmentContainers(shipmentId, tx),
    upsertedIds: upserted.map((row) => row.id),
  };
}

async function reconcileShipmentContainersWithFulfillmentGuard(
  tx: Tx,
  shipmentId: number,
  userId: number | null,
  containers: ShipmentContainerInput[],
) {
  const activeFulfillments = await tx.select({
    id: s.shipmentFulfillments.id,
    tripId: s.trips.id,
  })
    .from(s.shipmentFulfillments)
    .leftJoin(s.trips, and(
      eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ));

  if (activeFulfillments.some((fulfillment) => fulfillment.tripId != null)) {
    throw new ApiError(409, 'Không thể thay đổi container sau khi đã phát hành lệnh điều xe. Hãy hủy hoặc thay thế lệnh theo quy trình điều vận.');
  }
  if (activeFulfillments.length > 0) {
    await tx.update(s.shipmentFulfillments).set({
      canceledAt: new Date(),
      canceledBy: userId,
      cancellationReason: 'Container của lô hàng đã được cập nhật; cần gán lại nhà xe.',
      cancellationDisposition: 'REPLACED',
      version: sql`${s.shipmentFulfillments.version} + 1`,
      updatedAt: new Date(),
    }).where(inArray(s.shipmentFulfillments.id, activeFulfillments.map((fulfillment) => fulfillment.id)));
  }

  return reconcileShipmentContainersInTx(tx, shipmentId, userId, containers);
}

function parsePlanUpdateSnapshot(snapshot: unknown): UpdateShipmentInput {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new ApiError(500, 'Ảnh chụp yêu cầu thay đổi không hợp lệ');
  }
  const parsed = updateShipmentSchema.safeParse({
    ...(snapshot as Record<string, unknown>),
    expectedVersion: 0,
  });
  if (!parsed.success) {
    throw new ApiError(500, 'Ảnh chụp yêu cầu thay đổi không còn hợp lệ');
  }
  const patch: UpdateShipmentInput = { ...parsed.data };
  delete patch.expectedVersion;
  return patch;
}

function parseContainerChangeSnapshot(snapshot: unknown) {
  if (!Array.isArray(snapshot)) {
    throw new ApiError(500, 'Ảnh chụp công-te-nơ không hợp lệ');
  }
  const parsed = shipmentContainerBatchSchema.safeParse({
    expectedVersion: 0,
    containers: snapshot,
  });
  if (!parsed.success) {
    throw new ApiError(500, 'Ảnh chụp công-te-nơ không còn hợp lệ');
  }
  return parsed.data.containers;
}

// ─── Container batch upsert (full reconcile) ────────────────────────────────
//
// Mirrors `batchUpsertTripContainers`: the incoming list becomes the desired
// full state — new rows are inserted, existing rows are updated by id, and any
// existing row whose id is missing from the incoming list is deleted. This is
// the same contract the trip-edit form uses, so the shipment UI behaves
// identically.

/**
 * M10.2 slice 1 — validate the desired container set of a shipment.
 *
 * Two checks, both PRD M10-02-03 ("format + duplicate checks"):
 *   1. Each non-null `containerNumber` must pass the shared ISO 6346
 *      validator (format + check digit). Null numbers are allowed — a
 *      shipment can hold placeholder rows before the BL arrives.
 *   2. No two containers in the desired set may share the same number.
 *      Cross-shipment reuse is legal (shared container pool), so the check
 *      is scoped to this batch only.
 *
 * Throws `ApiError(400, …)` on the first violation with a Vietnamese
 * message ready to surface in the UI. Runs inside the caller's transaction
 * BEFORE any write, so a rejected batch leaves the shipment untouched.
 */
function assertContainerSetValid(
  containers: ReadonlyArray<{
    id?: number;
    containerNumber?: string | null;
  }>,
): void {
  const seen = new Set<string>();
  for (const c of containers) {
    const num = c.containerNumber?.trim() || null;
    if (!num) continue; // placeholder row — allowed
    const [ok, message] = validateContainerNumber(num);
    if (!ok) {
      throw new ApiError(400, `Số container "${num}" không hợp lệ: ${message}`);
    }
    const key = num.toUpperCase();
    if (seen.has(key)) {
      throw new ApiError(
        400,
        `Số container "${num}" bị trùng trong cùng lô hàng. Mỗi container phải có số duy nhất.`,
      );
    }
    seen.add(key);
  }
}

export async function batchUpsertShipmentContainers(
  shipmentId: number,
  userId: number | null,
  containers: ShipmentContainerInput[],
): Promise<Array<{ id: number }>>;
export async function batchUpsertShipmentContainers(
  shipmentId: number,
  userId: number | null,
  expectedVersion: number,
  containers: ShipmentContainerInput[],
  actor?: AuthUser,
  transaction?: Tx,
): Promise<ShipmentContainerMutationResult>;
export async function batchUpsertShipmentContainers(
  shipmentId: number,
  userId: number | null,
  expectedVersionOrContainers: number | ShipmentContainerInput[],
  maybeContainers?: ShipmentContainerInput[],
  actor?: AuthUser,
  transaction?: Tx,
): Promise<ShipmentContainerMutationResult | Array<{ id: number }>> {
  const legacyCompat = Array.isArray(expectedVersionOrContainers);
  const expectedVersion = legacyCompat ? null : expectedVersionOrContainers;
  const containers = legacyCompat ? expectedVersionOrContainers : (maybeContainers ?? []);
  const execute = async (tx: Tx) => {
    // Existence + ownership guard: a missing (or soft-deleted) shipment must
    // surface as a 404, not an FK violation.
    const [existing] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (expectedVersion != null && existing.version !== expectedVersion) {
      throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
    }

    let clerkScope = null;
    if (actor && isClerkScopedUser(actor)) {
      clerkScope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(clerkScope, existing);
    }

    // M10.2 slice 1: validate the desired container set BEFORE any write so a
    // rejected batch leaves the shipment untouched. The batch is a full
    // reconcile — `containers` becomes the desired final list — so duplicate
    // and format checks against it cover the post-state correctly. Null
    // numbers are allowed (placeholder rows before the BL arrives); only
    // non-null values are validated. Reuses the shared ISO 6346 validator
    // already ported from vantaiphucloc.
    assertContainerSetValid(containers);

    const current = await tx.select()
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipmentId));

    if (actor && isClerkScopedUser(actor) && !isDirectlyEditableIntakeStatus(existing.status)) {
      const classification = classifyClerkContainerChange(current, containers);
      if (classification.mode === 'NOOP') {
        return {
          items: current,
          upsertedIds: current.map((row) => row.id),
          shipmentVersion: existing.version,
          changeMode: 'NOOP' as const,
          changeRequestId: null,
          notificationDelivered: true,
        };
      }
      const changeRequestId = await createShipmentChangeRequest(tx, {
        shipment: existing,
        sourceVersion: existing.version,
        requestKind: 'CONTAINER_RECONCILE',
        requestedBy: actor.userId,
        beforeSnapshot: classification.beforeSnapshot,
        afterSnapshot: classification.afterSnapshot,
      });
      return {
        items: current,
        upsertedIds: current.map((row) => row.id),
        shipmentVersion: existing.version,
        changeMode: 'REQUESTED' as const,
        changeRequestId,
        notificationDelivered: false,
        message: 'Đã ghi nhận thay đổi công-te-nơ.',
      };
    }

    const reconciled = await reconcileShipmentContainersWithFulfillmentGuard(
      tx,
      shipmentId,
      userId,
      containers,
    );

    // Bump the shipment's version so any open editor is told to reload — the
    // container set is part of the shipment's editable surface.
    const nextVersion = existing.version + 1;
    await tx.update(s.shipments)
      .set({ version: nextVersion, updatedAt: new Date() })
      .where(eq(s.shipments.id, shipmentId));

    const directResult = {
      items: reconciled.items,
      upsertedIds: reconciled.upsertedIds,
      shipmentVersion: nextVersion,
      changeMode: 'DIRECT' as const,
      changeRequestId: null,
      notificationDelivered: true,
    };
    return legacyCompat ? reconciled.upsertedIds.map((id) => ({ id })) : directResult;
  };
  const result = transaction ? await execute(transaction) : await db.transaction(execute);
  if (!legacyCompat && 'changeMode' in result && result.changeMode === 'REQUESTED') {
    return {
      ...result,
      notificationDelivered: true,
      message: 'Đã ghi nhận thay đổi công-te-nơ và thông báo điều vận.',
    };
  }
  return result;
}

// ─── Document attach ────────────────────────────────────────────────────────
//
// The file bytes themselves are uploaded separately via `/api/upload` (the same
// path trip photos use); this endpoint records the metadata row that references
// the resulting `storageKey`. Multipart upload is a Wave 2 portal concern.

export async function attachShipmentDocument(
  shipmentId: number,
  input: { type: typeof s.shipmentDocuments.type.enumValues[number]; storageKey: string; uploadedBy?: number | null },
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const documentType = normalizeShipmentDocumentType(input.type);
    if (!documentType) throw new ApiError(400, 'Loại chứng từ không hợp lệ');
    const [existing] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, existing);
    }

    const [doc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId,
      type: documentType,
      storageKey: input.storageKey,
      uploadedBy: input.uploadedBy ?? null,
    }).returning();
    return doc;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

export async function upsertShipmentDeclaration(
  shipmentId: number,
  input: ShipmentDeclarationMutationInput,
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const scope = normalizeShipmentDeclarationScope(input.scope) ?? DEFAULT_SHIPMENT_DECLARATION_SCOPE;
    const issuedAt = input.issuedAt ? new Date(input.issuedAt) : null;
    const [existingShipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!existingShipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, existingShipment);
    }

    if (input.id != null) {
      const [updated] = await tx.update(s.shipmentDeclarations).set({
        declarationNumber: input.declarationNumber ?? null,
        issuedAt,
        scope,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
        .where(and(
          eq(s.shipmentDeclarations.id, input.id),
          eq(s.shipmentDeclarations.shipmentId, shipmentId),
        ))
        .returning();
      if (!updated) throw new ApiError(404, 'Không tìm thấy tờ khai cần cập nhật');
      return updated;
    }

    const [created] = await tx.insert(s.shipmentDeclarations).values({
      shipmentId,
      declarationNumber: input.declarationNumber ?? null,
      issuedAt,
      scope,
      note: input.note ?? null,
      createdBy: input.updatedBy ?? null,
    }).returning();
    return created;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── M3.2: expired document check + document replacement ────────────────────

/**
 * Check if a shipment has any expired documents (DO type with expiresAt in the
 * past). Returns the list of expired document rows. Empty = no expired docs.
 */
export async function checkExpiredDocuments(shipmentId: number, transaction?: Tx) {
  const client = transaction ?? db;
  const today = new Date().toISOString().slice(0, 10);
  const docs = await client.select()
    .from(s.shipmentDocuments)
    .where(and(
      eq(s.shipmentDocuments.shipmentId, shipmentId),
      eq(s.shipmentDocuments.type, 'DO'),
      sql`${s.shipmentDocuments.expiresAt} IS NOT NULL`,
      sql`${s.shipmentDocuments.expiresAt} < ${today}`,
      isNull(s.shipmentDocuments.replacedBy), // not superseded by a newer version
    ));
  return docs;
}

// ─── M10.2 slice 2: dispatch readiness (advisory) ───────────────────────────
//
// PRD M10-02-03 ("mandatory fields defined before dispatch") + Q17 (clerk
// editable surface, status `pending`). A hard mandatory gate would be a
// breaking behavioural change while the field set is still unconfirmed, so
// slice 2 ships the check as advisory: this helper returns the list of
// missing recommended fields so fulfillment-dispatch callers can show
// `preDispatchWarnings` without blocking dispatch. The UI (slice 3) shows a
// confirm dialog; a follow-up slice flips enforcing on
// once Q17 / M10.2 §1 sign-off lands (mirrors the M12.2 "advisory first"
// precedent).
//
// Recommended set today: BL number + ≥1 shipment container. BL is the legal
// shipping document; containers are what get snapshotted into the trip.

export interface DispatchReadiness {
  /** True when no recommended fields are missing. */
  ready: boolean;
  /** Vietnamese field labels not yet set (empty when `ready`). */
  missing: string[];
}

/**
 * Return the list of recommended pre-dispatch fields that are not yet set on
 * the shipment. Throws 404 on a missing/soft-deleted shipment so callers can
 * surface the canonical not-found error before dispatch attempts.
 */
export async function getDispatchReadiness(shipmentId: number, transaction?: Tx): Promise<DispatchReadiness> {
  const client = transaction ?? db;
  const [shipment] = await client.select({
    blNumber: s.shipments.blNumber,
  })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  const missing: string[] = [];
  if (!shipment.blNumber || shipment.blNumber.trim() === '') {
    missing.push('Số vận đơn (B/L)');
  }

  const [containerCountRow] = await client.select({ count: count() })
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId));
  const containerCount = containerCountRow?.count ?? 0;
  if (containerCount === 0) {
    missing.push('Công-te-nơ (ít nhất một)');
  }

  return { ready: missing.length === 0, missing };
}

/**
 * M3.2: Replace a shipment document with a new version. The old document is
 * NOT deleted — its `replacedBy` is set to the new document's id, preserving
 * the full audit history. The new document inherits the old one's type and
 * can have a new expiry date.
 */
export async function replaceShipmentDocument(
  shipmentId: number,
  oldDocId: number,
  newDocData: {
    expectedVersion: number;
    storageKey: string;
    expiresAt?: string | null;
    uploadedBy?: number | null;
  },
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (shipment.version !== newDocData.expectedVersion) {
      throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
    }
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, shipment);
    }

    const [oldDoc] = await tx.select()
      .from(s.shipmentDocuments)
      .where(and(
        eq(s.shipmentDocuments.id, oldDocId),
        eq(s.shipmentDocuments.shipmentId, shipmentId),
      ))
      .for('update')
      .limit(1);
    if (!oldDoc) throw new ApiError(404, 'Không tìm thấy tài liệu cần thay thế');
    if (oldDoc.replacedBy != null) {
      throw new ApiError(409, 'Tài liệu đã được thay thế. Vui lòng tải lại.');
    }

    const [newDoc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId,
      type: oldDoc.type,
      storageKey: newDocData.storageKey,
      expiresAt: newDocData.expiresAt ?? null,
      uploadedBy: newDocData.uploadedBy ?? null,
    }).returning();

    const [linked] = await tx.update(s.shipmentDocuments)
      .set({ replacedBy: newDoc.id })
      .where(and(
        eq(s.shipmentDocuments.id, oldDocId),
        eq(s.shipmentDocuments.shipmentId, shipmentId),
        isNull(s.shipmentDocuments.replacedBy),
      ))
      .returning({ id: s.shipmentDocuments.id });
    if (!linked) {
      throw new ApiError(409, 'Tài liệu đã được thay thế. Vui lòng tải lại.');
    }

    const nextVersion = shipment.version + 1;
    await tx.update(s.shipments)
      .set({ version: nextVersion, updatedAt: new Date(), updatedBy: actor?.userId ?? null })
      .where(eq(s.shipments.id, shipmentId));

    return { ...newDoc, shipmentVersion: nextVersion };
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

export async function reviewShipmentChangeRequest(
  shipmentId: number,
  changeRequestId: number,
  resolution: 'APPLIED' | 'REJECTED',
  actor: AuthUser,
  transaction?: Tx,
): Promise<ShipmentChangeRequestReviewResult> {
  const execute = async (tx: Tx) => {
    const [request] = await tx.select()
      .from(s.shipmentChangeRequests)
      .where(and(
        eq(s.shipmentChangeRequests.id, changeRequestId),
        eq(s.shipmentChangeRequests.shipmentId, shipmentId),
      ))
      .for('update')
      .limit(1);
    if (!request) {
      throw new ApiError(404, 'Không tìm thấy yêu cầu thay đổi cần xử lý');
    }

    const [shipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    let reviewedShipment = shipment;
    if (resolution === 'APPLIED') {
      if (shipment.version !== request.sourceVersion) {
        throw new ApiError(409, 'Lô hàng đã đổi phiên bản. Vui lòng tải lại trước khi áp dụng yêu cầu này.');
      }
      if (request.requestKind === 'PLAN_UPDATE') {
        const patch = parsePlanUpdateSnapshot(request.afterSnapshot);
        const [updated] = await tx.update(s.shipments).set({
          ...(patch.customerId !== undefined ? { customerId: patch.customerId } : {}),
          ...(patch.cargoTypeId !== undefined ? { cargoTypeId: patch.cargoTypeId } : {}),
          ...(patch.responsibleUnitId !== undefined ? { responsibleUnitId: patch.responsibleUnitId } : {}),
          ...(patch.bookingRef !== undefined ? { bookingRef: patch.bookingRef } : {}),
          ...(patch.blNumber !== undefined ? { blNumber: patch.blNumber } : {}),
          ...(patch.tradeDirection !== undefined ? { tradeDirection: patch.tradeDirection } : {}),
          ...(patch.cargoMode !== undefined ? { cargoMode: patch.cargoMode } : {}),
          ...(patch.operationalSiteId !== undefined ? { operationalSiteId: patch.operationalSiteId } : {}),
          ...(patch.pickupWarehouseSiteId !== undefined ? { pickupWarehouseSiteId: patch.pickupWarehouseSiteId } : {}),
          ...(patch.factoryName !== undefined ? { factoryName: patch.factoryName } : {}),
          ...(patch.shippingLineName !== undefined ? { shippingLineName: patch.shippingLineName } : {}),
          ...(patch.expectedDeliveryDate !== undefined ? { expectedDeliveryDate: patch.expectedDeliveryDate } : {}),
          ...(patch.customsCutoffAt !== undefined ? { customsCutoffAt: toNullableTimestamp(patch.customsCutoffAt, 'Hạn hải quan') } : {}),
          ...(patch.closingAt !== undefined ? { closingAt: toNullableTimestamp(patch.closingAt, 'Giờ closing') } : {}),
          ...(patch.plannedReturnAt !== undefined ? { plannedReturnAt: toNullableTimestamp(patch.plannedReturnAt, 'Ngày trả rỗng kế hoạch') } : {}),
          ...(patch.cargoWeightKg !== undefined ? { cargoWeightKg: toNullableFixedDecimal(patch.cargoWeightKg, 8, 2, 'Trọng lượng') } : {}),
          ...(patch.cargoVolumeCbm !== undefined ? { cargoVolumeCbm: toNullableFixedDecimal(patch.cargoVolumeCbm, 7, 3, 'Thể tích') } : {}),
          ...(patch.packageCount !== undefined ? { packageCount: patch.packageCount } : {}),
          ...(patch.packageType !== undefined ? { packageType: patch.packageType } : {}),
          ...(patch.operationalNotes !== undefined ? { operationalNotes: patch.operationalNotes } : {}),
          ...(patch.pickupLocation !== undefined ? { pickupLocation: patch.pickupLocation } : {}),
          ...(patch.deliveryLocation !== undefined ? { deliveryLocation: patch.deliveryLocation } : {}),
          ...(patch.contactName !== undefined ? { contactName: patch.contactName } : {}),
          ...(patch.contactPhone !== undefined ? { contactPhone: patch.contactPhone } : {}),
          version: shipment.version + 1,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
          .where(eq(s.shipments.id, shipmentId))
          .returning();
        reviewedShipment = updated;
        if (isDirectlyEditableIntakeStatus(reviewedShipment.status)) {
          await syncShipmentAuthorityToTrips(tx, reviewedShipment);
        }
      } else {
        const containers = parseContainerChangeSnapshot(request.afterSnapshot);
        assertContainerSetValid(containers);
        await reconcileShipmentContainersWithFulfillmentGuard(
          tx,
          shipmentId,
          actor.userId,
          containers,
        );
        const [updated] = await tx.update(s.shipments).set({
          version: shipment.version + 1,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
          .where(eq(s.shipments.id, shipmentId))
          .returning();
        reviewedShipment = updated;
      }
    }

    await tx.delete(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.id, changeRequestId));

    await persistChangeRequestDecisionNotification(tx, {
      shipmentId: reviewedShipment.id,
      shipmentCode: reviewedShipment.shipmentCode ?? null,
      requesterId: request.requestedBy,
      resolution,
    });

    return {
      shipment: reviewedShipment,
      requesterId: request.requestedBy,
      shipmentVersion: reviewedShipment.version,
      resolution,
    };
  };
  const result = transaction ? await execute(transaction) : await db.transaction(execute);

  return {
    shipment: result.shipment,
    resolution: result.resolution,
    changeRequestId,
    shipmentVersion: result.shipmentVersion,
    notificationDelivered: true,
    message: result.resolution === 'APPLIED'
      ? 'Đã áp dụng yêu cầu thay đổi và cập nhật phiên bản lô hàng.'
      : 'Đã từ chối yêu cầu thay đổi.',
  };
}
