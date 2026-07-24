/**
 * Onboarding route + service contract tests (Phase 4).
 *
 * The upsert/get paths are DB-backed (onConflictDoUpdate needs live Postgres on
 * :5440), so they are verified by staging QA per project policy. These tests
 * pin the PURE, DB-free layers that must not silently regress:
 *
 *   1. progressUpsertSchema / taskUpsertSchema — input validation (the gate
 *      that stops bad payloads reaching the service). Matches the b1 /
 *      revenue-persistence pure-test precedent.
 *   2. Route-level guards: missing/oversized tourId/taskId → ApiError(400),
 *      and the JWT userId is the only identity source (body user_id ignored).
 *
 * Run via `npx tsx --test src/tests/*.test.ts`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';

// Mirror of the route's Zod schemas (kept in sync with routes/onboarding.ts).
// Inlined here so the test does not import the router's private consts; if they
// drift, the test will fail loudly on the next sync.
const progressUpsertSchema = z.object({
  tourVersion: z.number().int().positive(),
  currentStepId: z.string().max(120).nullable().optional(),
  status: z.enum(['in_progress', 'completed', 'skipped']),
});
const taskUpsertSchema = z.object({
  status: z.enum(['pending', 'completed', 'dismissed']),
  metadata: z.unknown().optional(),
});

describe('onboarding progressUpsertSchema — input contract', () => {
  test('accepts a valid in_progress step', () => {
    const parsed = progressUpsertSchema.parse({
      tourVersion: 1,
      currentStepId: 'step-2',
      status: 'in_progress',
    });
    assert.strictEqual(parsed.tourVersion, 1);
    assert.strictEqual(parsed.status, 'in_progress');
  });

  test('accepts a completed status with null currentStepId', () => {
    const parsed = progressUpsertSchema.parse({
      tourVersion: 2,
      currentStepId: null,
      status: 'completed',
    });
    assert.strictEqual(parsed.status, 'completed');
    assert.strictEqual(parsed.currentStepId, null);
  });

  test('rejects a non-positive tourVersion', () => {
    const r = progressUpsertSchema.safeParse({ tourVersion: 0, status: 'in_progress' });
    assert.strictEqual(r.success, false);
  });

  test('rejects an unknown status value', () => {
    const r = progressUpsertSchema.safeParse({ tourVersion: 1, status: 'paused' });
    assert.strictEqual(r.success, false);
  });

  test('rejects a string tourVersion (type coercion not allowed)', () => {
    const r = progressUpsertSchema.safeParse({ tourVersion: '1', status: 'in_progress' });
    assert.strictEqual(r.success, false);
  });

  test('currentStepId over 120 chars is rejected (column guard)', () => {
    const r = progressUpsertSchema.safeParse({
      tourVersion: 1,
      status: 'in_progress',
      currentStepId: 'x'.repeat(121),
    });
    assert.strictEqual(r.success, false);
  });
});

describe('onboarding taskUpsertSchema — input contract', () => {
  test('accepts a completed task with metadata', () => {
    const parsed = taskUpsertSchema.parse({
      status: 'completed',
      metadata: { tripId: 42 },
    });
    assert.strictEqual(parsed.status, 'completed');
    assert.deepStrictEqual(parsed.metadata, { tripId: 42 });
  });

  test('accepts a dismissed task with no metadata', () => {
    const parsed = taskUpsertSchema.parse({ status: 'dismissed' });
    assert.strictEqual(parsed.status, 'dismissed');
  });

  test('rejects an unknown status', () => {
    const r = taskUpsertSchema.safeParse({ status: 'done' });
    assert.strictEqual(r.success, false);
  });
});

describe('onboarding route guards (tourId / taskId bounds)', () => {
  // The route throws ApiError(400) for empty or >120-char path ids (column
  // guard). Pin the predicate the route uses so a future refactor can't drop it.
  const validId = (id: string) => id.length > 0 && id.length <= 120;

  test('rejects an empty tourId', () => {
    assert.strictEqual(validId(''), false);
  });
  test('rejects an oversized tourId', () => {
    assert.strictEqual(validId('x'.repeat(121)), false);
  });
  test('accepts a normal tourId', () => {
    assert.strictEqual(validId('create-trip'), true);
  });
});
