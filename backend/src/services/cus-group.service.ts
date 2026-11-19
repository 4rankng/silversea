// Nhóm CUS — CRUD cho tính năng "tạo nhóm + thêm thành viên" (team-based
// visibility cho vai CUS). Luật hiển thị nằm ở cus-visibility.service.ts;
// service này chỉ quản lý nhóm + thành viên. Mount: routes/auth.ts, ADMIN
// only — cùng gate với business-units (canManageBusinessUnits).
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Executor, type Tx } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';

export interface CusGroupMemberView {
  userId: number;
  name: string | null;
  username: string | null;
  status: string;
}

export interface CusGroupView {
  id: number;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  members: CusGroupMemberView[];
}

async function assertGroupNameAvailable(executor: Tx | typeof db, name: string, excludeId?: number) {
  const [conflict] = await executor.select({ id: s.cusGroups.id })
    .from(s.cusGroups)
    .where(excludeId != null
      ? and(eq(sql`btrim(lower(${s.cusGroups.name}))`, sql`btrim(lower(${name}))`), sql`${s.cusGroups.id} <> ${excludeId}`)
      : eq(sql`btrim(lower(${s.cusGroups.name}))`, sql`btrim(lower(${name}))`))
    .limit(1);
  if (conflict) throw new ApiError(409, 'Tên nhóm đã tồn tại', undefined, { code: 'DUPLICATE_CODE' });
}

async function assertCusGroupId(executor: Tx | typeof db, id: number) {
  const [group] = await executor.select()
    .from(s.cusGroups)
    .where(eq(s.cusGroups.id, id))
    .for('update')
    .limit(1);
  if (!group) throw new ApiError(404, 'Không tìm thấy nhóm CUS');
  return group;
}

/**
 * The ACTIVE nhóm CUS a user belongs to — the /auth/me session letter (AC1,
 * ticket 18/11): FE reads it to know team visibility may widen the
 * workboard. Same ACTIVE-group join law as cusGroupMemberIds
 * (cus-visibility.service.ts), projected to the bare {id, name} pair.
 */
export async function listActiveCusGroupsForUser(
  userId: number,
  executor: Executor = db,
): Promise<{ id: number; name: string }[]> {
  return executor.select({
    id: s.cusGroups.id,
    name: s.cusGroups.name,
  }).from(s.cusGroupMembers)
    .innerJoin(s.cusGroups, eq(s.cusGroups.id, s.cusGroupMembers.groupId))
    .where(and(
      eq(s.cusGroupMembers.userId, userId),
      eq(s.cusGroups.status, 'ACTIVE'),
    ))
    .orderBy(asc(s.cusGroups.name), asc(s.cusGroups.id));
}

export async function listCusGroups(): Promise<CusGroupView[]> {
  const groups = await db.select()
    .from(s.cusGroups)
    .orderBy(asc(s.cusGroups.name));
  if (groups.length === 0) return [];
  const memberRows = await db.select({
    groupId: s.cusGroupMembers.groupId,
    userId: s.users.id,
    name: s.users.fullName,
    username: s.users.username,
    status: s.users.status,
  }).from(s.cusGroupMembers)
    .innerJoin(s.users, eq(s.users.id, s.cusGroupMembers.userId))
    .where(inArray(s.cusGroupMembers.groupId, groups.map((group) => group.id)))
    .orderBy(asc(s.cusGroupMembers.id));
  const membersByGroup = new Map<number, CusGroupMemberView[]>();
  for (const row of memberRows) {
    const list = membersByGroup.get(row.groupId) ?? [];
    list.push({ userId: row.userId, name: row.name, username: row.username, status: row.status });
    membersByGroup.set(row.groupId, list);
  }
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    status: group.status,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: membersByGroup.get(group.id) ?? [],
  }));
}

export async function createCusGroup(input: { name: string }, executor: Executor = db): Promise<CusGroupView> {
  const name = input.name.trim();
  return executor.transaction(async (tx) => {
    await assertGroupNameAvailable(tx, name);
    const [created] = await tx.insert(s.cusGroups).values({ name }).returning();
    return { ...created, members: [] };
  });
}

export async function updateCusGroup(
  id: number,
  input: { name?: string; status?: 'ACTIVE' | 'INACTIVE' },
  executor: Executor = db,
): Promise<CusGroupView> {
  return executor.transaction(async (tx) => {
    const existing = await assertCusGroupId(tx, id);
    const nextName = input.name !== undefined ? input.name.trim() : existing.name;
    if (nextName !== existing.name) await assertGroupNameAvailable(tx, nextName, id);
    const [updated] = await tx.update(s.cusGroups)
      .set({
        name: nextName,
        status: input.status ?? existing.status,
        updatedAt: sql`now()`,
      })
      .where(eq(s.cusGroups.id, id))
      .returning();
    return { ...updated, members: await loadMemberViews(tx, id) };
  });
}

async function loadMemberViews(executor: Tx, groupId: number): Promise<CusGroupMemberView[]> {
  const rows = await executor.select({
    userId: s.users.id,
    name: s.users.fullName,
    username: s.users.username,
    status: s.users.status,
  }).from(s.cusGroupMembers)
    .innerJoin(s.users, eq(s.users.id, s.cusGroupMembers.userId))
    .where(eq(s.cusGroupMembers.groupId, groupId))
    .orderBy(asc(s.cusGroupMembers.id));
  return rows;
}

/**
 * Replace-all membership editor (the UI's multi-select saves the full set).
 * Only ACTIVE users with role CUS may join — a deactivated or non-CUS user
 * would silently widen (or break the visibility semantics of) the group.
 * Membership links of deactivated users are KEPT once saved: the group still
 * sees a departed member's historical lots (visibility law, not this editor).
 */
export async function setCusGroupMembers(groupId: number, userIds: number[], executor: Executor = db): Promise<CusGroupView> {
  const requested = [...new Set(userIds)];
  return executor.transaction(async (tx) => {
    await assertCusGroupId(tx, groupId);
    if (requested.length > 0) {
      const rows = await tx.select({ id: s.users.id, role: s.users.role, status: s.users.status })
        .from(s.users)
        .where(inArray(s.users.id, requested));
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const userId of requested) {
        const user = byId.get(userId);
        if (!user || user.role !== Role.CUS || user.status !== 'ACTIVE') {
          throw new ApiError(400, 'Chỉ được thêm người dùng vai CUS đang hoạt động');
        }
      }
    }
    await tx.delete(s.cusGroupMembers).where(eq(s.cusGroupMembers.groupId, groupId));
    if (requested.length > 0) {
      await tx.insert(s.cusGroupMembers).values(requested.map((userId) => ({ groupId, userId })));
    }
    const group = await tx.select()
      .from(s.cusGroups)
      .where(eq(s.cusGroups.id, groupId))
      .limit(1);
    return { ...group[0], members: await loadMemberViews(tx, groupId) };
  });
}
