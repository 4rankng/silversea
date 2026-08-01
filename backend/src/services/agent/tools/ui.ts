// Agent tools — Navigation suite (agent directives).
// These are NOT read tools: navigate/focus/open/prefill produce a Directive the
// frontend bridge applies (the backend cannot drive the SPA directly). The
// orchestrator detects the `ui.` prefix and emits a `directive` SSE event,
// then feeds a short confirmation back to the LLM so it can keep reasoning.
// `ui.search_pages` IS a read tool — it returns the route catalog so the LLM
// can resolve "trang lương" → salary before calling ui.navigate.
import { z } from 'zod';
import {
  agentRouteKeySchema,
  AGENT_ROUTE_KEYS,
  PAGE_CATALOG,
  Role,
  type AgentRouteKey,
  type PageAgentMeta,
} from '@tingting/shared';
import { OFFICE_ROLES, type AgentToolDef, type AgentContext } from '../tool.types';
import { NAV_HIGHLIGHT_DEFAULTS } from '../routeMatcher';
import { normalizeText as normalizeSearchText } from '../text';

// OFFICE_ROLES is a readonly tuple of specific enum members; widen to Role[]
// so .includes(ctx.role) type-checks (ctx.role is the full Role union).
const OFFICE_ROLE_SET: readonly Role[] = OFFICE_ROLES;

// Per-key search data, derived from PAGE_CATALOG (single source of truth). The
// LLM resolves a user query ("mau giay bao no", "luong", "cong no") by matching
// the title + description + aliases — not just the routeKey + description it
// used to. The agent-keys sync guard in shared/src/schemas/agent.ts guarantees
// every AgentRouteKey has `agent` data, so `agent!` is safe here.
const PAGE_SEARCH_ENTRIES: ReadonlyArray<{
  routeKey: AgentRouteKey;
  title: string;
  description: string;
  aliases: readonly string[];
}> = (AGENT_ROUTE_KEYS as readonly AgentRouteKey[]).map((k) => {
  // Annotated as PageAgentMeta so optional `aliases` reads uniformly across the
  // catalog's narrow per-entry agent types (only some entries declare aliases).
  const meta: PageAgentMeta = PAGE_CATALOG[k].agent!;
  return {
    routeKey: k,
    title: PAGE_CATALOG[k].title,
    description: meta.description,
    aliases: meta.aliases ?? [],
  };
});

function buildDirectiveTool<A extends z.ZodTypeAny>(
  name: string,
  description: string,
  params: A,
  toDirective: (args: z.infer<A>, ctx: AgentContext) => unknown,
  label: (args: z.infer<A>) => string,
): AgentToolDef {
  return {
    name,
    description,
    params,
    allowedRoles: OFFICE_ROLES,
    // Directive tools are side-effecting + ack-ordered → MUST stay serial.
    readonly: false,
    async execute(rawArgs, ctx) {
      if (!OFFICE_ROLE_SET.includes(ctx.role)) {
        return { data: null, label: 'Không có quyền' };
      }
      const args = params.parse(rawArgs);
      return { data: toDirective(args, ctx), label: label(args) };
    },
  };
}

// Optional element highlight after navigation: scroll + ring-pulse a specific
// button/section so the user sees exactly where to act. Mirrors the navigate
// directive's `highlight` shape (validated by the shared schema at emit time).
const highlightParamSchema = z.object({
  targetId: z.string().min(1),
  durationMs: z.number().int().min(300).max(5000).optional(),
});

function normalizeNavigateArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...input };

  next.routeKey =
    input.routeKey ??
    input.route_key ??
    input.route ??
    input.page ??
    input.pageKey;

  const topLevelParams: Record<string, string | number> = {};
  for (const key of ['id', 'truckId', 'truck_id', 'trailerId', 'trailer_id']) {
    const value = input[key];
    if (typeof value === 'string' || typeof value === 'number') {
      topLevelParams[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    }
  }

  if (
    input.params &&
    typeof input.params === 'object' &&
    !Array.isArray(input.params)
  ) {
    next.params = { ...topLevelParams, ...(input.params as Record<string, unknown>) };
  } else if (Object.keys(topLevelParams).length > 0) {
    next.params = topLevelParams;
  }

  const highlight = input.highlight ?? input.targetId ?? input.target_id;
  if (typeof highlight === 'string') {
    next.highlight = {
      targetId: highlight,
      durationMs: coerceDuration(input.durationMs ?? input.duration_ms),
    };
  } else if (highlight && typeof highlight === 'object' && !Array.isArray(highlight)) {
    const h = highlight as Record<string, unknown>;
    next.highlight = {
      ...h,
      targetId: h.targetId ?? h.target_id ?? h.id,
      durationMs: coerceDuration(h.durationMs ?? h.duration_ms),
    };
  }

  return next;
}

function coerceDuration(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

const navigateParamsSchema = z.preprocess(
  normalizeNavigateArgs,
  z.object({
    routeKey: agentRouteKeySchema,
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    highlight: highlightParamSchema.optional(),
  }),
);

export const uiTools: AgentToolDef[] = [
  buildDirectiveTool(
    'ui.navigate',
    'Mở một trang trong ứng dụng (điều hướng SPA). Trả routeKey từ danh sách trang đã biết; dùng ui.search_pages nếu chưa chắc routeKey. Có thể kèm highlight:{targetId,durationMs} để cuộn + tô sáng nút/phần tử cụ thể trên trang đích (VD trang lốp: targetId "ttp-add-trigger"). Dùng highlight khi người dùng cần biết chính xác chỗ để bấm/nhập — đặc biệt khi bot không thể tự thực hiện hành động (v1 chỉ đọc) mà chỉ dẫn người dùng tới nút đó.',
    navigateParamsSchema,
    (a) => ({
      kind: 'navigate',
      routeKey: a.routeKey,
      params: a.params,
      // Inject the default target when the model navigates to a known
      // spotlightable page but didn't name one — the user still gets a pinpoint.
      ...(a.highlight
        ? { highlight: a.highlight }
        : NAV_HIGHLIGHT_DEFAULTS[a.routeKey]
          ? { highlight: { targetId: NAV_HIGHLIGHT_DEFAULTS[a.routeKey] } }
          : {}),
    }),
    (a) => `Mở trang ${a.routeKey}`,
  ),
  buildDirectiveTool(
    'ui.focus',
    'Mở một trang rồi cuộn + tô sáng một dòng theo id (ví dụ chuyến/khách cụ thể).',
    z.object({
      routeKey: agentRouteKeySchema,
      id: z.union([z.string(), z.number()]),
      prefix: z.string().optional(),
    }),
    (a) => ({ kind: 'focus', routeKey: a.routeKey, id: a.id, prefix: a.prefix }),
    (a) => `Tô sáng mục ${a.routeKey}`,
  ),
  // Keep open/prefill out of the advertised tool list until pages actually
  // register component handlers. The system prompt already tells the model not
  // to use them; hiding the tools as well prevents malformed `prefill: "..."`
  // arguments from leaking through as raw Zod errors in the chat bubble.
  {
    name: 'ui.search_pages',
    description:
      'Tìm trang phù hợp theo từ khoá tiếng Việt (VD "lương", "công nợ", "chi phí"). Trả về danh sách {routeKey, description} để dùng cho ui.navigate/ui.focus.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ query: z.string().min(1) }),
    // Pure in-memory catalog search — safe to run concurrently with data.* reads.
    readonly: true,
    async execute(rawArgs, ctx) {
      if (!OFFICE_ROLE_SET.includes(ctx.role)) return { data: [] };
      const { query } = z.object({ query: z.string().min(1) }).parse(rawArgs);
      const q = normalizeSearchText(query);
      const matches = PAGE_SEARCH_ENTRIES.filter(
        (p) =>
          normalizeSearchText(p.title).includes(q) ||
          normalizeSearchText(p.description).includes(q) ||
          p.aliases.some((a) => normalizeSearchText(a).includes(q)),
      ).map((p) => ({ routeKey: p.routeKey, description: p.description }));
      return { data: matches, label: `${matches.length} trang phù hợp` };
    },
  },
];
