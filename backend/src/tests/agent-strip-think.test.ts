/**
 * stripThink — content-cleaning regression guard.
 *
 * The hook at openai-runner.ts:cleanContent is the single chokepoint through
 * which ALL model `content` flows before it enters ReAct history or reaches the
 * user. It must scrub two leak classes MiniMax emits inline inside `content`
 * (in addition to the structured `tool_calls` array the orchestrator actually
 * executes):
 *
 *   1. `<think>` reasoning blocks (the original job).
 *   2. `<minimax:tool_call …>` and bare `<tool_call>` markup — a parasitic
 *      duplicate of the model's tool intent that previously rendered verbatim
 *      in the chat bubble (the user-facing leak this guard locks down).
 *
 * These tests FAIL without the tool-call stripping branch and PASS with it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { stripThink } from '../services/llm/minimax.client';

describe('stripThink — reasoning blocks (baseline)', () => {
  test('strips a closed <think> block and keeps surrounding text', () => {
    assert.strictEqual(
      stripThink('Hello <think>secret</think> world'),
      'Hello  world',
    );
  });

  test('strips an unclosed <think> to end of string', () => {
    assert.strictEqual(stripThink('Answer<think>half…'), 'Answer');
  });

  test('returns null when only reasoning was present', () => {
    assert.strictEqual(stripThink('<think>only reasoning</think>'), null);
  });

  test('returns null for empty / null / whitespace-only input', () => {
    assert.strictEqual(stripThink(null), null);
    assert.strictEqual(stripThink(undefined), null);
    assert.strictEqual(stripThink('   '), null);
    assert.strictEqual(stripThink(''), null);
  });
});

describe('stripThink — <minimax:tool_call> markup leak (regression)', () => {
  // The exact leak observed in production: the model emits a tool-call intent
  // inline as content AND in the structured tool_calls array. The inline copy
  // must not survive into the chat bubble.
  test('strips the observed leak: <minimax:tool_call debtReceivable null></minimax:tool_call>', () => {
    const leaked =
      'Trong hệ thống có 2 mẫu giấy báo nợ. ' +
      '<minimax:tool_call debtReceivable null></minimax:tool_call> ' +
      'Để xem các giấy báo nợ đã lập gần đây, bạn vào trang Công nợ phải thu.';
    const cleaned = stripThink(leaked);
    assert.ok(cleaned, 'expected non-null text');
    assert.ok(
      !/minimax:tool_call/i.test(cleaned),
      `markup leaked through: ${cleaned}`,
    );
    assert.ok(
      cleaned.includes('Trong hệ thống có 2 mẫu giấy báo nợ.'),
      'surrounding prose must survive',
    );
    assert.ok(
      cleaned.includes('Để xem các giấy báo nợ đã lập gần đây'),
      'trailing prose must survive',
    );
  });

  test('strips a populated <minimax:tool_call>…</minimax:tool_call> block', () => {
    const cleaned = stripThink(
      'Sure. <minimax:tool_call name="data.search">{"q":"lốp"}</minimax:tool_call> Done.',
    );
    assert.strictEqual(cleaned, 'Sure.  Done.');
  });

  test('strips a self-closing <minimax:tool_call/> tag', () => {
    // Internal double-space is left intact (only ends trimmed) — same contract
    // as the existing <think> stripper. Callers that care normalize whitespace.
    assert.strictEqual(
      stripThink('Before <minimax:tool_call abc/> After'),
      'Before  After',
    );
  });

  test('strips an unclosed <minimax:tool_call> to end of string', () => {
    assert.strictEqual(stripThink('Answer <minimax:tool_call x y z'), 'Answer');
  });

  test('returns null when the content is ONLY tool-call markup', () => {
    assert.strictEqual(
      stripThink('<minimax:tool_call debtReceivable null></minimax:tool_call>'),
      null,
    );
  });
});

describe('stripThink — bare <tool_call> variant', () => {
  test('strips a bare <tool_call>…</tool_call> block', () => {
    assert.strictEqual(
      stripThink('Hi <tool_call>{"name":"x"}</tool_call> there'),
      'Hi  there',
    );
  });

  test('strips a self-closing bare <tool_call/> tag', () => {
    assert.strictEqual(stripThink('A <tool_call/> B'), 'A  B');
  });
});

describe('stripThink — combined reasoning + tool-call markup', () => {
  test('strips both <think> and <minimax:tool_call> in one pass', () => {
    const input =
      '<think>planning</think>Let me look that up. ' +
      '<minimax:tool_call data.search null></minimax:tool_call> Here you go.';
    const cleaned = stripThink(input);
    assert.strictEqual(cleaned, 'Let me look that up.  Here you go.');
  });
});
