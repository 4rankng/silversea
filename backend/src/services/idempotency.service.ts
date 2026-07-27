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
import { and, eq, sql } from 'drizzle-orm';
import { ApiError } from '../errors';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** Tag identifying the logical endpoint (e.g. 'shipments.quick-create'). */
export const IDEMPOTENCY_ENDPOINTS = {
  SHIPMENT_QUICK_CREATE: 'shipments.quick-create',
  PAYMENTS_RECEIVE: 'payments.receive',
  PAYMENTS_VENDOR: 'payments.vendor',
  PAYMENTS_CARRIER: 'payments.carrier',
  DRIVER_PAYOUT: 'drivers.payout',
  COMMISSIONS_CREATE: 'commissions.create',
  PENALTIES_CREATE: 'penalties.create',
  PENALTIES_CANCEL: 'penalties.cancel',
  DRIVER_PROGRESS: 'driver.progress',
  DRIVER_INCIDENTAL_COST: 'driver.incidental-cost',
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
 * entering `create`. The unique index remains a database-level safety net.
 */
export async function runIdempotent<T>(args: {
  endpoint: string;
  idempotencyKey: string | undefined;
  payload: unknown;
  createdBy?: number | null;
  create: (tx: Tx) => Promise<T & { id: number }>;
  load: (entityId: number, tx: Tx) => Promise<T>;
  entityType: string;
}): Promise<IdempotentRunResult<T>> {
  const { endpoint, idempotencyKey, payload, createdBy, create, load, entityType } = args;

  // No key → caller still gets a normal result, but on the same transaction
  // contract as the keyed path.
  if (!idempotencyKey) {
    return db.transaction(async (tx) => {
      const result = await create(tx);
      return { result, replayed: false };
    });
  }

  const payloadHash = hashPayload(payload);
  const lockKey = `${endpoint}\u001f${idempotencyKey}`;

  return db.transaction(async (tx) => {
    // hashtextextended returns one stable int8 key. Transaction scope releases
    // the lock automatically on commit/rollback, including thrown create errors.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );

    const [existing] = await tx.select().from(s.idempotencyKeys)
      .where(and(
        eq(s.idempotencyKeys.endpoint, endpoint),
        eq(s.idempotencyKeys.idempotencyKey, idempotencyKey),
      ))
      .limit(1);

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ApiError(
          409,
          'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.',
          `idempotency_key=${idempotencyKey}`,
        );
      }
      if (!existing.entityId) {
        throw new ApiError(
          409,
          'Khóa giao dịch đã được dùng nhưng chưa ghi nhận kết quả — vui lòng dùng mã giao dịch mới.',
          `idempotency_key=${idempotencyKey}`,
        );
      }
      const result = await load(existing.entityId, tx);
      return { result, replayed: true };
    }

    const created = await create(tx);
    await tx.insert(s.idempotencyKeys).values({
      endpoint,
      idempotencyKey,
      entityType,
      entityId: created.id,
      payloadHash,
      createdBy: createdBy ?? null,
    });
    return { result: created, replayed: false };
  });
}
