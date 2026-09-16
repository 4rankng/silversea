import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { findIdempotencyRecord, hashPayload, runIdempotent } from '../services/idempotency.service';
import { withTestCleanup } from './helpers/db-isolation';
import { disconnectRedis } from '../lib/redis';

// Step 1.3 (plan: backend-atomic-falcon): the DB unique index
// idempotency_keys_endpoint_key_uniq is the backstop behind the advisory
// lock. When a bypass writer inserts the same (endpoint, key) row mid-flight,
// our own idempotency-row insert trips 23505 and the business tx rolls back.
// runIdempotent must then REPLAY from the winning row instead of surfacing
// the constraint error. Red-first: without the catch-and-replay this test
// errors with the raw 23505 and leaves exactly one (bypass) row.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup = withTestCleanup();
const keyRows: Array<{ endpoint: string; key: string }> = [];

after(async () => {
  for (const { endpoint, key } of keyRows) {
    await db.delete(s.idempotencyKeys).where(and(eq(s.idempotencyKeys.endpoint, endpoint), eq(s.idempotencyKeys.idempotencyKey, key)));
  }
  await client.end({ timeout: 1 });
  await disconnectRedis();
});

describe('q23 idempotency unique-backstop replay (step 1.3)', () => {
  const endpoint = 'test:unique-backstop';

  test('matching-hash bypass insert → 23505 → replayed with exactly one row', async () => {
    const key = `qa-bs-${suffix}-ok`;
    keyRows.push({ endpoint, key });
    const payload = { amount: 42 };

    const result = await runIdempotent<{ source: string; id: number }>({
      endpoint,
      idempotencyKey: key,
      payload,
      entityType: 'backstop_probe',
      create: async () => {
        // Bypass writer: same (endpoint, key), matching hash, an entityId and
        // no snapshot — the exact shape replayFromRecord can serve.
        await db.insert(s.idempotencyKeys).values({
          endpoint,
          idempotencyKey: key,
          entityType: 'backstop_probe',
          entityId: 777,
          payloadHash: hashPayload(payload),
          responseStatusCode: 200,
          responseSnapshot: null,
        });
        return { source: 'create', id: 777 };
      },
      load: async (id) => ({ source: 'load', id }),
    });

    assert.equal(result.replayed, true);
    assert.deepEqual(result.result, { source: 'load', id: 777 });
    const row = await findIdempotencyRecord(endpoint, key);
    assert.ok(row);
    assert.equal(row.entityId, 777);
    const rows = await db.select().from(s.idempotencyKeys).where(and(eq(s.idempotencyKeys.endpoint, endpoint), eq(s.idempotencyKeys.idempotencyKey, key)));
    assert.equal(rows.length, 1);
  });

  test('different-hash bypass insert → 409, no replay', async () => {
    const key = `qa-bs-${suffix}-hash`;
    keyRows.push({ endpoint, key });
    const payload = { amount: 42 };

    await assert.rejects(
      runIdempotent({
        endpoint,
        idempotencyKey: key,
        payload,
        entityType: 'backstop_probe',
        create: async () => {
          await db.insert(s.idempotencyKeys).values({
            endpoint,
            idempotencyKey: key,
            entityType: 'backstop_probe',
            entityId: 888,
            payloadHash: hashPayload({ amount: 43 }),
            responseStatusCode: 200,
            responseSnapshot: null,
          });
          return { source: 'create', id: 888 };
        },
      }),
      (error: unknown) => {
        const e = error as { statusCode?: number; message?: string };
        assert.equal(e.statusCode, 409);
        assert.match(e.message ?? '', /nội dung khác/);
        return true;
      },
    );
    const rows = await db.select().from(s.idempotencyKeys).where(and(eq(s.idempotencyKeys.endpoint, endpoint), eq(s.idempotencyKeys.idempotencyKey, key)));
    assert.equal(rows.length, 1);
  });
});
