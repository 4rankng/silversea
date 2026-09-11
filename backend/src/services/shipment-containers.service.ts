// Shipment Containers Service — container lifecycle for shipments.
//
// Extracted from shipment.service.ts (T3b): the phase-01 container snapshot
// into trips, the full-reconcile batch upsert (with clerk change-request
// boundary + fulfillment guard), and the change-request snapshot parsers.
// Leaf module: imports only db/schema, shared helpers, and the sibling leaf
// services (intake guards, accounting lock, edit boundary) — never
// shipment.service itself, which keeps the dependency direction one-way.

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  canonicalShipmentStatus,
  localDateInBusinessZone,
  shipmentContainerBatchSchema,
  updateShipmentSchema,
  validateContainerNumber,
} from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import {
  assertDispatcherCanMutateShipmentIntake,
  ensureReadyShipmentHandoff,
} from './shipment-intake.service';
import { lockShipmentFreightRate } from './freight-rate-snapshot-lifecycle.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import type {
  ShipmentContainerInput,
  ShipmentContainerMutationResult,
  UpdateShipmentInput,
} from './shipment-types';

export async function listShipmentContainers(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  return await client.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentContainers.createdAt));
}

/**
 * Per-container factory authority validation — the single choke point every
 * container write passes through (direct PUT, change-request review, CUS
 * reconcile). Protects the factory's customer/type boundary and returns the
 * siteId → canonical routeId map so callers can enforce that a container's
 * route follows its factory (master-data spec 2026-09-06).
 */
async function assertContainerFactorySitesValid(
  tx: Tx,
  customerId: number | null,
  siteIds: number[],
): Promise<Map<number, number | null>> {
  if (siteIds.length === 0) return new Map();
  // Ad-hoc orders (null customer) may still reference catalog factories; the
  // customer-scope equality cannot apply, but FACTORY/active still must.
  const sites = await tx.select({
    id: s.operationalSites.id,
    routeId: s.operationalSites.routeId,
  })
    .from(s.operationalSites)
    .where(and(
      inArray(s.operationalSites.id, siteIds),
      ...(customerId != null ? [eq(s.operationalSites.customerId, customerId)] : []),
      eq(s.operationalSites.siteType, 'FACTORY'),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    ));
  if (sites.length !== siteIds.length) {
    throw new ApiError(409, 'Nhà máy của container không còn hiệu lực hoặc không thuộc khách hàng của lô hàng.');
  }
  return new Map(sites.map((site) => [site.id, site.routeId]));
}

/** Routes remain independent from factories, but must be active catalog rows. */
async function assertContainerRoutesActive(tx: Tx, routeIds: number[]): Promise<void> {
  if (routeIds.length === 0) return;
  const routes = await tx.select({ id: s.routes.id })
    .from(s.routes)
    .where(and(inArray(s.routes.id, routeIds), isNull(s.routes.deletedAt)));
  if (routes.length !== routeIds.length) {
    throw new ApiError(409, 'Tuyến đường của container không còn hiệu lực.');
  }
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

function deriveExpectedDeliveryDateFromContainers(
  containers: ReadonlyArray<{ customerAppointmentAt?: string | null }>,
): string | null {
  let earliest: string | null = null;
  for (const container of containers) {
    if (!container.customerAppointmentAt) continue;
    // Every schedule projection uses the Vietnam business day. Slicing an ISO
    // string would derive a UTC date for a late-evening appointment, while the
    // single-container save path correctly uses Asia/Ho_Chi_Minh.
    const day = localDateInBusinessZone(new Date(container.customerAppointmentAt));
    if (!day) continue;
    if (!earliest || day < earliest) earliest = day;
  }
  return earliest;
}

export async function reconcileShipmentContainersInTx(
  tx: Tx,
  shipmentId: number,
  userId: number | null,
  containers: ShipmentContainerInput[],
) {
  const [shipment] = await tx.select({
    shippingLineName: s.shipments.shippingLineName,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    cargoMode: s.shipments.cargoMode,
    closingAt: s.shipments.closingAt,
    plannedReturnAt: s.shipments.plannedReturnAt,
    status: s.shipments.status,
    version: s.shipments.version,
    customerId: s.shipments.customerId,
  })
    .from(s.shipments)
    .where(eq(s.shipments.id, shipmentId))
    .limit(1)
    .for('update');
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  const shippingLineName = resolveShipmentShippingLine(shipment.shippingLineName, containers);
  const synchronizedContainers = synchronizeContainerShippingLine(containers, shippingLineName);
  if (!shipment.shippingLineName?.trim() && shippingLineName) {
    await tx.update(s.shipments).set({ shippingLineName, updatedAt: new Date() })
      .where(eq(s.shipments.id, shipmentId));
  }

  const current = await tx.select()
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId));
  const existingIds = new Set(current.map((row) => row.id));
  const incomingIds = new Set(synchronizedContainers.filter((row) => row.id).map((row) => row.id as number));

  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    await tx.delete(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.id, toDelete));
  }

  const upserted: Array<{ id: number }> = [];
  const currentById = new Map(current.map((row) => [row.id, row]));
  const resolvedSiteIds = [...new Set(containers.map((container) => (
    container.operationalSiteId !== undefined
      ? container.operationalSiteId
      : container.id != null ? currentById.get(container.id)?.operationalSiteId ?? null : null
  )).filter((id): id is number => id != null))];
  const factoryRouteBySiteId = await assertContainerFactorySitesValid(tx, shipment.customerId, resolvedSiteIds);
  // Factory-route authority (master-data spec 2026-09-06): the factory owns
  // its canonical route, so a container's route follows its factory. Resolve
  // every container up front so an explicit mismatch is rejected (422) and a
  // missing route is derived from the factory; factories without a configured
  // route keep the previous independent per-container route behavior.
  const resolvedContainers = synchronizedContainers.map((container) => {
    const isUpdate = container.id != null && existingIds.has(container.id);
    // Per-container factory authority: an update that leaves the field
    // unspecified (undefined — e.g. a UI payload that doesn't manage it)
    // preserves the existing authority; only an explicit null clears it.
    // Inserts without the field start at null (legacy behavior).
    const resolvedSiteId = container.operationalSiteId !== undefined
      ? container.operationalSiteId
      : isUpdate
        ? currentById.get(container.id as number)?.operationalSiteId ?? null
        : null;
    const explicitRouteId = container.routeId !== undefined
      ? container.routeId
      : isUpdate
        ? currentById.get(container.id as number)?.routeId ?? null
        : null;
    const factoryRouteId = resolvedSiteId != null
      ? factoryRouteBySiteId.get(resolvedSiteId) ?? null
      : null;
    if (factoryRouteId != null && explicitRouteId != null && explicitRouteId !== factoryRouteId) {
      throw new ApiError(422, 'Tuyến đường không khớp tuyến đã cấu hình của nhà máy.');
    }
    return { container, isUpdate, resolvedSiteId, resolvedRouteId: factoryRouteId ?? explicitRouteId };
  });
  const resolvedRouteIds = [...new Set(resolvedContainers
    .map((row) => row.resolvedRouteId)
    .filter((id): id is number => id != null))];
  await assertContainerRoutesActive(tx, resolvedRouteIds);
  for (const { container, isUpdate, resolvedSiteId, resolvedRouteId } of resolvedContainers) {
    // Ports follow the same undefined-preservation contract as the factory
    // site above: surfaces that don't manage lift/drop ports (e.g. a payload
    // editing only cargo figures) keep the saved ports; only an explicit
    // null clears them.
    const resolvedPickupPortId = container.pickupPortId !== undefined
      ? container.pickupPortId
      : isUpdate
        ? currentById.get(container.id as number)?.pickupPortId ?? null
        : null;
    const resolvedDropoffPortId = container.dropoffPortId !== undefined
      ? container.dropoffPortId
      : isUpdate
        ? currentById.get(container.id as number)?.dropoffPortId ?? null
        : null;
    // Ad-hoc raw port names (Lệnh chạy ngoài): a catalog id wins and clears
    // its raw mirror; an explicit null id lets the raw text stand.
    const rawPickupPortName = resolvedPickupPortId != null
      ? null
      : container.rawPickupPortName?.trim() || null;
    const rawDropoffPortName = resolvedDropoffPortId != null
      ? null
      : container.rawDropoffPortName?.trim() || null;
    const payload = {
      shipmentId,
      containerTypeId: container.containerTypeId ?? null,
      containerNumber: container.containerNumber?.trim() || null,
      sealNumber: container.sealNumber?.trim() || null,
      cargoWeightKg: container.cargoWeightKg != null ? String(container.cargoWeightKg) : null,
      cargoVolumeCbm: container.cargoVolumeCbm != null ? String(container.cargoVolumeCbm) : null,
      shippingLineName: container.shippingLineName?.trim() || null,
      routeId: resolvedRouteId,
      pickupPortId: resolvedPickupPortId,
      dropoffPortId: resolvedDropoffPortId,
      rawPickupPortName,
      rawDropoffPortName,
      operationalSiteId: resolvedSiteId,
      customerAppointmentAt: container.customerAppointmentAt ? new Date(container.customerAppointmentAt) : null,
      notes: container.notes ?? null,
      updatedAt: new Date(),
    };
    if (isUpdate) {
      const [updated] = await tx.update(s.shipmentContainers)
        .set(payload)
        .where(eq(s.shipmentContainers.id, container.id as number))
        .returning({ id: s.shipmentContainers.id });
      if (updated) upserted.push(updated);
    } else {
      const [inserted] = await tx.insert(s.shipmentContainers)
        .values({ ...payload, createdBy: userId })
        .returning({ id: s.shipmentContainers.id });
      if (inserted) upserted.push(inserted);
    }
  }

  // The shipment-level date is an internal projection of the earliest
  // per-container appointment, never an independently edited delivery date.
  // It remains available to dispatch readiness and pricing while every UI
  // schedule renders the individual container times.
  const derivedDate = deriveExpectedDeliveryDateFromContainers(synchronizedContainers);
  const canonicalStatus = canonicalShipmentStatus(shipment.status ?? 'PENDING_DATE');
  if (
    shipment.cargoMode === CARGO_MODE.FCL
    && derivedDate == null
    && canonicalStatus === 'READY_FOR_DISPATCH'
    && current.some((container) => container.customerAppointmentAt != null)
  ) {
    throw new ApiError(409, 'Không thể xóa lịch hẹn cuối cùng của container khi lô đã sẵn sàng điều xe.');
  }
  if (derivedDate !== shipment.expectedDeliveryDate) {
    const allContainersDated = synchronizedContainers.length > 0
      && synchronizedContainers.every((container) => container.customerAppointmentAt != null);
    const becomesReady = shipment.cargoMode === CARGO_MODE.FCL
      && canonicalStatus === 'PENDING_DATE'
      && derivedDate != null
      && allContainersDated;
    const [updatedShipment] = await tx.update(s.shipments).set({
      expectedDeliveryDate: derivedDate,
      ...(becomesReady ? { status: 'READY_FOR_DISPATCH' as const } : {}),
      updatedAt: new Date(),
    }).where(eq(s.shipments.id, shipmentId)).returning();
    if (becomesReady) {
      await tx.insert(s.shipmentStatusHistory).values({
        shipmentId,
        fromStatus: shipment.status ?? 'PENDING_DATE',
        toStatus: 'READY_FOR_DISPATCH',
        reason: 'Đã bổ sung ngày đóng/trả theo container và sẵn sàng điều xe.',
        changedBy: userId,
      });
      // Both reconcile callers bump version to preBump+1 after this returns;
      // snapshot that final version so handoffVersion matches the shipment.
      await ensureReadyShipmentHandoff(tx, { ...updatedShipment, version: shipment.version + 1 }, userId);
    }
  }

  return {
    items: await listShipmentContainers(shipmentId, tx),
    upsertedIds: upserted.map((row) => row.id),
  };
}

export async function reconcileShipmentContainersWithFulfillmentGuard(
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

  const result = await reconcileShipmentContainersInTx(tx, shipmentId, userId, containers);
  // Snapshot refresh happens at re-decompose: ensureShipmentFulfillmentsInTx
  // resolves per-container deliverySite overrides from current authority, so
  // the fulfillments canceled above are rebuilt (by the next decomposition)
  // with fresh snapshots — never the stale inherited factory.
  return result;
}

export function parsePlanUpdateSnapshot(snapshot: unknown): UpdateShipmentInput {
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

export function parseContainerChangeSnapshot(snapshot: unknown) {
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
export function assertContainerSetValid(
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

function resolveShipmentShippingLine(
  shipmentShippingLineName: string | null,
  containers: ReadonlyArray<ShipmentContainerInput>,
): string | null {
  const master = shipmentShippingLineName?.trim() || null;
  const incomingByKey = new Map<string, string>();
  for (const container of containers) {
    const value = container.shippingLineName?.trim() || null;
    if (value) incomingByKey.set(value.toLocaleLowerCase('vi'), value);
  }
  if (incomingByKey.size > 1) {
    throw new ApiError(400, 'Các container trong cùng lô phải dùng chung một hãng tàu.');
  }
  const incoming = incomingByKey.values().next().value as string | undefined;
  if (master && incoming && master.localeCompare(incoming, 'vi', { sensitivity: 'base' }) !== 0) {
    throw new ApiError(400, 'Hãng tàu của container phải khớp với hãng tàu chung của lô hàng.');
  }
  return master ?? incoming ?? null;
}

function synchronizeContainerShippingLine(
  containers: ReadonlyArray<ShipmentContainerInput>,
  shippingLineName: string | null,
): ShipmentContainerInput[] {
  return containers.map((container) => ({ ...container, shippingLineName }));
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
    assertDispatcherCanMutateShipmentIntake(actor, existing.status);
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (expectedVersion != null && existing.version !== expectedVersion) {
      throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
    }

    // M10.2 slice 1: validate the desired container set BEFORE any write so a
    // rejected batch leaves the shipment untouched. The batch is a full
    // reconcile — `containers` becomes the desired final list — so duplicate
    // and format checks against it cover the post-state correctly. Null
    // numbers are allowed (placeholder rows before the BL arrives); only
    // non-null values are validated. Reuses the shared ISO 6346 validator
    // already ported from vantaiphucloc.
    const shippingLineName = resolveShipmentShippingLine(existing.shippingLineName, containers);
    const synchronizedContainers = synchronizeContainerShippingLine(containers, shippingLineName);
    assertContainerSetValid(synchronizedContainers);

    // 2026-09-10 user directive: all phê duyệt (approval) flows are removed —
    // clerk container reconciles apply directly, with no change-request
    // routing to reintroduce later.

    const reconciled = await reconcileShipmentContainersWithFulfillmentGuard(
      tx,
      shipmentId,
      userId,
      synchronizedContainers,
    );

    // Bump the shipment's version so any open editor is told to reload — the
    // container set is part of the shipment's editable surface.
    const nextVersion = existing.version + 1;
    await tx.update(s.shipments)
      .set({ version: nextVersion, updatedAt: new Date() })
      .where(eq(s.shipments.id, shipmentId));

    // Auto freight pricing (Phương án tính cước): FCL intake is usually where
    // the transport date + container class first become known together — lock
    // the rate snapshot now; dispatch supersedes with the exact per-trip row.
    // MANUAL fallback keeps the reconcile non-blocking; ad-hoc skips inside.
    await lockShipmentFreightRate(tx, { shipmentId });

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
  return runInTx(transaction, execute);
}
