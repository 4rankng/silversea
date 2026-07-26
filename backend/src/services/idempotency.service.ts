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

/** Tag identifying the logical endpoint (e.g. 'shipments.quick-create'). */
export const IDEMPOTENCY_ENDPOINTS = {
  SHIPMENT_QUICK_CREATE: 'shipments.quick-create',
  DRIVER_PROGRESS: 'driver.progress',
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
 * `create` runs inside the caller's responsibility — it is NOT wrapped in
 * an outer transaction here because typical `create` impls (e.g.
 * `createShipment`) open their own transaction and may also enqueue audit
 * events. The idempotency row is inserted after `create` succeeds so a
 * failure of `create` leaves no orphan key.
 *
 * Race window: two concurrent first-calls with the same key can both pass
 * the `findIdempotencyRecord` lookup and both call `create`. The
 * `uniqueIndex(endpoint, idempotencyKey)` then rejects the second insert;
 * we catch that and behave as a replay (load + return the stored entity).
 * The loser of the race therefore creates zero duplicate shipments.
 */
export async function runIdempotent<T>(args: {
  endpoint: string;
  idempotencyKey: string | undefined;
  payload: unknown;
  createdBy?: number | null;
  create: () => Promise<T & { id: number }>;
  load: (entityId: number) => Promise<T>;
  entityType: string;
}): Promise<IdempotentRunResult<T>> {
  const { endpoint, idempotencyKey, payload, createdBy, create, load, entityType } = args;

  // No key → non-idempotent path. Caller still gets a normal result.
  if (!idempotencyKey) {
    const result = await create();
    return { result, replayed: false };
  }

  const payloadHash = hashPayload(payload);
  const existing = await findIdempotencyRecord(endpoint, idempotencyKey);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new ApiError(
        409,
        'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.',
        `idempotency_key=${idempotencyKey}`,
      );
    }
    if (!existing.entityId) {
      // Defensive: a stored key with no entityId means a previous write
      // finished but did not record its entity. Treat as conflict so the
      // client retries with a fresh key rather than silently no-oping.
      throw new ApiError(
        409,
        'Khóa giao dịch đã được dùng nhưng chưa ghi nhận kết quả — vui lòng dùng mã giao dịch mới.',
        `idempotency_key=${idempotencyKey}`,
      );
    }
    const result = await load(existing.entityId);
    return { result, replayed: true };
  }

  // First-call path. Run create, then persist the key. The unique index
  // closes the concurrent-replay race (see docstring).
  const created = await create();
  try {
    await db.insert(s.idempotencyKeys).values({
      endpoint,
      idempotencyKey,
      entityType,
      entityId: created.id,
      payloadHash,
      createdBy: createdBy ?? null,
    });
  } catch (err) {
    // Unique violation → a concurrent caller won the race. Behave as a
    // replay: load whatever the winner stored and return it.
    const concurrent = await findIdempotencyRecord(endpoint, idempotencyKey);
    if (concurrent) {
      if (concurrent.payloadHash !== payloadHash) {
        throw new ApiError(
          409,
          'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.',
          `idempotency_key=${idempotencyKey}`,
        );
      }
      if (!concurrent.entityId) {
        throw new ApiError(
          409,
          'Khóa giao dịch đã được dùng nhưng chưa ghi nhận kết quả — vui lòng dùng mã giao dịch mới.',
          `idempotency_key=${idempotencyKey}`,
        );
      }
      const result = await load(concurrent.entityId);
      return { result, replayed: true };
    }
    throw err;
  }
  return { result: created, replayed: false };
}
