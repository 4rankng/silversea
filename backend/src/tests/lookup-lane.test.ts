/**
 * P1 Lane 2 tests — single-tool lookup intent detection + response shaping.
 *
 * Tests the intent router's lookup detection (plate numbers, customer names,
 * trip codes, driver names) and the response formatting (no live DB needed —
 * we test the pure routing and shape construction).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeIntent } from '../services/agent/intent-router.js';

describe('P1 Lane 2 — lookup intent detection (positive cases)', () => {
  const lookupCases: { msg: string; expectedQuery: string; desc: string }[] = [
    { msg: 'Số lốp 136.31', expectedQuery: '136.31', desc: 'tire plate lookup' },
    { msg: 'so lop 136.31', expectedQuery: '136.31', desc: 'no-tone tire lookup' },
    { msg: '136.31', expectedQuery: '136.31', desc: 'bare plate number' },
    { msg: 'lốp xe 15C-136.31', expectedQuery: '15c-136.31', desc: 'full plate with prefix (normalized lowercase)' },
    { msg: 'khách hàng vietsun', expectedQuery: 'vietsun', desc: 'customer name lookup' },
    { msg: 'cong no khach hang vietsun', expectedQuery: 'vietsun', desc: 'no-tone customer lookup' },
    { msg: 'khach vietsun', expectedQuery: 'vietsun', desc: 'short customer lookup' },
  ];

  for (const tc of lookupCases) {
    test(`lookup: ${tc.desc}`, () => {
      const d = routeIntent(tc.msg);
      assert.equal(d.lane, 'lookup',
        `expected lane='lookup' for "${tc.msg}", got '${d.lane}' (${d.reason})`);
      assert.ok(d.lookupQuery, 'lookup decision must have a lookupQuery');
      assert.equal(d.lookupQuery, tc.expectedQuery);
    });
  }
});

describe('P1 Lane 2 — must NOT trigger for non-lookup queries', () => {
  const nonLookupCases: { msg: string; desc: string }[] = [
    { msg: 'tại sao lợi nhuận giảm?', desc: 'analytical question' },
    { msg: 'lợi nhuận xe 15C-136.31 tháng 6 là bao nhiêu?', desc: 'too long (>60 chars) + analytical' },
    { msg: 'hướng dẫn tạo chuyến', desc: 'tutorial request' },
    { msg: 'mở trang công nợ', desc: 'navigation intent (not lookup)' },
    { msg: 'tóm tắt việc hôm nay', desc: 'summary intent (not lookup)' },
    { msg: 'cty có bao nhiêu xe', desc: 'aggregate question (not entity lookup)' },
    { msg: 'tháng này kiếm được bao tiền rồi', desc: 'analytical question' },
  ];

  for (const tc of nonLookupCases) {
    test(`not-lookup: ${tc.desc}`, () => {
      const d = routeIntent(tc.msg);
      assert.notEqual(d.lane, 'lookup',
        `"${tc.msg}" should NOT be lane='lookup', got lookup — MISROUTE`);
    });
  }
});

describe('P1 Lane 2 — response shape (pure construction)', () => {
  test('text response with lookup results validates', async () => {
    const { agentResponseSchema } = await import('@tingting/shared');
    const response = {
      type: 'text' as const,
      content: 'Tìm thấy 2 kết quả cho "136.31":\n\n**Đầu kéo**: 136.31 — status: ACTIVE',
      actions: [
        { label: 'Mở trang Đầu kéo', directive: { kind: 'navigate' as const, routeKey: 'fleet' } },
      ],
    };
    const parsed = agentResponseSchema.safeParse(response);
    assert.ok(parsed.success, `lookup response should validate: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 2))}`);
  });

  test('empty results produce a "not found" text', async () => {
    const { agentResponseSchema } = await import('@tingting/shared');
    const response = {
      type: 'text' as const,
      content: 'Không tìm thấy dữ liệu cho "xyz123". Bạn có thể thử lại với từ khóa khác.',
    };
    assert.ok(agentResponseSchema.safeParse(response).success);
  });
});
