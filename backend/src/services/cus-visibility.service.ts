// Team-based visibility for the CUS role (lô hàng + debit scoping).
//
// ONE law for every CUS row-visibility decision in the system:
//   1. lô do chính mình tạo               (shipments.created_by = actor)
//   2. lô do người cùng NHÓM ACTIVE tạo   (cus_groups / cus_group_members)
//   3. lô không rõ người tạo              (created_by IS NULL)
//   4. lô do người KHÔNG phải vai CUS tạo (dispatcher/admin/manager...) —
//      fallback vận hành: mọi CUS thấy.
// ADMIN / MANAGER / ACCOUNTANT / DISPATCHER and non-CUS roles are NEVER
// scoped — they keep seeing everything (ruling 18/11: giám đốc xem hết).
//
// Scope resolves from the DB on every request (no token change): gán nhóm có
// hiệu lực ngay ở request kế tiếp, không cần đăng nhập lại.
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as s from '../db/schema';
import { db, type Executor } from '../db';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { ApiError } from '../errors';

/** The narrow actor shape the visibility law reads — every caller
 * (full AuthUser tokens, service-level Picks) satisfies it structurally. */
type VisibilityActor = Pick<AuthUser, 'userId' | 'role'>;

export const CUS_LOT_NOT_FOUND_MESSAGE = 'Không tìm thấy lô hàng';

/**
 * Pure arm builder — the four WHERE branches above on `shipments.created_by`.
 * `memberIds` is the actor's ACTIVE-group co-members (empty = arm 2 drops).
 * Non-CUS roles get `[]` (no scoping at all).
 */
export function cusVisibilityArms(actor: VisibilityActor, memberIds: number[]): SQL[] {
  if (actor.role !== Role.CUS) return [];
  const arms: SQL[] = [
    eq(s.shipments.createdBy, actor.userId),
    isNull(s.shipments.createdBy),
    // Fallback 4: created by a dispatcher/admin/manager (non-CUS creator) —
    // `not in` over the CUS user ids; a creator id missing from `users`
    // (deleted account) matches this arm too, like the SQL subquery.
    sql`${s.shipments.createdBy} not in (select id from users where role = 'CUS')`,
  ];
  if (memberIds.length > 0) {
    arms.splice(1, 0, inArray(s.shipments.createdBy, memberIds));
  }
  return [or(...arms)!];
}

/**
 * The actor's co-members across every ACTIVE group they belong to. A
 * deactivated USER keeps their membership links, so a group still sees a
 * departed member's historical lots (intentional — the lots predate the exit).
 */
export async function cusGroupMemberIds(executor: Executor, userId: number): Promise<number[]> {
  const mine = alias(s.cusGroupMembers, 'cus_group_members_mine');
  const peers = alias(s.cusGroupMembers, 'cus_group_members_peers');
  const rows = await executor.select({ userId: peers.userId })
    .from(mine)
    .innerJoin(peers, eq(peers.groupId, mine.groupId))
    .innerJoin(s.cusGroups, eq(s.cusGroups.id, mine.groupId))
    .where(and(
      eq(mine.userId, userId),
      eq(s.cusGroups.status, 'ACTIVE'),
    ));
  const ids = [...new Set(rows.map((row) => row.userId).filter((id) => id !== userId))];
  ids.sort((a, b) => a - b);
  return ids;
}

/**
 * WHERE conditions for CUS row visibility on any `shipments`-rooted query.
 * Resolves group membership from the DB each call, so membership edits apply
 * on the next request without re-login.
 */
export async function cusVisibilityCondition(executor: Executor, actor: VisibilityActor): Promise<SQL[]> {
  if (actor.role !== Role.CUS) return [];
  const memberIds = await cusGroupMemberIds(executor, actor.userId);
  return cusVisibilityArms(actor, memberIds);
}

/**
 * Pure per-lot decision shared with `assertCusLotVisible` (unit-testable
 * without a database): does a CUS actor see the lot with this creator?
 * `creatorRole` is null when the creator row is gone (treated as non-CUS —
 * arm 4 semantics).
 */
export function cusLotVisibleFor(
  actor: VisibilityActor,
  memberIds: number[],
  createdBy: number | null,
  creatorRole: string | null,
): boolean {
  if (actor.role !== Role.CUS) return true;
  if (createdBy == null) return true;
  if (createdBy === actor.userId) return true;
  if (memberIds.includes(createdBy)) return true;
  return creatorRole == null || creatorRole !== Role.CUS;
}

/**
 * Per-lot guard for every CUS-reachable endpoint that takes a shipment id.
 * Non-CUS roles pass unconditionally. A CUS actor who may not see the lot
 * gets the same 404 as a missing lot — the response never reveals that the
 * lot exists. Executor is optional-last per the house convention so routes
 * never import db just to pass it back.
 */
export async function assertCusLotVisible(
  shipmentId: number,
  actor: VisibilityActor,
  executor: Executor = db,
): Promise<void> {
  if (actor.role !== Role.CUS) return;
  const [row] = await executor.select({
    createdBy: s.shipments.createdBy,
  }).from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(404, CUS_LOT_NOT_FOUND_MESSAGE);
  let creatorRole: string | null = null;
  if (row.createdBy != null) {
    const [creator] = await executor.select({ role: s.users.role })
      .from(s.users)
      .where(eq(s.users.id, row.createdBy))
      .limit(1);
    creatorRole = creator?.role ?? null;
  }
  if (cusLotVisibleFor(actor, await cusGroupMemberIds(executor, actor.userId), row.createdBy, creatorRole)) {
    return;
  }
  throw new ApiError(404, CUS_LOT_NOT_FOUND_MESSAGE);
}

/**
 * Trip-scoped variant: resolves `trips.shipment_id` first, then applies the
 * per-lot law. A missing trip or a trip without a lot is left to the
 * endpoint's own 404 semantics — the guard never widens an error.
 */
export async function assertCusTripVisible(
  tripId: number,
  actor: VisibilityActor,
  executor: Executor = db,
): Promise<void> {
  if (actor.role !== Role.CUS) return;
  const [row] = await executor.select({ shipmentId: s.trips.shipmentId })
    .from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  if (!row || row.shipmentId == null) return;
  await assertCusLotVisible(row.shipmentId, actor, executor);
}

/** Fulfillment-scoped variant (dispatch planning complete-external). */
export async function assertCusFulfillmentVisible(
  fulfillmentId: number,
  actor: VisibilityActor,
  executor: Executor = db,
): Promise<void> {
  if (actor.role !== Role.CUS) return;
  const [row] = await executor.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(eq(s.shipmentFulfillments.id, fulfillmentId))
    .limit(1);
  if (!row) return;
  await assertCusLotVisible(row.shipmentId, actor, executor);
}

/**
 * LCL whole-group variant: every live member lot of the COST/REV group must
 * be visible to the CUS actor (tách nhóm/gán BKS acts on all members).
 */
export async function assertCusLclGroupMembersVisible(
  groupId: string,
  dimension: 'COST' | 'REV',
  actor: VisibilityActor,
  executor: Executor = db,
): Promise<void> {
  if (actor.role !== Role.CUS) return;
  const column = dimension === 'COST' ? s.shipments.costGroupId : s.shipments.revGroupId;
  const rows = await executor.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(and(isNull(s.shipments.deletedAt), eq(column, groupId)));
  for (const row of rows) {
    await assertCusLotVisible(row.id, actor, executor);
  }
}

/**
 * Guard for consolidated billing documents (debit note gộp): a CUS actor may
 * open a document only while AT LEAST ONE underlying lot is visible to them.
 * A document with no lot links stays visible (consistent with fallback 3/4).
 */
export async function assertCusBillingDocumentVisible(
  documentId: number,
  actor: VisibilityActor,
  executor: Executor = db,
): Promise<void> {
  if (actor.role !== Role.CUS) return;
  const memberIds = await cusGroupMemberIds(executor, actor.userId);
  const arms = cusVisibilityArms(actor, memberIds);
  const linkedLotExists = sql`exists (
    select 1
    from ${s.shipmentAccountingLocks}
    join ${s.shipments} on ${s.shipments.id} = ${s.shipmentAccountingLocks.shipmentId}
    where ${s.shipmentAccountingLocks.billingDocumentId} = ${s.billingDocuments.id}
  )`;
  const visibleLotExists = sql`exists (
    select 1
    from ${s.shipmentAccountingLocks}
    join ${s.shipments} on ${s.shipments.id} = ${s.shipmentAccountingLocks.shipmentId}
    where ${s.shipmentAccountingLocks.billingDocumentId} = ${s.billingDocuments.id}
      and ${or(...arms)}
  )`;
  const [row] = await executor.select({
    id: s.billingDocuments.id,
    hasLinkedLots: linkedLotExists.as('has_linked_lots'),
    hasVisibleLot: visibleLotExists.as('has_visible_lot'),
  })
    .from(s.billingDocuments)
    .where(eq(s.billingDocuments.id, documentId))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy chứng từ');
  // No underlying lot linked (AP statements, emptied docs) → visible to every
  // CUS, consistent with the NULL/non-CUS-creator fallbacks.
  if (!row.hasLinkedLots || row.hasVisibleLot) return;
  throw new ApiError(404, 'Không tìm thấy chứng từ');
}
