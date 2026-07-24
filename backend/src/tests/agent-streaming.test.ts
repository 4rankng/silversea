/**
 * Streaming primitive tests (Phase 2).
 *
 * `runOpenAiStreamingCompletion` is the lowest-risk, highest-leverage piece of
 * the token-streaming work: it parses an OpenAI SSE stream and invokes `onText`
 * per content delta while assembling fragmented tool_calls. These tests feed it
 * a crafted `ReadableStream` (no network) so the behaviour is deterministic.
 *
 * The orchestrator's peek-then-commit heuristic (suppress streaming for
 * JSON-leading content) is verified via `runOpenAiStreamingCompletion`'s
 * `onText` contract: the runner always invokes onText for every content delta;
 * the orchestrator layer decides whether to forward. So we test the runner's
 * delta order + accumulation here, and the JSON-suppression decision lives in
 * the orchestrator (covered by the type system + manual verification).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { runOpenAiStreamingCompletion } from '../services/llm/openai-runner';

/** Build a ReadableStream<Uint8Array> from an array of string chunks, each
 *  emitted as one `value` to the reader (simulates SSE chunk boundaries). */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

/** Minimal cfg that returns the mock stream via a fetch override. We stub fetch
 *  globally so the runner's `fetch(...)` resolves to our crafted SSE. */
function withMockFetch<T>(body: ReadableStream<Uint8Array>, fn: () => Promise<T>): Promise<T> {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      body,
      // Unused by the streaming path but keep for shape safety.
      text: async () => '',
    }) as unknown as Response) as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = origFetch;
  });
}

const cfg = {
  providerId: 'minimax',
  baseUrl: 'https://example.test/v1',
  apiKey: 'k',
  model: 'test-model',
  timeoutMs: 10_000,
};

describe('runOpenAiStreamingCompletion — SSE parsing', () => {
  test('emits content deltas in order and accumulates into final content', async () => {
    const deltas: string[] = [];
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, (d) => deltas.push(d)),
    );
    assert.deepStrictEqual(deltas, ['Hello', ' world', '!']);
    assert.strictEqual(result.content, 'Hello world!');
    assert.strictEqual(result.finishReason, null);
    assert.deepStrictEqual(result.toolCalls, []);
  });

  test('captures finish_reason from the final chunk', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, () => {}),
    );
    assert.strictEqual(result.finishReason, 'stop');
    assert.strictEqual(result.content, 'hi');
  });

  test('assembles fragmented tool_calls by index', async () => {
    // Build SSE chunks with a JSON helper so the nested-quote escaping is
    // unambiguous (the arguments field is itself a JSON string of JSON).
    const mk = (delta: unknown, finishReason?: string) => {
      const choice: unknown = finishReason
        ? { delta, finish_reason: finishReason }
        : { delta };
      return `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
    };
    const body = sseStream([
      // First fragment: id + name + start of arguments
      mk({
        tool_calls: [
          { index: 0, id: 'call_1', type: 'function', function: { name: 'data.search', arguments: '{"q":' } },
        ],
      }),
      // Second fragment: rest of arguments (no id/name — same index)
      mk({
        tool_calls: [{ index: 0, function: { arguments: '"l"}' } }],
      }),
      mk({}, 'tool_calls'),
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, () => {}),
    );
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].id, 'call_1');
    assert.strictEqual(result.toolCalls[0].name, 'data.search');
    assert.strictEqual(result.toolCalls[0].arguments, '{"q":"l"}');
    assert.strictEqual(result.finishReason, 'tool_calls');
  });

  test('handles a stream that ends without [DONE] sentinel', async () => {
    const body = sseStream(['data: {"choices":[{"delta":{"content":"ab"}}]}\n\n']);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, () => {}),
    );
    assert.strictEqual(result.content, 'ab');
  });

  test('skips malformed JSON chunks without throwing', async () => {
    const deltas: string[] = [];
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {not valid json\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, (d) => deltas.push(d)),
    );
    assert.deepStrictEqual(deltas, ['ok', '!']);
    assert.strictEqual(result.content, 'ok!');
  });

  test('ignores SSE comments / keepalives', async () => {
    const deltas: string[] = [];
    const body = sseStream([
      ': this is a keepalive comment\n\n',
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      ': another\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, (d) => deltas.push(d)),
    );
    assert.deepStrictEqual(deltas, ['x']);
    assert.strictEqual(result.content, 'x');
  });

  test('returns null content when no content deltas arrived (tool-only turn)', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"x","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, () => {}),
    );
    assert.strictEqual(result.content, null);
    assert.strictEqual(result.toolCalls.length, 1);
  });

  test('preserves tool_call order by index even when emitted out of order', async () => {
    // A provider that emits index 1 before index 0 (non-conformant but defensive).
    const mk = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
    const body = sseStream([
      mk({ tool_calls: [{ index: 1, id: 'c1', function: { name: 'second', arguments: '{}' } }] }),
      mk({ tool_calls: [{ index: 0, id: 'c0', function: { name: 'first', arguments: '{}' } }] }),
      'data: [DONE]\n\n',
    ]);
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(cfg, { messages: [] }, () => {}),
    );
    assert.strictEqual(result.toolCalls.length, 2);
    assert.strictEqual(result.toolCalls[0].id, 'c0', 'index 0 sorts first');
    assert.strictEqual(result.toolCalls[0].name, 'first');
    assert.strictEqual(result.toolCalls[1].id, 'c1');
    assert.strictEqual(result.toolCalls[1].name, 'second');
  });
});

describe('runOpenAiStreamingCompletion — cleanContent runs once on accumulated text', () => {
  test('cleanContent strips <think> from the accumulated stream, not per-delta', async () => {
    const deltas: string[] = [];
    const body = sseStream([
      // Model emits a <think> block split across two chunks + real text.
      'data: {"choices":[{"delta":{"content":"<think>sec"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ret</think>real answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    // onText receives RAW deltas (the partial "<think>sec" leaks mid-stream —
    // that's expected; the orchestrator decides whether to forward it). The
    // RETURNED content is cleaned.
    const result = await withMockFetch(body, () =>
      runOpenAiStreamingCompletion(
        { ...cfg, cleanContent: (s) => (s ? s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : null) },
        { messages: [] },
        (d) => deltas.push(d),
      ),
    );
    // Raw deltas preserved (cleanContent does NOT run per-delta).
    assert.deepStrictEqual(deltas, ['<think>sec', 'ret</think>real answer']);
    // Final content is cleaned.
    assert.strictEqual(result.content, 'real answer');
  });
});
