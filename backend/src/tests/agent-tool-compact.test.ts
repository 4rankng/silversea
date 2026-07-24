// Unit tests for the structure-aware tool-result compactor. Pure (no DB) — the
// compactor is a pure transform, so we assert shape/size guarantees directly.
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { compactToolResult } from '../services/agent/tool-result-compact';

const row = (i: number) => ({ id: i, plate: `51C-${i}`, note: null, empty: '', name: `X${i}` });

// The compactor appends a human-readable `…(đã cắt)` elision note when it has to
// cut a non-array payload (matching the pre-existing convention). That suffix is
// NOT JSON — parse the prefix before it to validate the re-balanced structure.
const NOTE = '…(đã cắt)';
const parseJsonView = (out: string): unknown =>
  JSON.parse(out.endsWith(NOTE) ? out.slice(0, -NOTE.length) : out);

describe('compactToolResult', () => {
  test('passes small payloads through unchanged (valid JSON)', () => {
    const out = compactToolResult({ ok: true, count: 3 });
    assert.strictEqual(out, JSON.stringify({ ok: true, count: 3 }));
  });

  test('caps an array to maxRows and annotates the elision', () => {
    const data = Array.from({ length: 50 }, (_, i) => row(i));
    const parsed = JSON.parse(compactToolResult(data)) as Array<{ _truncated?: boolean; rowsTotal?: number }>;
    // 50 rows → 20 kept + 1 marker.
    assert.strictEqual(parsed.length, 21);
    const marker = parsed[parsed.length - 1];
    assert.ok(marker._truncated, 'elision marker present');
    assert.strictEqual(marker.rowsTotal, 50);
  });

  test('drops null / undefined / empty-string keys from row-objects', () => {
    const out = compactToolResult([{ id: 1, a: null, b: '', c: 0, d: 'x' }]);
    const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
    assert.deepStrictEqual(parsed[0], { id: 1, c: 0, d: 'x' });
  });

  test('preserves envelope summary scalars while capping the payload array', () => {
    const data = { total: 999, count: 999, rows: Array.from({ length: 40 }, (_, i) => row(i)) };
    const parsed = JSON.parse(compactToolResult(data)) as {
      total: number; count: number; rows: Array<Record<string, unknown>>;
    };
    assert.strictEqual(parsed.total, 999);
    assert.strictEqual(parsed.count, 999);
    assert.ok(parsed.rows.length <= 21, 'payload array was capped');
  });

  test('enforces the char budget and never exceeds it', () => {
    const huge = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      blob: 'X'.repeat(200),
    }));
    const out = compactToolResult(huge, { maxChars: 1500 });
    assert.ok(out.length <= 1500, `got ${out.length}`);
    // Still valid JSON (boundary-cut kept brackets balanced).
    parseJsonView(out);
  });

  test('char budget on a non-array giant object cuts at a safe boundary', () => {
    const giant = { blob: 'Y'.repeat(10_000) };
    const out = compactToolResult(giant, { maxChars: 500 });
    assert.ok(out.length <= 500);
    assert.ok(out.endsWith('…(đã cắt)'));
    parseJsonView(out); // re-balanced prefix → parseable
  });

  test('char budget landing mid property-KEY drops the partial key (valid JSON)', () => {
    const data = { extremely_long_descriptive_property_name_for_testing: 1 };
    const out = compactToolResult(data, { maxChars: 35 });
    assert.ok(out.length <= 35, `got ${out.length}`);
    parseJsonView(out); // partial key dropped cleanly → valid (possibly {}) JSON
  });

  test('primitive / non-object values pass through safely', () => {
    assert.strictEqual(compactToolResult(42), '42');
    assert.strictEqual(compactToolResult('hello'), '"hello"');
    assert.strictEqual(compactToolResult(null), 'null');
  });
});
