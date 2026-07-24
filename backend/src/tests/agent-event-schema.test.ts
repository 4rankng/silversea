/**
 * AG-UI event-taxonomy contract test (Phase 1).
 *
 * Locks down the renamed `agentEventSchema` contract: the discriminator is now
 * `type` (AG-UI BaseEvent convention), the six event literals are SCREAMING-
 * CASE AG-UI lifecycle/tool names, and three text-message streaming events
 * were added. Also guards the two LANDMINES surfaced by the rename scout:
 *
 *   1. `agentResponseSchema` STILL uses `type:'directive'` (the *response*
 *      discriminator, unrelated to the event stream) — must not have been
 *      swept up in the event rename.
 *   2. `agentActionResultSchema.status` STILL uses `'ok'|'error'|'timeout'` —
 *      the `'error'` there is NOT the event literal.
 *
 * If any assertion here fails, a rename regressed an unrelated contract.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  agentEventSchema,
  agentResponseSchema,
  agentActionResultSchema,
} from '@tingting/shared';

describe('agentEventSchema — AG-UI taxonomy (Phase 1 rename)', () => {
  test('RUN_STARTED parses (old "received" fails)', () => {
    assert.ok(agentEventSchema.safeParse({ type: 'RUN_STARTED' }).success);
    // Old discriminator field + literal must now REJECT.
    assert.ok(!agentEventSchema.safeParse({ event: 'received' }).success);
  });

  test('TOOL_CALL_START parses with toolName + optional args', () => {
    const ok = agentEventSchema.safeParse({
      type: 'TOOL_CALL_START',
      toolName: 'data.search',
      args: { q: 'lốp' },
    });
    assert.ok(ok.success, 'TOOL_CALL_START should parse');
    // Old literal fails.
    assert.ok(!agentEventSchema.safeParse({ event: 'tool_start', toolName: 'x' }).success);
  });

  test('TOOL_CALL_END parses with ok flag + label', () => {
    assert.ok(
      agentEventSchema.safeParse({
        type: 'TOOL_CALL_END',
        toolName: 'report.run',
        ok: true,
        label: '3 chuyến',
      }).success,
    );
    assert.ok(
      !agentEventSchema.safeParse({ event: 'tool_result', toolName: 'x', ok: true }).success,
    );
  });

  test('DIRECTIVE event parses with directive payload + ack fields', () => {
    const ok = agentEventSchema.safeParse({
      type: 'DIRECTIVE',
      directive: { kind: 'navigate', routeKey: 'dashboard' },
      actionId: 'abc-123',
      requiresAck: true,
    });
    assert.ok(ok.success, 'DIRECTIVE should parse');
    assert.ok(!agentEventSchema.safeParse({ event: 'directive', directive: {} }).success);
  });

  test('RUN_FINISHED parses with a valid AgentResponse', () => {
    assert.ok(
      agentEventSchema.safeParse({
        type: 'RUN_FINISHED',
        response: { type: 'text', content: 'Xin chào' },
        conversationId: '5',
      }).success,
    );
    assert.ok(!agentEventSchema.safeParse({ event: 'done', response: {} }).success);
  });

  test('RUN_ERROR parses with a message', () => {
    assert.ok(agentEventSchema.safeParse({ type: 'RUN_ERROR', message: 'Lỗi' }).success);
    assert.ok(!agentEventSchema.safeParse({ event: 'error', message: 'x' }).success);
  });
});

describe('agentEventSchema — text-message streaming events (Phase 2)', () => {
  test('TEXT_MESSAGE_START parses with messageId', () => {
    assert.ok(
      agentEventSchema.safeParse({ type: 'TEXT_MESSAGE_START', messageId: 'm_1' }).success,
    );
    // missing messageId must fail
    assert.ok(!agentEventSchema.safeParse({ type: 'TEXT_MESSAGE_START' }).success);
  });

  test('TEXT_MESSAGE_CONTENT parses with messageId + non-empty delta', () => {
    assert.ok(
      agentEventSchema.safeParse({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'm_1',
        delta: 'Xin ',
      }).success,
    );
  });

  test('TEXT_MESSAGE_END parses with messageId', () => {
    assert.ok(
      agentEventSchema.safeParse({ type: 'TEXT_MESSAGE_END', messageId: 'm_1' }).success,
    );
  });
});

describe('landmine guard — unrelated contracts unchanged by the event rename', () => {
  test('agentResponseSchema STILL uses type:"directive" (response discriminator)', () => {
    // The EVENT rename changed event "directive" → "DIRECTIVE". The RESPONSE
    // type "directive" is a separate union and must be untouched.
    assert.ok(
      agentResponseSchema.safeParse({
        type: 'directive',
        directive: { kind: 'navigate', routeKey: 'fleet' },
      }).success,
      'agentResponseSchema directive variant must still parse',
    );
  });

  test('agentActionResultSchema.status STILL includes "error" (ack status enum)', () => {
    assert.ok(agentActionResultSchema.safeParse({ actionId: 'a', status: 'error' }).success);
    assert.ok(agentActionResultSchema.safeParse({ actionId: 'a', status: 'ok' }).success);
    assert.ok(agentActionResultSchema.safeParse({ actionId: 'a', status: 'timeout' }).success);
  });
});
