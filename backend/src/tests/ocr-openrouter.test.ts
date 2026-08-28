/**
 * OCR OpenRouter 2-tier model chain — model ordering, failover, and the
 * OpenRouter-specific parsing edge cases (<think> stripping, parts-array
 * content, HTTP error handling). Run with the project's tsx --test runner.
 *
 * globalThis.fetch is mocked per-test and routed by model so we can prove:
 *   - Qwen3-VL-32B is tried FIRST and, on success, Qwen3.7-Plus is never called.
 *   - a Qwen3-VL-32B failure (HTTP 429) transparently fails over to Qwen3.7-Plus.
 *   - <think> reasoning and parts-array `content` are normalized before parsing.
 *
 * Note: no before/after hooks — this Node/tsx ESM surface doesn't expose
 * `afterAll`. Config keys are pinned at module top-level (each test file runs
 * in its own process under `tsx --test`, so there is no cross-file leakage),
 * and per-test state is set up inline with try/finally.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { callOpenRouterVision, extractContainerAndSeal } from '../services/ocr.service';
import { config } from '../config';
import type { OcrSettings } from '../services/ocr-settings.service';

const originalFetch = globalThis.fetch;

// Pin the key so orderedModels() returns both models regardless of the
// local .env (hermetic). Restore is unnecessary: each test file runs in its own
// process under `tsx --test`.
config.openrouterApiKey = 'test-or-key';

// 1×1 PNG — a valid image so sharp's preprocessImage succeeds cleanly (the
// mocked fetch ignores the bytes; we just want no preprocessing noise).
const IMG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Valid ISO 6346 container number (check digit 5) — autoCorrect keeps it as-is.
const VALID_CONTAINER = 'ALLU5216535';
const TEST_SETTINGS: OcrSettings = {
  enabled: true,
  openrouterKey: 'test-or-key',
  geminiKey: '',
};

/** Minimal Response stand-in for the mocked global fetch. */
function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
  } as Response;
}

const orBody = (content: unknown, model = 'qwen/qwen3-vl-32b-instruct') =>
  ({ choices: [{ message: { content } }], model });

describe('OCR: OpenRouter 2-tier model chain', () => {
  test('callOpenRouterVision: success → provider=openrouter + parsed JSON text', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return res(orBody(JSON.stringify({ container_numbers: [VALID_CONTAINER] })));
    }) as unknown as typeof globalThis.fetch;
    try {
      const r = await callOpenRouterVision('prompt', IMG, 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.equal(r.provider, 'openrouter');
      assert.equal(r.model, 'qwen/qwen3-vl-32b-instruct');
      assert.deepEqual(JSON.parse(r.text!), { container_numbers: [VALID_CONTAINER] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callOpenRouterVision: strips <think> reasoning before the JSON answer', async () => {
    globalThis.fetch = (async (_url: string | URL | Request) => {
      return res(orBody(`<think>reasoning about the image...</think>{"container_numbers":["${VALID_CONTAINER}"]}`));
    }) as unknown as typeof globalThis.fetch;
    try {
      const r = await callOpenRouterVision('prompt', IMG, 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.equal(r.text!.includes('<think>'), false);
      assert.deepEqual(JSON.parse(r.text!), { container_numbers: [VALID_CONTAINER] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callOpenRouterVision: normalizes parts-array content (not only string)', async () => {
    globalThis.fetch = (async () =>
      res(orBody([{ type: 'text', text: `{"container_numbers":["${VALID_CONTAINER}"]}` }]))) as unknown as typeof globalThis.fetch;
    try {
      const r = await callOpenRouterVision('prompt', IMG, 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.deepEqual(JSON.parse(r.text!), { container_numbers: [VALID_CONTAINER] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callOpenRouterVision: HTTP 429 → failure "HTTP 429", no throw', async () => {
    globalThis.fetch = (async () => res({ error: 'rate limited' }, 429)) as unknown as typeof globalThis.fetch;
    try {
      const r = await callOpenRouterVision('prompt', IMG, 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, false);
      assert.equal(r.provider, 'openrouter');
      assert.equal(r.error, 'HTTP 429');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callOpenRouterVision: empty key → friendly error, fetch NOT called', async () => {
    const saved = config.openrouterApiKey;
    let calls = 0;
    config.openrouterApiKey = '';
    globalThis.fetch = (async () => { calls++; return res(orBody('{}')); }) as unknown as typeof globalThis.fetch;
    try {
      const r = await callOpenRouterVision('prompt', IMG, 'image/jpeg', {
        ...TEST_SETTINGS,
        openrouterKey: '',
      });
      assert.equal(r.success, false);
      assert.equal(r.provider, 'openrouter');
      assert.match(r.error!, /OPENROUTER_API_KEY/);
      assert.equal(calls, 0);
    } finally {
      config.openrouterApiKey = saved;
      globalThis.fetch = originalFetch;
    }
  });

  test('extractContainerAndSeal: Qwen3-VL-32B succeeds first → Qwen3.7-Plus NOT called', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return res(orBody(JSON.stringify({ container_numbers: [VALID_CONTAINER] })));
    }) as unknown as typeof globalThis.fetch;
    try {
      const r = await extractContainerAndSeal(IMG, 'CONTAINER', 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.equal(r.provider, 'openrouter');
      assert.deepEqual(r.containerNumbers, [VALID_CONTAINER]);
      assert.equal(callCount, 1, 'Only the first model should be called');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('extractContainerAndSeal: Qwen3-VL-32B 429 → failover to Qwen3.7-Plus', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) return res({ error: 'rate limited' }, 429);
      // Second call (Qwen3.7-Plus) succeeds
      return res(orBody(JSON.stringify({ container_numbers: [VALID_CONTAINER] }), 'qwen/qwen3.7-plus'));
    }) as unknown as typeof globalThis.fetch;
    try {
      const r = await extractContainerAndSeal(IMG, 'CONTAINER', 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.equal(r.provider, 'openrouter');
      assert.deepEqual(r.containerNumbers, [VALID_CONTAINER]);
      assert.equal(callCount, 2, 'Both models should be called on failover');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('extractContainerAndSeal: SEAL path returns the seal via OpenRouter', async () => {
    globalThis.fetch = (async () => res(orBody(JSON.stringify({ seal_number: 'VN123456' })))) as unknown as typeof globalThis.fetch;
    try {
      const r = await extractContainerAndSeal(IMG, 'SEAL', 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.equal(r.provider, 'openrouter');
      assert.equal(r.sealNumber, 'VN123456');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('extractContainerAndSeal: wrong-key JSON (no schema) → regex net recovers the number', async () => {
    // OpenRouter sends NO response_format, so the model may emit valid JSON
    // under a different key. parseResponse must fall through to the regex net
    // and recover the number. Parity with vantaiphucloc ocr.py.
    globalThis.fetch = (async () => res(orBody('{"numbers":["ALLU5216535"]}'))) as unknown as typeof globalThis.fetch;
    try {
      const r = await extractContainerAndSeal(IMG, 'CONTAINER', 'image/jpeg', TEST_SETTINGS);
      assert.equal(r.success, true);
      assert.equal(r.provider, 'openrouter');
      assert.deepEqual(r.containerNumbers, [VALID_CONTAINER]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('extractContainerAndSeal: no keys configured → friendly "chưa cấu hình" error', async () => {
    const savedOr = config.openrouterApiKey;
    let calls = 0;
    config.openrouterApiKey = '';
    globalThis.fetch = (async () => { calls++; return res({}); }) as unknown as typeof globalThis.fetch;
    try {
      const r = await extractContainerAndSeal(IMG, 'CONTAINER', 'image/jpeg', {
        enabled: true,
        openrouterKey: '',
        geminiKey: '',
      });
      assert.equal(r.success, false);
      assert.equal(r.provider, null);
      assert.match(r.error!, /chưa cấu hình/);
      assert.equal(calls, 0);
    } finally {
      config.openrouterApiKey = savedOr;
      globalThis.fetch = originalFetch;
    }
  });
});
