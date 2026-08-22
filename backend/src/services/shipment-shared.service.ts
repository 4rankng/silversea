// Shipment shared helpers — cross-leaf utilities extracted from
// shipment.service.ts (maintainability round 3). Holds the pieces the
// lifecycle and review leaves both need (authority→trip sync, scalar
// normalizers), the trip expense-scope completion state used by every
// shipment-close path, and the pending change-request read shared by review
// and the detail assembler — so no leaf-to-leaf cycle arises.

import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { TripPodStatus } from '@tingting/shared';
import type { Tx } from './trip-shared';
import { resolveFreightPrice } from './pricing.service';

const SYNTHETIC_LCL_FULFILLMENT_SCOPE_PREFIX = '__fulfillment_lcl:';


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

export function hasCompletedExpenseScopes(
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

export async function loadTripExpenseScopeState(tx: Tx, tripIds: number[]) {
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

export async function assertShipmentDirectCloseTripReadiness(
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

export type ShipmentAuthorityTripRow = Pick<
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

export type ShipmentChangeRequestRow = typeof s.shipmentChangeRequests.$inferSelect;

export type ShipmentChangeRequestSummary = ShipmentChangeRequestRow & {
  requester: {
    id: number;
    fullName: string | null;
    username: string | null;
  } | null;
};

export function toNullableFixedDecimal(
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

export function toNullableTimestamp(
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

function buildFullPricingFormula(freightFormula: string, freightPrice: number, vatRate: number): string {
  const vatPct = Math.round(vatRate * 1000) / 10;
  return `${freightFormula} = ${freightPrice.toLocaleString('vi-VN')}đ; VAT ${vatPct}%`;
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

export async function syncShipmentAuthorityToTrips(
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
