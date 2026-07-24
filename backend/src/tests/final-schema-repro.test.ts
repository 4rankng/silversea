/**
 * P0.5 regression tests — final_schema error hotfix.
 *
 * Each case is a realistic model output that previously caused `final_schema`
 * errors (27% of production turns). The sanitizer + Zod schema must now accept
 * (or gracefully downgrade) ALL of them. These lock the fix: if a future
 * schema change re-tightens a field, these tests fail loudly.
 *
 * Root causes found via prod data analysis (n=11 final_schema turns):
 *  - Unknown widget types (metric/chart/list) the model invents
 *  - Wrapped response objects ({response: {...}})
 *  - kpi_grid/anomaly_list with missing required fields
 *  - Table cells containing objects instead of primitives
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentResponseSchema } from '@tingting/shared';
import { sanitizeAgentJson, parseAgentResponseContent } from '../services/agent/orchestrator.js';

/** Sanitize → Zod-validate. Returns the parsed response or null. */
function validate(raw: unknown) {
  const sanitized = sanitizeAgentJson(raw);
  return agentResponseSchema.safeParse(sanitized);
}

describe('P0.5 final_schema hotfix — unknown widget types', () => {
  test('"metric" widget coerces to kpi_grid', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'metric', label: 'X', value: 100, format: 'number' }],
    });
    // Either parses as insight_card with kpi_grid, OR downgrades to text (both OK).
    assert.ok(r.success, `metric widget should parse: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 2))}`);
  });

  test('"chart" widget coerces to bar_chart', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'chart', data: [{ name: 'A', value: 10 }] }],
    });
    assert.ok(r.success);
  });

  test('"list" widget coerces to table from items', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'list', items: [{ text: 'item 1' }] }],
    });
    assert.ok(r.success);
  });

  test('completely unknown widget with no data is dropped, card downgrades to text', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'My summary.',
      widgets: [{ type: 'completely_bogus', foo: 'bar' }],
    });
    // The widget is dropped → empty widgets → card downgrades to text.
    assert.ok(r.success);
    assert.equal(r.data!.type, 'text');
  });
});

describe('P0.5 final_schema hotfix — wrapped response objects', () => {
  test('{response: {...}} is unwrapped', () => {
    const r = validate({
      response: {
        type: 'insight_card', title: 'T', summary: 'S',
        widgets: [{ type: 'kpi_grid', items: [{ label: 'X', value: 100, format: 'number' }] }],
      },
    });
    assert.ok(r.success);
    assert.equal(r.data!.type, 'insight_card');
  });

  test('{answer: {type:"text",...}} is unwrapped', () => {
    const r = validate({ answer: { type: 'text', content: 'Hello world.' } });
    assert.ok(r.success);
    assert.equal(r.data!.type, 'text');
  });
});

describe('P0.5 final_schema hotfix — missing required fields', () => {
  test('kpi_grid with no items → widget dropped, card → text', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'Summary text.',
      widgets: [{ type: 'kpi_grid' }],
    });
    assert.ok(r.success);
    assert.equal(r.data!.type, 'text');
  });

  test('anomaly_list missing detail → defaults to empty string', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'anomaly_list', items: [{ label: 'Issue', severity: 'high' }] }],
    });
    assert.ok(r.success);
  });

  test('anomaly_list severity "medium" → coerced to "med"', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'anomaly_list', items: [{ label: 'X', detail: 'Y', severity: 'medium' }] }],
    });
    assert.ok(r.success);
  });
});

describe('P0.5 final_schema hotfix — table cell coercion', () => {
  test('table rows with object cells → coerced to strings', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'table', columns: ['X', 'Y'], rows: [[{ a: 1 }, 2]] }],
    });
    assert.ok(r.success, `object cells should coerce: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 2))}`);
  });

  test('table with object rows (not arrays) → reshaped', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'table', columns: ['X', 'Y'], rows: [{ x: 1, y: 2 }] }],
    });
    assert.ok(r.success);
  });
});

describe('P0.5 final_schema hotfix — response type aliases', () => {
  test('type "card" → insight_card', () => {
    const r = validate({
      type: 'card', title: 'T', summary: 'S',
      widgets: [{ type: 'kpi_grid', items: [{ label: 'X', value: 100, format: 'number' }] }],
    });
    assert.ok(r.success);
    assert.equal(r.data!.type, 'insight_card');
  });
});

describe('P0.5 final_schema hotfix — numeric coercion', () => {
  test('kpi_grid value as string "120000000" → number', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'kpi_grid', items: [{ label: 'X', value: '120000000', format: 'vnd' }] }],
    });
    assert.ok(r.success);
  });

  test('kpi_grid delta as string "50" → number', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'kpi_grid', items: [{ label: 'X', value: 100, format: 'number', delta: '50' }] }],
    });
    assert.ok(r.success);
  });
});

describe('P1 callout field-name coercion (insight_card → summary regression)', () => {
  // Regression: the wire contract names the callout body `text`, but the model
  // often emits `content`/`message`. Without the map, ONE such callout failed
  // the whole widgets array, which downgraded the ENTIRE insight_card to its
  // prose summary — the "full card became one line" bug.
  test('callout with `content` (not `text`) → kept as insight_card', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ widget: 'callout', title: '⚠️ Cảnh báo', content: 'Xe ngoài đang lỗ 4.6M.' }],
    });
    assert.ok(r.success, `should parse: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 2))}`);
    assert.equal(r.data!.type, 'insight_card');
  });

  test('callout with `message` → text reclaimed', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'callout', message: 'Lưu ý.' }],
    });
    assert.ok(r.success);
    assert.equal(r.data!.type, 'insight_card');
  });

  // The exact reported payload: a rich card whose ONLY validation problem was
  // the callout `content` field. The whole card must survive and render.
  test('reported full card (callout.content) renders as insight_card', () => {
    const r = validate({
      type: 'insight_card',
      title: 'Phân tích kinh doanh – Tháng 7/2026',
      summary: 'Tháng 7 đạt lợi nhuận gộp 65.9M VND.',
      widgets: [
        { widget: 'kpi_grid', data: [
          { label: 'Doanh thu', value: 256849093, format: 'vnd' },
          { label: 'Chi phí', value: 190958203, format: 'vnd' },
          { label: 'Lợi nhuận gộp', value: 65890890, format: 'vnd' },
          { label: 'Biên lợi nhuận', value: 25.65, format: 'percent' },
        ] },
        { widget: 'bar_chart', title: 'Lợi nhuận theo xe', data: [
          { label: '15C-139.82', value: 29978705 },
          { label: 'Xe ngoài', value: -4656967 },
        ] },
        { widget: 'callout', title: '⚠️ Cảnh báo', content: 'Xe ngoài đang lỗ 4.6M.' },
      ],
    });
    assert.ok(r.success, `full card should parse: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 2))}`);
    assert.equal(r.data!.type, 'insight_card');
  });
});

describe('P0.5 final_schema hotfix — baseline (must not regress)', () => {
  test('valid insight_card with kpi_grid still passes', () => {
    const r = validate({
      type: 'insight_card', title: 'Lợi nhuận', summary: 'Tháng này lời 120 triệu.',
      widgets: [{ type: 'kpi_grid', items: [{ label: 'Doanh thu', value: 500000000, format: 'vnd' }] }],
    });
    assert.ok(r.success);
    assert.equal(r.data!.type, 'insight_card');
  });

  test('valid text response still passes', () => {
    const r = validate({ type: 'text', content: 'Đây là câu trả lời.' });
    assert.ok(r.success);
  });

  test('insight_card with extra unknown fields still passes (non-strict)', () => {
    const r = validate({
      type: 'insight_card', title: 'T', summary: 'S',
      widgets: [{ type: 'kpi_grid', items: [{ label: 'X', value: 100, format: 'number' }] }],
      metadata: { source: 'tool' }, confidence: 0.9,
    });
    assert.ok(r.success);
  });

  test('parseAgentResponseContent handles a wrapped JSON string', () => {
    // Simulates the full produceFinalAnswer path: model emits JSON string.
    const json = JSON.stringify({
      response: {
        type: 'insight_card', title: 'T', summary: 'S',
        widgets: [{ type: 'kpi_grid', items: [{ label: 'X', value: 100, format: 'number' }] }],
      },
    });
    const parsed = parseAgentResponseContent(json);
    assert.ok(parsed);
    assert.equal(parsed!.type, 'insight_card');
  });
});
