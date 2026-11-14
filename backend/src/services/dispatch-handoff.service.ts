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
 *     reason. One active handoff per shipment (UNSEEN/SEEN application guard).
 *   - Version-conflict detection: checkVersionConflict compares the
 *     handoff's snapshot version against the shipment's current version.
 *     If they diverge, the caller should warn the dispatcher
 *     ("phiên bản mới" — M10-03-03).
 *   - Notification: emitNotification on dispatch so the handler sees it.
 */
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { NotificationType, Role } from '@tingting/shared';
import { ApiError } from '../errors';
import { emitNotification } from './notification.service';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

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
 * SIL-817 systemic guard: a named handler must be a real, ACTIVE staff user
 * with a dispatch-capable role (the roles the resolve route admits). A
 * handler-less handoff is still allowed — clerk intake broadcasts to the
 * whole dispatch queue by design — but a WRONG handler must never be
 * written, or the 403 "Lệnh điều vận được giao cho nhân viên khác" wall
 * from markSeen/resolveHandoff locks every dispatcher out of the handoff.
 */
const HANDOFF_HANDLER_ROLES: readonly string[] = [Role.DISPATCHER, Role.ADMIN, Role.MANAGER];

async function assertHandoffHandlerEligible(handlerId: number, tx: Tx): Promise<void> {
  const [handler] = await tx.select({ id: s.users.id, role: s.users.role, status: s.users.status })
    .from(s.users)
    .where(eq(s.users.id, handlerId))
    .limit(1);
  if (!handler
      || !HANDOFF_HANDLER_ROLES.includes(handler.role as string)
      || handler.status !== 'ACTIVE') {
    throw new ApiError(400, 'Lệnh phát phải gắn người điều vận phụ trách: handler phải là nhân viên điều vận đang hoạt động.');
  }
}

/**
 * SIL-817 AC3b (id 946, QA fail 14/11 on build c230df97): Phát lệnh issued
 * the order (staging lô R3M-D2-A → handoff #668) while the lot's intake
 * handoff stayed UNSEEN with handler_id NULL — the exact strand the
 * stuck-trips watchlist flags as "UNSEEN — chưa có người phụ trách", and the
 * root of the PROD trip-13 wall this ticket opened with. The clerk intake
 * broadcast stays handler-less BY DESIGN (see the guard above); the moment a
 * dispatcher issues the order is the ownership moment, so the issue
 * transaction claims the ACTIVE (UNSEEN/SEEN) handoff for the issuing
 * dispatcher instead of asking for a dialog field nobody had.
 *
 * Row law (markSeen convention): only a handler-NULL row is claimed, under
 * FOR UPDATE, with the version bump + updatedAt — an owned handoff keeps its
 * owner (and a queue client holding a stale expectedVersion gets the normal
 * 409 "đã được cập nhật", never a silent re-own); ACCEPTED/REJECTED rows are
 * history and out of reach of the active filter. Caller passes
 * input.actor.userId — issueFulfillmentDispatchOrder's assertDispatchActor
 * already pins the actor to DISPATCHER/ADMIN/MANAGER, the same set
 * HANDOFF_HANDLER_ROLES admits, so no second eligibility lookup is needed.
 */
export async function claimHandlerlessDispatchHandoffInTx(
  tx: Tx,
  shipmentId: number,
  handlerId: number,
): Promise<boolean> {
  const [active] = await tx.select({ id: s.dispatchHandoffs.id })
    .from(s.dispatchHandoffs)
    .where(and(
      eq(s.dispatchHandoffs.shipmentId, shipmentId),
      sql`${s.dispatchHandoffs.status} IN ('UNSEEN', 'SEEN')`,
      isNull(s.dispatchHandoffs.handlerId),
    ))
    .limit(1)
    .for('update');
  if (!active) return false;
  const [claimed] = await tx.update(s.dispatchHandoffs)
    .set({
      handlerId,
      version: sql`${s.dispatchHandoffs.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(s.dispatchHandoffs.id, active.id), isNull(s.dispatchHandoffs.handlerId)))
    .returning({ id: s.dispatchHandoffs.id });
  return claimed != null;
}

/**
 * Create a new dispatch handoff for a shipment. The shipment must not
 * already have an active (UNSEEN/SEEN) handoff — enforced by an
 * application-owned lock and canonical lookup.
 */
export async function createHandoff(input: CreateHandoffInput) {
  const execute = async (tx: Tx) => {
    if (input.actor) {
      await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, { write: true });
    }
    if (input.handlerId != null) {
      await assertHandoffHandlerEligible(input.handlerId, tx);
    }
    await assertShipmentAccountingUnlocked(tx, input.shipmentId);
    await lockApplicationOwnedUniqueness(
      tx,
      'dispatch-handoff:active-shipment',
      [input.shipmentId],
    );
    // Locking the shipment makes the version snapshot and handoff insert one
    // authoritative operation.
    const [shipment] = await tx.select({ id: s.shipments.id, version: s.shipments.version, shipmentCode: s.shipments.shipmentCode })
      .from(s.shipments)
      .where(eq(s.shipments.id, input.shipmentId))
      .limit(1)
      .for('update');
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

    const [active] = await tx.select({ id: s.dispatchHandoffs.id })
      .from(s.dispatchHandoffs)
      .where(and(
        eq(s.dispatchHandoffs.shipmentId, input.shipmentId),
        sql`${s.dispatchHandoffs.status} IN ('UNSEEN', 'SEEN')`,
      ))
      .limit(1);
    if (active) {
      throw new ApiError(409, 'Lô hàng đã có lệnh điều vận đang xử lý. Vui lòng tải lại.');
    }

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
    const [target] = await tx.select({ shipmentId: s.dispatchHandoffs.shipmentId })
      .from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.id, handoffId))
      .limit(1);
    if (!target || (options.expectedShipmentId != null && target.shipmentId !== options.expectedShipmentId)) {
      throw new ApiError(404, 'Không tìm thấy lệnh điều vận');
    }
    await assertShipmentAccountingUnlocked(tx, target.shipmentId);
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
  return runInTx(options.transaction, execute);
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
    const [target] = await tx.select({ shipmentId: s.dispatchHandoffs.shipmentId })
      .from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.id, handoffId))
      .limit(1);
    if (!target || (options.expectedShipmentId != null && target.shipmentId !== options.expectedShipmentId)) {
      throw new ApiError(404, 'Không tìm thấy lệnh điều vận');
    }
    await assertShipmentAccountingUnlocked(tx, target.shipmentId);
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
      await lockApplicationOwnedUniqueness(
        tx,
        'dispatch-handoff:accepted-shipment',
        [existing.shipmentId],
      );
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
  return runInTx(options.transaction, execute);
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

/** Get the most recent handoff for shipment-facing lifecycle presentation. */
export async function getLatestHandoffForShipment(shipmentId: number) {
  const [row] = await db.select().from(s.dispatchHandoffs)
    .where(eq(s.dispatchHandoffs.shipmentId, shipmentId))
    .orderBy(desc(s.dispatchHandoffs.dispatchedAt), desc(s.dispatchHandoffs.id))
    .limit(1);
  return row ?? null;
}
