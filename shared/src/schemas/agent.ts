import { z } from 'zod';
import { PAGE_CATALOG } from '../navigation/pageCatalog';

/**
 * Agent (command-and-insight assistant) wire contract.
 *
 * This is the single source of truth for what travels between the backend
 * orchestrator (MiniMax) and the frontend drawer. Three layers:
 *
 *   1. Directive      — how the agent drives the UI (navigate/focus/open/prefill/toast/scrollTo)
 *   2. Widget         — a typed, natively-rendered card building block
 *   3. AgentResponse  — the assistant's final answer: text | insight_card | directive
 *
 * Kept in `shared` (not the flat `schemas/index.ts`, which is already 800+
 * lines of entity CRUD) because this is a self-contained, cross-boundary
 * contract consumed by both `@tingting/backend` and `@tingting/frontend`.
 *
 * Design rules:
 *   - Every multi-variant type is a `discriminatedUnion` so the renderer /
 *     consumer switches exhaustively on one field.
 *   - `format` on numeric widgets drives RENDERING (vnd / percent / number /
 *     days) — the value itself is always a plain number. The LLM must never
 *     embed pre-formatted strings (it would defeat locale + consistency); the
 *     backend Zod-validates and the system prompt enforces "numbers only".
 */

// ─── Route keys the agent may navigate to ──────────────────────────────────
// This is the CLOSED set the LLM chooses from + the backend validates against
// role (R9). It is the *agent's* view of navigable office-staff destinations;
// the frontend directive bridge resolves each key to an actual `routes.ts`
// path. Keep this in sync when adding a new office page the agent should reach.
export const AGENT_ROUTE_KEYS = [
  // Top-level
  'dashboard',
  'dispatch',
  'fleet',
  'fleetTires',
  'fleetTrailerTires',
  'trips',
  'tripNew',
  'tripDetail',
  'tripEdit',
  // Finance
  'accounting',
  'finance',
  'profit',
  'debt',
  'debtDetail',
  'payables',
  'payableDetail',
  'penalties',
  'advances',
  'governanceActions',
  'adminAdvanceSettlements',
  'salary',
  'expenses',
  'expenseNew',
  'expenseEdit',
  // Catalogs
  'customers',
  'suppliers',
  'config',
  'configCustomers',
  'configRoutes',
  'configBusinessCalendar',
  'configTrucks',
  'configTrailers',
  'configFuel',
  'configSalaryPeriods',
  'configDebitNoteTemplates',
  // Admin
  'users',
  'auditLogs',
  'chatbotMonitoring',
] as const;

export type AgentRouteKey = (typeof AGENT_ROUTE_KEYS)[number];

export const agentRouteKeySchema = z.enum(AGENT_ROUTE_KEYS);

// ─── Catalog ↔ route-key sync guard ─────────────────────────────────────────
// `AGENT_ROUTE_KEYS` must EXACTLY equal the set of PAGE_CATALOG entries that
// declare an `agent` sub-object. It is kept a hand-written `as const` tuple
// because the `as const` is load-bearing for `z.enum` above — deriving it via
// Object.keys().filter() would widen to `string[]` and break the enum. This
// assertion fails tsc on drift in EITHER direction: an agent-bearing catalog
// entry missing from the tuple, or a tuple key whose catalog entry has no
// `agent` data.
type _CatalogAgentKeys = {
  [K in keyof typeof PAGE_CATALOG]: (typeof PAGE_CATALOG)[K] extends { agent: unknown } ? K : never;
}[keyof typeof PAGE_CATALOG];
type _TupleExtra = Exclude<_CatalogAgentKeys, AgentRouteKey>; // catalog agent key not listed in the tuple
type _TupleMissing = Exclude<AgentRouteKey, _CatalogAgentKeys>; // tuple key with no catalog `agent` data
const _agentKeysInSync: (_TupleExtra extends never ? true : _TupleExtra) &
  (_TupleMissing extends never ? true : _TupleMissing) = true;
void _agentKeysInSync;

// ─── Openable component ids (modal/drawer/form targets) ─────────────────────
// Advisory closed set of componentIds pages MAY register via `useAgentOpenable`.
// Currently EMPTY: no page registers a handler yet, so an `open`/`prefill`
// directive would silently no-op — the system prompt steers the LLM to
// `navigate`/`focus` instead. When a page registers a handler, add its id here
// so it can be listed in the prompt. The schema stays a plain string because
// registrations are dynamic per mounted page (the backend cannot authoritatively
// enumerate them); this array is the *intended* registry, not an enforcement.
export const AGENT_COMPONENT_IDS = [] as const;
export const agentComponentIdSchema = z.string().min(1);

// ─── Directive (UI driver) ─────────────────────────────────────────────────
// Discriminator is `kind` so the frontend switch is exhaustive. `navigate`/
// `focus` target a registered page (and may carry highlight/animation intent);
// `open`/`prefill` target a per-page component registered via `useAgentOpenable`;
// `toast`/`scrollTo` are fire-and-forget client actions (no ack).
const directiveParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .optional();

/** Scroll-to + ring-highlight an element by id for a bounded duration. */
const highlightSchema = z.object({
  targetId: z.string().min(1),
  durationMs: z.number().min(300).max(5000).optional(),
});

/**
 * Route-transition intent. `fade` renders via the View Transitions API
 * (progressive enhancement — no-op where unsupported). `slide-left`/`slide-right`
 * are ACCEPTED by the schema but currently RENDER AS FADE until a transition
 * library is wired up; do not claim they slide.
 */
const routeAnimationSchema = z.enum(['none', 'fade', 'slide-left', 'slide-right']);

export const agentDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('navigate'),
    routeKey: agentRouteKeySchema,
    params: directiveParamsSchema,
    /** Optional emphasis after navigation lands (scroll + highlight a metric). */
    highlight: highlightSchema.optional(),
    animation: routeAnimationSchema.optional(),
  }),
  z.object({
    kind: z.literal('focus'),
    /** Navigate then scroll-to + highlight a row (reuses the `?focus=` pattern). */
    routeKey: agentRouteKeySchema,
    id: z.union([z.string(), z.number()]),
    prefix: z.string().optional(),
    /** Highlight-ring duration in ms (defaults to 2000 on the frontend). */
    durationMs: z.number().min(300).max(5000).optional(),
  }),
  z.object({
    kind: z.literal('open'),
    /** componentId matches a handler registered in the target page's useAgentOpenable. */
    componentId: agentComponentIdSchema,
    prefill: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('prefill'),
    componentId: agentComponentIdSchema,
    values: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('toast'),
    variant: z.enum(['success', 'error', 'warning', 'info']),
    message: z.string().min(1),
    durationMs: z.number().min(1000).max(10000).optional(),
  }),
  z.object({
    kind: z.literal('scrollTo'),
    targetId: z.string().min(1),
    durationMs: z.number().min(300).max(5000).optional(),
  }),
]);

export type AgentDirective = z.infer<typeof agentDirectiveSchema>;

/** Kinds the frontend confirms back via `agent:action_result` (deterministic
 *  outcome). Others (open/prefill/toast/scrollTo) are fire-and-forget. */
export const ACKED_DIRECTIVE_KINDS = ['navigate', 'focus'] as const;
export type AckedDirectiveKind = (typeof ACKED_DIRECTIVE_KINDS)[number];

// ─── Widgets ───────────────────────────────────────────────────────────────
export const widgetFormatSchema = z.enum(['vnd', 'percent', 'number', 'days']);
export type WidgetFormat = z.infer<typeof widgetFormatSchema>;

/** P4 — provenance tag for a widget value. Tells the user HOW a number was
 *  derived: observed (read from DB), calculated (formula), forecast (model),
 *  assumption (user/model estimate). Rendered as a colored chip. */
export const provenanceSchema = z.object({
  metricId: z.string().optional(),
  category: z.enum(['observed', 'calculated', 'forecast', 'assumption']),
  formula: z.string().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const agentWidgetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('kpi_grid'),
    items: z
      .array(
        z.object({
          label: z.string(),
          /** Always a raw number; `format` decides how it is rendered. */
          value: z.number(),
          format: widgetFormatSchema,
          /** Optional prior/compare value, same format — rendered as a delta. */
          delta: z.number().optional(),
          /** P4 — provenance tag (observed/calculated/forecast/assumption). */
          provenance: provenanceSchema.optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    type: z.literal('bar_chart'),
    title: z.string().optional(),
    data: z.array(z.object({ name: z.string(), value: z.number() })),
    format: widgetFormatSchema.optional(),
  }),
  z.object({
    type: z.literal('line_chart'),
    title: z.string().optional(),
    series: z.array(
      z.object({
        name: z.string(),
        points: z.array(z.object({ x: z.union([z.string(), z.number()]), y: z.number() })),
      }),
    ),
  }),
  z.object({
    type: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
  }),
  z.object({
    type: z.literal('callout'),
    variant: z.enum(['info', 'warning', 'danger']),
    text: z.string(),
  }),
  z.object({
    type: z.literal('anomaly_list'),
    items: z.array(
      z.object({
        label: z.string(),
        detail: z.string(),
        severity: z.enum(['low', 'med', 'high']),
      }),
    ),
  }),
]);

export type AgentWidget = z.infer<typeof agentWidgetSchema>;

// ─── Action chips (response-level shortcuts that fire a directive) ─────────
export const agentActionChipSchema = z.object({
  label: z.string(),
  directive: agentDirectiveSchema,
});
export type AgentActionChip = z.infer<typeof agentActionChipSchema>;

// ─── Citations (P2 — provenance for grounded answers) ───────────────────────
// Every grounded answer (from doc-RAG, FAQ, or tool data) should carry at least
// one citation so users can verify the source. Rendered as small chips under
// the answer in the frontend.
export const agentCitationSchema = z.object({
  /** Unique source identifier (e.g. "doc:CONTEXT.md:glossary", "faq:12"). */
  sourceId: z.string(),
  /** Human-readable label for the chip (e.g. "CONTEXT.md", "FAQ #12"). */
  label: z.string(),
  /** What kind of source this is. */
  kind: z.enum(['faq', 'doc', 'tool']),
  /** Optional URL or path for deep-linking (e.g. "/docs/adr/0001-..."). */
  url: z.string().optional(),
});
export type AgentCitation = z.infer<typeof agentCitationSchema>;

// ─── Final response ────────────────────────────────────────────────────────
export const agentResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
    /** Optional suggested next actions for prose answers (e.g. open the page named in text). */
    actions: z.array(agentActionChipSchema).optional(),
    /** P2 — citations for grounded answers (doc-RAG, FAQ source). */
    citations: z.array(agentCitationSchema).optional(),
  }),
  z.object({
    type: z.literal('insight_card'),
    title: z.string(),
    /** One- or two-sentence cause/answer the LLM composes from tool numbers. */
    summary: z.string(),
    /** Optional analysis emitted after the structured card. Kept separately so
     *  a useful narrative augments the widgets instead of replacing them. */
    details: z.string().optional(),
    widgets: z.array(agentWidgetSchema).min(1),
    actions: z.array(agentActionChipSchema).optional(),
    citations: z.array(agentCitationSchema).optional(),
  }),
  z.object({ type: z.literal('directive'), directive: agentDirectiveSchema }),
]);

export type AgentResponse = z.infer<typeof agentResponseSchema>;

// ─── Conversation persistence (GET /conversations[/:id]) ───────────────────
export const agentMessageRoleSchema = z.enum(['user', 'assistant']);

export const agentMessageSchema = z.object({
  id: z.string(),
  role: agentMessageRoleSchema,
  /** Present for user turns and for assistant `text` responses. */
  content: z.string().optional(),
  /** Present for assistant turns whose answer was a card or directive. */
  response: agentResponseSchema.optional(),
  createdAt: z.string(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const agentConversationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  messages: z.array(agentMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentConversation = z.infer<typeof agentConversationSchema>;

// ─── Live event stream ─────────────────────────────────────────────────────
// The assistant streams these over a socket.io `/agent` namespace (`agent:event`
// frames). The event names follow the AG-UI (Agent–User Interaction) protocol's
// lifecycle/tool/text-message taxonomy (RUN_STARTED, TOOL_CALL_*, RUN_FINISHED,
// RUN_ERROR, TEXT_MESSAGE_*), with a typed DIRECTIVE extension carrying our rich
// navigate/focus/open/prefill/toast/scrollTo UI-driver payload. The transport is
// still Socket.IO — we adopt the protocol's contract, not its SDK.
//
// NOTE the discriminator is `type` (AG-UI BaseEvent convention), NOT `event`.
// Do not confuse these event `type` literals with the `AgentResponse.type`
// discriminator (text/insight_card/directive) above — they
// are separate unions that happen to share the string 'directive'.
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({
    // Emitted instantly on agent:chat receipt, before any LLM/FAQ work. Gives
    // the frontend a perceived-latency floor: "Đang xử lý…" replaces the static
    // spinner the moment the server has the message, not after the first LLM
    // call returns. Fire-and-forget; no client response expected.
    type: z.literal('RUN_STARTED'),
  }),
  z.object({
    type: z.literal('TOOL_CALL_START'),
    toolName: z.string(),
    /** Echo of the args the LLM chose (truncated/summarised for display). */
    args: z.unknown().optional(),
    /** Optional lifecycle marker for a richer thinking indicator. */
    status: z.enum(['started', 'running', 'completed']).optional(),
  }),
  z.object({
    type: z.literal('TOOL_CALL_END'),
    toolName: z.string(),
    toolCallId: z.string().optional(),
    ok: z.boolean(),
    /** Short human label of what was returned, for the "thinking" indicator. */
    label: z.string().optional(),
    status: z.enum(['started', 'running', 'completed']).optional(),
  }),
  // Typed domain extension (AG-UI would model this as a CUSTOM event; we keep a
  // dedicated variant so the `AgentDirective` payload + ack semantics are typed).
  z.object({
    type: z.literal('DIRECTIVE'),
    directive: agentDirectiveSchema,
    /** Present when the frontend must confirm execution via `agent:action_result`
     *  (navigate/focus). Absent → fire-and-forget. */
    actionId: z.string().optional(),
    requiresAck: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('RUN_FINISHED'),
    response: agentResponseSchema,
    /** Set on the first turn — the id of the conversation that was created/used. */
    conversationId: z.string().optional(),
    /** Assistant message id, used by the browser to report true wait time. */
    messageId: z.number().int().positive().optional(),
    /** True when the answer came from the FAQ fast lane (zero LLM calls). Lets
     *  the frontend tag the bubble + the backend skip agent_turn_metrics. */
    fastLane: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('RUN_ERROR'),
    message: z.string(),
  }),
  // ── Text-message streaming (token-by-token for {type:'text'} answers) ─────
  // AG-UI text-message triad. Emitted only for streamable prose answers
  // (terminal ReAct prose + the produceFinalAnswer prose fallback). Structured
  // answers (insight_card/directive) need complete JSON for
  // Zod validation, so they are buffered and arrive whole in RUN_FINISHED.
  // The frontend correlates START/CONTENT/END by `messageId` into one pending
  // bubble; RUN_FINISHED carries the authoritative full text for persistence.
  z.object({
    type: z.literal('TEXT_MESSAGE_START'),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal('TEXT_MESSAGE_CONTENT'),
    messageId: z.string(),
    /** Non-empty incremental token/chunk. */
    delta: z.string(),
  }),
  z.object({
    type: z.literal('TEXT_MESSAGE_END'),
    messageId: z.string(),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

// ─── Client→server action acknowledgment ────────────────────────────────────
// Emitted on the `agent:action_result` socket event for directives the server
// tagged with `requiresAck: true`. Lets the orchestrator await confirmed
// execution before composing the final "Đã mở trang…" text — so it never claims
// success for a directive the client never applied (e.g. drawer closed,
// disconnected, unknown route).
export const agentActionResultSchema = z.object({
  actionId: z.string(),
  status: z.enum(['ok', 'error', 'timeout']),
  reason: z.string().optional(),
});
export type AgentActionResult = z.infer<typeof agentActionResultSchema>;
