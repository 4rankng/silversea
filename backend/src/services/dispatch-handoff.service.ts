/**
 * Wave 4 M10.3 — dispatch handoff service.
 *
 * Manages the lifecycle of a shipment handoff from clerk to dispatcher
 * (điều vận). The handoff flows: UNSEEN → SEEN → ACCEPTED | REJECTED.
 *
 * Key features (per M10-03 spec):
 *   - createHandoff: creates an UNSEEN handoff with the shipment's
 *     current version snapshot for conflict detection.
 *   - markSeen: transitions UNSEEN → SEEN (dispatcher opened it).
 *   - resolveHandoff: transitions to ACCEPTED or REJECTED with a
 *     reason. One active handoff per shipment (UNSEEN/SEEN unique index).
 *   - Version-conflict detection: checkVersionConflict compares the
 *     handoff's snapshot version against the shipment's current version.
 *     If they diverge, the caller should warn the dispatcher
 *     ("phiên bản mới" — M10-03-03).
 *   - Notification: emitNotification on dispatch so the handler sees it.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NotificationType } from '@tingting/shared';
import { ApiError } from '../errors';
import { emitNotification } from './notification.service';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { assertActorCanAccessShipment } from './shipment-coordination.service';

export type HandoffStatus = 'UNSEEN' | 'SEEN' | 'ACCEPTED' | 'REJECTED';

export interface CreateHandoffInput {
  shipmentId: number;
  handlerId?: number | null;
  priority?: string;
  vehicleNeededBy?: Date | null;
  operationalNote?: string | null;
  createdBy: number;
  actor?: AuthUser;
  transaction?: Tx;
}

export interface HandoffVersionCheck {
  hasConflict: boolean;
  handoffVersion: number;
  currentVersion: number;
}

/**
 * Create a new dispatch handoff for a shipment. The shipment must not
 * already have an active (UNSEEN/SEEN) handoff — enforced by the partial
 * unique index.
 */
export async function createHandoff(input: CreateHandoffInput) {
  const execute = async (tx: Tx) => {
    if (input.actor) {
      await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
    }
    // Locking the shipment makes the version snapshot and handoff insert one
    // authoritative operation.
    const [shipment] = await tx.select({ id: s.shipments.id, version: s.shipments.version, shipmentCode: s.shipments.shipmentCode })
      .from(s.shipments)
      .where(eq(s.shipments.id, input.shipmentId))
      .limit(1)
      .for('update');
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

    const [handoff] = await tx.insert(s.dispatchHandoffs).values({
      shipmentId: input.shipmentId,
      handlerId: input.handlerId ?? null,
      priority: input.priority ?? 'NORMAL',
      vehicleNeededBy: input.vehicleNeededBy ?? null,
      operationalNote: input.operationalNote ?? null,
      status: 'UNSEEN',
      handoffVersion: shipment.version,
      createdBy: input.createdBy,
    }).returning();
    return { handoff, shipment };
  };
  const { handoff, shipment } = input.transaction
    ? await execute(input.transaction)
    : await db.transaction(execute);

  // Emit notification to the handler (or all dispatchers if unassigned).
  emitNotification({
    type: NotificationType.SHIPMENT_HANDOFF,
    title: 'Lô hàng mới cần điều vận',
    message: `Lô ${shipment.shipmentCode ?? 'chưa có mã'} đã được giao cho điều vận`,
    relatedEntityType: 'shipments',
    relatedEntityId: shipment.id,
    targetUserId: input.handlerId ?? undefined,
  });

  return handoff;
}

/**
 * Mark a handoff as SEEN (the dispatcher opened it). Only valid on
 * UNSEEN handoffs — idempotent on SEEN (no-op).
 */
export async function markSeen(
  handoffId: number,
  options: { actorId?: number; expectedVersion?: number; expectedShipmentId?: number; transaction?: Tx } = {},
) {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.id, handoffId)).limit(1).for('update');
    if (!existing || (options.expectedShipmentId != null && existing.shipmentId !== options.expectedShipmentId)) {
      throw new ApiError(404, 'Không tìm thấy lệnh điều vận');
    }
    if (options.expectedVersion != null && existing.version !== options.expectedVersion) {
      throw new ApiError(409, 'Lệnh điều vận đã được cập nhật. Vui lòng tải lại.');
    }
    if (options.actorId != null && existing.handlerId != null && existing.handlerId !== options.actorId) {
      throw new ApiError(403, 'Lệnh điều vận được giao cho nhân viên khác');
    }
    if (existing.status === 'SEEN') return existing;
    if (existing.status !== 'UNSEEN') {
      throw new ApiError(400, `Không thể xem lệnh đang ở ${existing.status}`);
    }

    const [updated] = await tx.update(s.dispatchHandoffs)
      .set({
        status: 'SEEN',
        seenAt: new Date(),
        version: sql`${s.dispatchHandoffs.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.dispatchHandoffs.id, handoffId),
        eq(s.dispatchHandoffs.status, 'UNSEEN'),
      ))
      .returning();
    if (!updated) throw new ApiError(409, 'Lệnh điều vận đã được người khác xử lý');
    return updated;
  };
  return options.transaction ? execute(options.transaction) : db.transaction(execute);
}

/**
 * Resolve a handoff: ACCEPTED (dispatcher took ownership) or REJECTED
 * (with reason). Only valid on UNSEEN or SEEN handoffs.
 */
export async function resolveHandoff(
  handoffId: number,
  resolution: 'ACCEPTED' | 'REJECTED',
  actorId: number,
  expectedVersion: number,
  options: { rejectReason?: string | null; expectedShipmentId?: number; transaction?: Tx } = {},
) {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.id, handoffId)).limit(1).for('update');
    if (!existing || (options.expectedShipmentId != null && existing.shipmentId !== options.expectedShipmentId)) {
      throw new ApiError(404, 'Không tìm thấy lệnh điều vận');
    }
    if (existing.version !== expectedVersion) {
      throw new ApiError(409, 'Lệnh điều vận đã được cập nhật. Vui lòng tải lại.');
    }
    if (existing.status === 'ACCEPTED' || existing.status === 'REJECTED') {
      throw new ApiError(409, `Lệnh đã kết thúc ở ${existing.status}`);
    }
    if (existing.handlerId != null && existing.handlerId !== actorId) {
      throw new ApiError(403, 'Lệnh điều vận được giao cho nhân viên khác');
    }
    const rejectReason = options.rejectReason?.trim() || null;
    if (resolution === 'REJECTED' && !rejectReason) {
      throw new ApiError(400, 'Lý do từ chối là bắt buộc khi từ chối lệnh điều vận');
    }

    const now = new Date();
    let supersedesHandoffId: number | null = null;
    if (resolution === 'ACCEPTED') {
      const [previousAccepted] = await tx.select().from(s.dispatchHandoffs)
        .where(and(
          eq(s.dispatchHandoffs.shipmentId, existing.shipmentId),
          eq(s.dispatchHandoffs.status, 'ACCEPTED'),
          sql`${s.dispatchHandoffs.supersededAt} is null`,
        ))
        .orderBy(desc(s.dispatchHandoffs.resolvedAt))
        .limit(1)
        .for('update');
      if (previousAccepted) {
        supersedesHandoffId = previousAccepted.id;
        await tx.update(s.dispatchHandoffs).set({
          supersededAt: now,
          version: sql`${s.dispatchHandoffs.version} + 1`,
          updatedAt: now,
        }).where(and(
          eq(s.dispatchHandoffs.id, previousAccepted.id),
          eq(s.dispatchHandoffs.version, previousAccepted.version),
          sql`${s.dispatchHandoffs.supersededAt} is null`,
        ));
      }
    }

    const [updated] = await tx.update(s.dispatchHandoffs)
      .set({
        status: resolution,
        resolvedAt: now,
        acceptedBy: resolution === 'ACCEPTED' ? actorId : null,
        supersedesHandoffId,
        rejectReason: resolution === 'REJECTED' ? rejectReason : null,
        version: sql`${s.dispatchHandoffs.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(s.dispatchHandoffs.id, handoffId),
        eq(s.dispatchHandoffs.version, expectedVersion),
        sql`${s.dispatchHandoffs.status} IN ('UNSEEN', 'SEEN')`,
      ))
      .returning();
    if (!updated) throw new ApiError(409, 'Lệnh điều vận đã được người khác xử lý');
    return updated;
  };
  return options.transaction ? execute(options.transaction) : db.transaction(execute);
}

/**
 * Check for a version conflict: has the shipment been edited since the
 * handoff was created? Returns hasConflict=true when the shipment's
 * current version differs from the snapshot taken at handoff time.
 *
 * Per M10-03-03: "Nếu dữ liệu bị sửa trong lúc điều vận đang xem, phải
 * cảnh báo có phiên bản mới".
 */
export async function checkVersionConflict(handoffId: number): Promise<HandoffVersionCheck> {
  const [handoff] = await db.select({
    handoffVersion: s.dispatchHandoffs.handoffVersion,
    shipmentId: s.dispatchHandoffs.shipmentId,
  })
    .from(s.dispatchHandoffs)
    .where(eq(s.dispatchHandoffs.id, handoffId))
    .limit(1);
  if (!handoff) throw new ApiError(404, 'Không tìm thấy lệnh điều vận');

  const [shipment] = await db.select({ version: s.shipments.version })
    .from(s.shipments)
    .where(eq(s.shipments.id, handoff.shipmentId))
    .limit(1);

  const currentVersion = shipment?.version ?? 0;
  return {
    hasConflict: currentVersion !== handoff.handoffVersion,
    handoffVersion: handoff.handoffVersion,
    currentVersion,
  };
}

/** Get the active handoff for a shipment (UNSEEN or SEEN), or null. */
export async function getActiveHandoffForShipment(shipmentId: number) {
  const [row] = await db.select().from(s.dispatchHandoffs)
    .where(and(
      eq(s.dispatchHandoffs.shipmentId, shipmentId),
      sql`${s.dispatchHandoffs.status} IN ('UNSEEN', 'SEEN')`,
    ))
    .limit(1);
  return row ?? null;
}

/** List handoffs, optionally filtered by handler or status. */
export async function listHandoffs(opts: {
  handlerId?: number;
  status?: HandoffStatus;
} = {}) {
  const conditions = [];
  if (opts.handlerId) conditions.push(eq(s.dispatchHandoffs.handlerId, opts.handlerId));
  if (opts.status) conditions.push(eq(s.dispatchHandoffs.status, opts.status));
  const query = db.select().from(s.dispatchHandoffs);
  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(s.dispatchHandoffs.dispatchedAt))
    : query.orderBy(desc(s.dispatchHandoffs.dispatchedAt));
}
