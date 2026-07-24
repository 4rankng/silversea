import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

interface AuditQueryParams {
  page: number;
  limit: number;
  category?: string;
  search?: string;
}

export async function queryAuditLogs(params: AuditQueryParams) {
  const { page, limit, category, search } = params;

  const conditions = [
    sql`coalesce(${s.auditLogs.payload}->>'event', '') != 'ACCESS_DENIED'`
  ];

  if (category) {
    if (category === 'trip') {
      conditions.push(sql`(${s.auditLogs.payload}->>'event' LIKE 'TRIP_%' OR ${s.auditLogs.payload}->>'event' = 'STATUS_CHANGED')`);
    } else if (category === 'finance') {
      conditions.push(sql`${s.auditLogs.payload}->>'event' IN ('PAYMENT_RECEIVED', 'ADJUSTMENT_CREATED', 'PROFIT_DISTRIBUTED')`);
    } else if (category === 'penalty') {
      conditions.push(sql`${s.auditLogs.payload}->>'event' = 'PENALTY_CREATED'`);
    } else if (category === 'auth') {
      conditions.push(sql`${s.auditLogs.payload}->>'event' IN ('USER_LOGIN', 'USER_LOGOUT')`);
    } else if (category === 'config') {
      conditions.push(sql`${s.auditLogs.payload}->>'event' IN ('ENTITY_CREATED', 'ENTITY_UPDATED', 'ENTITY_DELETED')`);
    }
  }

  if (search && search.trim()) {
    const searchPattern = `%${search.trim()}%`;
    conditions.push(sql`(${s.users.fullName} ILIKE ${searchPattern} OR ${s.users.username} ILIKE ${searchPattern} OR ${s.auditLogs.message} ILIKE ${searchPattern} OR ${s.auditLogs.payload}->>'event' ILIKE ${searchPattern})`);
  }

  const items = await db.select({
    id: s.auditLogs.id,
    timestamp: s.auditLogs.timestamp,
    userId: s.auditLogs.userId,
    userName: sql`COALESCE(${s.auditLogs.actorName}, ${s.users.fullName}, ${s.users.username})`,
    username: s.users.username,
    userDeletedAt: s.users.deletedAt,
    userIdExists: s.users.id,
    message: s.auditLogs.message,
    payload: s.auditLogs.payload,
    ipAddress: s.auditLogs.ipAddress,
  }).from(s.auditLogs)
    .leftJoin(s.users, eq(s.auditLogs.userId, s.users.id))
    .where(and(...conditions))
    .orderBy(desc(s.auditLogs.id))
    .limit(limit).offset((page - 1) * limit);

  const [countRow] = await db.select({ count: sql<number>`count(*)` })
    .from(s.auditLogs)
    .leftJoin(s.users, eq(s.auditLogs.userId, s.users.id))
    .where(and(...conditions));

  return {
    items: items.map(i => {
      let displayName = i.userName || i.username || 'Người dùng';
      const isDeleted = i.userDeletedAt !== null || (i.userId !== null && i.userIdExists === null);
      if (isDeleted) {
        displayName = `${displayName} (Đã xóa)`;
      }
      return {
        id: i.id,
        userId: i.userId,
        userName: displayName,
        action: (typeof i.payload?.event === 'string' ? i.payload.event : '') || '',
        method: (typeof i.payload?.method === 'string' ? i.payload.method : '') || '',
        path: (typeof i.payload?.path === 'string' ? i.payload.path : '') || '',
        message: i.message,
        timestamp: i.timestamp,
        payload: i.payload,
        ipAddress: i.ipAddress,
      };
    }),
    total: Number(countRow?.count ?? 0),
    page,
    pageSize: limit,
  };
}
