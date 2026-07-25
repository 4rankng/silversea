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
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { createTripCommand } from './trip-command.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';

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
  bookingRef?: string | null;
  blNumber?: string | null;
  expectedDeliveryDate?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  createdBy?: number | null;
}

export interface UpdateShipmentInput {
  version: number; // Required for optimistic-lock check
  customerId?: number;
  bookingRef?: string | null;
  blNumber?: string | null;
  expectedDeliveryDate?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  updatedBy?: number | null;
}

export interface ListShipmentsOptions {
  customerId?: number;
  status?: ShipmentStatus;
  limit?: number;
  offset?: number;
}

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

export async function createShipment(input: CreateShipmentInput) {
  return await db.transaction(async (tx) => {
    // 1. Insert the shipment row (DRAFT default, version 1).
    const [shipment] = await tx.insert(s.shipments).values({
      customerId: input.customerId,
      bookingRef: input.bookingRef ?? null,
      blNumber: input.blNumber ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
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
  });
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getShipment(id: number) {
  const [shipment] = await db.select().from(s.shipments)
    .where(and(eq(s.shipments.id, id), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  return shipment;
}

export async function listShipments(options: ListShipmentsOptions = {}) {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (options.customerId != null) {
    conditions.push(eq(s.shipments.customerId, options.customerId));
  }
  if (options.status != null) {
    conditions.push(eq(s.shipments.status, options.status));
  }

  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const offset = Math.max(0, options.offset ?? 0);

  return await db.select().from(s.shipments)
    .where(and(...conditions))
    .orderBy(desc(s.shipments.createdAt))
    .limit(limit)
    .offset(offset);
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
  if (options.customerId != null) {
    conditions.push(eq(s.shipments.customerId, options.customerId));
  }
  if (options.status != null) {
    conditions.push(eq(s.shipments.status, options.status));
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
    db.select({ value: count() }).from(s.shipments).where(and(...conditions)),
  ]);
  const total = Number(totalRows[0]?.value ?? 0);
  // Flatten `shipment` + `customerName` into a single object so the route
  // layer returns `{ ...shipmentColumns, customerName }` directly.
  const flatItems = items.map((row) => ({ ...row.shipment, customerName: row.customerName }));
  return { items: flatItems, total, page, limit };
}

// ─── Update (optimistic-lock) ───────────────────────────────────────────────

export async function updateShipment(id: number, input: UpdateShipmentInput) {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, id), isNull(s.shipments.deletedAt)))
      .for('update') // pessimistic row lock so the version bump is race-free
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');

    if (existing.version !== input.version) {
      throw new ApiError(
        409,
        'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.',
      );
    }

    const nextVersion = existing.version + 1;
    const [updated] = await tx.update(s.shipments).set({
      version: nextVersion,
      ...(input.customerId != null ? { customerId: input.customerId } : {}),
      ...(input.bookingRef !== undefined ? { bookingRef: input.bookingRef } : {}),
      ...(input.blNumber !== undefined ? { blNumber: input.blNumber } : {}),
      ...(input.expectedDeliveryDate !== undefined
        ? { expectedDeliveryDate: input.expectedDeliveryDate }
        : {}),
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

    return updated;
  });
}

// ─── Status transitions ─────────────────────────────────────────────────────

export async function transitionShipmentStatus(
  shipmentId: number,
  targetStatus: ShipmentStatus,
  options: { reason?: string | null; changedBy?: number | null } = {},
) {
  return await db.transaction(async (tx) => {
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
  });
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
) {
  return await db.transaction(async (tx) => {
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
  });
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
        eq(s.tripContainers.notes, SNAPSHOT_MARKER(shipmentId)),
      ),
    )
    .limit(1);
  if (existing) return { copied: 0, skipped: true };

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
  shipment: Awaited<ReturnType<typeof getShipment>> & { customerName: string | null };
  containers: Awaited<ReturnType<typeof listShipmentContainers>>;
  documents: Awaited<ReturnType<typeof listShipmentDocuments>>;
  declarations: Awaited<ReturnType<typeof listShipmentDeclarations>>;
  statusHistory: Awaited<ReturnType<typeof listShipmentStatusHistory>>;
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

export async function getShipmentDetail(id: number): Promise<ShipmentDetail> {
  // Fetch the shipment first so a missing row 404s cleanly rather than
  // returning an empty payload.
  const shipment = await getShipment(id);
  // Join the customer name so the detail page can show a readable label
  // instead of "Khách hàng #{id}". leftJoin keeps the row even if the
  // customer was hard-deleted (customerName = null in that case).
  const [joined] = await db.select({ customerName: s.customers.name })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .where(eq(s.shipments.id, id));
  const shipmentWithCustomer = { ...shipment, customerName: joined?.customerName ?? null };
  const [containers, documents, declarations, statusHistory] = await Promise.all([
    listShipmentContainers(id),
    listShipmentDocuments(id),
    listShipmentDeclarations(id),
    listShipmentStatusHistory(id),
  ]);
  return { shipment: shipmentWithCustomer, containers, documents, declarations, statusHistory };
}

// ─── Container batch upsert (full reconcile) ────────────────────────────────
//
// Mirrors `batchUpsertTripContainers`: the incoming list becomes the desired
// full state — new rows are inserted, existing rows are updated by id, and any
// existing row whose id is missing from the incoming list is deleted. This is
// the same contract the trip-edit form uses, so the shipment UI behaves
// identically.

export async function batchUpsertShipmentContainers(
  shipmentId: number,
  userId: number | null,
  containers: Array<{
    id?: number;
    containerTypeId?: number | null;
    containerNumber?: string | null;
    sealNumber?: string | null;
    cargoWeightKg?: string | number | null;
    notes?: string | null;
  }>,
) {
  return await db.transaction(async (tx) => {
    // Existence + ownership guard: a missing (or soft-deleted) shipment must
    // surface as a 404, not an FK violation.
    const [existing] = await tx.select({ id: s.shipments.id })
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');

    const current = await tx.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipmentId));
    const existingIds = new Set(current.map(r => r.id));
    const incomingIds = new Set(containers.filter(c => c.id).map(c => c.id as number));

    const toDelete = [...existingIds].filter(id => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await tx.delete(s.shipmentContainers)
        .where(inArray(s.shipmentContainers.id, toDelete));
    }

    const upserted: Array<{ id: number }> = [];
    for (const c of containers) {
      const payload = {
        shipmentId,
        containerTypeId: c.containerTypeId ?? null,
        containerNumber: c.containerNumber?.trim() || null,
        sealNumber: c.sealNumber?.trim() || null,
        cargoWeightKg: c.cargoWeightKg != null ? String(c.cargoWeightKg) : null,
        notes: c.notes ?? null,
        updatedAt: new Date(),
      };
      if (c.id && existingIds.has(c.id)) {
        const [updated] = await tx.update(s.shipmentContainers)
          .set(payload)
          .where(eq(s.shipmentContainers.id, c.id))
          .returning({ id: s.shipmentContainers.id });
        if (updated) upserted.push(updated);
      } else {
        const [inserted] = await tx.insert(s.shipmentContainers)
          .values({ ...payload, createdBy: userId })
          .returning({ id: s.shipmentContainers.id });
        if (inserted) upserted.push(inserted);
      }
    }

    // Bump the shipment's version so any open editor is told to reload — the
    // container set is part of the shipment's editable surface.
    await tx.update(s.shipments)
      .set({ version: sql`${s.shipments.version} + 1`, updatedAt: new Date() })
      .where(eq(s.shipments.id, shipmentId));

    return upserted;
  });
}

// ─── Document attach ────────────────────────────────────────────────────────
//
// The file bytes themselves are uploaded separately via `/api/upload` (the same
// path trip photos use); this endpoint records the metadata row that references
// the resulting `storageKey`. Multipart upload is a Wave 2 portal concern.

export async function attachShipmentDocument(
  shipmentId: number,
  input: { type: typeof s.shipmentDocuments.type.enumValues[number]; storageKey: string; uploadedBy?: number | null },
) {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: s.shipments.id })
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');

    const [doc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId,
      type: input.type,
      storageKey: input.storageKey,
      uploadedBy: input.uploadedBy ?? null,
    }).returning();
    return doc;
  });
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
    fuelMode?: import('@tingting/shared').FuelMode;
  },
  actor: { userId: number; role: import('@tingting/shared').Role },
) {
  // 1. Read the shipment (404 if missing). No `FOR UPDATE` — the partial
  //    unique index `trips_shipment_id_live_uniq` is the concurrency guard.
  const [shipment] = await db.select()
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  // M3.2: check for expired DO (Delivery Order) documents before dispatch.
  // An expired DO blocks dispatch — the operator must upload a renewed DO.
  const expiredDocs = await checkExpiredDocuments(shipmentId);
  if (expiredDocs.length > 0) {
    throw new ApiError(
      409,
      `Lệnh giao hàng (D/O) đã hết hạn. Vui lòng tải lên D/O mới.`,
    );
  }

  // 2. Idempotent short-circuit FIRST: a live (non-CANCELED) trip is already
  //    linked → return it with `created: false`, regardless of the shipment's
  //    current status. This makes a retry after a successful dispatch safe
  //    (the shipment is now IN_PROGRESS, which would otherwise trip the
  //    DRAFT-only precondition below).
  const [existingLiveTrip] = await db.select()
    .from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipmentId),
      sql`${s.trips.status} <> 'CANCELED'`,
    ))
    .limit(1);
  if (existingLiveTrip) {
    return { trip: existingLiveTrip, created: false as const };
  }

  // 3. No existing live trip — this is a fresh dispatch. Require DRAFT: a
  //    CANCELED shipment cannot be dispatched, and a shipment already advanced
  //    past DRAFT without a linked trip is in an inconsistent state we refuse
  //    to paper over. (Re-dispatch after a cancel-and-re-open is a future
  //    Wave 2 audit-reason flow; for now the only way forward is a new
  //    shipment.)
  if (shipment.status !== 'DRAFT') {
    throw new ApiError(
      409,
      `Không thể điều vận lô hàng ở trạng thái "${shipment.status}".`,
    );
  }

  // 3. Create the trip via the canonical command (handles pricing lookup,
  //    notification, cache invalidation). Customer comes from the shipment.
  //    `createTripCommand` manages its own transaction; the trip's
  //    `shipmentId` is NULL on insert, so this never trips the unique index.
  const trip = await createTripCommand({
    customerId: shipment.customerId,
    routeId: fulfillment.routeId,
    cargoTypeId: fulfillment.cargoTypeId,
    containerTypeId: fulfillment.containerTypeId,
    truckId: fulfillment.truckId ?? null,
    driverId: fulfillment.driverId ?? null,
    departureDate: fulfillment.departureDate,
    customerReference: fulfillment.customerReference,
    containerCount: fulfillment.containerCount,
    fuelMode: fulfillment.fuelMode,
    createdBy: actor.userId,
  }, { userId: actor.userId, role: actor.role });

  // 4. Link + snapshot + transition in one tx. The UPDATE on trips.shipmentId
  //    is the concurrency pinch point: if a concurrent dispatch already linked
  //    a different trip, this UPDATE fails the partial unique index (23505).
  //    We catch that, clean up the orphan trip we just created, and return the
  //    winner's trip.
  try {
    await db.transaction(async (tx) => {
      await tx.update(s.trips)
        .set({ shipmentId })
        .where(eq(s.trips.id, trip.id));

      await snapshotContainersIntoTrip(shipmentId, trip.id, actor.userId, tx);

      // Move shipment DRAFT → IN_PROGRESS. Guarded by `status = 'DRAFT'` so a
      // concurrent status change can't double-advance; if zero rows match,
      // the shipment was changed out from under us and we surface a 409.
      const [updated] = await tx.update(s.shipments)
        .set({ status: 'IN_PROGRESS', version: sql`${s.shipments.version} + 1`, updatedAt: new Date() })
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
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Concurrent dispatch won. Clean up the orphan trip we just created so
      // it doesn't pollute reporting / tripCode sequencing, then return the
      // winner's trip with `created: false`.
      await db.delete(s.trips).where(eq(s.trips.id, trip.id)).catch(() => {});
      const [winner] = await db.select()
        .from(s.trips)
        .where(and(
          eq(s.trips.shipmentId, shipmentId),
          sql`${s.trips.status} <> 'CANCELED'`,
        ))
        .limit(1);
      if (winner) return { trip: winner, created: false as const };
    }
    throw err;
  }

  // 5. Reload to pick up the link for the response (snapshot fields etc.).
  const [finalTrip] = await db.select().from(s.trips).where(eq(s.trips.id, trip.id)).limit(1);

  // Shipment status change affects AR/AP aging reports (a trip now exists).
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
    cacheInvalidatePattern('reports:entity-results:*'),
  ]).catch((err: unknown) => console.warn(
    '[cache] dispatch invalidate failed', { shipmentId, err },
  ));

  return { trip: finalTrip ?? trip, created: true as const };
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
export async function checkExpiredDocuments(shipmentId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const docs = await db.select()
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

/**
 * M3.2: Replace a shipment document with a new version. The old document is
 * NOT deleted — its `replacedBy` is set to the new document's id, preserving
 * the full audit history. The new document inherits the old one's type and
 * can have a new expiry date.
 */
export async function replaceShipmentDocument(
  oldDocId: number,
  newDocData: { storageKey: string; expiresAt?: string | null; uploadedBy?: number | null },
) {
  return await db.transaction(async (tx) => {
    // 1. Fetch the old document to inherit type + shipmentId.
    const [oldDoc] = await tx.select()
      .from(s.shipmentDocuments)
      .where(eq(s.shipmentDocuments.id, oldDocId))
      .limit(1);
    if (!oldDoc) throw new ApiError(404, 'Không tìm thấy tài liệu cần thay thế');

    // 2. Insert the new document.
    const [newDoc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId: oldDoc.shipmentId,
      type: oldDoc.type,
      storageKey: newDocData.storageKey,
      expiresAt: newDocData.expiresAt ?? null,
      uploadedBy: newDocData.uploadedBy ?? null,
    }).returning();

    // 3. Mark the old document as replaced.
    await tx.update(s.shipmentDocuments)
      .set({ replacedBy: newDoc.id })
      .where(eq(s.shipmentDocuments.id, oldDocId));

    return newDoc;
  });
}
