// Structured-response sanitization for the agent orchestrator: JSON extraction
// + repair, tolerance normalization before Zod validation, tool-arg/error
// formatting for the ReAct loop, and the protocol-safe tool-history trimmer.
// Extracted from orchestrator.ts verbatim (pure code movement) — runAgent
// imports these helpers one-way; nothing here imports the orchestrator.
import { jsonrepair } from 'jsonrepair';
import { ZodError } from 'zod';
import { agentResponseSchema, type AgentResponse, type AgentCitation } from '@tingting/shared';
import { stripThink, type MiniMaxMessage } from '../llm/minimax.client';
import { cutAtSafeBoundary } from './tool-result-compact';
import { ToolError } from './tool.types';

function normalizeForIntent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function parseAgentResponseContent(content: string | null): AgentResponse | null {
  if (!content) return null;
  // MiniMax reasoning models may prepend <think> blocks even in JSON mode.
  // Strip them, then fall back to the first balanced object if prose/tags remain.
  const stripped = stripThink(content) ?? '';
  const candidate = stripped || content;
  const extracted = extractFirstJsonObjectWithRemainder(candidate);
  const jsonObj = extracted?.json ?? candidate;
  // JSON.parse with a jsonrepair fallback (Layer 1 healing): the model often
  // emits structurally-near-valid JSON — trailing commas, single quotes, missing
  // closing quotes, unbalanced brackets — that JSON.parse rejects but jsonrepair
  // fixes deterministically (no LLM call, so it removes a fallback re-call).
  // Truncation (finish_reason='length') is guarded upstream in produceFinalAnswer,
  // so any text reaching here is a COMPLETE payload that is safe to repair.
  const raw = tryParseJson(jsonObj);
  if (raw === undefined) return null;
  const response = validateSanitized(sanitizeAgentJson(raw));
  if (response?.type !== 'insight_card' || !extracted) return response;

  // Some providers obey the JSON shape but append a useful Vietnamese analysis
  // after the closing brace. Preserve that prose as part of the same response;
  // otherwise schema fallback reduces the whole rich card to its short summary.
  const details = extracted.trailing
    .replace(/^\s*```(?:json)?\s*/i, '')
    .trim();
  if (details.length < 5 || isInternalContractLeak(details)) return response;
  const existingDetails = response.details?.trim();
  if (!existingDetails) return { ...response, details };
  if (existingDetails === details) return response;
  return { ...response, details: `${existingDetails}\n\n${details}` };
}

/** JSON.parse with a deterministic jsonrepair fallback. Returns undefined when
 *  even repair cannot yield a value (caller treats as "no structured answer"). */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(jsonrepair(text));
    } catch {
      return undefined;
    }
  }
}

/** Sanitize + Zod-validate a parsed object into an AgentResponse, applying the
 *  text-quality guards (non-empty, no internal-contract leak). Null when the
 *  object isn't a usable response. */
function validateSanitized(sanitized: unknown): AgentResponse | null {
  const parsed = agentResponseSchema.safeParse(sanitized);
  if (!parsed.success) return null;
  if (parsed.data.type === 'text' && !parsed.data.content.trim()) return null;
  if (parsed.data.type === 'text' && isInternalContractLeak(parsed.data.content)) return null;
  return parsed.data;
}

/**
 * Never replace a substantial streamed answer with a degraded final summary.
 * The threshold avoids preferring a short speculative prose prefix over a
 * properly finalized response, while preserving the detailed answer the user
 * has already read when the card-normalization fallback loses its widgets.
 */
export function preserveDetailedTerminalText(
  response: AgentResponse,
  terminalContent: string | null | undefined,
): AgentResponse {
  if (response.type !== 'text') return response;
  const terminal = stripThink(terminalContent)?.trim();
  if (!terminal || isInternalContractLeak(terminal)) return response;
  if (!isSubstantiallyMoreDetailed(terminal, response.content)) return response;
  return { ...response, content: terminal };
}

function isSubstantiallyMoreDetailed(candidate: string, summary: string): boolean {
  const normalizedCandidate = candidate.replace(/\s+/g, ' ').trim();
  const normalizedSummary = summary.replace(/\s+/g, ' ').trim();
  if (!normalizedCandidate || normalizedCandidate === normalizedSummary) return false;
  return normalizedCandidate.length >= 200
    && normalizedCandidate.length >= normalizedSummary.length + 120
    && normalizedCandidate.length >= normalizedSummary.length * 1.5;
}

/** Salvage a human-readable answer from a structured-card response that failed
 *  schema validation, so we don't pay for a 2nd prose LLM call. The model often
 *  wraps Vietnamese prose around a near-miss JSON, or emits plain text despite
 *  json_object mode. We prefer a JSON text field (content/summary/title/…) over
 *  raw JSON, and never dump raw JSON at the user. Returns null when only
 *  reasoning or fragments were present (caller then uses the prose fallback). */
export function salvageText(content: string | null | undefined): string | null {
  const stripped = stripThink(content);
  if (!stripped || stripped.length < 5) return null;
  const jsonObj = extractFirstJsonObject(stripped);
  if (jsonObj) {
    try {
      const obj = JSON.parse(jsonObj) as Record<string, unknown>;
      for (const key of ['content', 'summary', 'title', 'message', 'text']) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim().length >= 5) {
          const text = v.trim();
          return isInternalContractLeak(text) ? null : text;
        }
      }
      // Valid JSON but no usable text field — don't show raw JSON to the user.
      return null;
    } catch {
      // Balanced {...} that isn't valid JSON — don't surface the raw blob to
      // the user; hand off to the dedicated prose LLM call below instead.
      return null;
    }
  }
  return isInternalContractLeak(stripped) ? null : stripped;
}

function isInternalContractLeak(text: string): boolean {
  const normalized = normalizeForIntent(text);
  return [
    'schema json',
    'dung schema',
    'json schema',
    'directive',
    'routekey',
    'widget',
    'tool',
    'insight_card',
  ].some((needle) => normalized.includes(needle));
}

/** P2 — extract citations from a knowledge.search tool result and push them
 *  into the collectedCitations array (deduped by sourceId, max 5). */
export function collectKnowledgeCitations(data: unknown, out: AgentCitation[]): void {
  if (!data || typeof data !== 'object') return;
  const result = data as { chunks?: Array<{ source?: string; heading?: string }> };
  if (!Array.isArray(result.chunks)) return;
  const seen = new Set<string>();
  for (const chunk of result.chunks) {
    if (!chunk.source || !chunk.heading) continue;
    const sourceId = `doc:${chunk.source}:${chunk.heading}`.slice(0, 100);
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({
      sourceId,
      label: chunk.heading,
      kind: 'doc',
      ...(chunk.source.startsWith('docs/') ? { url: chunk.source } : {}),
    });
    if (out.length >= 5) break;
  }
}

export function safeParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function formatToolError(e: unknown): string {
  if (e instanceof ToolError) return e.message;
  if (e instanceof ZodError) return `Tham số công cụ không hợp lệ: ${formatZodIssues(e)}`;
  return e instanceof Error ? e.message : 'Lỗi công cụ';
}

export function formatToolErrorLabel(e: unknown, toolName: string): string {
  if (e instanceof ZodError) return `Đang điều chỉnh tham số cho ${toolName}`;
  if (e instanceof ToolError && e.code === 'invalid_args') return `Cần thêm tham số cho ${toolName}`;
  return formatToolError(e);
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

const WIDGET_FORMATS = new Set(['vnd', 'percent', 'number', 'days']);
const WIDGET_TYPE_ALIASES: Record<string, string> = {
  kpi: 'kpi_grid',
  kpiGrid: 'kpi_grid',
  kpi_grid: 'kpi_grid',
  metrics: 'kpi_grid',
  metric: 'kpi_grid',
  stats: 'kpi_grid',
  bar: 'bar_chart',
  barChart: 'bar_chart',
  bar_chart: 'bar_chart',
  chart: 'bar_chart',
  column_chart: 'bar_chart',
  pie: 'bar_chart',
  pie_chart: 'bar_chart',
  line: 'line_chart',
  lineChart: 'line_chart',
  line_chart: 'line_chart',
  trend: 'line_chart',
  trend_chart: 'line_chart',
  warning: 'callout',
  note: 'callout',
  alert: 'callout',
  info: 'callout',
  highlight: 'callout',
  table_view: 'table',
  grid: 'table',
  anomalies: 'anomaly_list',
  anomaly: 'anomaly_list',
};
const RESPONSE_TYPE_ALIASES: Record<string, string> = {
  card: 'insight_card',
  insight: 'insight_card',
  insightcard: 'insight_card',
  analysis: 'insight_card',
  report: 'insight_card',
  message: 'text',
  answer: 'text',
  reply: 'text',
  prose: 'text',
  navigate: 'directive',
  action: 'directive',
};

/**
 * Tolerate the LLM's realistic-but-non-conformant output before strict Zod
 * validation: coerce unknown numeric `format` values to a safe default and
 * drop action chips without a usable directive. Keeps a good insight_card
 * from degrading to the generic apology over a stray "vnd_million".
 */
export function sanitizeAgentJson(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let obj = raw as Record<string, unknown>;
  // P0.5: the model often wraps its response in a container object —
  // {response: {...}}, {result: {...}}, {data: {...}}, {answer: {...}}.
  // Unwrap to the inner object so the discriminated union sees the real `type`.
  for (const wrapperKey of ['response', 'result', 'data', 'answer', 'output']) {
    const inner = obj[wrapperKey];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const innerRec = inner as Record<string, unknown>;
      // Only unwrap if the inner object looks like a response (has type/content/widgets/summary).
      if (typeof innerRec.type === 'string' || typeof innerRec.content === 'string' || Array.isArray(innerRec.widgets) || typeof innerRec.summary === 'string' || typeof innerRec.directive === 'object') {
        obj = innerRec;
        break;
      }
    }
  }
  if (typeof obj.kind === 'string' && obj.type === undefined) obj.type = obj.kind;
  if (typeof obj.type === 'string' && RESPONSE_TYPE_ALIASES[obj.type]) obj.type = RESPONSE_TYPE_ALIASES[obj.type];
  if (obj.type === undefined) {
    if (typeof obj.content === 'string' || typeof obj.message === 'string' || typeof obj.text === 'string') obj.type = 'text';
    else if (obj.directive && typeof obj.directive === 'object') obj.type = 'directive';
    else if (obj.summary || obj.widgets) obj.type = 'insight_card';
  }
  if (obj.type === 'text' && typeof obj.content !== 'string') {
    obj.content = typeof obj.message === 'string'
      ? obj.message
      : typeof obj.text === 'string'
        ? obj.text
        : typeof obj.summary === 'string'
          ? obj.summary
          : '';
  }
  if (obj.type === 'directive' && obj.directive && typeof obj.directive === 'object') {
    obj.directive = sanitizeDirective(obj.directive);
  }
  // text and insight_card may carry top-level `actions`; normalize action chips
  // for both. text has no `widgets`, so the widget block below is a no-op for it.
  if (obj.type === 'text' || obj.type === 'insight_card') {
    if (obj.type === 'insight_card' && typeof obj.title !== 'string') {
      obj.title = typeof obj.summary === 'string' ? obj.summary.slice(0, 80) : 'Tóm tắt';
    }
    if (obj.type === 'insight_card' && typeof obj.summary !== 'string') {
      obj.summary = typeof obj.content === 'string' ? obj.content : typeof obj.title === 'string' ? obj.title : '';
    }
    if (obj.widgets && !Array.isArray(obj.widgets)) obj.widgets = [obj.widgets];
    if (Array.isArray(obj.widgets)) {
      obj.widgets = (obj.widgets as Record<string, unknown>[]).map((w) => {
        if (!w) return w;
        // The model often emits an alternate discriminator key for widgets
        // (`kind`, `widget`) — the widget union discriminates on `type`.
        // Normalize the FIRST present one so the card parses instead of failing
        // at the discriminator with a widget that has no `type` at all (seen in
        // production: `{"widget":"kpi_grid","data":[...]}` → final_schema fail).
        if (!w.type) {
          const alt = w.kind ?? w.widget;
          if (typeof alt === 'string') {
            w.type = alt;
            delete w.kind;
            delete w.widget;
          }
        }
        if (typeof w.type === 'string' && WIDGET_TYPE_ALIASES[w.type]) w.type = WIDGET_TYPE_ALIASES[w.type];
        // P0.5: unknown widget type (not in the alias map) → coerce to the most
        // generic shape (table) if it has array-ish data, else drop the widget
        // by returning null (filtered below). This prevents a single unknown
        // widget type from failing the ENTIRE card validation.
        const KNOWN_WIDGET_TYPES = new Set(['kpi_grid', 'bar_chart', 'line_chart', 'table', 'callout', 'anomaly_list']);
        if (typeof w.type === 'string' && !KNOWN_WIDGET_TYPES.has(w.type)) {
          // Try to reshape as a table from columns/rows or items/data.
          if (Array.isArray(w.rows) || Array.isArray(w.columns)) {
            w.type = 'table';
            if (!Array.isArray(w.columns)) w.columns = [];
            if (!Array.isArray(w.rows)) w.rows = [];
          } else if (Array.isArray(w.items) && w.items.length > 0 && typeof w.items[0] === 'object') {
            // A list of objects → table (build columns from first item's keys).
            w.type = 'table';
            const firstItem = w.items[0] as Record<string, unknown>;
            w.columns = Object.keys(firstItem);
            w.rows = (w.items as Record<string, unknown>[]).map((it) =>
              (w.columns as string[]).map((c) => {
                const v = it[c];
                return typeof v === 'number' || typeof v === 'string' ? v : (v == null ? '' : JSON.stringify(v));
              }),
            );
            delete w.items;
          } else if (Array.isArray(w.data)) {
            // A data array → bar_chart instead (more natural than table).
            w.type = 'bar_chart';
          } else if (typeof w.text === 'string' || typeof w.message === 'string') {
            w.type = 'callout';
            if (typeof w.variant !== 'string') w.variant = 'info';
            if (typeof w.text !== 'string') w.text = w.message ?? '';
          } else {
            return null; // unrecoverable widget — drop it
          }
        }
        if (typeof w.format === 'string' && !WIDGET_FORMATS.has(w.format)) w.format = 'number';
        // kpi_grid items sometimes arrive under `data` instead of `items` (the
        // model reuses the bar_chart key). Reclaim them before the empty-items
        // guard below drops the widget — the items.map normalizer then runs.
        if (w.type === 'kpi_grid' && !Array.isArray(w.items) && Array.isArray(w.data)) {
          w.items = w.data;
          delete w.data;
        }
        // P0.5: kpi_grid with missing/empty items → the schema requires items.min(1).
        // Drop the widget entirely so the card-level empty-widgets downgrade
        // (below) converts the whole card to text rather than failing validation.
        if (w.type === 'kpi_grid' && (!Array.isArray(w.items) || w.items.length === 0)) {
          return null;
        }
        if (Array.isArray(w.items)) {
          w.items = (w.items as Record<string, unknown>[]).map((it) => {
            if (it) {
              // format is required on kpi items — default missing/unknown to 'number'.
              if (it.format === undefined || (typeof it.format === 'string' && !WIDGET_FORMATS.has(it.format))) {
                it.format = 'number';
              }
              it.value = coerceNumeric(it.value);
              it.delta = coerceNumeric(it.delta);
            }
            return it;
          });
        }
        if (Array.isArray(w.data)) {
          w.data = (w.data as Record<string, unknown>[]).map((point) => ({
            ...point,
            name: typeof point.name === 'string' ? point.name : String(point.label ?? point.title ?? ''),
            value: coerceNumeric(point.value),
          }));
        }
        if (Array.isArray(w.series)) {
          w.series = (w.series as Record<string, unknown>[]).map((series) => ({
            ...series,
            points: Array.isArray(series.points)
              ? (series.points as Record<string, unknown>[]).map((point) => ({ ...point, y: coerceNumeric(point.y) }))
              : series.points,
          }));
        }
        if (w.type === 'table') normalizeTableWidget(w);
        if (w.type === 'callout') {
          // The wire contract names the callout body `text`, but the model
          // often emits `content`/`message`/`title-as-body`. Without this map
          // the callout fails validation, which fails the ENTIRE widgets
          // array, which downgrades the whole insight_card to its prose
          // summary (the "card becomes one line" bug). Reclaim the body text
          // from any of these keys before the schema runs.
          if (typeof w.text !== 'string') {
            w.text = typeof w.content === 'string' ? w.content
              : typeof w.message === 'string' ? w.message
              : typeof w.body === 'string' ? w.body
              : '';
          }
          if (typeof w.variant !== 'string') w.variant = 'info';
        }
        if (w.type === 'anomaly_list' && Array.isArray(w.items)) {
          w.items = (w.items as Record<string, unknown>[]).map((item) => ({
            ...item,
            // P0.5: detail is required by the schema; default missing to empty.
            detail: typeof item.detail === 'string' ? item.detail : (typeof item.description === 'string' ? item.description : ''),
            severity: item.severity === 'medium' ? 'med' : item.severity,
          }));
        }
        return w;
      })
        // P0.5: drop widgets that couldn't be coerced to a known type (returned null).
        .filter((w): w is Record<string, unknown> => w !== null && typeof w === 'object');
    }
    if (
      obj.type === 'insight_card' &&
      (!Array.isArray(obj.widgets) || obj.widgets.length === 0) &&
      (typeof obj.summary === 'string' || typeof obj.content === 'string')
    ) {
      return { type: 'text', content: String(obj.summary ?? obj.content) };
    }
    if (Array.isArray(obj.actions)) {
      obj.actions = (obj.actions as Record<string, unknown>[])
        .map((a) => {
          if (!a || typeof a !== 'object' || typeof a.directive !== 'object') return null;
          return { ...a, directive: sanitizeDirective(a.directive) };
        })
        .filter(Boolean);
    }
  }
  return obj;
}

function sanitizeDirective(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const d = { ...(raw as Record<string, unknown>) };
  if (typeof d.type === 'string' && d.kind === undefined) d.kind = d.type;
  if (d.routeKey === undefined) d.routeKey = d.route_key ?? d.route ?? d.page ?? d.pageKey;
  if (d.targetId === undefined && d.target_id !== undefined) d.targetId = d.target_id;
  if (d.durationMs === undefined && d.duration_ms !== undefined) d.durationMs = coerceNumeric(d.duration_ms);
  if (d.highlight && typeof d.highlight === 'object' && !Array.isArray(d.highlight)) {
    const h = { ...(d.highlight as Record<string, unknown>) };
    if (h.targetId === undefined) h.targetId = h.target_id ?? h.id;
    if (h.durationMs === undefined) h.durationMs = coerceNumeric(h.duration_ms);
    d.highlight = h;
  }
  return d;
}

function coerceNumeric(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : value;
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s) return value;
  // Models frequently pre-format KPI values even though the wire contract asks
  // for raw numbers. Strip display-only currency and percent suffixes here;
  // the widget `format` field adds them back consistently in the frontend.
  const compact = s.replace(/\s/g, '').replace(/₫|đ|vnd|vnđ|%/gi, '');
  if (/^-?\d+([.,]\d{3})+$/.test(compact)) return Number(compact.replace(/[.,]/g, ''));
  if (/^-?\d+(,\d+)?$/.test(compact)) return Number(compact.replace(',', '.'));
  if (/^-?\d+(\.\d+)?$/.test(compact)) return Number(compact);
  return value;
}

function normalizeTableWidget(w: Record<string, unknown>) {
  if (!Array.isArray(w.rows)) return;
  const rows = w.rows;
  // P0.5: even when rows are arrays, individual CELLS may be objects/arrays
  // (the schema requires string|number per cell). Coerce any non-primitive
  // cell to a string so the table validates.
  if (rows.every((r) => Array.isArray(r))) {
    w.rows = rows.map((r) =>
      (r as unknown[]).map((cell) => {
        if (typeof cell === 'number' || typeof cell === 'string') return cell;
        if (cell == null) return '';
        if (typeof cell === 'object') {
          // Extract a display value from common keys, else stringify.
          const o = cell as Record<string, unknown>;
          for (const k of ['label', 'name', 'value', 'text', 'title']) {
            if (typeof o[k] === 'string' || typeof o[k] === 'number') return o[k];
          }
          return JSON.stringify(cell);
        }
        return String(cell);
      }),
    );
    return;
  }
  const objectRows = rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[];
  if (objectRows.length !== rows.length) return;
  const columns = Array.isArray(w.columns) && w.columns.every((c) => typeof c === 'string')
    ? w.columns as string[]
    : Array.from(new Set(objectRows.flatMap((r) => Object.keys(r))));
  w.columns = columns;
  w.rows = objectRows.map((r) => columns.map((c) => {
    const v = r[c];
    const n = coerceNumeric(v);
    return typeof n === 'number' || typeof n === 'string' ? n : JSON.stringify(n ?? '');
  }));
}

/**
 * Find the first balanced `{…}` JSON object in `s`. Reasoning models sometimes
 * wrap the JSON in leftover prose or tags even after stripping <think>; this
 * locates the real object without trusting the string to start with `{`.
 * Returns null if no balanced object is present.
 */
function extractFirstJsonObjectWithRemainder(s: string): { json: string; trailing: string } | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return { json: s.slice(start, i + 1), trailing: s.slice(i + 1) };
      }
    }
  }
  return null;
}

function extractFirstJsonObject(s: string): string | null {
  return extractFirstJsonObjectWithRemainder(s)?.json ?? null;
}

// Per-tool-result view compaction lives in ./tool-result-compact.ts
// (structure-aware: caps rows, drops empty columns, and — unlike the old blunt
// char slice — cuts at a safe boundary so JSON is never handed to the model
// half-corrupted). See compactToolResult().

/**
 * P1.1 — cap the accumulated within-turn tool-result history by CHAR BUDGET so
 * the ReAct loop stops re-billing every prior tool result on each callMiniMax
 * (the dominant 59k-tokens/turn driver — each call is billed for its full prompt
 * context, and `messages` only ever grows). PROTOCOL-SAFE: it drops only
 * COMPLETE units (one assistant(tool_calls) message + ALL its tool replies),
 * because a `tool_calls` turn with a missing `tool` reply is an OpenAI 400.
 * The seed (system + prior history + current user message) and the most recent
 * units are always kept, so normal 1–2-tool turns never lose synthesis data;
 * trimming only fires on genuinely long turns, and never below KEEP_RECENT.
 */
const TOOL_HISTORY_BUDGET_CHARS = 24_000; // ~6k tokens of tool history before trimming kicks in
const KEEP_RECENT_TOOL_UNITS = 2;
export function trimToolHistory(messages: MiniMaxMessage[]): MiniMaxMessage[] {
  // Everything before the first assistant(tool_calls) is the seed — always keep.
  const firstToolUnitIdx = messages.findIndex(
    (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
  );
  if (firstToolUnitIdx < 0) return messages; // no tool history accumulated yet
  const seed = messages.slice(0, firstToolUnitIdx);

  // Group the tail into units: each unit = [assistant(tool_calls), ...its tool replies].
  const units: MiniMaxMessage[][] = [];
  for (const m of messages.slice(firstToolUnitIdx)) {
    if (m.role === 'assistant') {
      units.push([m]);
    } else {
      const cur = units[units.length - 1];
      if (cur) cur.push(m);
      else units.push([m]); // defensive: tool reply with no preceding assistant
    }
  }

  // Drop oldest complete units until under budget, but never below KEEP_RECENT.
  while (units.length > KEEP_RECENT_TOOL_UNITS) {
    if (JSON.stringify(units.flat()).length <= TOOL_HISTORY_BUDGET_CHARS) break;
    units.shift();
  }

  // HARD CAP (prod metrics 2026-06-28: turns hit 21–30k prompt tokens at
  // ~0.26ms/token — the >20s tail). The KEEP_RECENT floor above stops at 2 units
  // regardless of size, so two huge tool results could still blow the budget.
  //
  // Pass 1: re-cut the LARGEST tool-reply (largest-first = fastest convergence)
  // with cutAtSafeBoundary — valid JSON + the same '…(đã cắt)' marker
  // compactToolResult already uses. Stop the moment a cut doesn't shrink: below
  // ~190 chars cutAtSafeBoundary only GROWS the string (appends the note), so
  // halving can't help there — breaking avoids a wasted-iteration spin.
  //
  // Pass 2 (last resort, makes the cap actually hard): if still over budget —
  // many small replies whose sum exceeds it, or huge non-tool messages — drop
  // oldest WHOLE units (even below KEEP_RECENT) until it fits. A whole unit is
  // its assistant(tool_calls) + trailing tool replies, so the remaining pairs
  // stay protocol-safe. Last resort: only the seed remains.
  //
  // Both passes are no-ops when already under budget.
  const MAX_TRIM_PASSES = 50; // backstop only — halving converges in ~log2(budget/200) ≈ 8
  const kept: MiniMaxMessage[] = units.flat();
  let guard = 0;
  while (JSON.stringify(kept).length > TOOL_HISTORY_BUDGET_CHARS && guard++ < MAX_TRIM_PASSES) {
    let worstIdx = -1;
    let worstLen = -1;
    for (let i = 0; i < kept.length; i++) {
      const c = kept[i].content;
      if (kept[i].role === 'tool' && typeof c === 'string' && c.length > worstLen) {
        worstLen = c.length;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break; // no shrinkable tool-reply content
    const target = kept[worstIdx].content as string;
    const halved = Math.max(200, Math.floor(target.length / 2));
    const next = cutAtSafeBoundary(target, halved);
    if (next.length >= target.length) break; // couldn't shrink this one → Pass 1 done
    kept[worstIdx] = { ...kept[worstIdx], content: next };
  }
  // Pass 2: drop oldest whole units until under budget (or only seed remains).
  while (JSON.stringify(kept).length > TOOL_HISTORY_BUDGET_CHARS && kept.length > 0) {
    kept.shift(); // leading assistant(tool_calls) (or a stray leading tool reply)
    while (kept.length > 0 && kept[0].role === 'tool') kept.shift(); // …its now-orphaned replies
  }
  return [...seed, ...kept];
}
