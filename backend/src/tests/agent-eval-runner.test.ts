/**
 * P5 Evaluation framework — behavioral eval runner.
 *
 * Loads the golden Q/A set from golden-qa.json and asserts that routeIntent
 * classifies each message into the expected lane. This is the deterministic
 * (non-LLM) layer of the eval framework: it catches intent-routing
 * regressions without needing a live model.
 *
 * Run via: `cd backend && pnpm test:eval` (or as part of the regular test suite).
 *
 * The LLM-dependent layer (answer correctness, data-analysis accuracy) requires
 * a live model + DB and is deferred to staging. Here we lock the ROUTING layer
 * — the part that's deterministic and testable without external dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeIntent } from '../services/agent/intent-router.js';

interface GoldenCase {
  id: string;
  message: string;
  expectedLane: 'nav' | 'summary' | 'react';
  expectedRouteKey?: string;
  desc: string;
}

const __dirname_eval = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(__dirname_eval, 'agent-eval', 'golden-qa.json');
const goldenCases: GoldenCase[] = JSON.parse(readFileSync(goldenPath, 'utf-8'));

describe('P5 Eval — golden Q/A routing (deterministic layer)', () => {
  let passCount = 0;

  for (const tc of goldenCases) {
    test(`${tc.id}: ${tc.desc}`, () => {
      const decision = routeIntent(tc.message);
      assert.equal(
        decision.lane,
        tc.expectedLane,
        `[${tc.id}] expected lane='${tc.expectedLane}' for "${tc.message}", got '${decision.lane}' (${decision.reason})`,
      );
      if (tc.expectedRouteKey && decision.lane === 'nav' && decision.directive) {
        const actualKey = decision.directive.kind === 'navigate' ? decision.directive.routeKey : '';
        assert.equal(
          actualKey,
          tc.expectedRouteKey,
          `[${tc.id}] expected routeKey='${tc.expectedRouteKey}', got '${actualKey}'`,
        );
      }
      passCount++;
    });
  }

  // Aggregate gate: ≥90% of golden cases must route correctly.
  test('golden Q/A routing rate ≥ 90%', () => {
    assert.ok(goldenCases.length > 0, 'golden Q/A dataset must not be empty');
    const rate = passCount / goldenCases.length;
    assert.ok(
      rate >= 0.9,
      `golden Q/A routing rate ${(rate * 100).toFixed(1)}% is below the 90% gate`,
    );
  });
});
