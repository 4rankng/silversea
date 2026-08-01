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
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { createTrip } from './trip.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import {
  NotificationType,
  shipmentContainerBatchSchema,
  updateShipmentSchema,
  validateContainerNumber,
} from '@tingting/shared';
import { emitNotification } from './notification.service';
import { resolveFreightPrice } from './pricing.service';
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

// ─── Status machine ─────────────────────────────────────────────────────────
//
// Mirrors the lifecycle implied by the `shipment_status` enum + phase-01
// "booking → documents → dispatch → delivery → debit-note":
//
//   DRAFT ──► IN_PROGRESS ──► DELIVERED ──► CLOSED
//                │
//                └──► CANCELED   (DRAFT can also go straight to CANCELED)
//
// CANCELED is a sink (terminal). CLOSED is terminal. Once DELIVERED, the only
// forward edge is CLOSED (re-opening is a later Wave 2 need with audit reason;
// not added speculatively here).
const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['DELIVERED', 'CANCELED'],
  DELIVERED: ['CLOSED'],
  CLOSED: [],
  CANCELED: [],
};

export type ShipmentStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'CLOSED'
  | 'CANCELED';

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
>;

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

async function listLiveShipmentAuthorityTrips(tx: Tx, shipmentId: number): Promise<ShipmentAuthorityTripRow[]> {
  return tx.select({
    id: s.trips.id,
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
  })
    .from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      sql`${s.trips.status} <> 'CANCELED'`,
      isNull(s.trips.deletedAt),
    ))
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

// ─── Create ─────────────────────────────────────────────────────────────────

async function createShipmentTx(tx: Tx, input: CreateShipmentInput, actor?: AuthUser) {
  let responsibleUnitId = input.responsibleUnitId ?? null;
  if (actor && isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId, tx);
    assertClerkCanCreateForCustomer(scope, input.customerId);
    responsibleUnitId = resolveClerkResponsibleUnitId(scope, input.responsibleUnitId);
  }

  // 1. Insert the shipment row (DRAFT default, version 1).
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
    closingAt: toNullableTimestamp(input.closingAt, 'Giờ closing'),
    plannedReturnAt: toNullableTimestamp(input.plannedReturnAt, 'Ngày trả rỗng kế hoạch'),
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
    status: 'DRAFT',
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
    toStatus: 'DRAFT',
    reason: 'Tạo lô hàng',
    changedBy: input.createdBy ?? null,
  });

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
  return shipment;
}

export async function listShipments(options: ListShipmentsOptions = {}) {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (options.customerIds?.length) {
    conditions.push(inArray(s.shipments.customerId, options.customerIds));
  } else if (options.customerId != null) {
    conditions.push(eq(s.shipments.customerId, options.customerId));
  }
  if (options.status != null) {
    conditions.push(eq(s.shipments.status, options.status));
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
  return rows.map((row) => row.shipment);
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
    conditions.push(eq(s.shipments.status, options.status));
  }
  const searchPredicate = buildShipmentSearchPredicate(options.q);
  if (searchPredicate) {
    conditions.push(searchPredicate);
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
  // Flatten `shipment` + `customerName` into a single object so the route
  // layer returns `{ ...shipmentColumns, customerName }` directly.
  const flatItems = items.map((row) => ({ ...row.shipment, customerName: row.customerName }));
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

    if (shipmentAuthorityChanged && existing.status !== 'DRAFT') {
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
      ...(input.closingAt !== undefined ? { closingAt: toNullableTimestamp(input.closingAt, 'Giờ closing') } : {}),
      ...(input.plannedReturnAt !== undefined ? { plannedReturnAt: toNullableTimestamp(input.plannedReturnAt, 'Ngày trả rỗng kế hoạch') } : {}),
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

    if (shipmentAuthorityChanged && updated.status === 'DRAFT') {
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

    const currentStatus = shipment.status as ShipmentStatus;

    // Idempotent: same target → no-op, return current row without writing a
    // duplicate history row (mirrors trip-status-machine's short-circuit).
    if (currentStatus === targetStatus) return shipment;

    assertLegalTransition(currentStatus, targetStatus);

    // Conditional update guards against concurrent transition races.
    const [updated] = await tx.update(s.shipments).set({
      status: targetStatus,
      version: sql`${s.shipments.version} + 1`,
      updatedAt: new Date(),
    })
      .where(and(eq(s.shipments.id, shipmentId), eq(s.shipments.status, currentStatus)))
      .returning();

    if (!updated) {
      throw new ApiError(
        409,
        'Trạng thái lô hàng đã bị thay đổi bởi người khác. Vui lòng tải lại.',
      );
    }

    await tx.insert(s.shipmentStatusHistory).values({
      shipmentId,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      reason: options.reason ?? null,
      changedBy: options.changedBy ?? null,
    });

    return updated;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── Soft delete ────────────────────────────────────────────────────────────
//
// Only DRAFT or CANCELED shipments may be tombstoned — once work has started
// (IN_PROGRESS / DELIVERED / CLOSED) the audit trail + linked trips must be
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

    if (existing.version !== options.version) {
      throw new ApiError(
        409,
        'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.',
      );
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'CANCELED') {
      throw new ApiError(
        409,
        'Chỉ có thể xóa lô hàng ở trạng thái DRAFT hoặc CANCELED.',
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
  };
  containers: Awaited<ReturnType<typeof listShipmentContainers>>;
  documents: Awaited<ReturnType<typeof listShipmentDocuments>>;
  declarations: Awaited<ReturnType<typeof listShipmentDeclarations>>;
  statusHistory: Awaited<ReturnType<typeof listShipmentStatusHistory>>;
  pendingChangeRequests: Awaited<ReturnType<typeof listPendingShipmentChangeRequests>>;
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
  return await client.select().from(s.shipmentStatusHistory)
    .where(eq(s.shipmentStatusHistory.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentStatusHistory.changedAt));
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
  // Join the customer name so the detail page can show a readable label
  // instead of "Khách hàng #{id}". leftJoin keeps the row even if the
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
  const [containers, documents, declarations, statusHistory, pendingChangeRequests] = await Promise.all([
    listShipmentContainers(id),
    listShipmentDocuments(id),
    listShipmentDeclarations(id),
    listShipmentStatusHistory(id),
    listPendingShipmentChangeRequests(id),
  ]);
  return { shipment: shipmentWithCustomer, containers, documents, declarations, statusHistory, pendingChangeRequests };
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

    if (actor && isClerkScopedUser(actor) && existing.status !== 'DRAFT') {
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
    const reconciled = await reconcileShipmentContainersInTx(tx, shipmentId, userId, containers);

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
    const [existing] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, existing);
    }

    const [doc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId,
      type: input.type,
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
    const issuedAt = input.issuedAt ? new Date(input.issuedAt) : null;
    const [existingShipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!existingShipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, existingShipment);
    }

    if (input.id != null) {
      const [updated] = await tx.update(s.shipmentDeclarations).set({
        declarationNumber: input.declarationNumber ?? null,
        issuedAt,
        scope: input.scope ?? 'SINGLE',
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
      scope: input.scope ?? 'SINGLE',
      note: input.note ?? null,
      createdBy: input.updatedBy ?? null,
    }).returning();
    return created;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── Dispatch: shipment → linked trip ───────────────────────────────────────
//
// Phase-01 architecture: a shipment exists before any trip; on dispatch, a
// trip is created and linked via `trips.shipmentId`, and the shipment's
// containers are snapshotted into the new trip's `trip_containers`.
//
// Fulfillment-time fields (route/cargo/container-type/truck/driver) are NOT on
// the shipment — they are decided at dispatch and forwarded to
// `createTripCommand`. Customer comes from the shipment.
//
// Concurrency / idempotency model:
//
//   - The `trips_shipment_id_live_uniq` partial unique index (see schema.ts +
//     migration 0114) enforces "at most one non-CANCELED trip per shipment" at
//     the DB level. Two concurrent dispatches each create their own trip (no
//     collision — `shipmentId` is NULL on insert), but only one of the
//     subsequent `UPDATE trips SET shipmentId = …` updates can win: the loser
//     raises 23505 and is caught here, after which we read + return the
//     winner's trip. The loser's now-orphan trip is hard-deleted in the catch
//     so it does not pollute reporting.
//
//   - A retry after a successful dispatch short-circuits at the existing-trip
//     lookup and returns the existing trip with `created: false`.
//
//   - DRAFT-only precondition: a shipment that has already advanced past
//     DRAFT cannot be re-dispatched. CANCELED shipments cannot be dispatched
//     at all. This mirrors the legal-edge state machine in
//     `transitionShipmentStatus`.

type ShipmentDispatchResult = {
  trip: typeof s.trips.$inferSelect;
  created: boolean;
  preDispatchWarnings: string[];
};

async function dispatchShipmentToTripInTx(
  tx: Tx,
  shipmentId: number,
  fulfillment: {
    routeId: number;
    cargoTypeId: number;
    containerTypeId: number;
    truckId?: number | null;
    driverId?: number | null;
    departureDate: string;
    customerReference?: string;
    containerCount?: number;
    creditApprovalRequestId?: number | null;
    fuelMode?: import('@tingting/shared').FuelMode;
  },
  actor: { userId: number; role: import('@tingting/shared').Role },
): Promise<ShipmentDispatchResult> {
  const [shipment] = await tx.select()
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  if (shipment.cargoMode === 'LCL') {
    throw new ApiError(
      409,
      'Điều vận lô hàng LCL chưa được hỗ trợ. Vui lòng giữ lô ở hồ sơ vận hành, không tạo dữ liệu công-te-nơ giả.',
    );
  }

  const expiredDocs = await checkExpiredDocuments(shipmentId, tx);
  if (expiredDocs.length > 0) {
    throw new ApiError(409, 'Lệnh giao hàng (D/O) đã hết hạn. Vui lòng tải lên D/O mới.');
  }
  const preDispatchWarnings = (await getDispatchReadiness(shipmentId, tx)).missing;

  const [existingLiveTrip] = await tx.select()
    .from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      sql`${s.trips.status} <> 'CANCELED'`,
    ))
    .limit(1);
  if (existingLiveTrip) {
    return { trip: existingLiveTrip, created: false, preDispatchWarnings };
  }
  if (shipment.status !== 'DRAFT') {
    throw new ApiError(409, `Không thể điều vận lô hàng ở trạng thái "${shipment.status}".`);
  }

  const trip = await createTrip({
    customerId: shipment.customerId,
    routeId: fulfillment.routeId,
    cargoTypeId: fulfillment.cargoTypeId,
    containerTypeId: fulfillment.containerTypeId,
    truckId: fulfillment.truckId ?? null,
    driverId: fulfillment.driverId ?? null,
    departureDate: fulfillment.departureDate,
    customerReference: fulfillment.customerReference,
    containerCount: fulfillment.containerCount,
    creditApprovalRequestId: fulfillment.creditApprovalRequestId ?? null,
    fuelMode: fulfillment.fuelMode,
    createdBy: actor.userId,
    createdByRole: actor.role,
    shipmentId,
  }, tx);

  const [updated] = await tx.update(s.shipments)
    .set({
      status: 'IN_PROGRESS',
      version: sql`${s.shipments.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(s.shipments.id, shipmentId), eq(s.shipments.status, 'DRAFT')))
    .returning({ id: s.shipments.id });
  if (!updated) {
    throw new ApiError(
      409,
      'Trạng thái lô hàng đã bị thay đổi bởi người khác. Vui lòng tải lại.',
    );
  }

  await tx.insert(s.shipmentStatusHistory).values({
    shipmentId,
    fromStatus: 'DRAFT',
    toStatus: 'IN_PROGRESS',
    reason: `Điều vận sang chuyến ${trip.tripCode}`,
    changedBy: actor.userId,
  });

  return { trip, created: true, preDispatchWarnings };
}

export async function completeShipmentDispatchSideEffects(
  result: ShipmentDispatchResult,
  shipmentId: number,
): Promise<void> {
  if (!result.created) return;
  emitNotification({
    type: NotificationType.TRIP_CREATED,
    title: 'Chuyến mới được tạo',
    message: `Chuyến ${result.trip.tripCode} đã được tạo`,
    relatedEntityType: 'trips',
    relatedEntityId: result.trip.id,
    targetDriverId: result.trip.driverId ?? undefined,
  });
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
    cacheInvalidatePattern('reports:entity-results:*'),
  ]).catch((err: unknown) => console.warn(
    '[cache] dispatch invalidate failed', { shipmentId, err },
  ));
}

export async function dispatchShipmentToTrip(
  shipmentId: number,
  fulfillment: {
    routeId: number;
    cargoTypeId: number;
    containerTypeId: number;
    truckId?: number | null;
    driverId?: number | null;
    departureDate: string;
    customerReference?: string;
    containerCount?: number;
    creditApprovalRequestId?: number | null;
    fuelMode?: import('@tingting/shared').FuelMode;
  },
  actor: { userId: number; role: import('@tingting/shared').Role },
  transaction?: Tx,
) {
  if (transaction) {
    return dispatchShipmentToTripInTx(transaction, shipmentId, fulfillment, actor);
  }
  return db.transaction((tx) => dispatchShipmentToTripInTx(tx, shipmentId, fulfillment, actor));
}

// Postgres unique-violation detector — 23505 is the SQLSTATE for any unique
// constraint violation. Drizzle wraps the underlying postgres-js error, so the
// code may live on either `err.code` (postgres-js direct) or `err.cause.code`
// (Drizzle-wrapped). Mirrors `apiErrorFromUniqueConstraint` in
// `routes/utils/crud-factory.ts`.
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
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
// missing recommended fields and `dispatchShipmentToTrip` surfaces them as
// `preDispatchWarnings` in its response without blocking dispatch. The UI
// (slice 3) shows a confirm dialog; a follow-up slice flips enforcing on
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
        if (reviewedShipment.status === 'DRAFT') {
          await syncShipmentAuthorityToTrips(tx, reviewedShipment);
        }
      } else {
        const containers = parseContainerChangeSnapshot(request.afterSnapshot);
        assertContainerSetValid(containers);
        await reconcileShipmentContainersInTx(tx, shipmentId, actor.userId, containers);
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
