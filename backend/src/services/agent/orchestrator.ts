// Agent orchestrator — the ReAct loop that turns a user message into a final
// AgentResponse, streaming progress as SSE events.
//
// Flow:
//   1. system prompt (role-aware, current route, "use only tool numbers")
//   2. loop (≤ agentMaxIterations): callMiniMax(tools) → execute each
//      tool_call (role-checked) → feed results back. ui.* tools also emit a
//      `DIRECTIVE` event so the UI moves immediately.
//   3. final call with JSON-mode → AgentResponse (Zod-validated; retry once,
//      then degrade to text).
//   4. persist the turn (resilient — a missing migration must not kill chat).
//
// ⚠️ Depends on the MiniMax spike (R1): tool-calling + JSON-mode shape. The
// client is written to the OpenAI-compatible surface; verify before enabling.
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZodError } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { randomUUID } from 'crypto';
import { performance } from 'node:perf_hooks';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../../config';
import {
  agentResponseSchema,
  agentDirectiveSchema,
  ACKED_DIRECTIVE_KINDS,
  Role,
  type AgentEvent,
  type AgentResponse,
  type AgentDirective,
  type AgentActionChip,
  type AgentActionResult,
  type AgentCitation,
  PAGE_CATALOG,
} from '@tingting/shared';
import {
  callMiniMax,
  callMiniMaxStream,
  stripThink,
  MODEL_FAST,
  AGENT_MAX_ITERATIONS,
  MiniMaxError,
  type MiniMaxMessage,
  type MiniMaxTool,
  type MiniMaxFunctionCall,
} from '../llm/minimax.client';
import { compactToolResult, cutAtSafeBoundary } from './tool-result-compact';
import { estimateTokensByComponent, formatAttribution } from './token-attribution';
import { getToolsForRole } from './tool.registry';
import { iterationBudgetFor, readonlyToolCacheKey, selectToolsForMessage } from './tool-selector.js';
import { createSafeTextDeltaFilter } from './stream-sanitizer.js';
import {
  matchRoute,
  sameRoute,
  hasOnlyNumericParams,
  NAV_HIGHLIGHT_DEFAULTS,
} from './routeMatcher';
import type { AgentContext, AgentToolDef, ToolResult } from './tool.types';
import { ToolError } from './tool.types';
import { withSpan, withRootSpan, type SpanAttrs } from './telemetry.js';
import logger from '../../lib/logger.js';

// ── Latency computation (pure, unit-tested) ─────────────────────────────────
// LATENCY CONTRACT — read before editing the metrics row:
//   latency_total_ms          = LLM + tools + final            (EXCLUDES ack + persist)
//   latency_user_perceived_ms = server-side wait fallback = root durationMs
//   latency_ack_ms / latency_persist_ms : tracked in their own columns
// All durations come from performance.now() (via withSpan.durationMs or a local
// timer), NEVER from the OTel span duration. See telemetry.ts LATENCY CONTRACT.
export interface MetricsAccumulator {
  latencyLlmMs: number;
  latencyToolsMs: number;
  latencyFinalMs: number;
  latencyAckMs: number;
  latencyPersistMs: number;
  /** P0 — time-to-first-token (ms from turn start to first streamed delta or
   *  first tool result). Stamped once; null when the turn streamed nothing and
   *  ran no tools. Persisted to latency_first_token_ms. */
  latencyFirstTokenMs: number | undefined;
  reactIterations: number;
  toolCallCount: number;
  fallbackUsed: boolean;
  aborted: boolean;
  errorKind: string | undefined;
  /** P0 — which execution lane handled the turn. Today only 'react_fallback'
   *  (this orchestrator) and 'faq' (set in agentSocket before calling runAgent
   *  is skipped). P1 will add 'nav'/'lookup'. Persisted to intent_bucket. */
  intentBucket: string | undefined;
  /** True iff a navigate/focus directive was emitted this turn (mid-loop tool,
   *  terminal answer, or guardrail-synthesized). Powers the dashboard's
   *  navigate-compliance KPI (A4) and gates the A3 guardrail. */
  navigateDirectiveEmitted: boolean;
  /** True iff the A3 guardrail converted a prose-with-path answer into a
   *  navigate directive (the model failed to call ui.navigate on its own). */
  guardrailFired: boolean;
  /** True iff Case 1 short-circuited produceFinalAnswer — the ReAct loop's
   *  terminal assistant message already held valid structured JSON, so NO
   *  separate json_object call was made. Measures the double-call collapse:
   *  high = the model reliably emits in-loop JSON; low = Case 3 (structured
   *  retry) fires often and the collapse isn't helping. In-memory only —
   *  persisted indirectly via latencyFinalMs === 0. */
  finalAvoided: boolean;
}

export interface LatencyBreakdown {
  latencyTotalMs: number;
  latencyUserPerceivedMs: number;
  latencyAckMs: number;
  latencyPersistMs: number;
}

export function computeLatencies(
  acc: Pick<MetricsAccumulator, 'latencyLlmMs' | 'latencyToolsMs' | 'latencyFinalMs' | 'latencyAckMs' | 'latencyPersistMs'>,
  rootDurationMs: number,
): LatencyBreakdown {
  // invariant: user_perceived = total + ack + persist (+overhead)
  return {
    latencyTotalMs: acc.latencyLlmMs + acc.latencyToolsMs + acc.latencyFinalMs,
    latencyUserPerceivedMs: rootDurationMs,
    latencyAckMs: acc.latencyAckMs,
    latencyPersistMs: acc.latencyPersistMs,
  };
}

// System-prompt construction + structured-response contract live in
// system-prompt.ts so they can be unit-tested in isolation and extended without
// touching the ReAct loop. See docs/context-engineering/playbook.md §Instructions.
import { buildSystemPrompt } from './system-prompt.js';

function toolsToMiniMax(tools: AgentToolDef[]): MiniMaxTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.params, { name: t.name }) as Record<string, unknown>,
    },
  }));
}

/** Compose the terminal bubble for a navigate/focus directive from its ack. */
function directiveAckText(
  d: Extract<AgentDirective, { kind: 'navigate' | 'focus' }>,
  ack: AgentActionResult,
): AgentResponse {
  const title = PAGE_CATALOG[d.routeKey]?.title ?? d.routeKey;
  const where = d.kind === 'focus' ? `${title} đã chọn` : title;
  if (ack.status === 'ok') {
    return { type: 'text', content: `Đã mở trang ${where} cho bạn.` };
  }
  return {
    type: 'text',
    content: `Không mở được trang ${where}${ack.reason ? ` (${ack.reason})` : ''}. Bạn có thể mở thủ công.`,
  };
}

function normalizeForIntent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** A3 guardrail helper: scan a prose answer for a path-like token that resolves
 *  to an agent-navigable route DIFFERENT from the user's current page, and
 *  return a navigate directive for it (with the page's default highlight target
 *  when one is configured). Returns null when no usable path is found.
 *  Deterministic + unit-tested; Vietnamese title/alias matching is intentionally
 *  out of scope (match only on /path tokens for v1 determinism). */
export function synthesizeNavigateFromProse(
  text: string,
  currentRouteKey: string | undefined,
): Extract<AgentDirective, { kind: 'navigate' }> | null {
  // /segment[/segment]… tokens, at least one segment after the leading slash.
  const tokens = text.match(/\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9-]+)*/gi) ?? [];
  const current = currentRouteKey ? matchRoute(currentRouteKey) : null;
  for (const tok of tokens) {
    const m = matchRoute(tok);
    if (!m) continue;
    // Parametric routes need a numeric id; static routes (no params) pass.
    if (!hasOnlyNumericParams(m)) continue;
    // Skip a redundant navigate to the page the user is already on.
    if (sameRoute(m, current)) continue;
    const defaultTarget = NAV_HIGHLIGHT_DEFAULTS[m.routeKey];
    return {
      kind: 'navigate',
      routeKey: m.routeKey,
      params: m.params,
      ...(defaultTarget ? { highlight: { targetId: defaultTarget } } : {}),
    };
  }
  return null;
}

/** Build an optional action chip for prose answers that mention a valid app
 *  path but remain text (for example after a prior navigation already happened
 *  in the same turn). This avoids dumping bare `/fleet/1/tires` instructions
 *  without a clickable next step. */
export function synthesizeTextActionsFromProse(
  text: string,
  currentRouteKey: string | undefined,
): AgentActionChip[] {
  const directive = synthesizeNavigateFromProse(text, currentRouteKey);
  if (!directive) return [];
  const label = directive.routeKey === 'fleetTires' || directive.routeKey === 'fleetTrailerTires'
    ? 'Mở trang lốp'
    : 'Mở trang đề xuất';
  return [{ label, directive }];
}

export interface RunAgentResult {
  response: AgentResponse;
  conversationId: string | undefined;
  assistantMessageId: number | undefined;
  toolTrace: unknown[];
}

export async function runAgent(opts: {
  ctx: AgentContext;
  message: string;
  conversationId?: string;
  /** Prior turns in this session (in-memory, supplied by the socket layer) so
   *  a follow-up question shares context. Compact text only — no widgets. */
  priorMessages?: MiniMaxMessage[];
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** When provided, navigate/focus directives are emitted with `requiresAck`
   *  and this resolves once the frontend confirms execution (or times out).
   *  Lets the agent compose accurate "đã mở / không mở được" text. */
  awaitAck?: (actionId: string) => Promise<AgentActionResult>;
}): Promise<RunAgentResult> {
  const { ctx, emit, signal } = opts;
  const tools = selectToolsForMessage(getToolsForRole(ctx.role), opts.message);
  const selectedToolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const miniMaxTools = toolsToMiniMax(tools);
  const iterationBudget = Math.min(AGENT_MAX_ITERATIONS, iterationBudgetFor(opts.message, tools.length));
  // Exact duplicate read calls in one turn share the same promise. Service-level
  // report caches continue to provide cross-turn caching + mutation invalidation.
  const readonlyToolCache = new Map<string, Promise<ToolResult>>();
  const toolTrace: unknown[] = [];
  // P2 — citations collected from knowledge.search tool results, attached to
  // the final AgentResponse for doc-RAG provenance.
  const collectedCitations: AgentCitation[] = [];

  // ── Metrics accumulator ────────────────────────────────────────────────
  // Every persisted assistant turn writes exactly one metrics row. Latency
  // numbers come ONLY from performance.now() (via withSpan.durationMs or a
  // local timer) — NEVER the OTel span duration. See telemetry.ts LATENCY CONTRACT.
  const metrics: MetricsAccumulator = {
    latencyLlmMs: 0,
    latencyToolsMs: 0,
    latencyFinalMs: 0,
    latencyAckMs: 0,
    latencyPersistMs: 0,
    latencyFirstTokenMs: undefined,
    reactIterations: 0,
    toolCallCount: 0,
    fallbackUsed: false,
    aborted: false,
    errorKind: undefined,
    intentBucket: 'react_fallback',
    navigateDirectiveEmitted: false,
    guardrailFired: false,
    finalAvoided: false,
  };

  // P0 — turn start anchor for time-to-first-token. Captured once, before the
  // ReAct loop begins. Both stamp sites (first streamed delta, first tool
  // result) guard on `latencyFirstTokenMs === undefined` so only the EARLIEST
  // signal wins. performance.now() matches the LATENCY CONTRACT (telemetry.ts).
  const turnStart = performance.now();

  // Hoisted out of the root-span body so the metrics row can be written AFTER
  // the span resolves: rootDurationMs + traceId come from withRootSpan's RETURN,
  // so referencing them inside the callback is a TDZ. Mutated inside the span.
  const totalUsage = { promptTokens: 0, completionTokens: 0 };
  let conversationId: string | undefined;
  let assistantMessageId: number | undefined;

  const rootAttrs: SpanAttrs = {
    conversation_id: opts.conversationId ?? 'new',
    role: ctx.role,
    model: MODEL_FAST,
    route_context: ctx.currentRouteKey ?? 'none',
    // NOTE: no user_id span attr (low-cardinality only) — userId goes in the
    // metrics DB row, not on the trace.
  };

  const { result: runResult, durationMs: rootDurationMs, traceId } = await withRootSpan(
    'agent.turn',
    rootAttrs,
    async () => {
      const messages: MiniMaxMessage[] = [
        { role: 'system', content: buildSystemPrompt(ctx, tools, opts.message) },
        ...(opts.priorMessages ?? []),
        { role: 'user', content: opts.message },
      ];

      // ── ReAct loop ──────────────────────────────────────────────────────
      // Accumulate tokens across every MiniMax call (each call is billed for
      // its full prompt context, so summing == actual consumption).
      // (totalUsage is declared in the outer scope — written to the metrics row
      // after the span resolves.)
      const addUsage = (u: { promptTokens: number; completionTokens: number }) => {
        totalUsage.promptTokens += u.promptTokens;
        totalUsage.completionTokens += u.completionTokens;
      };

      const persistResponse = async (response: AgentResponse) => {
        // ── Persist (resilient — never crash the chat over storage) ─────────
        // persistTurn is wrapped in its own span → latencyPersistMs. It returns
        // BOTH conversationId AND the new assistant messageId (so the metrics
        // row has its PK). On failure we still return conversationId=undef.
        try {
          const persistSpan = await withSpan('agent.db.persist_turn', undefined, async () =>
            persistTurn({
              ctx,
              userMessage: opts.message,
              response,
              toolTrace,
              conversationId: opts.conversationId,
              promptTokens: totalUsage.promptTokens,
              completionTokens: totalUsage.completionTokens,
            }),
          );
          metrics.latencyPersistMs += persistSpan.durationMs;
          conversationId = persistSpan.result.conversationId;
          assistantMessageId = persistSpan.result.messageId;
        } catch (e) {
          // Persist failure must NOT crash chat; no row to write (no messageId).
          console.error('[agent] persist failed (migration applied?)', e);
        }

        // One per-turn token-attribution log: shows which prompt component
        // (system / toolSchema / history / transcript) dominates tokens_in — the
        // lever for latency. Counts only (no prompt text/PII). `measured` is the
        // real billed prompt_tokens for cross-check vs the char estimate.
        const attr = estimateTokensByComponent(messages, miniMaxTools);
        console.log(
          `[agent] token-attribution ${formatAttribution(attr)} measured=${totalUsage.promptTokens}`,
        );
        return { response, conversationId, toolTrace };
      };

      for (let i = 0; i < iterationBudget; i++) {
        metrics.reactIterations = i + 1;
        // Stop spending tokens the moment the client disconnects. PRE-PERSIST
        // abort → no row (1:1 invariant: no messageId exists).
        if (opts.signal?.aborted) {
          return { response: { type: 'text' as const, content: '' }, conversationId: undefined, toolTrace };
        }

        let result;
        // Local timer around the await because withSpan re-throws on failure
        // (so durationMs is unobtainable from its return on the error path).
        const llmStart = performance.now();
        // ── Streaming peek-then-commit (Phase 2) ─────────────────────────────
        // The loop call streams tokens. We EAGERLY emit TEXT_MESSAGE_* for prose
        // deltas, but BUFFER a small prefix first to detect structured output:
        // the terminal turn may be JSON (Case 1: in-loop structured answer that
        // becomes an insight_card/tutorial) — streaming raw JSON tokens is poor
        // UX, so if the first non-whitespace char is `{` or `[` we suppress
        // streaming entirely (the card arrives whole in RUN_FINISHED). Once a
        // stream is committed (prose confirmed), all subsequent deltas stream.
        // OpenAI-compatible models emit EITHER tool_calls OR content per turn,
        // so a tool-request turn never triggers onText at all.
        const streamMessageId = randomUUID();
        const PROBE = 3; // sniff up to 3 chars of leading content before deciding
        let probeBuf = '';
        let probing = true;
        let textEmitted = false;
        let suppressedByJson = false;
        const onSafeText = (delta: string): void => {
          if (suppressedByJson) return;
          if (probing) {
            probeBuf += delta;
            if (probeBuf.length < PROBE && !/\s*\S/.exec(probeBuf)) return; // keep buffering whitespace
            const firstChar = probeBuf.trim()[0];
            if (firstChar === '{' || firstChar === '[') {
              // Structured JSON turn — suppress streaming; card arrives whole.
              suppressedByJson = true;
              probeBuf = '';
              return;
            }
            // Confirmed prose — flush the probe buffer as the first delta.
            probing = false;
            if (!textEmitted) {
              emit({ type: 'TEXT_MESSAGE_START', messageId: streamMessageId });
              textEmitted = true;
            }
            if (probeBuf) {
              // P0 — first visible token to the client. Stamp once (the earliest
              // signal wins; a tool result could have landed earlier in a prior
              // iteration but this is the first *streamed* content).
              if (metrics.latencyFirstTokenMs === undefined) {
                metrics.latencyFirstTokenMs = performance.now() - turnStart;
              }
              emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: streamMessageId, delta: probeBuf });
            }
            probeBuf = '';
            return;
          }
          emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: streamMessageId, delta });
        };
        const safeText = createSafeTextDeltaFilter(onSafeText);
        try {
          const wrapped = await withSpan(
            'agent.llm.react_call',
            { 'gen_ai.request.model': MODEL_FAST },
            async () =>
              config.agentStreamingEnabled
                ? callMiniMaxStream(
                    { messages: trimToolHistory(messages), tools: miniMaxTools, signal },
                    safeText.push,
                  )
                : callMiniMax({ messages: trimToolHistory(messages), tools: miniMaxTools, signal }),
          );
          metrics.latencyLlmMs += wrapped.durationMs;
          result = wrapped.result;
        } catch (e) {
          // Record llm latency on the throwing path via our own timer, then
          // re-throw to the caller (socket layer) — pre-persist, no row.
          metrics.latencyLlmMs += performance.now() - llmStart;
          if (e instanceof MiniMaxError) metrics.errorKind = e.code;
          throw e;
        }
        addUsage(result.usage);
        safeText.finish();
        // Edge: a short answer (≤PROBE chars) resolved while still probing and
        // confirmed prose — flush it now as a complete stream.
        if (probing && !suppressedByJson && probeBuf.trim()) {
          if (!textEmitted) {
            emit({ type: 'TEXT_MESSAGE_START', messageId: streamMessageId });
            textEmitted = true;
          }
          emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: streamMessageId, delta: probeBuf });
        }
        probing = false;
        probeBuf = '';
        // Retire the streaming bubble: emit END only if we started a stream
        // (prose turn). JSON-suppressed / tool turns never started one.
        if (textEmitted) {
          emit({ type: 'TEXT_MESSAGE_END', messageId: streamMessageId });
        }

        if (result.toolCalls.length === 0) {
          // Model is ready to answer — break to the structured final call.
          if (result.content) {
            messages.push({ role: 'assistant', content: result.content });
          }
          break;
        }

        // Record the assistant's tool-request turn, then answer each call.
        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Client disconnected between the MiniMax call returning and tool
        // execution — stop before running DB-backed tools for a gone client.
        // PRE-PERSIST abort → no row.
        if (opts.signal?.aborted) {
          return { response: { type: 'text' as const, content: '' }, conversationId: undefined, toolTrace };
        }

        // ── Tool execution (P1.3: read-only tools run concurrently) ──────────
        // Partition into READ-ONLY tools (data.* queries, ui.search_pages — no
        // side effects, order-independent) and SIDE-EFFECTING tools (ui.navigate
        // /ui.focus — each awaits a UI ack, so they MUST fire serially in order).
        // Results are re-serialized below in ORIGINAL call order so the
        // assistant(tool_calls) keeps its replies in the order the model asked
        // (protocol-safe) and ack sequencing stays deterministic.
        type ToolPending = {
          call: MiniMaxFunctionCall;
          tool: AgentToolDef | undefined;
          parsedArgs: unknown;
          status: 'pending' | 'ok' | 'error' | 'missing';
          result?: ToolResult;
          errorMsg?: string;
          errorLabel?: string;
          cacheHit?: boolean;
        };
        const pendings: ToolPending[] = result.toolCalls.map((call) => ({
          call,
          // A hallucinated or non-advertised tool is unavailable for this turn.
          tool: selectedToolsByName.get(call.name),
          parsedArgs: safeParseArgs(call.arguments),
          status: 'pending' as const,
        }));
        // tool_start events fire in original order (the UI shows them sequentially).
        // P0 — the first TOOL_CALL_START is the user's first sign of progress on a
        // tool turn (these turns stream no prose). Stamp TTFT once; if an earlier
        // iteration already streamed text, that stamp already won.
        if (metrics.latencyFirstTokenMs === undefined && pendings.length > 0) {
          metrics.latencyFirstTokenMs = performance.now() - turnStart;
        }
        for (const p of pendings) emit({ type: 'TOOL_CALL_START', toolName: p.call.name, args: p.parsedArgs });

        // Execute ONE tool. Spans retain per-call tracing; wall-clock metrics
        // are recorded around the concurrent batch / serial call below.
        const runExecute = async (p: ToolPending): Promise<void> => {
          try {
            const cacheKey = p.tool?.readonly === true
              ? readonlyToolCacheKey(p.call.name, p.parsedArgs)
              : undefined;
            const cached = cacheKey ? readonlyToolCache.get(cacheKey) : undefined;
            if (cached) {
              p.result = await cached;
              p.cacheHit = true;
            } else {
              const execution = withSpan(
                'agent.tool.execute',
                { 'gen_ai.tool.name': p.call.name },
                async () => p.tool!.execute(p.parsedArgs, ctx),
              );
              if (cacheKey) {
                readonlyToolCache.set(cacheKey, execution.then((span) => span.result));
              }
              const toolSpan = await execution;
              p.result = toolSpan.result;
            }
            p.status = 'ok';
          } catch (e) {
            const cacheKey = p.tool?.readonly === true
              ? readonlyToolCacheKey(p.call.name, p.parsedArgs)
              : undefined;
            if (cacheKey) readonlyToolCache.delete(cacheKey);
            metrics.errorKind = 'tool';
            p.errorMsg = formatToolError(e);
            p.errorLabel = formatToolErrorLabel(e, p.call.name);
            p.status = 'error';
          }
        };

        let terminalDirectiveResponse: AgentResponse | undefined;

        // 1) READ-ONLY tools → concurrent. Count batch wall-clock once; summing
        // overlapping tool spans would inflate the user-facing pipeline time.
        const readonlyPendings = pendings.filter((p) => p.tool?.readonly === true);
        if (readonlyPendings.length > 0) {
          const batchStart = performance.now();
          await Promise.all(readonlyPendings.map((p) => runExecute(p)));
          metrics.latencyToolsMs += performance.now() - batchStart;
        }

        // 2) Side-effecting tools (ui.* + un-flagged) → serial, in original
        // order, so each directive's ack settles before the next one fires.
        for (const p of pendings) {
          if (p.tool?.readonly === true) continue; // already ran concurrently
          if (!p.tool) { p.status = 'missing'; continue; }
          const toolStart = performance.now();
          await runExecute(p);
          metrics.latencyToolsMs += performance.now() - toolStart;
          if (p.status !== 'ok' || !p.result) continue;
          // ui.* tools produce a directive — move the UI immediately. For
          // navigate/focus we request an ack so the LLM learns whether the page
          // actually opened before it composes its final answer. The ack wait is
          // its OWN span (kept OUT of latencyToolsMs).
          if (p.call.name.startsWith('ui.')) {
            const parsed = agentDirectiveSchema.safeParse(p.result.data);
            if (parsed.success) {
              const d = parsed.data as AgentDirective;
              if (
                (ACKED_DIRECTIVE_KINDS as readonly string[]).includes(d.kind) &&
                opts.awaitAck &&
                !opts.signal?.aborted
              ) {
                const actionId = randomUUID();
                metrics.navigateDirectiveEmitted = true;
                emit({ type: 'DIRECTIVE', directive: d, actionId, requiresAck: true });
                const ackSpan = await withSpan(
                  'agent.socket.ack_wait',
                  { directive_kind: d.kind },
                  async () => opts.awaitAck!(actionId),
                );
                metrics.latencyAckMs += ackSpan.durationMs;
                const ack = ackSpan.result;
                if (opts.signal?.aborted) {
                  // PRE-PERSIST abort → no row.
                  return { response: { type: 'text' as const, content: '' }, conversationId: undefined, toolTrace };
                }
                terminalDirectiveResponse = directiveAckText(
                  d as Extract<AgentDirective, { kind: 'navigate' | 'focus' }>,
                  ack,
                );
                // Replace the tool result with the ack outcome so the model's
                // final answer reflects reality ("đã mở" only if ok).
                p.result = {
                  data: { directive: d, opened: ack.status === 'ok', ackStatus: ack.status, reason: ack.reason },
                  label: ack.status === 'ok' ? p.result.label : `${p.result.label} — ${ack.status}`,
                };
              } else {
                emit({ type: 'DIRECTIVE', directive: d });
              }
            }
          }
        }

        // 3) Re-serialize in ORIGINAL call order: tool_result events, the tool
        // messages fed back to the model, the trace, and toolCallCount. Replies
        // in the order the model requested keep the tool-calling protocol
        // well-formed; missing tools are not counted (they never reached execute).
        for (const p of pendings) {
          if (p.status === 'missing') {
            const msg = `Công cụ không tồn tại: ${p.call.name}`;
            emit({ type: 'TOOL_CALL_END', toolName: p.call.name, toolCallId: p.call.id, ok: false, label: msg });
            messages.push({ role: 'tool', tool_call_id: p.call.id, name: p.call.name, content: msg });
            toolTrace.push({ toolName: p.call.name, ok: false, error: msg });
            continue;
          }
          metrics.toolCallCount += 1;
          if (p.status === 'error') {
            emit({ type: 'TOOL_CALL_END', toolName: p.call.name, toolCallId: p.call.id, ok: false, label: p.errorLabel ?? 'Công cụ cần tham số khác' });
            messages.push({ role: 'tool', tool_call_id: p.call.id, name: p.call.name, content: `Lỗi: ${p.errorMsg}` });
            toolTrace.push({ toolName: p.call.name, ok: false, args: p.parsedArgs, error: p.errorMsg });
            continue;
          }
          emit({ type: 'TOOL_CALL_END', toolName: p.call.name, toolCallId: p.call.id, ok: true, label: p.result!.label });
          // P2 — collect citations from knowledge.search results for the final
          // response's citations[] field.
          if (p.call.name === 'knowledge.search') {
            collectKnowledgeCitations(p.result!.data, collectedCitations);
          }
          // Feed a size-capped JSON view back to the model.
          const view = compactToolResult(p.result!.data);
          messages.push({ role: 'tool', tool_call_id: p.call.id, name: p.call.name, content: view });
          toolTrace.push({ toolName: p.call.name, ok: true, args: p.parsedArgs, label: p.result!.label, cacheHit: p.cacheHit === true });
        }

        if (
          terminalDirectiveResponse &&
          pendings.length > 0 &&
          pendings.every((p) =>
            p.status === 'ok' &&
            (p.call.name === 'ui.navigate' || p.call.name === 'ui.focus')
          )
        ) {
          return persistResponse(terminalDirectiveResponse);
        }
      }

      // ── Final structured answer (JSON-mode) ───────────────────────────────
      if (opts.signal?.aborted) {
        return { response: { type: 'text' as const, content: '' }, conversationId: undefined, toolTrace };
      }
      // P1 — gate the redundant final-answer LLM call. The ReAct loop's terminal
      // turn already produced an answer; only pay for a SEPARATE structured call
      // when we need one. Three cases:
      //   1. Model emitted valid 5-shape JSON in the loop → use it (no call).
      //   2. Non-analytical turn (no tools, or only ui.* navigation/focus/search)
      //      answered in prose → return the prose as text (no call). Dominant win:
      //      ~−9s for every simple/navigation/help turn (the avg final-call cost).
      //   3. Analytical turn (ran a data/structured tool) → one structured call
      //      shapes the tool numbers into insight_card widgets.
      let finalUsage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
      let fallbackUsed = false;
      let fallbackReason: string | undefined;
      let response: AgentResponse;

      // The terminal assistant turn = last assistant message with no pending
      // tool_calls (the loop pushes it right before breaking on a no-tools turn).
      const terminalAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && !(m.tool_calls && m.tool_calls.length > 0));
      const terminalStructured = terminalAssistant
        ? parseAgentResponseContent(terminalAssistant.content)
        : null;
      // "Analytical" = a tool that returns data needing widget shaping ran.
      // Everything except ui.* counts — tours.* + data/* stay on the structured
      // path so start_tour / insight_card still compose correctly.
      const usedDataTool = messages.some(
        (m) => m.role === 'tool' && typeof m.name === 'string' && !m.name.startsWith('ui.'),
      );

      if (!terminalStructured && !usedDataTool && terminalAssistant && !opts.signal?.aborted) {
        // Case 2 — non-analytical prose answer: return as text, no structured call.
        response = { type: 'text' as const, content: stripThink(terminalAssistant.content) ?? '' };
      } else if (terminalStructured && !opts.signal?.aborted) {
        // Case 1 — the ReAct loop's terminal assistant message already contains
        // valid structured JSON (insight_card / tutorial / text / directive /
        // start_tour). Trust it directly and SKIP produceFinalAnswer entirely.
        // This is the double-call collapse: analytical turns whose model emits
        // valid in-loop JSON no longer pay for a separate json_object call.
        // produceFinalAnswer (Case 3 below) is now only the genuine fallback for
        // analytical turns where the loop output is NOT valid structured JSON.
        response = terminalStructured;
        metrics.finalAvoided = true;
      } else {
        // Case 3 — analytical turn (a data tool ran) but the loop's terminal
        // output was NOT valid structured JSON. produceFinalAnswer re-tries with
        // a dedicated json_object call, then a prose fallback if that fails.
        const finalSpan = await withSpan('agent.final_answer', undefined, async () =>
          produceFinalAnswer(trimToolHistory(messages), signal, emit),
        );
        metrics.latencyFinalMs += finalSpan.durationMs;
        finalUsage = finalSpan.result.usage;
        fallbackUsed = finalSpan.result.fallbackUsed;
        fallbackReason = finalSpan.result.fallbackReason;
        response = finalSpan.result.response;
      }
      metrics.fallbackUsed = fallbackUsed;
      // P0b — record WHY the final answer fell back (prefixed final_*), so the
      // dashboard can split fallback cause from ReAct-loop errors. Guard on
      // `!metrics.errorKind`: a turn that had a mid-loop TOOL failure AND then
      // fell back keeps the 'tool' error (counted in errorRate — the actionable
      // signal). The fallback itself is still captured by fallbackUsed →
      // fallbackRate; we only stamp a final_ reason when there's no competing
      // mid-loop error, so errorRate never silently drops a real tool error.
      if (!metrics.errorKind && fallbackUsed && fallbackReason) metrics.errorKind = fallbackReason;
      addUsage(finalUsage);

      // A streamed terminal answer is user-visible before the structured pass
      // completes. If that pass degrades a detailed answer to a short text
      // summary (for example because every generated widget was invalid), keep
      // the richer terminal answer as the final, persisted response. A valid
      // insight card still wins because it preserves the structured data.
      response = preserveDetailedTerminalText(response, terminalAssistant?.content);

      // A3 — prose-with-path guardrail. MiniMax-M3 sometimes ignores the
      // "call ui.navigate, don't write paths in text" rule and emits a plain
      // prose answer naming a destination (e.g. "...tại /fleet/1/tires"). When
      // that happens and no directive was emitted this turn, extract the path,
      // resolve it via PAGE_CATALOG, and convert the answer into a real
      // navigate directive. The terminal-ack block below then emits it, awaits
      // the ack, and rewrites the bubble via directiveAckText — so we NEVER
      // claim "đã mở" for a page the client never applied. Gated by a config
      // kill-switch; the current-route guard skips a redundant navigate to the
      // page the user is already on (routeKey AND params compared).
      if (
        config.agentNavigateGuardrail &&
        response.type === 'text' &&
        !metrics.navigateDirectiveEmitted &&
        !opts.signal?.aborted
      ) {
        const synthesized = synthesizeNavigateFromProse(response.content, ctx.currentRouteKey);
        if (synthesized) {
          metrics.guardrailFired = true;
          metrics.navigateDirectiveEmitted = true;
          response = { type: 'directive', directive: synthesized };
        }
      }

      if (response.type === 'text' && !opts.signal?.aborted) {
        const synthesizedActions = synthesizeTextActionsFromProse(response.content, ctx.currentRouteKey);
        if (synthesizedActions.length > 0) {
          response = {
            ...response,
            actions: [...(response.actions ?? []), ...synthesizedActions],
          };
        }
      }

      // Telemetry: a navigate/focus directive in the terminal answer counts as
      // "navigate emitted" whether or not the ack path ran — the frontend still
      // applies the directive from the done event.
      if (
        response.type === 'directive' &&
        (ACKED_DIRECTIVE_KINDS as readonly string[]).includes(response.directive.kind)
      ) {
        metrics.navigateDirectiveEmitted = true;
      }

      // Terminal directive ack: if the model's FINAL answer is itself a
      // navigate/focus directive, confirm it actually landed before claiming
      // success — then rewrite the answer to an honest text line so we never
      // say "đã mở" for a page the client never applied.
      if (
        response.type === 'directive' &&
        (ACKED_DIRECTIVE_KINDS as readonly string[]).includes(response.directive.kind) &&
        opts.awaitAck &&
        !opts.signal?.aborted
      ) {
        const actionId = randomUUID();
        emit({ type: 'DIRECTIVE', directive: response.directive, actionId, requiresAck: true });
        // TERMINAL ACK WAIT — its own span, tracked in latencyAckMs.
        const ackSpan = await withSpan(
          'agent.socket.ack_wait',
          { directive_kind: response.directive.kind },
          async () => opts.awaitAck!(actionId),
        );
        metrics.latencyAckMs += ackSpan.durationMs;
        const ack = ackSpan.result;
        response = directiveAckText(
          response.directive as Extract<AgentDirective, { kind: 'navigate' | 'focus' }>,
          ack,
        );
      }

      // P2 — auto-attach citations from knowledge.search tool results. When the
      // ReAct loop called knowledge.search, the tool returned chunks with source
      // metadata. Extract the top sources and attach them as citations[] on the
      // final response so the user sees provenance (doc-RAG grounding).
      if (collectedCitations.length > 0 && (response.type === 'text' || response.type === 'insight_card')) {
        response = { ...response, citations: collectedCitations };
      }

      return persistResponse(response);
    },
  );

  // ── Metrics row (100% write, sampler-independent) ──────────────────────
  // Written AFTER the root span resolves: rootDurationMs (total user-perceived
  // latency incl. ack + persist) and traceId come from withRootSpan's RETURN, so
  // referencing them inside the span body is a TDZ. Always write when we have a
  // messageId; turns that aborted BEFORE persistTurn have none → no row (1:1
  // invariant). The dashboard abort KPI is labelled "tỷ lệ huỷ khi lưu".
  if (assistantMessageId !== undefined) {
    const lat = computeLatencies(metrics, rootDurationMs);
    try {
      await db.insert(schema.agentTurnMetrics).values({
        messageId: assistantMessageId,
        traceId,
        userId: ctx.userId,
        role: ctx.role,
        conversationId: conversationId !== undefined ? Number(conversationId) : undefined,
        model: MODEL_FAST,
        latencyUserPerceivedMs: Math.round(lat.latencyUserPerceivedMs),
        latencyTotalMs: Math.round(lat.latencyTotalMs),
        latencyLlmMs: Math.round(metrics.latencyLlmMs),
        latencyToolsMs: Math.round(metrics.latencyToolsMs),
        latencyFinalMs: Math.round(metrics.latencyFinalMs),
        latencyAckMs: Math.round(metrics.latencyAckMs),
        latencyPersistMs: Math.round(metrics.latencyPersistMs),
        latencyFirstTokenMs: metrics.latencyFirstTokenMs !== undefined
          ? Math.round(metrics.latencyFirstTokenMs)
          : undefined,
        reactIterations: metrics.reactIterations,
        toolCallCount: metrics.toolCallCount,
        fallbackUsed: metrics.fallbackUsed,
        aborted: metrics.aborted,
        navigateDirectiveEmitted: metrics.navigateDirectiveEmitted,
        guardrailFired: metrics.guardrailFired,
        errorKind: metrics.errorKind,
        intentBucket: metrics.intentBucket,
        tokensIn: totalUsage.promptTokens,
        tokensOut: totalUsage.completionTokens,
      });
    } catch (err) {
      // Never crash the chat over telemetry. Log and move on.
      logger.warn(
        { traceId, messageId: assistantMessageId, err },
        'agent_turn_metrics insert failed',
      );
    }
  }

  return { ...runResult, assistantMessageId };
}

async function produceFinalAnswer(
  messages: MiniMaxMessage[],
  signal: AbortSignal | undefined,
  emit: ((event: AgentEvent) => void) | undefined,
): Promise<{
  response: AgentResponse;
  usage: { promptTokens: number; completionTokens: number };
  /** true when the structured-card path failed and the prose path produced the
   *  answer (i.e. the model could not emit the strict insight_card schema). */
  fallbackUsed: boolean;
  /** P0b — WHY the final answer fell back. `final_*`-prefixed so the dashboard
   *  can bucket fallback cause (timeout/http/parse/schema/prose_failed) WITHOUT
   *  a migration, reusing the existing errorKind column. Undefined when the
   *  structured card validated (no fallback). */
  fallbackReason?: string;
}> {
  let fallbackReason: string | undefined;
  const direct = parseLatestAssistantResponse(messages);
  if (direct) {
    return { response: direct, usage: { promptTokens: 0, completionTokens: 0 }, fallbackUsed: false };
  }

  // The model does not reliably emit the strict insight_card schema, so try the
  // structured card ONCE; if it doesn't validate, ask for a plain prose answer
  // (no schema / json_object burden). Either way the user gets the model's real
  // analysis of the tool data the loop already gathered — never an empty "Xin
  // lỗi". A client disconnect (abort) must throw so runAgent skips persistTurn.
  const CARD_NUDGE =
    'Dựa trên dữ liệu công cụ đã có, trả lời cuối cùng theo ĐÚNG schema JSON (một trong 5 dạng), chỉ trả JSON, không kèm giải thích. Nếu có bước tiếp theo là mở trang/bấm nút, phải đặt trong actions[{label,directive}] với routeKey/params thật; không chỉ viết tên trang hoặc path trong content. Nếu cần bảng, ưu tiên insight_card widget type="table" hoặc Markdown table chuẩn trong text.';

  // 1) Best-effort structured insight_card (validated + sanitized).
  let cardContent: string | null = null;
  let cardUsage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
  try {
    const card = await callMiniMax({
      messages: [...messages, { role: 'user', content: CARD_NUDGE }],
      responseFormat: { type: 'json_object' },
      // Enough for a rich card, without inviting long prose that later fails JSON.
      maxTokens: 6000,
      signal,
    });
    cardUsage = card.usage;
    // Truncation guard (finish_reason='length'): max_tokens hit mid-output → the
    // JSON is incomplete. A healer (jsonrepair) would silently close it into a
    // PARTIAL object, so we must NOT parse or salvage it — drop the content and
    // let the prose path regenerate a complete answer. 'stop'/'tool_calls' are
    // complete and safe to parse/heal.
    if (card.finishReason === 'length') {
      cardContent = null;
      fallbackReason = 'final_truncated';
    } else {
      cardContent = card.content;
      const parsed = parseAgentResponseContent(card.content);
      if (parsed) return { response: parsed, usage: card.usage, fallbackUsed: false };
      // Card came back but didn't validate (non-JSON or schema-invalid) → record
      // the schema failure as the fallback cause before degrading to prose.
      // P0.5 diagnostic: log the raw card head so the exact validation gap is
      // observable without a redeploy. Counts only — truncated, no PII beyond
      // what the model already emitted.
      console.log(`[agent] final_schema fail, raw card head: ${(card.content ?? '').slice(0, 500)}`);
      fallbackReason = 'final_schema';
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    fallbackReason = e instanceof MiniMaxError ? `final_${e.code}` : 'final_parse';
    console.error(`[agent] structured card failed (${fallbackReason}), falling back to prose`, e);
  }

  // 1b) SALVAGE — the structured card didn't validate, but its content usually
  // still holds the model's real Vietnamese analysis (a near-miss JSON, or plain
  // prose emitted despite json_object mode). Surface it instead of paying for a
  // 2nd prose LLM call. Only fall through to the prose call when there is
  // genuinely nothing human-readable to show. (cardContent is null when the card
  // call itself threw, so this naturally skips on timeout/http/parse failures.)
  if (cardContent) {
    const salvaged = salvageText(cardContent);
    if (salvaged) {
      return { response: { type: 'text', content: salvaged }, usage: cardUsage, fallbackUsed: true, fallbackReason };
    }
  }

  // 2) Reliable prose answer — concise Vietnamese analysis, no JSON constraint.
  // This is the highest-value streaming target: it is a DEDICATED prose call
  // (guaranteed non-JSON), and it only fires on the degraded fallback path
  // where the user has waited longest. Stream tokens live via TEXT_MESSAGE_*.
  const proseStreamId = emit && config.agentStreamingEnabled ? randomUUID() : undefined;
  try {
    const onProseText = (delta: string): void => {
      if (!emit || !proseStreamId) return;
      emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: proseStreamId, delta });
    };
    const safeProseText = createSafeTextDeltaFilter(onProseText);
    if (emit && proseStreamId) {
      emit({ type: 'TEXT_MESSAGE_START', messageId: proseStreamId });
    }
    const proseOptions: Parameters<typeof callMiniMax>[0] = {
        messages: [
          ...messages,
          {
            role: 'user',
            content: [
              'Trả lời người dùng bằng tiếng Việt tự nhiên, ngắn gọn (2-4 câu).',
              'Tuyệt đối không nhắc JSON, schema, tool, directive, routeKey, widget, hay quy tắc nội bộ.',
              'Nếu người dùng hỏi đang nói về gì / vừa nói gì, hãy tóm tắt các lượt trước trong cuộc trò chuyện thay vì nói về định dạng trả lời.',
            ].join(' '),
          },
        ],
        signal,
      };
    const prose = config.agentStreamingEnabled
      ? await callMiniMaxStream(proseOptions, safeProseText.push)
      : await callMiniMax(proseOptions);
    safeProseText.finish();
    if (emit && proseStreamId) {
      emit({ type: 'TEXT_MESSAGE_END', messageId: proseStreamId });
    }
    const text = stripThink(prose.content) ?? '';
    if (text) return { response: { type: 'text', content: text }, usage: prose.usage, fallbackUsed: true, fallbackReason };
  } catch (e) {
    // Emit END on BOTH paths (abort + error) so a START always pairs with an
    // END — otherwise the frontend leaves a dangling streaming bubble. On abort
    // the agentSocket emit is a no-op (gated on !aborted), but emitting keeps
    // the START/END invariant honest for any non-gated emit path.
    if (emit && proseStreamId) {
      emit({ type: 'TEXT_MESSAGE_END', messageId: proseStreamId });
    }
    if (signal?.aborted) throw e;
    console.error('[agent] prose answer failed', e);
  }

  // Final-degradation apology — counts as a fallback (both real paths failed).
  return {
    response: { type: 'text', content: 'Xin lỗi, tôi không thể xử lý yêu cầu này lúc nào.' },
    usage: { promptTokens: 0, completionTokens: 0 },
    fallbackUsed: true,
    fallbackReason: fallbackReason ?? 'final_prose_failed',
  };
}

function parseLatestAssistantResponse(messages: MiniMaxMessage[]): AgentResponse | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) continue;
    const parsed = parseAgentResponseContent(m.content);
    if (parsed) return parsed;
    return null;
  }
  return null;
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
function salvageText(content: string | null | undefined): string | null {
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
function collectKnowledgeCitations(data: unknown, out: AgentCitation[]): void {
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

function safeParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatToolError(e: unknown): string {
  if (e instanceof ToolError) return e.message;
  if (e instanceof ZodError) return `Tham số công cụ không hợp lệ: ${formatZodIssues(e)}`;
  return e instanceof Error ? e.message : 'Lỗi công cụ';
}

function formatToolErrorLabel(e: unknown, toolName: string): string {
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

// ── Persistence ────────────────────────────────────────────────────────────
// Returns BOTH the conversationId AND the newly inserted assistant messageId.
// The messageId is the PK of the agent_turn_metrics row written by runAgent.
async function persistTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  response: AgentResponse;
  toolTrace: unknown[];
  conversationId?: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  let conversationId = opts.conversationId;

  // IDOR guard: if continuing, the conversation MUST belong to the caller.
  // A missing, non-numeric, or other-user id falls back to a fresh
  // conversation (keeps chat working) instead of writing into someone
  // else's thread.
  if (conversationId) {
    const numericId = Number(conversationId);
    const [existing] = Number.isFinite(numericId)
      ? await db
          .select({ userId: schema.agentConversations.userId })
          .from(schema.agentConversations)
          .where(eq(schema.agentConversations.id, numericId))
          .limit(1)
      : [];
    if (!existing || existing.userId !== opts.ctx.userId) {
      conversationId = undefined;
    }
  }

  if (!conversationId) {
    const [row] = await db
      .insert(schema.agentConversations)
      .values({
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        title: opts.userMessage.slice(0, 120),
      })
      .returning({ id: schema.agentConversations.id });
    conversationId = String(row.id);
  }

  await db.insert(schema.agentMessages).values({
    conversationId: Number(conversationId),
    role: 'user',
    content: opts.userMessage,
  });

  const directives = opts.response.type === 'directive' ? [opts.response.directive] : [];
  // .returning on the ASSISTANT insert only — that's the row whose id is the
  // metrics PK. (The user-message insert above has no metrics row.)
  const [assistantRow] = await db
    .insert(schema.agentMessages)
    .values({
      conversationId: Number(conversationId),
      role: 'assistant',
      response: opts.response,
      toolTrace: opts.toolTrace,
      directives,
      tokensIn: opts.promptTokens,
      tokensOut: opts.completionTokens,
    })
    .returning({ id: schema.agentMessages.id });

  await db
    .update(schema.agentConversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.agentConversations.id, Number(conversationId)));

  return { conversationId, messageId: assistantRow?.id };
}

/**
 * P0 instrumentation — persist a FAQ fast-lane turn so FAQ hits are visible on
 * the dashboard. Before this, the FAQ lane returned early in agentSocket and
 * wrote NO metrics row, so FAQ hit-rate was unmeasurable (every recorded turn
 * had react_iterations >= 1 by construction). This reuses persistTurn for the
 * conversation/message rows, then writes a metrics row tagged
 * intentBucket='faq' with the measured lookup latency. Resilient: a failure
 * logs and never breaks chat (the answer was already emitted to the client).
 *
 * Returns the conversationId (so agentSocket can fold it into the done event)
 * and the messageId. Both undefined on failure.
 */
export async function recordFaqTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  answer: string;
  conversationId?: string;
  lookupMs: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const response: AgentResponse = { type: 'text', content: opts.answer };
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response,
      toolTrace: [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    if (messageId !== undefined) {
      await db.insert(schema.agentTurnMetrics).values({
        messageId,
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        conversationId: conversationId !== undefined ? Number(conversationId) : undefined,
        model: 'faq-fast-lane',
        // A FAQ turn has no LLM/tools/final/ack: the only latency is the lookup
        // (embed + pgvector cosine). Record it as both the total and the
        // first-token time so the dashboard sees FAQ turns as the fast floor.
        latencyUserPerceivedMs: Math.round(opts.lookupMs),
        latencyTotalMs: Math.round(opts.lookupMs),
        latencyFirstTokenMs: Math.round(opts.lookupMs),
        reactIterations: 0,
        toolCallCount: 0,
        fallbackUsed: false,
        aborted: false,
        navigateDirectiveEmitted: false,
        guardrailFired: false,
        intentBucket: 'faq',
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    return { conversationId, messageId };
  } catch (err) {
    // Never crash chat over telemetry. The answer was already sent to the client.
    logger.warn({ err }, 'recordFaqTurn metrics insert failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/**
 * P1 instrumentation — persist a Lane 0 navigation turn (deterministic, 0 LLM
 * calls). Mirrors recordFaqTurn but tags intentBucket='nav' and stores the
 * directive response. The ack wait (if any) is NOT included in lookupMs — the
 * caller measures only the router + emit time, since the ack is user-paced.
 */
export async function recordNavTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  directive: AgentDirective;
  conversationId?: string;
  lookupMs: number;
  ackOk?: boolean;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const response: AgentResponse = { type: 'directive', directive: opts.directive };
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response,
      toolTrace: [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    if (messageId !== undefined) {
      await db.insert(schema.agentTurnMetrics).values({
        messageId,
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        conversationId: conversationId !== undefined ? Number(conversationId) : undefined,
        model: 'intent-router',
        latencyUserPerceivedMs: Math.round(opts.lookupMs),
        latencyTotalMs: Math.round(opts.lookupMs),
        latencyFirstTokenMs: Math.round(opts.lookupMs),
        reactIterations: 0,
        toolCallCount: 0,
        fallbackUsed: false,
        aborted: false,
        // A navigate directive was emitted — track it for the navigate KPI.
        navigateDirectiveEmitted: true,
        guardrailFired: false,
        intentBucket: 'nav',
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordNavTurn metrics insert failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/**
 * P3 instrumentation — persist a Lane 3 summary turn (daily-work assistant,
 * 0 LLM calls). Mirrors recordNavTurn but tags intentBucket='summary' and
 * stores the insight_card response from getDashboardStats().
 */
export async function recordSummaryTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  response: AgentResponse;
  conversationId?: string;
  lookupMs: number;
  /** Deterministic summary variants can identify their own lane in metrics. */
  model?: string;
  intentBucket?: string;
  toolCallCount?: number;
  toolTrace?: unknown[];
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response: opts.response,
      toolTrace: opts.toolTrace ?? [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    if (messageId !== undefined) {
      await db.insert(schema.agentTurnMetrics).values({
        messageId,
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        conversationId: conversationId !== undefined ? Number(conversationId) : undefined,
        model: opts.model ?? 'summary-lane',
        latencyUserPerceivedMs: Math.round(opts.lookupMs),
        latencyTotalMs: Math.round(opts.lookupMs),
        latencyFirstTokenMs: Math.round(opts.lookupMs),
        reactIterations: 0,
        toolCallCount: opts.toolCallCount ?? 0,
        fallbackUsed: false,
        aborted: false,
        navigateDirectiveEmitted: false,
        guardrailFired: false,
        intentBucket: opts.intentBucket ?? 'summary',
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordSummaryTurn metrics insert failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/**
 * P1 Lane 2 instrumentation — persist a lookup turn (single-tool search, 0 LLM
 * in v1). Tags intentBucket='lookup', toolCallCount=1.
 */
export async function recordLookupTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  response: AgentResponse;
  conversationId?: string;
  lookupMs: number;
  toolCallCount: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response: opts.response,
      toolTrace: [{ toolName: 'data.search', ok: true, label: 'Lane 2 lookup' }],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    if (messageId !== undefined) {
      await db.insert(schema.agentTurnMetrics).values({
        messageId,
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        conversationId: conversationId !== undefined ? Number(conversationId) : undefined,
        model: 'lookup-lane',
        latencyUserPerceivedMs: Math.round(opts.lookupMs),
        latencyTotalMs: Math.round(opts.lookupMs),
        latencyFirstTokenMs: Math.round(opts.lookupMs),
        reactIterations: 0,
        toolCallCount: opts.toolCallCount,
        fallbackUsed: false,
        aborted: false,
        navigateDirectiveEmitted: false,
        guardrailFired: false,
        intentBucket: 'lookup',
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordLookupTurn metrics insert failed');
    return { conversationId: undefined, messageId: undefined };
  }
}

/** Persist a cancelled turn so abort-rate telemetry is not silently lost. */
export async function recordAbortedTurn(opts: {
  ctx: AgentContext;
  userMessage: string;
  conversationId?: string;
  elapsedMs: number;
}): Promise<{ conversationId: string | undefined; messageId: number | undefined }> {
  try {
    const response: AgentResponse = { type: 'text', content: 'Yêu cầu đã được huỷ trước khi hoàn tất.' };
    const { conversationId, messageId } = await persistTurn({
      ctx: opts.ctx,
      userMessage: opts.userMessage,
      response,
      toolTrace: [],
      conversationId: opts.conversationId,
      promptTokens: 0,
      completionTokens: 0,
    });
    if (messageId !== undefined) {
      await db.insert(schema.agentTurnMetrics).values({
        messageId,
        userId: opts.ctx.userId,
        role: opts.ctx.role,
        conversationId: conversationId !== undefined ? Number(conversationId) : undefined,
        model: 'cancelled-turn',
        latencyUserPerceivedMs: Math.round(opts.elapsedMs),
        toolCallCount: null,
        fallbackUsed: false,
        aborted: true,
        navigateDirectiveEmitted: false,
        guardrailFired: false,
        intentBucket: 'aborted',
        tokensIn: null,
        tokensOut: null,
      });
    }
    return { conversationId, messageId };
  } catch (err) {
    logger.warn({ err }, 'recordAbortedTurn metrics insert failed');
    return { conversationId: undefined, messageId: undefined };
  }
}
