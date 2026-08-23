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
  sortBy?: AuditLogSortKey;
  sortDir?: 'asc' | 'desc';
  viewer: {
    userId: number;
    role: Role;
  };
}

// Server-side sort keys for the audit log table — one per data column (STT is
// a row index). userName re-uses the coalesce expression the select projects;
// NULLs last in both directions comes from the wrapper at the orderBy site.
export const AUDIT_LOG_SORT_KEYS = ['timestamp', 'userName', 'message'] as const;
export type AuditLogSortKey = (typeof AUDIT_LOG_SORT_KEYS)[number];

const AUDIT_USER_NAME_SQL = sql`coalesce(${s.auditLogs.actorName}, ${s.users.fullName}, ${s.users.username})`;

const AUDIT_SORT_SQL: Record<AuditLogSortKey, SQL> = {
  timestamp: sql`${s.auditLogs.timestamp}`,
  userName: AUDIT_USER_NAME_SQL,
  message: sql`${s.auditLogs.message}`,
};

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
  'payment_receipt',
  'payment-receipt',
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
  'billing_document',
  'billing-documents',
  'debt_offset',
  'credit_override',
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

function accountantAssignmentCondition(userId: number): SQL {
  const directCustomerId = sql`coalesce(
    ${s.auditLogs.payload}#>>'{body,customerId}',
    ${s.auditLogs.payload}#>>'{body,customer_id}',
    case
      when ${s.auditLogs.payload}#>>'{body,entityType}' = 'CUSTOMER'
      then ${s.auditLogs.payload}#>>'{body,entityId}'
      else null
    end
  )`;
  const directTripId = sql`coalesce(
    ${s.auditLogs.payload}#>>'{body,tripId}',
    ${s.auditLogs.payload}#>>'{body,trip_id}'
  )`;
  const path = sql`coalesce(${s.auditLogs.payload}->>'path', '')`;
  const isPaymentReceiptPath = sql`(
    ${path} like '/api/payments/receive%'
    or ${path} like '/api/payments/receipts/%'
  )`;
  const isBillingDocumentPath = sql`${path} like '/api/finance/billing-documents%'`;
  const isDebtOffsetPath = sql`${path} like '/api/finance/debt-offsets%'`;
  const isCreditOverridePath = sql`${path} like '/api/finance/credit-overrides%'`;
  const matchesDirectCustomer = sql`exists (
    select 1
    from ${s.userCustomerLinks} assigned_customer
    where assigned_customer.user_id = ${userId}
      and assigned_customer.customer_id::text = ${directCustomerId}
  )`;
  const matchesDirectTrip = sql`exists (
    select 1
    from ${s.trips} scoped_trip
    inner join ${s.userCustomerLinks} assigned_trip_customer
      on assigned_trip_customer.customer_id = scoped_trip.customer_id
    where assigned_trip_customer.user_id = ${userId}
      and scoped_trip.id::text = ${directTripId}
  )`;
  const matchesTripEntity = sql`exists (
    select 1
    from ${s.trips} scoped_entity_trip
    inner join ${s.userCustomerLinks} assigned_entity_customer
      on assigned_entity_customer.customer_id = scoped_entity_trip.customer_id
    where assigned_entity_customer.user_id = ${userId}
      and scoped_entity_trip.id = ${s.auditLogs.entityId}
      and ${s.auditLogs.entityType} in ('trips', 'trip')
  )`;
  const matchesTripExpenseEntity = sql`exists (
    select 1
    from ${s.tripExpenses} scoped_expense
    inner join ${s.trips} scoped_expense_trip on scoped_expense_trip.id = scoped_expense.trip_id
    inner join ${s.userCustomerLinks} assigned_expense_customer
      on assigned_expense_customer.customer_id = scoped_expense_trip.customer_id
    where assigned_expense_customer.user_id = ${userId}
      and scoped_expense.id = ${s.auditLogs.entityId}
      and ${s.auditLogs.entityType} in ('trip-expenses', 'forwarder-expenses')
  )`;
  const matchesPaymentReceipt = sql`exists (
    select 1
    from ${s.paymentReceipts} scoped_receipt
    inner join ${s.userCustomerLinks} assigned_receipt_customer
      on assigned_receipt_customer.customer_id = scoped_receipt.customer_id
    where assigned_receipt_customer.user_id = ${userId}
      and scoped_receipt.id = ${s.auditLogs.entityId}
      and (
        ${s.auditLogs.entityType} in ('payments', 'payment_receipt', 'payment-receipt')
        or ${isPaymentReceiptPath}
      )
  )`;
  const matchesBillingDocument = sql`exists (
    select 1
    from ${s.billingDocuments} scoped_document
    inner join ${s.userCustomerLinks} assigned_document_customer
      on assigned_document_customer.customer_id = scoped_document.entity_id
    where assigned_document_customer.user_id = ${userId}
      and scoped_document.id = ${s.auditLogs.entityId}
      and scoped_document.entity_type = 'CUSTOMER'
      and (
        ${s.auditLogs.entityType} in ('billing_document', 'billing-documents', 'finance')
        or ${isBillingDocumentPath}
      )
  )`;
  const matchesDebtOffset = sql`exists (
    select 1
    from ${s.debtOffsets} scoped_offset
    inner join ${s.userCustomerLinks} assigned_offset_customer
      on assigned_offset_customer.customer_id = scoped_offset.customer_id
    where assigned_offset_customer.user_id = ${userId}
      and scoped_offset.id = ${s.auditLogs.entityId}
      and (
        ${s.auditLogs.entityType} in ('debt_offset', 'debt-offsets')
        or ${isDebtOffsetPath}
      )
  )`;
  const matchesCreditOverride = sql`exists (
    select 1
    from ${s.creditOverrideRequests} scoped_override
    inner join ${s.userCustomerLinks} assigned_override_customer
      on assigned_override_customer.customer_id = scoped_override.customer_id
    where assigned_override_customer.user_id = ${userId}
      and scoped_override.id = ${s.auditLogs.entityId}
      and (
        ${s.auditLogs.entityType} in ('credit_override', 'credit-overrides')
        or ${isCreditOverridePath}
      )
  )`;
  const isCustomerBoundFinanceRow = sql`(
    ${directCustomerId} is not null
    or ${directTripId} is not null
    or ${s.auditLogs.entityType} in (
      'trips',
      'trip',
      'trip-expenses',
      'forwarder-expenses',
      'payments',
      'payment_receipt',
      'payment-receipt',
      'billing_document',
      'billing-documents',
      'debt_offset',
      'debt-offsets',
      'credit_override',
      'credit-overrides',
      'customer-email-logs'
    )
    or ${isPaymentReceiptPath}
    or ${isBillingDocumentPath}
    or ${isDebtOffsetPath}
    or ${isCreditOverridePath}
  )`;

  return sql`(
    not ${isCustomerBoundFinanceRow}
    or ${matchesDirectCustomer}
    or ${matchesDirectTrip}
    or ${matchesTripEntity}
    or ${matchesTripExpenseEntity}
    or ${matchesPaymentReceipt}
    or ${matchesBillingDocument}
    or ${matchesDebtOffset}
    or ${matchesCreditOverride}
  )`;
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
  const { page, limit, category, search, sortBy, sortDir, viewer } = params;
  assertViewer(viewer);

  const conditions: SQL[] = [
    sql`coalesce(${s.auditLogs.payload}->>'event', '') != 'ACCESS_DENIED'`,
  ];

  if (category) {
    conditions.push(matchesKnownCategory(category));
  }

  if (viewer.role === Role.ACCOUNTANT) {
    conditions.push(financeDomainCondition());
    conditions.push(accountantAssignmentCondition(viewer.userId));
  }

  if (search && search.trim()) {
    const searchPattern = `%${search.trim()}%`;
    conditions.push(sql`(${s.users.fullName} ILIKE ${searchPattern} OR ${s.users.username} ILIKE ${searchPattern} OR ${s.auditLogs.message} ILIKE ${searchPattern} OR ${s.auditLogs.payload}->>'event' ILIKE ${searchPattern})`);
  }

  const items = await db.select({
    id: s.auditLogs.id,
    timestamp: s.auditLogs.timestamp,
    userId: s.auditLogs.userId,
    userName: AUDIT_USER_NAME_SQL,
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
    .orderBy(...(
      sortBy
        ? [
            sql`${AUDIT_SORT_SQL[sortBy]} ${sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
            desc(s.auditLogs.id),
          ]
        : [desc(s.auditLogs.id)]
    ))
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
