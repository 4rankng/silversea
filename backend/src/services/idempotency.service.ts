// Idempotency Service — server-side dedupe for "resubmit doesn't duplicate"
// (PRD M10-01-03; Q23 proposal: same request id → same result, no extra row).
//
// Generic over an `(endpoint, idempotencyKey)` pair with a SHA-256 payload
// hash for conflict detection. Currently consumed by the M10.1 clerk
// quick-create endpoint (`POST /api/shipments/quick`); designed so future
// write paths (offline-queue sync, driver progress update) reuse the same
// helper instead of re-rolling dedupe logic.
//
// Conflict policy (matches Q23 verbatim proposal):
//   - Same key + same payload hash → return the stored result (replay).
//   - Same key + different payload hash → throw 409. This is a client bug;
//     we never silently overwrite the original result.
//   - No key → no dedupe; caller proceeds normally.
//
// All messages are Vietnamese (PRD Mxx-HT-01).

import { createHash } from 'node:crypto';
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import { persistMaterialWriteSuccessAuditInTransaction } from './audit.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TransactionOptions = NonNullable<Parameters<typeof db.transaction>[1]>;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 100;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type CrudIdempotencyOperation = 'create' | 'update' | 'delete';

/**
 * Stable namespace for generated configuration CRUD commands.
 *
 * Resource names come from the Drizzle table name, not the request URL, so
 * mounting or aliasing a router cannot accidentally change its replay
 * keyspace.
 */
export function buildCrudIdempotencyEndpoint(
  resource: string,
  operation: CrudIdempotencyOperation,
): string {
  const normalizedResource = resource.trim();
  if (!normalizedResource) {
    throw new Error('CRUD idempotency resource must not be empty');
  }
  const endpoint = `config.${normalizedResource}.${operation}`;
  if (endpoint.length > 100) {
    throw new Error(`CRUD idempotency endpoint exceeds 100 characters: ${endpoint}`);
  }
  return endpoint;
}

/** Tag identifying the logical endpoint (e.g. 'shipments.quick-create'). */
export const IDEMPOTENCY_ENDPOINTS = {
  UPLOAD_TRIP_PHOTO: 'upload.trip-photo',
  UPLOAD_TRIP_PHOTO_DELETE: 'upload.trip-photo.delete',
  UPLOAD_COMPANY_LOGO: 'upload.company-logo',
  OCR_CAPTURE: 'ocr.capture',
  OCR_PERSIST_ONLY: 'ocr.persist-only',
  SHIPMENT_QUICK_CREATE: 'shipments.quick-create',
  SHIPMENT_CREATE: 'shipments.create',
  SHIPMENT_UPDATE: 'shipments.update',
  SHIPMENT_TRANSITION: 'shipments.transition',
  SHIPMENT_DISPATCH: 'shipments.dispatch',
  SHIPMENT_DOCUMENT_ATTACH: 'shipments.documents.attach',
  SHIPMENT_DOCUMENT_REPLACE: 'shipments.documents.replace',
  SHIPMENT_DECLARATION_CREATE: 'shipments.declarations.create',
  SHIPMENT_DECLARATION_UPDATE: 'shipments.declarations.update',
  SHIPMENT_CONTAINERS_RECONCILE: 'shipments.containers.reconcile',
  SHIPMENT_CHANGE_REQUEST_REVIEW: 'shipments.change-requests.review',
  SHIPMENT_FULFILLMENTS_DECOMPOSE: 'shipments.fulfillments.decompose',
  SHIPMENT_SUBMIT_FOR_DISPATCH: 'shipments.submit-for-dispatch',
  SHIPMENT_CARRIER_ALLOCATIONS_ASSIGN: 'shipments.carrier-allocations.assign',
  SHIPMENT_FULFILLMENT_PLATE_ASSIGN: 'shipments.fulfillments.plate.assign',
  SHIPMENT_ACCOUNTING_LOCK_ACTIVATE: 'shipments.accounting-lock.activate',
  SHIPMENT_CUS_FINANCE_CONFIRM: 'shipments.cus.finance-confirm',
  SHIPMENT_CUS_PROPOSAL_BILLING_REVIEW: 'shipments.cus.proposal-billing.review',
  SHIPMENT_CUS_CONTAINER_LINE_UPDATE: 'shipments.cus.container-line.update',
  SHIPMENT_CUS_DOCUMENT_CUSTODY_UPDATE: 'shipments.cus.document-custody.update',
  SHIPMENT_CUS_LOCK: 'shipments.cus.lock',
  SHIPMENT_CUS_REOPEN_REQUEST: 'shipments.cus.reopen-request',
  SHIPMENT_CUS_REOPEN_DECISION: 'shipments.cus.reopen-decision',
  SHIPMENT_RECOVERY_RECORD: 'shipments.recovery.record',
  CARRIER_FLEET_VEHICLE_CREATE: 'shipments.carrier-fleet-vehicles.create',
  CARRIER_FLEET_VEHICLE_UPDATE: 'shipments.carrier-fleet-vehicles.update',
  SHIPMENT_FULFILLMENT_ASSIGN: 'shipments.fulfillments.assign',
  SHIPMENT_FULFILLMENT_CANCEL: 'shipments.fulfillments.cancel',
  SHIPMENT_COMPLETE: 'shipments.complete',
  SHIPMENT_DELETE: 'shipments.delete',
  PAYMENTS_RECEIVE: 'payments.receive',
  PAYMENT_REFUNDS_CREATE: 'payment-refunds.create',
  PAYMENTS_VENDOR: 'payments.vendor',
  PAYMENTS_CARRIER: 'payments.carrier',
  TREASURY_ACCOUNT_SETUP: 'treasury.accounts.setup.request',
  TREASURY_ACCOUNT_CUTOVER: 'treasury.accounts.cutover.request',
  TREASURY_MOVEMENT_REVERSAL: 'treasury.movements.reversal.request',
  DRIVER_PAYOUT: 'drivers.payout',
  COMMISSIONS_CREATE: 'commissions.create',
  PENALTIES_CREATE: 'penalties.create',
  PENALTIES_CANCEL: 'penalties.cancel',
  DRIVER_PROGRESS: 'driver.progress',
  DRIVER_FULFILLMENT_COMPLETE: 'driver.fulfillment.complete',
  TRIP_POD_CREATE: 'trips.pod.create',
  TRIP_POD_FILE_ATTACH: 'trips.pod.files.attach',
  TRIP_POD_SUBMIT: 'trips.pod.submit',
  TRIP_POD_REVIEW: 'trips.pod.review',
  SHIPMENT_COMPLETION_RECOMPUTE: 'shipments.completion.recompute',
  DRIVER_INCIDENTAL_COST: 'driver.incidental-cost',
  DEBT_OFFSET_CREATE: 'debt-offsets.create',
  DEBT_OFFSET_APPROVE: 'debt-offsets.approve',
  DEBT_OFFSET_CANCEL: 'debt-offsets.cancel',
  GOVERNANCE_CHECK: 'governance.check',
  GOVERNANCE_APPROVE: 'governance.approve',
  GOVERNANCE_REJECT: 'governance.reject',
  GOVERNANCE_RETURN: 'governance.return-for-evidence',
  GOVERNANCE_CANCEL: 'governance.cancel',
  ADVANCE_REQUEST_APPROVE: 'advance-requests.approve',
  ADVANCE_REQUEST_REJECT: 'advance-requests.reject',
  ADVANCE_SETTLEMENT_CHECK: 'advance-settlements.check',
  ADVANCE_SETTLEMENT_APPROVE: 'advance-settlements.approve',
  ADVANCE_SETTLEMENT_REJECT: 'advance-settlements.reject',
  ADVANCE_SETTLEMENT_REVERSE: 'advance-settlements.reverse',
  ADVANCE_SETTLEMENT_UPDATE: 'advance-settlements.update',
  ADVANCE_SETTLEMENT_EXPENSE_ADJUST: 'advance-settlements.expenses.adjust',
  TRIP_EXPENSE_APPROVE: 'trip-expenses.approve',
  TRIP_EXPENSE_REJECT: 'trip-expenses.reject',
  BILLING_DOCUMENT_CREATE: 'billing-documents.create',
  BILLING_DOCUMENT_UPDATE: 'billing-documents.update',
  BILLING_DOCUMENT_DELETE: 'billing-documents.delete',
  BILLING_DOCUMENT_ADJUSTMENT_REQUEST: 'billing-documents.adjustments.request',
  PORTAL_DEBIT_NOTE_CONFIRM: 'portal.debit-notes.confirm',
  PORTAL_DEBIT_NOTE_DISPUTE: 'portal.debit-notes.dispute',
  SALARY_PERIOD_CLOSE: 'salary-periods.close',
  SALARY_PERIOD_REOPEN: 'salary-periods.reopen',
  SALARY_PERIOD_ADJUSTMENT: 'salary-periods.adjustments.request',
  SALARY_CONFIRM: 'salary.confirm',
  SALARY_UNCONFIRM: 'salary.unconfirm',
  SALARY_WORKDAYS: 'salary.workdays',
  PROFIT_DISTRIBUTE: 'profit-distribute.execute',
  TRIP_PAIR_CREATE: 'trips.pairs.create',
  TRIP_BULK_FIGURES: 'trips.bulk-figures',
  TRIP_FINANCIAL_CLOSE: 'trips.financial-close',
  TRIP_COMPLETED_CANCEL: 'trips.completed-cancel',
  TRIP_DELETE: 'trips.delete',
  TRIP_PRE_DEPARTURE: 'trips.pre-departure',
  TRIP_ACTUALS: 'trips.actuals',
  TRIP_REASSIGN: 'trips.reassign',
  TRIP_UNLOCK: 'trips.unlock',
  TRIP_DEPARTURE_DATE: 'trips.departure-date',
  TRIP_CONTAINERS: 'trips.containers',
  TRIP_INSTRUCTIONS: 'trips.instructions',
  TRIP_ADJUSTMENT: 'trips.adjustment',
  FINANCIAL_ADJUSTMENT_CREATE: 'financial-adjustments.create',
  TRIP_EXPENSE_CREATE: 'trip-expenses.create',
  TRIP_EXPENSE_UPDATE: 'trip-expenses.update',
  TRIP_EXPENSE_DELETE: 'trip-expenses.delete',
  EXPENSE_PHOTO_CREATE: 'expenses.photo.create',
  EXPENSE_PHOTO_DELETE: 'expenses.photo.delete',
  SNAPSHOT_AR_RECAPTURE: 'financial.snapshots.ar.recapture',
  SNAPSHOT_AP_RECAPTURE: 'financial.snapshots.ap.recapture',
  SNAPSHOT_FUEL_SURCHARGE_RECAPTURE: 'financial.snapshots.fuel-surcharge.recapture',
} as const;

/** Stable, sorted-key JSON used as the hash input so key order doesn't matter. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`,
  );
  return `{${pairs.join(',')}}`;
}

/** SHA-256 hex of the canonicalised payload. */
export function hashPayload(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function normalizeIdempotencyKey(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError(
      400,
      `Idempotency-Key không được vượt quá ${MAX_IDEMPOTENCY_KEY_LENGTH} ký tự.`,
    );
  }
  return trimmed;
}

export function resolveIdempotencyKey(args: {
  headerValue?: string | null;
  requestId?: unknown;
}): string | undefined {
  const headerKey = normalizeIdempotencyKey(args.headerValue);
  if (headerKey) return headerKey;
  return normalizeIdempotencyKey(
    typeof args.requestId === 'string' ? args.requestId : undefined,
  );
}

export interface StoredEntity {
  entityType: string;
  entityId: number;
}

export interface IdempotentRunResult<T> {
  /** The stored or newly-created entity. */
  result: T;
  /** True when this call served a replay (no new row was created). */
  replayed: boolean;
  /** Persisted HTTP status for exact command-result replay consumers. */
  statusCode: number;
}

function snapshotJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function defaultEntityId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  if (!('id' in value)) return null;
  const candidate = (value as { id?: unknown }).id;
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : null;
}

/**
 * Look up an existing idempotency-key record. Returns null when none exists.
 * Visible for tests; routes should prefer `runIdempotent`.
 */
export async function findIdempotencyRecord(
  endpoint: string,
  idempotencyKey: string,
) {
  const [row] = await db.select().from(s.idempotencyKeys)
    .where(and(
      eq(s.idempotencyKeys.endpoint, endpoint),
      eq(s.idempotencyKeys.idempotencyKey, idempotencyKey),
    ))
    .limit(1);
  return row ?? null;
}

export async function waitForIdempotencyRecord(
  endpoint: string,
  idempotencyKey: string,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const existing = await findIdempotencyRecord(endpoint, idempotencyKey);
    if (existing) return existing;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Run `create` exactly once per `(endpoint, idempotencyKey)` pair.
 *
 * - No key → call `create`, return `{ result, replayed: false }`.
 * - Key + first call → call `create`, persist `(key → entity)`, return
 *   `{ result, replayed: false }`.
 * - Key + replay, same payload hash → load the stored entity via `load`
 *   and return `{ result, replayed: true }` without calling `create`.
 * - Key + replay, different payload hash → 409.
 *
 * `create` and replay `load` always receive a real transaction so the
 * business write and the idempotency row share the same connection and
 * commit/rollback boundary. This prevents nested-pool starvation when many
 * keyed requests arrive concurrently and keeps the stored entity/key mapping
 * atomic across every caller.
 *
 * Concurrent first calls are serialized with a transaction-scoped PostgreSQL
 * advisory lock derived from `(endpoint, idempotencyKey)`. The second caller
 * waits, then sees the committed key and replays the original entity without
 * entering `create`. The application lock and canonical lookup are the sole
 * uniqueness authority; the database intentionally has no unique constraint.
 */
export async function runIdempotent<T>(args: {
  endpoint: string;
  idempotencyKey: string | undefined;
  payload: unknown;
  createdBy?: number | null;
  transactionOptions?: TransactionOptions;
  responseStatusCode?: number;
  create: (tx: Tx) => Promise<T>;
  load?: (entityId: number, tx: Tx) => Promise<T>;
  entityType?: string | null;
  getEntityId?: (result: T) => number | null | undefined;
  serializeResult?: (result: T) => unknown;
  deserializeResult?: (snapshot: unknown) => T;
  onTransactionRollback?: (error: unknown, created: T | undefined) => Promise<void>;
  getEntityKey?: (result: T) => string | null | undefined;
}): Promise<IdempotentRunResult<T>> {
  const {
    endpoint,
    idempotencyKey,
    payload,
    createdBy,
    transactionOptions,
    responseStatusCode,
    create,
    load,
    entityType,
    getEntityId,
    serializeResult,
    deserializeResult,
    onTransactionRollback,
    getEntityKey,
  } = args;

  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này.');
  }

  const payloadHash = hashPayload(payload);
  const persistedStatusCode = responseStatusCode ?? 200;

  let createdResult: T | undefined;
  try {
    return await db.transaction(async (tx) => {
      await lockApplicationOwnedUniqueness(
        tx,
        'idempotency-key',
        [endpoint, idempotencyKey],
      );

      const [existing] = await tx.select().from(s.idempotencyKeys)
        .where(and(
          eq(s.idempotencyKeys.endpoint, endpoint),
          eq(s.idempotencyKeys.idempotencyKey, idempotencyKey),
        ))
        .limit(1);

      if (existing) {
        const requestedActor = createdBy ?? null;
        const persistedActor = existing.createdBy ?? null;
        if (requestedActor !== persistedActor) {
          throw new ApiError(
            409,
            'Khóa giao dịch này thuộc về người thực hiện khác — vui lòng dùng mã giao dịch mới.',
            `idempotency_key=${idempotencyKey}`,
          );
        }
        if (existing.payloadHash !== payloadHash) {
          throw new ApiError(
            409,
            'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.',
            `idempotency_key=${idempotencyKey}`,
          );
        }
        if (existing.responseSnapshot !== null && existing.responseSnapshot !== undefined) {
          return {
            result: deserializeResult
              ? deserializeResult(existing.responseSnapshot)
              : (existing.responseSnapshot as T),
            replayed: true,
            statusCode: existing.responseStatusCode,
          };
        }
        if (existing.entityId == null || !load) {
          throw new ApiError(
            409,
            'Khóa giao dịch đã được dùng nhưng chưa ghi nhận kết quả — vui lòng dùng mã giao dịch mới.',
            `idempotency_key=${idempotencyKey}`,
          );
        }
        const result = await load(existing.entityId, tx);
        return { result, replayed: true, statusCode: existing.responseStatusCode };
      }

      createdResult = await create(tx);
      const entityId = getEntityId
        ? (getEntityId(createdResult) ?? null)
        : defaultEntityId(createdResult);
      const entityKey = getEntityKey?.(createdResult) ?? undefined;
      const responseSnapshot = snapshotJsonValue(
        serializeResult ? serializeResult(createdResult) : createdResult,
      );
      const responseBody = (
        responseSnapshot
        && typeof responseSnapshot === 'object'
        && !Array.isArray(responseSnapshot)
      ) ? responseSnapshot as Record<string, unknown> : null;
      await tx.insert(s.idempotencyKeys).values({
        endpoint,
        idempotencyKey,
        entityType: entityType ?? null,
        entityId,
        payloadHash,
        responseStatusCode: persistedStatusCode,
        responseSnapshot,
        createdBy: createdBy ?? null,
      });
      await persistMaterialWriteSuccessAuditInTransaction({
        tx,
        statusCode: persistedStatusCode,
        responseBody,
        entityId,
        entityKey,
      });
      return { result: createdResult, replayed: false, statusCode: persistedStatusCode };
    }, transactionOptions);
  } catch (error) {
    if (onTransactionRollback) {
      await onTransactionRollback(error, createdResult);
    }
    throw error;
  }
}
