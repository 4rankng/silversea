// Shared helpers for the shipment-lifecycle leaf family: document-reference
// validation, create/update input+result types, and the close-authority
// context loaders (fulfillment + required-authority-trip rows). Extracted from
// shipment-lifecycle.service.ts verbatim (pure code movement); the create /
// update / transitions leaves and the lifecycle core import these one-way.
import * as s from '../db/schema';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
