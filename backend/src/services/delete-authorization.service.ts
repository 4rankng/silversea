// O2C session-scoped delete rules with accountant-approval undeletable exception.
// docs/prd/O2C dev.md, 01/08/2026. plan: 260801-2200 phase-03.
//
// The matrix keys off `approvedAt IS NOT NULL` (a real approval action), NOT
// `approvalStatus` (which defaults to 'APPROVED' on tripExpenses for legacy
// rows and would make every historical expense undeletable).
//
// "Session" = user + server-side idle window from row.created_at (default 4h,
// configurable via app_settings). There is no sessions table — this is a new
// concept. An out-of-session delete by a non-owner/non-manager is routed to the
// delete-request queue instead of executing directly.

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

/** Default idle window (4h). Overridable via app_settings in a future follow-up. */
export const DEFAULT_IDLE_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface DeletableRow {
  id: number;
  createdAt: Date | null;
  createdBy: number | null;
  approvedAt: Date | null;
}

export interface DeleteActor {
  userId: number;
  role: string;
}

export type DeleteOutcome =
  | { allowed: true }
  | { allowed: false; reason: 'approved' | 'not_owner' | 'out_of_session' | 'forbidden'; message: string };

/**
 * Core delete-authorization matrix (O2C dev.md):
 *
 *   if row.approvedAt != null → only ADMIN/MANAGER may delete (real approval)
 *   if actor is ADMIN/MANAGER  → allowed (owners)
 *   if row.createdBy != actor   → forbidden (not yours)
 *   if (now - createdAt) <= idle → allowed (in-session)
 *   else                         → out_of_session (route to delete-request queue)
 */
export function canDelete(
  row: DeletableRow,
  actor: DeleteActor,
  now: Date,
  idleWindowMs: number = DEFAULT_IDLE_WINDOW_MS,
): DeleteOutcome {
  const isOwner = (actor.role === Role.ADMIN || actor.role === Role.MANAGER);
  // Accountant-approved rows are undeletable below Admin/MANAGER — in any session.
  if (row.approvedAt != null && !isOwner) {
    return {
      allowed: false,
      reason: 'approved',
      message: 'Chi phí đã được kế toán duyệt nên không thể xóa. Chỉ Quản lý hoặc Quản trị viên mới có quyền.',
    };
  }
  if (isOwner) {
    return { allowed: true };
  }
  if (row.createdBy != null && row.createdBy !== actor.userId) {
    return {
      allowed: false,
      reason: 'not_owner',
      message: 'Bạn chỉ có thể xóa chi phí do chính bạn tạo.',
    };
  }
  if (row.createdAt != null && (now.getTime() - row.createdAt.getTime()) <= idleWindowMs) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'out_of_session',
    message: 'Đã hết phiên làm việc để xóa trực tiếp. Vui lòng gửi yêu cầu xóa để Quản lý duyệt.',
  };
}

/**
 * Throw if the actor cannot delete the row. Call this at the top of every DELETE
 * endpoint for cost/evidence rows. Returns the outcome so the caller can route
 * an out_of_session result to the delete-request queue if desired.
 */
export function requireCanDelete(
  row: DeletableRow,
  actor: DeleteActor,
  now: Date = new Date(),
): void {
  const outcome = canDelete(row, actor, now);
  if (!outcome.allowed) {
    throw new ApiError(outcome.reason === 'forbidden' ? 403 : 409, outcome.message);
  }
}

export async function lockDeleteEntityScope(
  tx: Tx,
  entityType: string,
  entityId: number,
): Promise<void> {
  if (!entityType.trim() || !Number.isInteger(entityId) || entityId < 1) {
    throw new ApiError(400, 'Yêu cầu xóa không hợp lệ.');
  }
  await lockApplicationOwnedUniqueness(tx, 'delete-authorization.entity', [entityType, entityId]);
}

// ─── Delete-request queue ────────────────────────────────────────────────────

export async function createDeleteRequest(args: {
  entityType: string;
  entityId: number;
  requestedBy: number;
  reason?: string | null;
  transaction?: Tx;
}): Promise<void> {
  const insert = async (tx: Tx) => {
    await lockDeleteEntityScope(tx, args.entityType, args.entityId);
    const [existing] = await tx.select({ id: s.deleteRequests.id }).from(s.deleteRequests)
      .where(and(
        eq(s.deleteRequests.entityType, args.entityType),
        eq(s.deleteRequests.entityId, args.entityId),
        eq(s.deleteRequests.requestedBy, args.requestedBy),
        eq(s.deleteRequests.status, 'PENDING'),
      ))
      .limit(1)
      .for('update');
    if (existing) return;
    await tx.insert(s.deleteRequests).values({
      entityType: args.entityType,
      entityId: args.entityId,
      requestedBy: args.requestedBy,
      reason: args.reason ?? null,
      status: 'PENDING',
    });
  };
  if (args.transaction) {
    await insert(args.transaction);
  } else {
    await db.transaction(insert);
  }
}

export async function listPendingDeleteRequests() {
  return db.select().from(s.deleteRequests)
    .where(eq(s.deleteRequests.status, 'PENDING'))
    .orderBy(desc(s.deleteRequests.createdAt));
}

export async function reviewDeleteRequest(args: {
  requestId: number;
  approved: boolean;
  reviewerId: number;
  executor: (entityType: string, entityId: number, tx: Tx) => Promise<void>;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [req] = await tx.select().from(s.deleteRequests)
      .where(and(eq(s.deleteRequests.id, args.requestId), eq(s.deleteRequests.status, 'PENDING')))
      .for('update')
      .limit(1);
    if (!req) {
      throw new ApiError(404, 'Không tìm thấy yêu cầu xóa hoặc đã được xử lý.');
    }
    await lockDeleteEntityScope(tx, req.entityType, req.entityId);
    await tx.update(s.deleteRequests).set({
      status: args.approved ? 'APPROVED' : 'REJECTED',
      reviewedBy: args.reviewerId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(s.deleteRequests.id, req.id));
    if (args.approved) {
      await args.executor(req.entityType, req.entityId, tx);
    }
  });
}
