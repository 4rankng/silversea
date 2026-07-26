// System-prompt builder for the TransTing agent.
//
// CONTEXT-ENGINEERING NOTE
// ------------------------
// The system prompt is the single most important context-engineering surface in
// this agent: it carries the persona, role grant, time anchor, tool-usage
// policy, response-shape contract, and the current-route hint. The model never
// sees the database or the React UI directly — every fact it has about *how to
// behave* flows through this string. Treat each bullet below as a load-bearing
// instruction; reordering or merging them measurably changes tool selection
// and JSON adherence (see tests/agent-system-prompt.test.ts golden parity).
//
// Sections are assembled by `buildSystemPromptSections` and joined by
// `buildSystemPrompt`. The orchestrator keeps calling `buildSystemPrompt` so the
// public behavior (the exact string sent to MiniMax) is byte-for-byte
// identical to the pre-refactor inline version. `buildSystemPromptSections` is
// exported for granular unit tests and for future, scoped enhancements (e.g.
// per-role few-shot, token-budget pruning).

import type { AgentContext, AgentToolDef } from './tool.types.js';
import { todayIsoVn } from './tools/period.js';

// The structured-response hint is intentionally kept verbatim here — it is the
// response-shape contract referenced by the JSON-mode final call in the
// orchestrator. Do not paraphrase: the field list matches AgentResponse in
// @tingting/shared one-to-one, and the model has been tuned against it.
export const STRUCTURED_RESPONSE_HINT = `Kết quả cuối phải là một JSON hợp lệ:
- text: {"type":"text","content":"...","actions":[{"label":"...","directive":{...}}]} (actions is optional)
- insight_card: {"type":"insight_card","title":"...","summary":"...","widgets":[...]}
- tutorial: {"type":"tutorial","title":"...","summary":"...","steps":[...]}
- start_tour: {"type":"start_tour","tourId":"..."}
- directive: {"type":"directive","directive":{...}}
Widget: kpi_grid, bar_chart, line_chart, table, callout hoặc anomaly_list. KPI value phải là số VND đầy đủ; format chỉ vnd|percent|number|days. Không có directive hợp lệ thì bỏ actions.`;

/**
 * Normalize Vietnamese text for intent detection (diacritics-agnostic lowercase).
 * Mirrors the orchestrator's own `normalizeForIntent` so the "needs UI detail"
 * heuristic keeps firing on the same inputs after the extraction.
 */
function normalizeForIntent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** The named, ordered sections that compose the agent system prompt. */
export interface SystemPromptSections {
  persona: string;
  time: string;
  toolPolicy: string[];
  tourPolicy: string[];
  uiPolicy: string[];
  route: string[];
  responseShape: string;
}

/**
 * Build the system-prompt sections for a turn. Pure function of
 * (ctx, tools, message) — no I/O, no globals, no clocks (date comes from
 * todayIsoVn). Safe to unit-test and to call from a worker thread.
 */
export function buildSystemPromptSections(
  ctx: AgentContext,
  tools: AgentToolDef[],
  message: string,
): SystemPromptSections {
  const names = new Set(tools.map((tool) => tool.name));
  const hasData = [...names].some((name) => name.startsWith('data.') || name === 'report.run');
  const hasTours = names.has('tours.search');
  const needsUiDetail = /(mo|vao|them|sua|xoa|nut|form|trang|huong dan|cach lam)/i.test(
    normalizeForIntent(message),
  );

  const persona = `Bạn là trợ lý TransTing cho công ty vận tải Việt Nam. Vai trò người dùng: ${ctx.role}. Bot chỉ đọc; người dùng tự lưu mọi thay đổi.`;
  const time = `Hôm nay: ${todayIsoVn()}. "Tháng này/nay" luôn là kỳ hiện tại. Trả lời tiếng Việt, ngắn và trực tiếp.`;

  const toolPolicy: string[] = [];
  if (hasData) {
    toolPolicy.push(
      '- Mọi số liệu phải lấy từ công cụ. Tổng tiền tài chính dùng report.run; không tự cộng bằng data.aggregate.',
    );
    toolPolicy.push(
      '- Định danh mơ hồ: data.search trước, data.detail chỉ khi cần thêm trường.',
    );
  }

  const tourPolicy: string[] = [];
  if (hasTours) {
    tourPolicy.push(
      '- Luồng hướng dẫn có sẵn: gọi tours.search rồi dùng start_tour. Câu hỏi thao tác hẹp dùng tutorial ngắn.',
    );
  }

  const uiPolicy: string[] = [];
  if (needsUiDetail) {
    uiPolicy.push(
      '- Cần mở/thao tác: dùng directive thật; không viết đường dẫn. Bot không sửa dữ liệu, chỉ dẫn tới đúng trang/nút.',
    );
    uiPolicy.push(
      '- open/prefill chỉ hỗ trợ componentId debt.record-payment; trường hợp khác dùng navigate/focus/highlight.',
    );
  }

  const route: string[] = [];
  if (ctx.currentRouteKey) {
    route.push(`Trang hiện tại: ${ctx.currentRouteKey}.`);
  }

  // No-tool conversation is streamed as prose and needs no JSON burden.
  const responseShape =
    tools.length === 0
      ? 'Trả lời trực tiếp bằng văn bản, không JSON.'
      : STRUCTURED_RESPONSE_HINT;

  return { persona, time, toolPolicy, tourPolicy, uiPolicy, route, responseShape };
}

/**
 * Compose the final system-prompt string for MiniMax. This is the only function
 * the orchestrator needs; its output must remain byte-for-byte identical to the
 * pre-refactor inline builder (see tests/agent-system-prompt.test.ts).
 *
 * Section order: persona → time → tool policy → tour policy → UI policy →
 * route → response shape. Empty sections are dropped; remaining lines are
 * joined with `\n`.
 */
export function buildSystemPrompt(
  ctx: AgentContext,
  tools: AgentToolDef[],
  message: string,
): string {
  const s = buildSystemPromptSections(ctx, tools, message);
  return [
    s.persona,
    s.time,
    ...s.toolPolicy,
    ...s.tourPolicy,
    ...s.uiPolicy,
    ...s.route,
    s.responseShape,
  ].filter(Boolean).join('\n');
}
