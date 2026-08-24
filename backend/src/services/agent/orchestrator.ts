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
//
// Response sanitization, turn persistence, and prose-path synthesis live in
// sibling leaves (response-sanitizer / turn-recording / synthesis); this file
// keeps the ReAct loop and re-exports the leaves' public surface.
import { zodToJsonSchema } from 'zod-to-json-schema';
import { randomUUID } from 'crypto';
import { config } from '../../config';
import {
  agentDirectiveSchema,
  ACKED_DIRECTIVE_KINDS,
  type AgentEvent,
  type AgentResponse,
  type AgentDirective,
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
import { compactToolResult } from './tool-result-compact';
import { estimateTokensByComponent, formatAttribution } from './token-attribution';
import { getToolsForRole } from './tool.registry';
import { iterationBudgetFor, readonlyToolCacheKey, selectToolsForMessage } from './tool-selector.js';
import { createSafeTextDeltaFilter } from './stream-sanitizer.js';
import type { AgentContext, AgentToolDef, ToolResult } from './tool.types';
import { withSpan, withRootSpan, type SpanAttrs } from './telemetry.js';

// System-prompt construction + structured-response contract live in
// system-prompt.ts so they can be unit-tested in isolation and extended without
// touching the ReAct loop. See docs/context-engineering/playbook.md §Instructions.
import { buildSystemPrompt } from './system-prompt.js';

import {
  parseAgentResponseContent,
  preserveDetailedTerminalText,
  trimToolHistory,
  collectKnowledgeCitations,
  safeParseArgs,
  formatToolError,
  formatToolErrorLabel,
  salvageText,
} from './response-sanitizer';
import { persistTurn } from './turn-recording';
import { synthesizeNavigateFromProse, synthesizeTextActionsFromProse } from './synthesis';

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

  // Behavioral state for the A3 prose-with-path guardrail. The only metric flag
  // that drives logic (not just telemetry): prevents double-navigating when a
  // directive was already emitted this turn.
  let navigateDirectiveEmitted = false;

  // Hoisted out of the root-span body so it can be referenced after the span
  // resolves. Mutated inside the span.
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

  const { result: runResult } = await withRootSpan(
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
        // Stop spending tokens the moment the client disconnects. PRE-PERSIST
        // abort → no row (1:1 invariant: no messageId exists).
        if (opts.signal?.aborted) {
          return { response: { type: 'text' as const, content: '' }, conversationId: undefined, toolTrace };
        }

        let result;
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
          result = wrapped.result;
        } catch (e) {
          // Re-throw to the caller (socket layer) — pre-persist, no row.
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
            p.errorMsg = formatToolError(e);
            p.errorLabel = formatToolErrorLabel(e, p.call.name);
            p.status = 'error';
          }
        };

        let terminalDirectiveResponse: AgentResponse | undefined;

        // 1) READ-ONLY tools → concurrent.
        const readonlyPendings = pendings.filter((p) => p.tool?.readonly === true);
        if (readonlyPendings.length > 0) {
          await Promise.all(readonlyPendings.map((p) => runExecute(p)));
        }

        // 2) Side-effecting tools (ui.* + un-flagged) → serial, in original
        // order, so each directive's ack settles before the next one fires.
        for (const p of pendings) {
          if (p.tool?.readonly === true) continue; // already ran concurrently
          if (!p.tool) { p.status = 'missing'; continue; }
          await runExecute(p);
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
                navigateDirectiveEmitted = true;
                emit({ type: 'DIRECTIVE', directive: d, actionId, requiresAck: true });
                const ackSpan = await withSpan(
                  'agent.socket.ack_wait',
                  { directive_kind: d.kind },
                  async () => opts.awaitAck!(actionId),
                );
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

        // 3) Re-serialize in ORIGINAL call order: tool_result events and the
        // tool messages fed back to the model. Replies in the order the model
        // requested keep the tool-calling protocol well-formed; missing tools
        // are not counted (they never reached execute).
        for (const p of pendings) {
          if (p.status === 'missing') {
            const msg = `Công cụ không tồn tại: ${p.call.name}`;
            emit({ type: 'TOOL_CALL_END', toolName: p.call.name, toolCallId: p.call.id, ok: false, label: msg });
            messages.push({ role: 'tool', tool_call_id: p.call.id, name: p.call.name, content: msg });
            toolTrace.push({ toolName: p.call.name, ok: false, error: msg });
            continue;
          }
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
      // The structured-answer path returns a `fallbackUsed` / `fallbackReason`
      // pair. We currently surface the answer itself but don't expose the
      // fallback cause to the caller — captured here for future telemetry
      // (P0b diagnostic) without triggering no-unused-vars.
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
      } else {
        // Case 3 — analytical turn (a data tool ran) but the loop's terminal
        // output was NOT valid structured JSON. produceFinalAnswer re-tries with
        // a dedicated json_object call, then a prose fallback if that fails.
        const finalSpan = await withSpan('agent.final_answer', undefined, async () =>
          produceFinalAnswer(trimToolHistory(messages), signal, emit),
        );
        finalUsage = finalSpan.result.usage;
        response = finalSpan.result.response;
      }
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
        !navigateDirectiveEmitted &&
        !opts.signal?.aborted
      ) {
        const synthesized = synthesizeNavigateFromProse(response.content, ctx.currentRouteKey);
        if (synthesized) {
          navigateDirectiveEmitted = true;
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
        navigateDirectiveEmitted = true;
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

// ── Compatibility re-exports (leaf surface, named only — `export *` is banned
// by the material-write registry scanner) ────────────────────────────────────
export {
  parseAgentResponseContent,
  preserveDetailedTerminalText,
  sanitizeAgentJson,
  trimToolHistory,
} from './response-sanitizer';
export {
  recordFaqTurn,
  recordNavTurn,
  recordSummaryTurn,
  recordLookupTurn,
  recordAbortedTurn,
} from './turn-recording';
export { synthesizeNavigateFromProse, synthesizeTextActionsFromProse } from './synthesis';
