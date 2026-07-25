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
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

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
  if (from === to) return; // Idempotent short-circuit (caller still records history? no — see transition)
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
  options: { deletedBy?: number | null; version: number } = { version: 0 },
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
