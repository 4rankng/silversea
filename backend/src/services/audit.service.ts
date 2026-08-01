import { AsyncLocalStorage } from 'node:async_hooks';
import { renderAuditMessage } from './audit-templates';
import { db } from '../db';
import * as s from '../db/schema';
import { auditLogs } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { resolveAuditEvent } from './audit-registry';
import { AuditEvent } from './audit-types';
import type { AuditPayload } from './audit-types';
import type { AuditEventType } from './audit-types';
import type { Request, Response } from 'express';

export interface AuditEntry extends AuditPayload {
  userId?: number;
  ipAddress?: string;
}

type AuditEnrichmentHandler = (rowId: number, payload: AuditEntry) => Promise<void>;
type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AuditPersistHandler = (payload: AuditEntry, tx?: AuditTx) => Promise<number>;

interface AuditRequestContext {
  req: Request;
  res: Response;
  fullPath: string;
  isLoginPath: boolean;
  declaredMaterialWriteEndpoint?: string;
}

const auditRequestContextStorage = new AsyncLocalStorage<AuditRequestContext>();

export function runWithAuditRequestContext<T>(
  context: AuditRequestContext,
  fn: () => T,
): T {
  return auditRequestContextStorage.run(context, fn);
}

export function getAuditRequestContext(): AuditRequestContext | undefined {
  return auditRequestContextStorage.getStore();
}

export function extractAuditEntityType(path: string): string | null {
  const parts = path.replace('/api/', '').split('/');

  if (parts.length >= 2 && parts[0] === 'forwarder' && parts[1] === 'me') {
    if (parts.length > 2) {
      if (parts[2] === 'trips' && parts[4] === 'containers') return 'container-instances';
      if (parts[2] === 'expenses' && parts[4] === 'photos') return 'expense-photos';
      if (parts[2] === 'expenses') return 'trip-expenses';
      return parts[2];
    }
    return 'forwarder';
  }

  if (parts.length >= 2 && parts[0] === 'driver' && parts[1] === 'me') {
    if (parts.length > 2) {
      if (parts[2] === 'trips' && parts[4] === 'containers') return 'container-instances';
      if (parts[2] === 'trips' && parts[4] === 'photos') return 'photos';
      return parts[2];
    }
    return 'driver';
  }

  if (parts.length >= 3 && parts[0] === 'trips' && parts[2] === 'expenses') {
    return 'trip-expenses';
  }

  if (parts.length >= 1) return parts[0];
  return null;
}

export function extractAuditEntityId(
  path: string,
  body: Record<string, unknown>,
): number | null {
  const toDatabaseInteger = (value: unknown): number | null => {
    const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
  };
  const parts = path.replace('/api/', '').split('/');
  const last = parts[parts.length - 1];
  const num = toDatabaseInteger(last);
  if (num != null) return num;

  if (
    ['approve', 'reject', 'lock', 'unlock', 'cancel', 'dispatch', 'pre-departure', 'actuals', 'departure-date'].includes(last)
  ) {
    const secondLast = parts[parts.length - 2];
    const idNum = toDatabaseInteger(secondLast);
    if (idNum != null) return idNum;
  }

  return toDatabaseInteger(body?.id);
}

export function sanitizeAuditBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!body) return {};
  const SENSITIVE_AUDIT_KEYS = new Set([
    'password',
    'passwordhash',
    'passworddigest',
    'currentpassword',
    'newpassword',
    'confirmpassword',
    'credential',
    'credentials',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'jwttoken',
    'authorization',
    'apikey',
    'minimaxapikey',
    'openrouterapikey',
    'minimaxkey',
    'openrouterkey',
    'resendapikey',
    'settingsencryptionkey',
  ]);

  const normalizeKey = (key: string) => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const isSensitiveAuditKey = (key: string) => {
    const normalized = normalizeKey(key);
    if (normalized === 'idempotencykey' || normalized.startsWith('clear')) return false;
    if (SENSITIVE_AUDIT_KEYS.has(normalized)) return true;
    return normalized.endsWith('password')
      || normalized.endsWith('passwordhash')
      || normalized.endsWith('credential')
      || normalized.endsWith('credentials')
      || normalized.endsWith('secret')
      || normalized.endsWith('token')
      || normalized.endsWith('apikey')
      || normalized.endsWith('encryptionkey');
  };

  const sanitizeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (key === '_requestId' || key === 'idempotencyKey' || isSensitiveAuditKey(key)) continue;
      sanitized[key] = sanitizeValue(nestedValue);
    }
    return sanitized;
  };

  return sanitizeValue(body) as Record<string, unknown>;
}

export function buildAuditMetadata(args: {
  req: Request;
  fullPath: string;
  statusCode: number;
  outcome: 'ACCEPTED' | 'SUCCEEDED' | 'REPLAYED' | 'FORBIDDEN' | 'CONFLICT' | 'REJECTED' | 'FAILED_LOGIN';
  body?: Record<string, unknown> | null;
  materialWriteEndpoint?: string | null;
  idempotencyKeyPresent?: boolean;
}) {
  return {
    method: args.req.method,
    path: args.fullPath,
    statusCode: args.statusCode,
    outcome: args.outcome,
    idempotencyKeyPresent: args.idempotencyKeyPresent ?? false,
    materialWriteEndpoint: args.materialWriteEndpoint ?? undefined,
    body: sanitizeAuditBody((args.req.body as Record<string, unknown>) ?? {}),
    error: typeof args.body?.error === 'string' ? args.body.error : undefined,
  };
}

export function extractAuditEntityKey(
  entityType: string | null,
  responseBody: Record<string, unknown> | null,
  requestBody: Record<string, unknown> | null,
): string | undefined {
  const pick = (obj: Record<string, unknown> | null, ...keys: string[]): string | undefined => {
    if (!obj) return undefined;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return undefined;
  };

  switch (entityType) {
    case 'trips':
      return pick(responseBody, 'tripCode') || pick(requestBody, 'tripCode');
    case 'trucks':
      return pick(responseBody, 'licensePlate') || pick(requestBody, 'licensePlate');
    case 'customers':
    case 'routes':
    case 'cargo-types':
    case 'drivers':
    case 'penalty-reasons':
    case 'suppliers':
    case 'expense-categories':
      return pick(responseBody, 'name') || pick(requestBody, 'name');
    case 'cap-table':
      return pick(responseBody, 'partnerName') || pick(requestBody, 'partnerName');
    case 'reports': {
      const quarter = pick(responseBody, 'quarter') || pick(requestBody, 'quarter');
      const year = pick(responseBody, 'year') || pick(requestBody, 'year');
      if (quarter && year) return `Quý ${quarter}/${year}`;
      return undefined;
    }
    case 'payments':
    case 'adjustments':
    case 'penalties': {
      const tripRef = pick(responseBody, 'tripCode') || pick(requestBody, 'tripCode');
      if (tripRef) return `cho chuyến ${tripRef}`;
      return undefined;
    }
    default:
      return pick(responseBody, 'name', 'code') || pick(requestBody, 'name', 'code');
  }
}

export async function persistMaterialWriteSuccessAuditInTransaction(args: {
  tx: AuditTx;
  statusCode: number;
  responseBody: Record<string, unknown> | null;
  entityId?: number | null;
  entityKey?: string;
}): Promise<void> {
  const context = getAuditRequestContext();
  if (!context) {
    return;
  }
  if (!context.declaredMaterialWriteEndpoint || !context.req.user) {
    throw new Error(`Material write audit context is incomplete for ${context.req.method} ${context.fullPath}`);
  }

  const requestBody = (context.req.body as Record<string, unknown> | undefined) ?? {};
  const entityType = extractAuditEntityType(context.fullPath) || 'unknown';
  const event = typeof context.res.locals.auditEvent === 'string'
    ? context.res.locals.auditEvent as AuditEventType
    : resolveAuditEvent(context.req.method, context.fullPath);
  const entityId = args.entityId ?? extractAuditEntityId(context.fullPath, requestBody) ?? undefined;
  const entityKey = args.entityKey
    ?? context.res.locals.auditEntityKey
    ?? extractAuditEntityKey(entityType, args.responseBody, requestBody);

  const payload = {
    event,
    entityType,
    entityId,
    entityKey,
    userId: context.req.user.userId,
    actorRole: context.req.user.role,
    actorEmail: context.req.user.email ?? undefined,
    actorName: context.req.user.fullName ?? context.req.user.username ?? undefined,
    ipAddress: context.req.ip,
    metadata: buildAuditMetadata({
      req: context.req,
      fullPath: context.fullPath,
      statusCode: args.statusCode,
      outcome: 'SUCCEEDED',
      body: args.responseBody,
      materialWriteEndpoint: context.declaredMaterialWriteEndpoint,
      idempotencyKeyPresent: true,
    }),
  } as const;

  const rowId = auditPersistHandler === defaultAuditPersistHandler
    ? await insertAuditRow(args.tx, payload)
    : await auditPersistHandler(payload, args.tx);

  context.res.locals.durableMaterialWriteSuccessAudited = true;
  context.res.locals.durableMaterialWriteAuditLogId = rowId;
}

/**
 * Persist the durable intent before a command performs work that cannot share
 * the database transaction (for example, a GPS provider call). If finalization
 * later fails, this row remains as the recoverable proof that the attempt was
 * accepted and identifies its material-write endpoint.
 */
export async function persistMaterialWriteAttemptAuditInTransaction(args: {
  tx: AuditTx;
  statusCode: number;
  responseBody: Record<string, unknown> | null;
  entityId?: number | null;
  entityKey?: string;
}): Promise<void> {
  const context = getAuditRequestContext();
  if (!context) {
    return;
  }
  if (!context.declaredMaterialWriteEndpoint || !context.req.user) {
    throw new Error(`Material write audit context is incomplete for ${context.req.method} ${context.fullPath}`);
  }

  const requestBody = (context.req.body as Record<string, unknown> | undefined) ?? {};
  const entityType = extractAuditEntityType(context.fullPath) || 'unknown';
  const event = typeof context.res.locals.auditEvent === 'string'
    ? context.res.locals.auditEvent as AuditEventType
    : resolveAuditEvent(context.req.method, context.fullPath);
  const entityId = args.entityId ?? extractAuditEntityId(context.fullPath, requestBody) ?? undefined;
  const entityKey = args.entityKey
    ?? context.res.locals.auditEntityKey
    ?? extractAuditEntityKey(entityType, args.responseBody, requestBody);

  await persistAuditInTransaction(args.tx, {
    event,
    entityType,
    entityId,
    entityKey,
    userId: context.req.user.userId,
    actorRole: context.req.user.role,
    actorEmail: context.req.user.email ?? undefined,
    actorName: context.req.user.fullName ?? context.req.user.username ?? undefined,
    ipAddress: context.req.ip,
    metadata: buildAuditMetadata({
      req: context.req,
      fullPath: context.fullPath,
      statusCode: args.statusCode,
      outcome: 'ACCEPTED',
      body: args.responseBody,
      materialWriteEndpoint: context.declaredMaterialWriteEndpoint,
      idempotencyKeyPresent: true,
    }),
  });
}

/**
 * Persist an idempotency conflict before returning 409. This is separate from
 * the response middleware because the command setup transaction owns the row
 * lock that proves which actor/payload already claimed the key.
 */
export async function persistMaterialWriteConflictAuditInTransaction(args: {
  tx: AuditTx;
  responseBody: Record<string, unknown> | null;
  entityId?: number | null;
  entityKey?: string;
}): Promise<void> {
  const context = getAuditRequestContext();
  if (!context) {
    return;
  }
  if (!context.declaredMaterialWriteEndpoint || !context.req.user) {
    throw new Error(`Material write audit context is incomplete for ${context.req.method} ${context.fullPath}`);
  }

  const requestBody = (context.req.body as Record<string, unknown> | undefined) ?? {};
  const entityType = extractAuditEntityType(context.fullPath) || 'unknown';
  const entityId = args.entityId ?? extractAuditEntityId(context.fullPath, requestBody) ?? undefined;
  const entityKey = args.entityKey
    ?? context.res.locals.auditEntityKey
    ?? extractAuditEntityKey(entityType, args.responseBody, requestBody);

  await persistAuditInTransaction(args.tx, {
    event: AuditEvent.MUTATION_CONFLICT,
    entityType,
    entityId,
    entityKey,
    userId: context.req.user.userId,
    actorRole: context.req.user.role,
    actorEmail: context.req.user.email ?? undefined,
    actorName: context.req.user.fullName ?? context.req.user.username ?? undefined,
    ipAddress: context.req.ip,
    metadata: buildAuditMetadata({
      req: context.req,
      fullPath: context.fullPath,
      statusCode: 409,
      outcome: 'CONFLICT',
      body: args.responseBody,
      materialWriteEndpoint: context.declaredMaterialWriteEndpoint,
      idempotencyKeyPresent: true,
    }),
  });
}

/**
 * Resolve human-readable identifiers for entities whose audit row only has the
 * numeric foreign key in the request body (payments, adjustments, penalties
 * all reference a trip via `trip_id`). Runs async out-of-band so it doesn't
 * delay the response.
 */
/**
 * Resolve human-readable identifiers for entities dynamically from the database.
 * This runs async out-of-band so it doesn't block the API response.
 */
async function enrichEntityKey(payload: AuditEntry): Promise<string | undefined> {
  const body = (payload.metadata?.body || {}) as Record<string, unknown>;

  // 1. Resolve based on entity type first

  // Expenses entity
  if (payload.entityType === 'expenses' && payload.entityId) {
    try {
      const [expense] = await db.select({
        amount: s.expenses.amount,
        categoryName: s.expenseCategories.name,
        supplierName: s.suppliers.name,
        truckPlate: s.trucks.licensePlate,
      }).from(s.expenses)
        .leftJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
        .leftJoin(s.suppliers, eq(s.expenses.supplierId, s.suppliers.id))
        .leftJoin(s.trucks, eq(s.expenses.truckId, s.trucks.id))
        .where(eq(s.expenses.id, payload.entityId))
        .limit(1);
      if (expense) {
        const amt = Number(expense.amount).toLocaleString('vi-VN') + ' ₫';
        return `chi phí ${expense.categoryName} với số tiền ${amt} (Nhà cung cấp: ${expense.supplierName}${expense.truckPlate ? `, Xe: ${expense.truckPlate}` : ''})`;
      }
    } catch (e) { console.warn('[audit] enrich expenses failed:', e); }
  }

  // Trip Expenses entity
  if ((payload.entityType === 'trip-expenses' || payload.entityType === 'forwarder-expenses') && payload.entityId) {
    try {
      const [expense] = await db.select({
        buyAmount: s.tripExpenses.buyAmount,
        typeName: s.forwarderExpenseTypes.name,
        tripCode: s.trips.tripCode,
        supplierName: s.suppliers.name,
      }).from(s.tripExpenses)
        .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
        .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
        .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
        .where(eq(s.tripExpenses.id, payload.entityId))
        .limit(1);
      if (expense) {
        const buyAmt = Number(expense.buyAmount).toLocaleString('vi-VN') + ' ₫';
        const tripPart = expense.tripCode ? ` cho chuyến ${expense.tripCode}` : '';
        const supplierPart = expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : '';
        return `phí ${expense.typeName || 'hộ'} với số tiền chi ${buyAmt}${tripPart}${supplierPart}`;
      }
    } catch (e) { console.warn('[audit] enrich trip/forwarder expenses failed:', e); }
  }

  // Penalties entity
  if (payload.entityType === 'penalties' && payload.entityId) {
    try {
      const [penalty] = await db.select({
        amount: s.penalties.amount,
        driverName: s.drivers.name,
        reasonText: s.penaltyReasons.reasonText,
        customReason: s.penalties.customReason,
        tripCode: s.trips.tripCode,
      }).from(s.penalties)
        .innerJoin(s.drivers, eq(s.penalties.driverId, s.drivers.id))
        .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
        .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
        .where(eq(s.penalties.id, payload.entityId))
        .limit(1);
      if (penalty) {
        const amt = Number(penalty.amount).toLocaleString('vi-VN') + ' ₫';
        const reason = penalty.reasonText || penalty.customReason || 'Không rõ lý do';
        return `lái xe ${penalty.driverName} với số tiền ${amt} (Lý do: ${reason}${penalty.tripCode ? `, Chuyến: ${penalty.tripCode}` : ''})`;
      }
    } catch (e) { console.warn('[audit] enrich penalties failed:', e); }
  }

  // Payments entity (Customer or Vendor payment)
  if (payload.entityType === 'payments') {
    // A. Vendor payment (has supplierId)
    if (body.supplierId && body.amount) {
      try {
        const [supplier] = await db.select({ name: s.suppliers.name })
          .from(s.suppliers).where(eq(s.suppliers.id, Number(body.supplierId))).limit(1);
        const amt = Number(body.amount).toLocaleString('vi-VN') + ' ₫';
        return `cho nhà cung cấp ${supplier?.name || `ID ${body.supplierId}`} với số tiền ${amt}${body.receiptId ? ` (Số hóa đơn: ${body.receiptId})` : ''}`;
      } catch (e) { console.warn('[audit] enrich vendor payment failed:', e); }
    }
    // B. Customer payment (has customerId)
    if (body.customerId && Array.isArray(body.payments)) {
      try {
        const [customer] = await db.select({ name: s.customers.name })
          .from(s.customers).where(eq(s.customers.id, Number(body.customerId))).limit(1);
        const payments = body.payments as Array<Record<string, unknown>>;
        const ids = payments.map((p) => p?.tripId || p?.trip_id).filter((x): x is number => typeof x === 'number');
        let tripDetail = '';
        if (ids.length > 0) {
          const rows = await db.select({ tripCode: s.trips.tripCode })
            .from(s.trips).where(inArray(s.trips.id, ids));
          const codes = rows.map(r => r.tripCode).filter((c): c is string => Boolean(c));
          if (codes.length > 0) {
            tripDetail = ` cho ${codes.length === 1 ? `chuyến ${codes[0]}` : `${codes.length} chuyến (${codes.join(', ')})`}`;
          }
        }
        const totalAmt = payments.reduce((sum: number, p: Record<string, unknown>) => sum + Number(p?.amount || 0), 0);
        const amtStr = totalAmt > 0 ? ` số tiền ${totalAmt.toLocaleString('vi-VN')} ₫` : '';
        return `từ khách hàng ${customer?.name || `ID ${body.customerId}`}${amtStr}${tripDetail}${body.receiptId ? ` (Số hóa đơn: ${body.receiptId})` : ''}`;
      } catch (e) { console.warn('[audit] enrich customer payment failed:', e); }
    }
  }

  // Adjustments (posted directly to ledger with tripId and amount)
  if (payload.entityType === 'adjustments') {
    const tripId = body.tripId || body.trip_id;
    if (typeof tripId === 'number' && body.amount !== undefined) {
      try {
        const [trip] = await db.select({ tripCode: s.trips.tripCode })
          .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
        if (trip?.tripCode) {
          const amt = Number(body.amount).toLocaleString('vi-VN') + ' ₫';
          return `cho chuyến ${trip.tripCode} với số tiền điều chỉnh ${amt}${body.note ? ` (Ghi chú: ${body.note})` : ''}`;
        }
      } catch (e) { console.warn('[audit] enrich adjustment failed:', e); }
    }
  }

  // 2. Fall back to manual key if present
  if (payload.entityKey) return payload.entityKey;

  // 3. Single-trip ref fallback
  const singleTripId = body.trip_id ?? body.tripId;
  if (typeof singleTripId === 'number') {
    try {
      const [trip] = await db.select({ tripCode: s.trips.tripCode })
        .from(s.trips).where(eq(s.trips.id, singleTripId)).limit(1);
      if (trip?.tripCode) return `cho chuyến ${trip.tripCode}`;
    } catch (e) { console.warn('[audit] enrich single-trip fallback failed:', e); }
  }

  // 4. Multi-trip ref fallback
  if (Array.isArray(body.payments)) {
    const payments = body.payments as Array<Record<string, unknown>>;
    const ids = payments.map((p) => p?.trip_id || p?.tripId).filter((x): x is number => typeof x === 'number');
    if (ids.length > 0) {
      try {
        const rows = await db.select({ tripCode: s.trips.tripCode })
          .from(s.trips).where(inArray(s.trips.id, ids));
        const codes = rows.map(r => r.tripCode).filter((c): c is string => Boolean(c));
        if (codes.length > 0) return `cho ${codes.length === 1 ? `chuyến ${codes[0]}` : `${codes.length} chuyến (${codes.join(', ')})`}`;
      } catch (e) { console.warn('[audit] enrich multi-trip fallback failed:', e); }
    }
  }

  // 5. Query basic entities by entityId if deleted or missing
  if (payload.entityId) {
    try {
      if (payload.entityType === 'customers') {
        const [row] = await db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'routes') {
        const [row] = await db.select({ name: s.routes.name }).from(s.routes).where(eq(s.routes.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'cargo-types') {
        const [row] = await db.select({ name: s.cargoTypes.name }).from(s.cargoTypes).where(eq(s.cargoTypes.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'drivers') {
        const [row] = await db.select({ name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'trucks') {
        const [row] = await db.select({ licensePlate: s.trucks.licensePlate }).from(s.trucks).where(eq(s.trucks.id, payload.entityId)).limit(1);
        if (row?.licensePlate) return row.licensePlate;
      } else if (payload.entityType === 'suppliers') {
        const [row] = await db.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'expense-categories') {
        const [row] = await db.select({ name: s.expenseCategories.name }).from(s.expenseCategories).where(eq(s.expenseCategories.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'trips') {
        const [row] = await db.select({ tripCode: s.trips.tripCode }).from(s.trips).where(eq(s.trips.id, payload.entityId)).limit(1);
        if (row?.tripCode) return row.tripCode;
      }
    } catch (e) { console.warn(`[audit] enrich basic entity (${payload.entityType}) failed:`, e); }
  }

  return undefined;
}

async function defaultAuditEnrichment(rowId: number, payload: AuditEntry): Promise<void> {
  const enrichedPayload: AuditEntry = { ...payload };
  if (enrichedPayload.entityKey) {
    return;
  }
  try {
    enrichedPayload.entityKey = await enrichEntityKey(enrichedPayload);
  } catch (error) {
    console.warn('[audit] enrichEntityKey failed:', error);
  }
  if (!enrichedPayload.entityKey) {
    return;
  }
  const message = renderAuditMessage(enrichedPayload);
  await db.update(auditLogs)
    .set({ message })
    .where(eq(auditLogs.id, rowId));
}

function canEnrichAuditEntry(payload: AuditEntry): boolean {
  if (payload.entityKey) {
    return false;
  }

  switch (payload.entityType) {
    case 'expenses':
    case 'trip-expenses':
    case 'forwarder-expenses':
    case 'penalties':
    case 'payments':
    case 'adjustments':
    case 'customers':
    case 'routes':
    case 'cargo-types':
    case 'drivers':
    case 'trucks':
    case 'suppliers':
    case 'expense-categories':
    case 'trips':
      return true;
    default:
      return false;
  }
}

function scheduleAuditEnrichment(rowId: number, payload: AuditEntry) {
  if (!canEnrichAuditEntry(payload)) {
    return;
  }
  void auditEnrichmentHandler(rowId, { ...payload }).catch((error) => {
    console.error('Audit log enrichment failed:', error);
  });
}

async function insertAuditRow(executor: AuditTx | typeof db, payload: AuditEntry): Promise<number> {
  const [created] = await executor.insert(auditLogs).values({
    userId: payload.userId ?? null,
    actorName: payload.actorName ?? null,
    message: renderAuditMessage(payload),
    entityType: payload.entityType,
    entityId: payload.entityId ?? null,
    payload: { event: payload.event, ...payload.metadata },
    ipAddress: payload.ipAddress ?? null,
  }).returning({ id: auditLogs.id });
  return created.id;
}

let auditEnrichmentHandler: AuditEnrichmentHandler = defaultAuditEnrichment;
const defaultAuditPersistHandler: AuditPersistHandler = async (payload: AuditEntry, tx?: AuditTx) => {
  const executor = tx ?? db;
  const rowId = await insertAuditRow(executor, payload);
  scheduleAuditEnrichment(rowId, payload);
  return rowId;
};
let auditPersistHandler: AuditPersistHandler = async (payload: AuditEntry, tx?: AuditTx) => {
  return defaultAuditPersistHandler(payload, tx);
};

export function setAuditEnrichmentHandlerForTest(
  handler: AuditEnrichmentHandler | null,
) {
  auditEnrichmentHandler = handler ?? defaultAuditEnrichment;
}

export function setAuditPersistHandlerForTest(
  handler: AuditPersistHandler | null,
) {
  auditPersistHandler = handler ?? defaultAuditPersistHandler;
}

export async function persistAudit(payload: AuditEntry): Promise<number> {
  return auditPersistHandler(payload);
}

export async function persistAuditInTransaction(
  tx: AuditTx,
  payload: AuditEntry,
): Promise<number> {
  return auditPersistHandler(payload, tx);
}

export async function finalizeDurableMaterialWriteAudit(args: {
  rowId: number;
  payload: AuditEntry;
}): Promise<void> {
  await db.update(auditLogs)
    .set({
      userId: args.payload.userId ?? null,
      actorName: args.payload.actorName ?? null,
      message: renderAuditMessage(args.payload),
      entityType: args.payload.entityType,
      entityId: args.payload.entityId ?? null,
      payload: { event: args.payload.event, ...args.payload.metadata },
      ipAddress: args.payload.ipAddress ?? null,
    })
    .where(eq(auditLogs.id, args.rowId));
  scheduleAuditEnrichment(args.rowId, args.payload);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'Lỗi không xác định';
}

export async function persistStorageCleanupFailureAudit(args: {
  entityType: string;
  storageKey: string;
  method: string;
  fullPath: string;
  requestBody?: Record<string, unknown> | null;
  userId?: number | null;
  actorRole?: string;
  actorEmail?: string | null;
  actorName?: string | null;
  ipAddress?: string;
  materialWriteEndpoint?: string | null;
  idempotencyKeyPresent?: boolean;
  entityId?: number | null;
  entityKey?: string;
  cleanupStage: 'rollback' | 'delete';
  originalError: unknown;
  cleanupError: unknown;
}): Promise<number> {
  return persistAudit({
    event: AuditEvent.STORAGE_CLEANUP_PENDING,
    entityType: args.entityType,
    entityId: args.entityId ?? undefined,
    entityKey: args.entityKey ?? args.storageKey,
    userId: args.userId ?? undefined,
    actorRole: args.actorRole ?? undefined,
    actorEmail: args.actorEmail ?? undefined,
    actorName: args.actorName ?? undefined,
    ipAddress: args.ipAddress ?? undefined,
    metadata: {
      method: args.method,
      path: args.fullPath,
      statusCode: 500,
      outcome: 'REJECTED',
      idempotencyKeyPresent: args.idempotencyKeyPresent ?? true,
      materialWriteEndpoint: args.materialWriteEndpoint ?? undefined,
      body: sanitizeAuditBody(args.requestBody ?? {}),
      error: formatUnknownError(args.cleanupError),
      cleanupPending: true,
      cleanupStage: args.cleanupStage,
      storageKey: args.storageKey,
      originalError: formatUnknownError(args.originalError),
      cleanupError: formatUnknownError(args.cleanupError),
    },
  });
}

export function initAuditService() {
  return;
}

export function emitAudit(payload: AuditEntry) {
  void persistAudit(payload).catch((error) => {
    console.error('Audit log write failed:', error);
  });
}

export function shouldScheduleAuditEnrichmentForTest(payload: AuditEntry): boolean {
  return canEnrichAuditEntry(payload);
}
