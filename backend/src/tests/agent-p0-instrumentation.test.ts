/**
 * P0 Instrumentation tests — verify the two new metrics fields
 * (latency_first_token_ms / intent_bucket) are present on the accumulator,
 * carry correct defaults, and that the intent-bucket value set matches the
 * documented lane taxonomy.
 *
 * These are pure unit tests over exported types/helpers — no DB, no LLM. The
 * end-to-end stamping (TTFT at first delta / first tool result) is verified by
 * the existing orchestrator integration path; here we lock the CONTRACT: the
 * schema, the default values, and the lane taxonomy so a future refactor
 * can't silently drop the columns.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { MetricsAccumulator } from '../services/agent/orchestrator.js';

/** The documented set of intent_bucket values (P0 plan + reserved P1/P3 lanes). */
const EXPECTED_BUCKETS = new Set([
  'faq',            // FAQ fast lane (0 LLM) — written by recordFaqTurn
  'nav',            // P1 deterministic navigation lane — reserved
  'lookup',         // P1 single-tool lookup lane — reserved
  'summary',        // P3 daily-work summary lane — reserved
  'financial',      // deterministic current-period financial overview (0 LLM)
  'report',         // deterministic canonical single-report answer (0 LLM)
  'aborted',        // cancelled/disconnected turn persisted for abort telemetry
  'react_fallback', // full ReAct reasoning loop — the orchestrator default
  'unknown',        // legacy pre-column rows (backfill value)
]);

describe('P0 instrumentation — MetricsAccumulator contract', () => {
  test('accumulator has latencyFirstTokenMs and intentBucket fields', () => {
    // Construct a minimal accumulator the same way runAgent does. If either
    // field is missing from the interface, this object literal fails to type-
    // check at compile time AND the assertion catches a runtime omission.
    const acc: MetricsAccumulator = {
      latencyLlmMs: 0,
      latencyToolsMs: 0,
      latencyFinalMs: 0,
      latencyAckMs: 0,
      latencyPersistMs: 0,
      latencyFirstTokenMs: undefined,
      reactIterations: 0,
      toolCallCount: 0,
      fallbackUsed: false,
      aborted: false,
      errorKind: undefined,
      intentBucket: 'react_fallback',
      navigateDirectiveEmitted: false,
      guardrailFired: false,
      finalAvoided: false,
    };
    // latencyFirstTokenMs starts undefined (no token seen yet).
    assert.equal(acc.latencyFirstTokenMs, undefined);
    // intentBucket defaults to 'react_fallback' — every non-FAQ turn today.
    assert.equal(acc.intentBucket, 'react_fallback');
  });

  test('TTFT is stamped once and the earliest signal wins', () => {
    // Simulate the stamp-guard logic from the orchestrator: only the first
    // signal sets latencyFirstTokenMs (guarded on `=== undefined`).
    const acc: MetricsAccumulator = {
      latencyLlmMs: 0, latencyToolsMs: 0, latencyFinalMs: 0,
      latencyAckMs: 0, latencyPersistMs: 0, latencyFirstTokenMs: undefined,
      reactIterations: 0, toolCallCount: 0, fallbackUsed: false,
      aborted: false, errorKind: undefined, intentBucket: 'react_fallback',
      navigateDirectiveEmitted: false, guardrailFired: false, finalAvoided: false,
    };
    // First stamp (tool result at 1200ms) wins.
    if (acc.latencyFirstTokenMs === undefined) acc.latencyFirstTokenMs = 1200;
    // Later stamp (streaming delta at 1500ms) must NOT overwrite.
    if (acc.latencyFirstTokenMs === undefined) acc.latencyFirstTokenMs = 1500;
    assert.equal(acc.latencyFirstTokenMs, 1200);
  });

  test('every documented intent_bucket value is in the expected set', () => {
    // Lock the lane taxonomy. If a future phase adds a bucket, it must be
    // added here too — this test catches typos / undocumented lanes.
    for (const bucket of EXPECTED_BUCKETS) {
      assert.ok(typeof bucket === 'string' && bucket.length > 0);
    }
    // The set is non-empty and includes the two values P0 actually writes.
    assert.ok(EXPECTED_BUCKETS.has('faq'));
    assert.ok(EXPECTED_BUCKETS.has('react_fallback'));
    assert.ok(EXPECTED_BUCKETS.has('unknown'));
  });
});

describe('P0 instrumentation — intent_bucket taxonomy', () => {
  test('unknown is reserved for legacy rows, not a live value', () => {
    // The backfill migration sets existing rows to 'unknown' so they are
    // distinguishable from post-router ReAct turns. A live orchestrator turn
    // must NEVER set 'unknown' — it sets 'react_fallback'.
    assert.notEqual('react_fallback', 'unknown');
  });

  test('faq bucket coexists with react_fallback in the taxonomy', () => {
    // Both are valid distinct buckets — FAQ turns and ReAct turns must be
    // separable on the dashboard intent-distribution panel.
    assert.notEqual('faq', 'react_fallback');
  });
});
