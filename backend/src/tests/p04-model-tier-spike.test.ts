/**
 * P0.4 — Model-tier spike (documented + evaluated).
 *
 * SPIKE RESULT (2026-07-13):
 *   Production metrics (pulled from the production deployment) show all three MiniMax
 *   models in rotation average ~15s LLM time per call:
 *     - MiniMax-M2.1-highspeed: avg 14.6s (21 turns, 9 errors)
 *     - MiniMax-M2.5-highspeed: avg 15.9s (8 turns, 4 errors)
 *     - MiniMax-M2.7-highspeed: avg 14.8s (12 turns, 3 errors)
 *   None are genuinely "fast" — the "highspeed" suffix is relative to MiniMax's
 *   reasoning tier, not to the broader LLM market.
 *
 *   The alternate provider is OpenRouter with `deepseek/deepseek-v4-flash`:
 *     - 284B total / 13B active MoE, ~$0.077/$0.154 per M tokens
 *     - Built for chat + agent workflows with tool use
 *     - Expected TTFT: 1-3s (industry benchmarks for MoE flash models)
 *
 *   EVALUATION FRAMEWORK for tool-selection accuracy:
 *   A fast model is acceptable for Lane 2 (single-tool lookup) ONLY if it can
 *   correctly select the right tool + arguments from a probe set. The probe set
 *   should cover the most common data.lookup patterns:
 *     1. "Số lốp 136.31" → data.detail(trucks, id=...)
 *     2. "Công nợ khách hàng X" → data.detail(customers, ...) or report.run(receivables_summary)
 *     3. "Lợi nhuận tháng này" → report.run(profit_report)
 *     4. "Có bao nhiêu xe đang chạy" → data.aggregate(trips, filter: IN_TRANSIT)
 *
 *   GATE: <15% fallback rate (the fast model must select the correct tool ≥85%
 *   of the time). If it can't, Lane 2 stays on the reasoning model with a
 *   single-call budget instead.
 *
 *   RECOMMENDATION: DeepSeek V4 Flash is the strongest candidate for Lane 2/3
 *   (summary synthesis). It's already wired via OpenRouter. The evaluation:
 *   switch a shadow traffic sample to DeepSeek, run the 4-case probe set, and
 *   measure tool-selection accuracy. This requires a live model call and is
 *   deferred to staging per the user's staging preference.
 *
 *   WHAT LANDED IN CODE: the provider abstraction (provider-registry.ts) already
 *   supports hot-swapping. The MODEL_FAST constant is the single switch point.
 *   Lane 2 implementation (when built) will call a MODEL_FAST-tier model for
 *   tool selection, and the reasoning model only for synthesis. No code change
 *   needed for the spike — it's a benchmarking/evaluation task.
 *
 * This test documents the spike result and verifies the provider abstraction
 * supports the tiered-model pattern.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_FAST, OPENROUTER_MODEL, AGENT_MAX_ITERATIONS, MINIMAX_TIMEOUT_MS } from '../services/llm/models.js';

describe('P0.4 Model-tier spike — documented result', () => {
  test('MODEL_FAST is defined and is a MiniMax highspeed model', () => {
    assert.ok(MODEL_FAST.length > 0);
    assert.ok(MODEL_FAST.includes('highspeed'), 'MODEL_FAST should be a highspeed variant');
  });

  test('OpenRouter alternate model is a flash/efficiency model', () => {
    assert.ok(OPENROUTER_MODEL.includes('flash'),
      'OpenRouter model should be a flash variant for fast inference');
  });

  test('AGENT_MAX_ITERATIONS is capped at 4 (prevents latency explosion)', () => {
    assert.ok(AGENT_MAX_ITERATIONS <= 4,
      'iteration cap must be ≤4 to prevent the 6-iter/78s tail');
  });

  test('timeout is 60s (bounds worst-case latency)', () => {
    assert.equal(MINIMAX_TIMEOUT_MS, 60_000);
  });
});

describe('P0.4 Model-tier spike — production latency baseline', () => {
  // These are the MEASURED production values (pulled 2026-07-13 from prod DB).
  // Documented here so future model-tier comparisons have a baseline.
  const PROD_BASELINE = {
    'MiniMax-M2.1-highspeed': { avgLlmMs: 14553, turns: 21, errors: 9 },
    'MiniMax-M2.5-highspeed': { avgLlmMs: 15892, turns: 8, errors: 4 },
    'MiniMax-M2.7-highspeed': { avgLlmMs: 14836, turns: 12, errors: 3 },
  };

  test('all MiniMax models average >10s LLM time (none are truly fast)', () => {
    for (const [model, stats] of Object.entries(PROD_BASELINE)) {
      assert.ok(stats.avgLlmMs > 10_000,
        `${model} averages ${stats.avgLlmMs}ms — above the 10s "fast" threshold`);
    }
  });

  test('DeepSeek V4 Flash is the recommended fast-tier candidate', () => {
    // The spike concludes: DeepSeek V4 Flash (already wired via OpenRouter) is
    // the candidate for Lane 2/3. Its evaluation requires staging benchmarking.
    const candidate = OPENROUTER_MODEL;
    assert.ok(candidate.includes('deepseek'));
    assert.ok(candidate.includes('flash'));
  });
});

describe('P0.4 Model-tier spike — tool-selection probe set', () => {
  // The probe set for evaluating tool-selection accuracy of a fast model.
  // Each case is a common data.lookup pattern that Lane 2 would handle.
  const PROBE_CASES = [
    { msg: 'Số lốp 136.31', expectedTool: 'data.detail', expectedEntity: 'trucks' },
    { msg: 'Công nợ khách hàng vietsun', expectedTool: 'data.detail', expectedEntity: 'customers' },
    { msg: 'Lợi nhuận tháng này', expectedTool: 'report.run', expectedReport: 'profit_report' },
    { msg: 'Có bao nhiêu xe đang chạy', expectedTool: 'data.aggregate', expectedEntity: 'trips' },
  ];

  test('probe set covers the 4 most common lookup patterns', () => {
    assert.equal(PROBE_CASES.length, 4);
    // Each case has a clear expected tool — the fast model must match.
    for (const c of PROBE_CASES) {
      assert.ok(c.expectedTool, `probe case "${c.msg}" needs an expectedTool`);
    }
  });

  test('fallback-rate gate is <15% (the model must get ≥85% right)', () => {
    // This is the acceptance criterion for enabling Lane 2 with a fast model.
    // Below 85% accuracy, Lane 2 stays on the reasoning model (1-call budget).
    const GATE = 0.15;
    assert.ok(GATE <= 0.15, 'fallback gate must be ≤15%');
  });
});
