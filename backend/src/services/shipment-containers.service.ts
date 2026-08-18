// Shipment Containers Service — container lifecycle for shipments.
//
// Extracted from shipment.service.ts (T3b): the phase-01 container snapshot
// into trips, the full-reconcile batch upsert (with clerk change-request
// boundary + fulfillment guard), and the change-request snapshot parsers.
// Leaf module: imports only db/schema, shared helpers, and the sibling leaf
// services (intake guards, accounting lock, edit boundary) — never
// shipment.service itself, which keeps the dependency direction one-way.

import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  canonicalShipmentStatus,
  shipmentContainerBatchSchema,
  updateShipmentSchema,
  validateContainerNumber,
} from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import {
  assertDispatcherCanMutateShipmentIntake,
  ensureReadyShipmentHandoff,
  hasDispatchDate,
  isDirectlyEditableIntakeStatus,
} from './shipment-intake.service';
import {
  assertClerkCanAccessShipment,
  isClerkScopedUser,
  loadClerkShipmentScope,
} from './clerk-shipment-scope.service';
import {
  classifyClerkContainerChange,
  createShipmentChangeRequest,
} from './shipment-edit-boundary.service';
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
    // Date part only — appointment timestamps arrive as ISO strings.
    const day = container.customerAppointmentAt.slice(0, 10);
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
    closingAt: s.shipments.closingAt,
    plannedReturnAt: s.shipments.plannedReturnAt,
    status: s.shipments.status,
    version: s.shipments.version,
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
  for (const container of synchronizedContainers) {
    const payload = {
      shipmentId,
      containerTypeId: container.containerTypeId ?? null,
      containerNumber: container.containerNumber?.trim() || null,
      sealNumber: container.sealNumber?.trim() || null,
      cargoWeightKg: container.cargoWeightKg != null ? String(container.cargoWeightKg) : null,
      cargoVolumeCbm: container.cargoVolumeCbm != null ? String(container.cargoVolumeCbm) : null,
      shippingLineName: container.shippingLineName?.trim() || null,
      pickupPortId: container.pickupPortId ?? null,
      dropoffPortId: container.dropoffPortId ?? null,
      customerAppointmentAt: container.customerAppointmentAt ? new Date(container.customerAppointmentAt) : null,
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

  // Per-container delivery dates drive the shipment-level expected delivery
  // date when the caller never set one: earliest container Ngày đóng/trả wins
  // and may flip PENDING_DATE → READY_FOR_DISPATCH (+ handoff), mirroring the
  // updateShipment date-gate. An explicit shipment-level date is never
  // overwritten by a later reconcile.
  const derivedDate = deriveExpectedDeliveryDateFromContainers(synchronizedContainers);
  if (derivedDate && shipment.expectedDeliveryDate == null) {
    const becomesReady = canonicalShipmentStatus(shipment.status ?? 'PENDING_DATE') === 'PENDING_DATE'
      && !hasDispatchDate(shipment);
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

  return reconcileShipmentContainersInTx(tx, shipmentId, userId, containers);
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
    const shippingLineName = resolveShipmentShippingLine(existing.shippingLineName, containers);
    const synchronizedContainers = synchronizeContainerShippingLine(containers, shippingLineName);
    assertContainerSetValid(synchronizedContainers);

    const current = await tx.select()
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipmentId));

    if (actor && isClerkScopedUser(actor) && !isDirectlyEditableIntakeStatus(existing.status)) {
      const classification = classifyClerkContainerChange(current, synchronizedContainers);
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
      synchronizedContainers,
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

