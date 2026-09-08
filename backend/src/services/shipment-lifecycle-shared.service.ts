// Shared helpers for the shipment-lifecycle leaf family: document-reference
// validation, create/update input+result types, and the close-authority
// context loaders (fulfillment + required-authority-trip rows). Extracted from
// shipment-lifecycle.service.ts verbatim (pure code movement); the create /
// update / transitions leaves and the lifecycle core import these one-way.
import * as s from '../db/schema';
import { db } from '../db';
import { and, asc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { isFulfillmentRequired } from './shipment-fulfillment.service';
import type { ShipmentAuthorityTripRow } from './shipment-shared.service';

export function assertShipmentDocumentReferences(input: {
  blNumber?: string | null;
  bookingRef?: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
}) {
  const hasBill = Boolean(input.blNumber?.trim());
  const hasBooking = Boolean(input.bookingRef?.trim());
  if (hasBill && hasBooking) {
    throw new ApiError(400, 'Một lô hàng chỉ có Số Bill (hàng Nhập) hoặc Số Booking (hàng Xuất).');
  }
  if (input.tradeDirection === 'IMPORT' && hasBooking) {
    throw new ApiError(400, 'Hàng Nhập dùng Số Bill, không dùng Số Booking.');
  }
  if (input.tradeDirection === 'EXPORT' && hasBill) {
    throw new ApiError(400, 'Hàng Xuất dùng Số Booking, không dùng Số Bill.');
  }
}

/**
 * Blank strings pass the trim-aware assertions above but violate the
 * direction CHECK on the shipments table (which is NULL-aware only), so an
 * untrimmed client payload would surface as a Postgres 23514 → 500 instead
 * of a clean store-as-null. Collapse whitespace-only refs to null at the
 * write boundary.
 */
export function normalizeDocumentReference(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

/**
 * Duplicate document-reference guard for shipment writes.
 *
 * Returns the first ACTIVE (non-soft-deleted) shipment whose `blNumber` or
 * `bookingRef` matches the supplied reference AND is not the same shipment
 * as `excludeShipmentId` (used by update flows to allow editing the row
 * itself). Soft-deleted rows are ignored — a clerk can resurrect the
 * historical `shipment_id` for audit, never silently create a new collision.
 *
 * The conflict payload carries the creator's username + full name so the
 * caller can show "đã nhập bởi <username> lúc <dd/MM HH:mm>" — the customer
 * feedback that motivated this guard (2026-09-07, BL `JJCTCHPDY260305`
 * created twice and the second row's "Chưa chốt ngày" became unreachable).
 */
export interface ShipmentReferenceConflict {
  shipmentId: number;
  shipmentCode: string | null;
  field: 'blNumber' | 'bookingRef';
  reference: string;
  createdBy: {
    id: number | null;
    username: string | null;
    fullName: string | null;
  } | null;
  createdAt: Date;
}

type TxOrDb = Tx | typeof db;

export async function findShipmentReferenceConflict(
  executor: TxOrDb,
  reference: { blNumber?: string | null; bookingRef?: string | null },
  excludeShipmentId?: number | null,
): Promise<ShipmentReferenceConflict | null> {
  // Trim incoming refs once so ilike + the field-derivation comparison
  // below agree (TC-EDGE-002: case-insensitive + whitespace-insensitive).
  const incomingBl = reference.blNumber?.trim() ?? null;
  const incomingBk = reference.bookingRef?.trim() ?? null;
  const conditions = [];
  if (incomingBl) {
    conditions.push(ilike(s.shipments.blNumber, incomingBl));
  }
  if (incomingBk) {
    conditions.push(ilike(s.shipments.bookingRef, incomingBk));
  }
  if (conditions.length === 0) return null;

  const baseWhere = and(
    sql`(${sql.join(conditions, sql` OR `)})`,
    isNull(s.shipments.deletedAt),
  );
  const where = excludeShipmentId != null
    ? and(baseWhere, sql`${s.shipments.id} <> ${excludeShipmentId}`)
    : baseWhere;

  const [row] = await executor.select({
    id: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    createdBy: s.shipments.createdBy,
    createdAt: s.shipments.createdAt,
    creatorUsername: s.users.username,
    creatorFullName: s.users.fullName,
  })
    .from(s.shipments)
    .leftJoin(s.users, eq(s.users.id, s.shipments.createdBy))
    .where(where)
    .orderBy(asc(s.shipments.id))
    .limit(1);
  if (!row) return null;

  // Derive the matched field from the SUPPLIED reference, not from equality
  // against the row: when the incoming payload has blNumber = null, the
  // naive `row.blNumber === reference.blNumber` sees null === null and
  // mislabels a bookingRef collision as blNumber (cross-direction case).
  // Compares case-insensitively against the trimmed incoming value so a
  // case-variant ilike match is still labeled as a Bill collision.
  const field: 'blNumber' | 'bookingRef' =
    incomingBl && row.blNumber?.toLowerCase() === incomingBl.toLowerCase()
      ? 'blNumber'
      : 'bookingRef';
  const value = field === 'blNumber' ? (row.blNumber ?? '') : (row.bookingRef ?? '');
  return {
    shipmentId: row.id,
    shipmentCode: row.shipmentCode,
    field,
    reference: value,
    createdBy: row.createdBy == null
      ? null
      : {
        id: row.createdBy,
        username: row.creatorUsername ?? null,
        fullName: row.creatorFullName ?? null,
      },
    createdAt: row.createdAt,
  };
}

export async function findDeclarationReferenceConflict(
  executor: TxOrDb,
  declarationNumber: string,
  excludeShipmentId?: number | null,
): Promise<ShipmentReferenceConflict | null> {
  const trimmed = declarationNumber.trim();
  const baseWhere = and(
    ilike(s.shipmentDeclarations.declarationNumber, trimmed),
  );
  const where = excludeShipmentId != null
    ? and(baseWhere, sql`${s.shipmentDeclarations.shipmentId} <> ${excludeShipmentId}`)
    : baseWhere;
  const [row] = await executor.select({
    id: s.shipmentDeclarations.id,
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
    createdBy: s.shipmentDeclarations.createdBy,
    createdAt: s.shipmentDeclarations.createdAt,
    creatorUsername: s.users.username,
    creatorFullName: s.users.fullName,
    shipmentCode: s.shipments.shipmentCode,
  })
    .from(s.shipmentDeclarations)
    .leftJoin(s.users, eq(s.users.id, s.shipmentDeclarations.createdBy))
    .leftJoin(s.shipments, eq(s.shipments.id, s.shipmentDeclarations.shipmentId))
    .where(where)
    .orderBy(asc(s.shipmentDeclarations.id))
    .limit(1);
  if (!row) return null;
  return {
    shipmentId: row.shipmentId,
    shipmentCode: row.shipmentCode ?? null,
    field: 'blNumber',
    reference: row.declarationNumber ?? '',
    createdBy: row.createdBy == null
      ? null
      : {
        id: row.createdBy,
        username: row.creatorUsername ?? null,
        fullName: row.creatorFullName ?? null,
      },
    createdAt: row.createdAt,
  };
}

/**
 * Throws ApiError(409) with a structured payload identifying the duplicate
 * shipment + the account that entered it. Mirrors the wording the customer
 * requested (2026-09-07 feedback).
 */
export function throwShipmentReferenceConflict(
  conflict: ShipmentReferenceConflict,
  kind: 'bill' | 'booking' | 'declaration',
): never {
  const label = kind === 'bill'
    ? 'Số Bill'
    : kind === 'booking'
      ? 'Số Booking'
      : 'Số tờ khai';
  const actor = conflict.createdBy?.username ?? 'tài khoản khác';
  const at = conflict.createdAt.toISOString();
  const err = new ApiError(
    409,
    `${label} đã được nhập bởi ${actor} lúc ${at}. Vui lòng kiểm tra lại trước khi tạo lô hàng mới.`,
    'SHIPMENT_REFERENCE_DUPLICATE',
  );
  // Attach the structured conflict info as a payload so the global error
  // handler can surface `{ conflict: { shipmentId, createdBy: {...} } }` to
  // the client without it being swallowed by the JSON serializer.
  (err as ApiError & { payload?: Record<string, unknown> }).payload = {
    code: 'SHIPMENT_REFERENCE_DUPLICATE',
    conflict: { ...conflict, createdAt: conflict.createdAt.toISOString() },
  };
  throw err;
}

/**
 * Route-level entry point for `GET /api/shipments/duplicate-check` — runs
 * the three reference lookups in parallel and serialises `createdAt` to
 * ISO so the JSON payload is plain-object safe. Lives here so the route
 * stays free of direct `db` imports (per `arch-layering.test.ts`).
 */
export async function listShipmentReferenceConflicts(
  reference: { blNumber?: string | null; bookingRef?: string | null; declarationNumber?: string | null },
  excludeShipmentId?: number | null,
): Promise<ShipmentReferenceConflict[]> {
  const [billConflict, bookingConflict, declarationConflict] = await Promise.all([
    reference.blNumber
      ? findShipmentReferenceConflict(db, { blNumber: reference.blNumber }, excludeShipmentId)
      : Promise.resolve(null),
    reference.bookingRef
      ? findShipmentReferenceConflict(db, { bookingRef: reference.bookingRef }, excludeShipmentId)
      : Promise.resolve(null),
    reference.declarationNumber
      ? findDeclarationReferenceConflict(db, reference.declarationNumber, excludeShipmentId)
      : Promise.resolve(null),
  ]);
  return [billConflict, bookingConflict, declarationConflict]
    .filter((conflict): conflict is ShipmentReferenceConflict => conflict != null)
    .map((conflict) => ({ ...conflict, createdAt: conflict.createdAt.toISOString() as unknown as Date }));
}

export interface CreateShipmentInput {
  /** Null for ad-hoc orders (Lệnh chạy ngoài) — rawCustomerName carries the text. */
  customerId?: number | null;
  isAdHoc?: boolean;
  rawCustomerName?: string | null;
  rawRouteName?: string | null;
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
  isCombined?: boolean;
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
  customerNotes?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  createdBy?: number | null;
}

/** Dispatch master-plan: how much of the container demand has a planned carrier. */
export type ShipmentUpdateResult = typeof s.shipments.$inferSelect & {
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
};

export type ShipmentFulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

export type ShipmentCloseAuthorityContext = {
  fulfillmentRows: ShipmentFulfillmentRow[];
  requiredFulfillments: ShipmentFulfillmentRow[];
};
export async function loadShipmentCloseAuthorityContext(tx: Tx, shipmentId: number): Promise<ShipmentCloseAuthorityContext> {
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

export async function listRequiredShipmentAuthorityTrips(
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
    // Trips-split: financial/pricing fields live in trip_financial_state.
    // The row lock stays on trips only (`of`), matching the pre-split lock
    // footprint (views and sidecars cannot take the lock).
    vatRate: sql<string>`coalesce(${s.tripFinancialState.vatRate}, '0.000')`,
    status: s.trips.status,
    pricingSource: s.tripFinancialState.pricingSource,
    pricingFormula: s.tripFinancialState.pricingFormula,
    pricingSnapshot: s.tripFinancialState.pricingSnapshot,
    revenue: s.tripFinancialState.revenue,
    revenueOriginal: s.tripFinancialState.revenueOriginal,
    revenueEmptyReturn: s.tripFinancialState.revenueEmptyReturn,
    podRecoveredAt: s.trips.podRecoveredAt,
  })
    .from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(and(
      inArray(s.trips.fulfillmentId, requiredFulfillmentIds),
      sql`${s.trips.status} <> 'CANCELED'`,
      isNull(s.trips.deletedAt),
    ))
    .orderBy(asc(s.trips.id))
    .for('update', { of: [s.trips] });
}
export async function assertShipmentFactorySiteValid(
  tx: Tx,
  customerId: number,
  operationalSiteId: number,
): Promise<void> {
  const [factory] = await tx.select({ id: s.operationalSites.id })
    .from(s.operationalSites)
    .where(and(
      eq(s.operationalSites.id, operationalSiteId),
      eq(s.operationalSites.customerId, customerId),
      eq(s.operationalSites.siteType, 'FACTORY'),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    )).limit(1);
  if (!factory) throw new ApiError(409, 'Nhà máy không còn hiệu lực hoặc không thuộc khách hàng của lô hàng.');
}
