/**
 * System-prompt builder tests.
 *
 * Two layers of protection:
 *
 * 1. GOLDEN PARITY — the exact strings the pre-refactor inline
 *    orchestrator.buildSystemPrompt produced for three representative inputs
 *    (no-tool chat / data+route / UI) are pinned. Any byte drift in the
 *    extracted module flips these red. This is the contract that lets us call
 *    the refactor behavior-preserving.
 *
 * 2. SECTION CONTRACT — buildSystemPromptSections exposes the named, ordered
 *    sections (persona/time/toolPolicy/uiPolicy/route/responseShape)
 *    so future context-engineering work (per-role few-shot, token-budget
 *    pruning) can target one section without re-reading the whole assembler.
 *    These tests pin which sections fire for which tool/message combinations.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import {
  buildSystemPrompt,
  buildSystemPromptSections,
  STRUCTURED_RESPONSE_HINT,
} from '../services/agent/system-prompt.js';
import type { AgentContext, AgentToolDef } from '../services/agent/tool.types.js';
import { Role } from '@tingting/shared';
// Import the SAME todayIsoVn the production builder uses, so the golden string
// can never drift on a non-UTC runner near a date boundary. A local helper that
// re-derives the date would risk double-correction via getTimezoneOffset.
import { todayIsoVn } from '../services/agent/tools/period.js';

// Lightweight tool factory — only `name` drives the builder's branch logic.
// The prompt builder reads only `tool.name`, so the rest of the AgentToolDef
// shape is filled with harmless defaults just to satisfy the type.
function tool(name: string): AgentToolDef {
  return {
    name,
    description: `mock ${name}`,
    params: z.object({}),
    allowedRoles: [Role.ADMIN],
    async execute() {
      return { data: null };
    },
  };
}

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    userId: 1,
    role: Role.ADMIN,
    currentRouteKey: undefined,
    ...over,
  };
}

describe('buildSystemPrompt — golden parity', () => {
  // The exact string the inline builder produced for a no-tool chit-chat turn.
  // If the extracted module drifts, this fails.
  const GOLDEN_NO_TOOLS = (role: Role, routeKey: string | undefined, today: string) =>
    [
      `Bạn là trợ lý TransTing cho công ty vận tải Việt Nam. Vai trò người dùng: ${role}. Bot chỉ đọc; người dùng tự lưu mọi thay đổi.`,
      `Hôm nay: ${today}. "Tháng này/nay" luôn là kỳ hiện tại. Trả lời tiếng Việt, ngắn và trực tiếp.`,
      routeKey ? `Trang hiện tại: ${routeKey}.` : '',
      'Trả lời trực tiếp bằng văn bản, không JSON.',
    ]
      .filter(Boolean)
      .join('\n');

  test('no tools, no route → prose-only shape (byte-identical to inline builder)', () => {
    const today = todayIsoVn();
    const got = buildSystemPrompt(ctx(), [], 'chào bạn');
    assert.strictEqual(got, GOLDEN_NO_TOOLS(Role.ADMIN, undefined, today));
  });

  test('no tools but route present → route line included', () => {
    const today = todayIsoVn();
    const got = buildSystemPrompt(ctx({ currentRouteKey: '/dashboard' }), [], 'chào bạn');
    assert.strictEqual(got, GOLDEN_NO_TOOLS(Role.ADMIN, '/dashboard', today));
    assert.ok(got.includes('Trang hiện tại: /dashboard.'));
  });

  test('data tool present → both data-policy lines + structured hint, no tour/ui lines', () => {
    const got = buildSystemPrompt(ctx(), [tool('data.search')], 'top doanh thu');
    assert.ok(got.includes('- Mọi số liệu phải lấy từ công cụ.'), 'data total policy');
    assert.ok(got.includes('- Định danh mơ hồ: data.search trước'), 'data lookup policy');
    assert.ok(!got.includes('tours.search'), 'no tour policy');
    assert.ok(!got.includes('Cần mở/thao tác'), 'no ui policy');
    assert.ok(got.endsWith(STRUCTURED_RESPONSE_HINT), 'structured hint tail');
  });

  test('report.run counts as data → data-policy fires', () => {
    const got = buildSystemPrompt(ctx(), [tool('report.run')], 'tổng thuế');
    assert.ok(got.includes('- Mọi số liệu phải lấy từ công cụ.'));
  });

  test('UI-triggering message + tools → ui-policy lines fire (diacritic-insensitive)', () => {
    // "mở" without diacritics ("mo") must still trigger UI policy — this is the
    // normalizeForIntent heuristic the orchestrator relied on. A non-data tool
    // here isolates the UI heuristic from the data branches. The actual
    // text uses ';' as separator inside the bullet (not a trailing period).
    const got = buildSystemPrompt(ctx(), [tool('ui.navigate')], 'mo trang nhom');
    assert.ok(got.includes('- Cần mở/thao tác: dùng directive thật;'));
    assert.ok(got.includes('- open/prefill chỉ hỗ trợ componentId debt.record-payment'));
  });

  test('data + ui-trigger + route → all sections present in correct order', () => {
    const got = buildSystemPrompt(
      ctx({ currentRouteKey: '/fleet/1' }),
      [tool('data.search'), tool('ui.navigate')],
      'them xe moi',
    );
    const idxPersona = got.indexOf('Bạn là trợ lý TransTing');
    const idxTime = got.indexOf('Hôm nay:');
    const idxData = got.indexOf('- Mọi số liệu');
    const idxUi = got.indexOf('- Cần mở/thao tác');
    const idxRoute = got.indexOf('Trang hiện tại:');
    const idxShape = got.indexOf('Kết quả cuối');
    assert.ok(idxPersona >= 0 && idxTime > idxPersona, 'persona before time');
    assert.ok(idxData > idxTime, 'data after time');
    assert.ok(idxUi > idxData, 'ui after data');
    assert.ok(idxRoute > idxUi, 'route after ui');
    assert.ok(idxShape > idxRoute, 'response shape last');
  });
});

describe('buildSystemPromptSections — section contract', () => {
  test('persona always present and role-stamped', () => {
    const s = buildSystemPromptSections(ctx({ role: Role.DRIVER }), [], 'hi');
    assert.ok(s.persona.includes('Vai trò người dùng: DRIVER'));
    assert.ok(s.persona.includes('Bot chỉ đọc'));
  });

  test('time always present', () => {
    const s = buildSystemPromptSections(ctx(), [], 'hi');
    assert.ok(s.time.startsWith('Hôm nay:'));
    assert.ok(s.time.includes('"Tháng này/nay"'));
  });

  test('toolPolicy empty when no data tool', () => {
    const s = buildSystemPromptSections(ctx(), [tool('ui.navigate')], 'hi');
    assert.deepStrictEqual(s.toolPolicy, []);
  });

  test('toolPolicy has 2 entries when any data tool present', () => {
    const s = buildSystemPromptSections(ctx(), [tool('data.detail')], 'hi');
    assert.strictEqual(s.toolPolicy.length, 2);
  });

  test('uiPolicy empty when message has no UI verb', () => {
    const s = buildSystemPromptSections(ctx(), [tool('ui.navigate')], 'bao nhieu tien');
    assert.deepStrictEqual(s.uiPolicy, []);
  });

  test('route empty when currentRouteKey undefined', () => {
    const s = buildSystemPromptSections(ctx(), [], 'hi');
    assert.deepStrictEqual(s.route, []);
  });

  test('responseShape is prose hint when no tools, structured hint otherwise', () => {
    assert.strictEqual(
      buildSystemPromptSections(ctx(), [], 'hi').responseShape,
      'Trả lời trực tiếp bằng văn bản, không JSON.',
    );
    assert.strictEqual(
      buildSystemPromptSections(ctx(), [tool('data.search')], 'hi').responseShape,
      STRUCTURED_RESPONSE_HINT,
    );
  });
});
