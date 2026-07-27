import { Role } from '@tingting/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';

interface AuditQueryParams {
  page: number;
  limit: number;
  category?: string;
  search?: string;
  viewer: {
    userId: number;
    role: Role;
  };
}

type AuditCategory = 'trip' | 'config' | 'finance' | 'auth' | 'penalty';

const AUDIT_VIEWER_ROLES = new Set([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);

const FINANCE_EXPLICIT_EVENTS = [
  'PAYMENT_RECEIVED',
  'ADJUSTMENT_CREATED',
  'DRIVER_SALARY_RECORDED',
  'PROFIT_DISTRIBUTED',
  'TRIP_EXPENSE_APPROVED',
  'TRIP_EXPENSE_REJECTED',
];

const AUTH_EVENTS = [
  'USER_LOGIN',
  'USER_LOGOUT',
  'LOGIN_FAILED',
  'ACCESS_DENIED',
];

const PENALTY_EVENTS = [
  'PENALTY_CREATED',
  'PENALTY_CANCELED',
];

const FINANCE_ENTITY_TYPES = [
  'finance',
  'payments',
  'adjustments',
  'expenses',
  'trip-expenses',
  'salary',
  'salary-periods',
  'debt',
  'payables',
  'advances',
  'settlements',
  'advance-settlements',
  'billing-documents',
  'customer-email-logs',
];

const FINANCE_PATH_PREFIXES = [
  '/api/finance',
  '/api/payments',
  '/api/adjustments',
  '/api/debt',
  '/api/payables',
  '/api/expenses',
  '/api/advances',
  '/api/settlements',
  '/api/admin/advance-settlements',
  '/api/salary',
  '/api/salary-periods',
  '/api/reports/receivables',
  '/api/reports/payables',
  '/api/reports/statement',
  '/api/reports/supplier-statement',
];

function eventSql(event: string): SQL {
  return sql`${s.auditLogs.payload}->>'event' = ${event}`;
}

function entityTypeSql(entityType: string): SQL {
  return sql`${s.auditLogs.entityType} = ${entityType}`;
}

function pathPrefixSql(prefix: string): SQL {
  return sql`${s.auditLogs.payload}->>'path' LIKE ${`${prefix}%`}`;
}

function buildOrCondition(parts: SQL[]): SQL {
  return sql`(${sql.join(parts, sql` OR `)})`;
}

function financeDomainCondition(): SQL {
  const predicates: SQL[] = [];
  for (const event of FINANCE_EXPLICIT_EVENTS) predicates.push(eventSql(event));
  for (const entityType of FINANCE_ENTITY_TYPES) predicates.push(entityTypeSql(entityType));
  for (const prefix of FINANCE_PATH_PREFIXES) predicates.push(pathPrefixSql(prefix));
  return buildOrCondition(predicates);
}

function matchesKnownCategory(category: string): SQL {
  if (category === 'trip') {
    return sql`(${s.auditLogs.payload}->>'event' LIKE 'TRIP_%' OR ${s.auditLogs.payload}->>'event' = 'STATUS_CHANGED')`;
  }
  if (category === 'finance') {
    return financeDomainCondition();
  }
  if (category === 'penalty') {
    return sql`${s.auditLogs.payload}->>'event' IN ('PENALTY_CREATED', 'PENALTY_CANCELED')`;
  }
  if (category === 'auth') {
    return sql`${s.auditLogs.payload}->>'event' IN ('USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED', 'ACCESS_DENIED')`;
  }
  if (category === 'config') {
    return sql`(${s.auditLogs.payload}->>'event' IN ('ENTITY_CREATED', 'ENTITY_UPDATED', 'ENTITY_DELETED') AND NOT ${financeDomainCondition()})`;
  }
  return sql`FALSE`;
}

function extractTopLevelString(payload: Record<string, unknown> | null | undefined, key: string): string | undefined {
  if (!payload || typeof payload[key] !== 'string') return undefined;
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function extractTopLevelNumber(payload: Record<string, unknown> | null | undefined, key: string): number | undefined {
  if (!payload || typeof payload[key] !== 'number') return undefined;
  return payload[key] as number;
}

function extractTopLevelBoolean(payload: Record<string, unknown> | null | undefined, key: string): boolean | undefined {
  if (!payload || typeof payload[key] !== 'boolean') return undefined;
  return payload[key] as boolean;
}

function redactPayloadForAccountant(payload: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  return {
    event: extractTopLevelString(payload, 'event'),
    statusCode: extractTopLevelNumber(payload, 'statusCode'),
    outcome: extractTopLevelString(payload, 'outcome'),
    failed: extractTopLevelBoolean(payload, 'failed'),
    idempotencyKeyPresent: extractTopLevelBoolean(payload, 'idempotencyKeyPresent'),
  };
}

function classifyAuditCategory(row: {
  action: string;
  entityType: string | null;
  path: string;
}): AuditCategory {
  if (FINANCE_EXPLICIT_EVENTS.includes(row.action)) return 'finance';
  if (PENALTY_EVENTS.includes(row.action)) return 'penalty';
  if (AUTH_EVENTS.includes(row.action)) return 'auth';
  if (row.action.startsWith('TRIP_') || row.action === 'STATUS_CHANGED') return 'trip';
  if ((row.entityType && FINANCE_ENTITY_TYPES.includes(row.entityType)) || FINANCE_PATH_PREFIXES.some((prefix) => row.path.startsWith(prefix))) {
    return 'finance';
  }
  return 'config';
}

function assertViewer(viewer: AuditQueryParams['viewer']) {
  if (!AUDIT_VIEWER_ROLES.has(viewer.role)) {
    throw new ApiError(403, 'Vai trò không được xem nhật ký người dùng');
  }
}

export async function queryAuditLogs(params: AuditQueryParams) {
  const { page, limit, category, search, viewer } = params;
  assertViewer(viewer);

  const conditions: SQL[] = [
    sql`coalesce(${s.auditLogs.payload}->>'event', '') != 'ACCESS_DENIED'`,
  ];

  if (category) {
    conditions.push(matchesKnownCategory(category));
  }

  if (viewer.role === Role.ACCOUNTANT) {
    // O02 accepted scope: this repo has no finer accountant row-assignment
    // authority today, so the deterministic scope is the finance/payroll audit
    // surface only. Everything else stays denied until a stronger mapping exists.
    conditions.push(financeDomainCondition());
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
    entityType: s.auditLogs.entityType,
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
      const action = (typeof i.payload?.event === 'string' ? i.payload.event : '') || '';
      const path = (typeof i.payload?.path === 'string' ? i.payload.path : '') || '';
      const accountantView = viewer.role === Role.ACCOUNTANT;
      const category = classifyAuditCategory({
        action,
        entityType: i.entityType,
        path,
      });
      return {
        id: i.id,
        userId: i.userId,
        userName: displayName,
        action,
        category,
        method: accountantView ? '' : (typeof i.payload?.method === 'string' ? i.payload.method : '') || '',
        path: accountantView ? '' : path,
        message: i.message,
        timestamp: i.timestamp,
        payload: accountantView ? redactPayloadForAccountant(i.payload) : i.payload,
        ipAddress: accountantView ? null : i.ipAddress,
      };
    }),
    total: Number(countRow?.count ?? 0),
    page,
    pageSize: limit,
  };
}
