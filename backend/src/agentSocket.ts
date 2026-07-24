// Real-time transport for the command-and-insight assistant: socket.io on the
// `/agent` namespace, attached to the same http.Server Express uses.
//
// Replaces the former `POST /api/agent/chat` SSE handler with the same
// contract: the orchestrator's `emit(event)` is wired to `socket.emit`, so
// `TOOL_CALL_START` / `TOOL_CALL_END` / `DIRECTIVE` stream live and the
// terminal `RUN_FINISHED` / `RUN_ERROR` frames close the turn. Conversation-
// history stays on REST. Event names follow the AG-UI protocol taxonomy.
//
// Auth mirrors `middleware/auth.ts`: the JWT travels in the socket.io handshake
// (`auth.token`) so the bot still impersonates the caller; the handshake is
// rejected on an invalid/expired/blacklisted token. Office roles plus the
// database-backed runtime bot switch only — same gate as the REST handler and
// the frontend launcher.
import type { Server as HttpServer } from 'http';
import { Server, type Namespace, type Socket } from 'socket.io';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { config } from './config';
import { getAppSettings, onAppSettingsChanged } from './services/app-settings.service';
import { Role, agentActionResultSchema, type AgentActionResult, type AgentEvent, type AgentResponse } from '@tingting/shared';
import { db } from './db';
import * as schema from './db/schema';
import type { AuthUser } from './middleware/auth';
import { isTokenBlacklisted } from './lib/redis';
import { runAgent, recordAbortedTurn, recordFaqTurn, recordNavTurn, recordSummaryTurn, recordLookupTurn } from './services/agent/orchestrator';
import { tryFaqFastLane } from './services/agent/faq-fast-lane';
import { routeIntent } from './services/agent/intent-router';
import { runSummary } from './services/agent/summary-lane';
import { runFinancialOverview } from './services/agent/financial-overview-lane';
import { runDeterministicReport } from './services/agent/deterministic-report-lane';
import { runLookup } from './services/agent/lookup-lane';
import { checkRateLimit } from './services/agent/rate-limiter';
import type { AgentContext } from './services/agent/tool.types';
import type { MiniMaxMessage } from './services/llm/minimax.client';

const OFFICE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];

interface ChatInput {
  message?: string;
  conversationId?: string;
  /** The SPA route the user is on when they ask — gives the LLM page context. */
  currentRouteKey?: string;
}

interface ClientTimingInput {
  messageId?: number;
  elapsedMs?: number;
}

// ── Per-session memory ─────────────────────────────────────────────────────
// The user/assistant exchanges for THIS socket, fed back to the LLM so a
// follow-up question shares context. In-memory only — NOT persisted (the DB
// history powers the sidebar separately). Compact text (no widgets/traces) and
// char-capped to bound prompt size + latency.
const SESSION_HISTORY_MAX_CHARS = 6000;

/** Render a final AgentResponse as compact text for session replay. */
function renderResponseText(response: AgentResponse): string {
  switch (response.type) {
    case 'text':
      return response.content;
    case 'insight_card':
      return response.summary ?? response.title ?? '';
    case 'tutorial':
      return `${response.title}: ${response.summary}`;
    case 'start_tour':
      return `(đã mở hướng dẫn ${response.tourId})`;
    case 'directive':
      return response.directive.kind === 'navigate' || response.directive.kind === 'focus'
        ? `(đã mở trang ${response.directive.routeKey})`
        : '(đã mở form)';
    default:
      // Exhaustiveness fallback — unreachable if the union is fully handled.
      return '';
  }
}

/** Drop oldest turns until the buffer is under the char budget (keep ≥ 2). */
function trimSessionHistory(history: MiniMaxMessage[]): void {
  let chars = history.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  while (chars > SESSION_HISTORY_MAX_CHARS && history.length > 2) {
    const removed = history.shift()!;
    chars -= removed.content?.length ?? 0;
  }
}

/**
 * Attach the assistant socket.io server. Returns the io instance (for graceful
 * shutdown. The server remains available while the bot is disabled so an
 * administrator can enable it without a process restart.
 */
export function initAgentSocket(server: HttpServer): Server {
  const io = new Server(server, {
    path: '/socket.io',
    // Mirror the Express CORS policy (dev: the Vite origin; prod: CORS_ORIGIN).
    cors: {
      origin: config.corsOrigin
        ? config.corsOrigin.split(',').map((s) => s.trim())
        : config.nodeEnv === 'development'
          ? ['http://localhost:7173']
          : [],
      credentials: true,
    },
  });
  const agentNs = io.of('/agent');
  registerAuth(agentNs);
  registerHandlers(agentNs);
  console.log('[agent-socket] listening on /agent (path /socket.io)');
  return io;
}

/** JWT handshake — reject before the namespace `connection` event fires. */
function registerAuth(agentNs: Namespace): void {
  agentNs.use(async (socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined)?.trim();
    if (!token) return next(new Error('Token không hợp lệ'));
    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthUser & { jti?: string };
      if (payload.jti && (await isTokenBlacklisted(payload.jti))) {
        return next(new Error('Token đã bị thu hồi'));
      }
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Token hết hạn hoặc không hợp lệ'));
    }
  });
}

function registerHandlers(agentNs: Namespace): void {
  // Settings changes are process-local and take effect without reconnecting or
  // restarting. Closing the sockets also aborts any in-flight orchestration in
  // their existing disconnect handler.
  onAppSettingsChanged((settings) => {
    if (settings.botEnabled) return;
    for (const socket of agentNs.sockets.values()) {
      socket.emit('agent:event', {
        type: 'RUN_ERROR',
        message: 'Trợ lý ảo hiện đang được tắt bởi quản trị viên.',
      } satisfies AgentEvent);
      socket.disconnect(true);
    }
  });

  agentNs.on('connection', async (socket: Socket) => {
    const user = socket.data.user as AuthUser | undefined;
    // Defense in depth: auth passed, but re-check the office-role gate (mirrors
    // the Casbin `agent` policy + frontend launcher visibility).
    if (!user || !OFFICE_ROLES.includes(user.role) || !(await getAppSettings()).botEnabled) {
      socket.emit('agent:event', { type: 'RUN_ERROR', message: 'Trợ lý chưa được bật' } satisfies AgentEvent);
      socket.disconnect();
      return;
    }
    console.log(`[agent-socket] connected: ${user.username ?? user.userId}`);
    // Room = user, so future cross-tab fan-out (e.g. push directives) is cheap.
    void socket.join(String(user.userId));

    // At most one in-flight turn per socket — a new message (or cancel, or
    // disconnect) aborts the previous, mirroring the SSE `req.on('close')`.
    let current: AbortController | null = null;
    // Serialize turn finalization so a replacement message cannot persist
    // before the cancellation record for the turn it superseded.
    let currentCompletion: Promise<void> = Promise.resolve();
    // Per-session conversation memory (see renderResponseText/trimSessionHistory).
    const sessionHistory: MiniMaxMessage[] = [];

    // Ack registry: directive events the orchestrator tags with `requiresAck`
    // are awaited here until the frontend emits `agent:action_result` (or the
    // timeout fires). Lets the agent confirm a navigation actually landed before
    // it claims "đã mở trang…". One map per socket; cleared on disconnect.
    const ACK_TIMEOUT_MS = 6000;
    const pendingAcks = new Map<string, (r: AgentActionResult) => void>();
    const awaitAck = (actionId: string): Promise<AgentActionResult> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingAcks.delete(actionId);
          resolve({ actionId, status: 'timeout' });
        }, ACK_TIMEOUT_MS);
        pendingAcks.set(actionId, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
      });
    socket.on('agent:action_result', (raw: unknown) => {
      const parsed = agentActionResultSchema.safeParse(raw);
      if (!parsed.success) return;
      const resolve = pendingAcks.get(parsed.data.actionId);
      if (resolve) {
        pendingAcks.delete(parsed.data.actionId);
        resolve(parsed.data);
      }
    });

    socket.on('agent:client_timing', async (raw: ClientTimingInput | null | undefined) => {
      const messageId = Number(raw?.messageId);
      const elapsedMs = Number(raw?.elapsedMs);
      if (!Number.isInteger(messageId) || messageId <= 0) return;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 10 * 60_000) return;
      try {
        await db
          .update(schema.agentTurnMetrics)
          .set({ latencyClientWaitMs: Math.round(elapsedMs) })
          .where(and(
            eq(schema.agentTurnMetrics.messageId, messageId),
            eq(schema.agentTurnMetrics.userId, user.userId),
          ));
      } catch (err) {
        console.warn('[agent-socket] client timing update failed', err);
      }
    });

    socket.on('agent:chat', async (input: ChatInput | null | undefined) => {
      // Re-check on every message. A socket may have connected before an
      // administrator disables the feature, so handshake-time validation alone
      // would let an old connection continue using the assistant.
      if (!(await getAppSettings()).botEnabled) {
        current?.abort();
        socket.emit('agent:event', {
          type: 'RUN_ERROR',
          message: 'Trợ lý ảo hiện đang được tắt bởi quản trị viên.',
        } satisfies AgentEvent);
        return;
      }

      const message = input?.message;
      if (typeof message !== 'string' || !message.trim()) {
        socket.emit('agent:event', { type: 'RUN_ERROR', message: 'Thiếu nội dung tin nhắn' } satisfies AgentEvent);
        return;
      }
      // P5 Governance — per-user rate limiting. Prevents abuse/cost runaway.
      const allowed = await checkRateLimit(user.userId);
      if (!allowed) {
        socket.emit('agent:event', {
          type: 'RUN_ERROR',
          message: 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng đợi một phút rồi thử lại.',
        } satisfies AgentEvent);
        return;
      }
      current?.abort();
      const previousCompletion = currentCompletion;
      let settleTurn!: () => void;
      currentCompletion = new Promise<void>((resolve) => { settleTurn = resolve; });
      const ac = new AbortController();
      current = ac;
      const turnStartedAt = performance.now();
      let turnRecorded = false;

      const ctx: AgentContext = {
        userId: user.userId,
        role: user.role,
        username: user.username ?? undefined,
        currentRouteKey: input?.currentRouteKey,
      };
      // Drop events for an already-aborted turn (client moved on / disconnected).
      const emit = (ev: AgentEvent): void => {
        if (!ac.signal.aborted) socket.emit('agent:event', ev);
      };

      try {
        await previousCompletion;
        if (ac.signal.aborted) return;
        // Immediate perceived-latency floor: tell the client we have the message
        // before any LLM/FAQ work. The frontend swaps "Đang suy nghĩ…" → a
        // richer "Đang xử lý…" state on receipt.
        emit({ type: 'RUN_STARTED' } satisfies AgentEvent);

        // ── FAQ fast lane ──────────────────────────────────────────────────
        // Zero-LLM path: seeded domain questions (penalty rules, fuel modes,
        // road allowance, etc.) answered from faq_entries via a 4-stage cascade
        // (exact → rule → pgvector cosine → score/margin gate). On a match,
        // emit done directly and skip runAgent entirely. On abstain (null) or
        // any error, fall through to the LLM agent — fail-open, never blocks.
        const faqStart = performance.now();
        const faq = await tryFaqFastLane(message);
        const faqLookupMs = performance.now() - faqStart;
        if (faq && !ac.signal.aborted) {
          // P0 instrumentation: persist the FAQ turn so FAQ hit-rate is finally
          // measurable (before this, FAQ hits wrote no metrics row at all).
          turnRecorded = true;
          const { conversationId: faqConvId, messageId: faqMsgId } = await recordFaqTurn({
            ctx,
            userMessage: message,
            answer: faq.answer,
            conversationId: input?.conversationId,
            lookupMs: faqLookupMs,
          });
          if (ac.signal.aborted) return;
          // Only fold into session memory if the turn wasn't superseded — avoids
          // polluting history for a turn the client never saw (e.g. navigated away
          // during the FAQ lookup).
          sessionHistory.push({ role: 'user', content: message });
          sessionHistory.push({ role: 'assistant', content: faq.answer });
          trimSessionHistory(sessionHistory);
          const faqDone: AgentEvent = {
            type: 'RUN_FINISHED',
            response: { type: 'text', content: faq.answer },
            fastLane: true,
            ...(faqConvId ? { conversationId: faqConvId } : {}),
            ...(faqMsgId ? { messageId: faqMsgId } : {}),
          };
          socket.emit('agent:event', faqDone);
          return;
        } else if (faq) {
          // We had a match but the turn was aborted mid-lookup — don't emit, but
          // log so fast-lane hit-rate is observable (H2: minimal observability).
          console.log('[agent-socket] FAQ fast-lane matched but turn aborted');
        }

        // ── P1+P3 Intent Router (Lane 0 nav + Lane 3 summary, 0 LLM) ────────
        // When enabled, classify the message deterministically BEFORE the
        // orchestrator. Navigation → directive (0 LLM); summary → dashboard
        // insight_card (0 LLM); everything else → full ReAct loop. Fail-open.
        if (config.agentIntentRouter && !ac.signal.aborted) {
          const routerStart = performance.now();
          const decision = routeIntent(message, ctx);

          // Lane 0: Navigation
          if (decision.lane === 'nav' && decision.directive && !ac.signal.aborted) {
            const directive = decision.directive;
            const actionId = randomUUID();
            emit({ type: 'DIRECTIVE', directive, actionId, requiresAck: true });
            let ackOk = true;
            try {
              const ack = await awaitAck(actionId);
              ackOk = ack.status === 'ok';
            } catch {
              ackOk = false;
            }
            if (ac.signal.aborted) return;

            const lookupMs = performance.now() - routerStart;
            turnRecorded = true;
            const { conversationId: navConvId, messageId: navMsgId } = await recordNavTurn({
              ctx, userMessage: message, directive,
              conversationId: input?.conversationId, lookupMs, ackOk,
            });
            if (ac.signal.aborted) return;
            sessionHistory.push({ role: 'user', content: message });
            const routeKeyStr = directive.kind === 'navigate' ? directive.routeKey : 'trang đích';
            const navText = ackOk ? `Đã mở trang ${routeKeyStr}.` : `Không mở được trang ${routeKeyStr}.`;
            sessionHistory.push({ role: 'assistant', content: navText });
            trimSessionHistory(sessionHistory);
            socket.emit('agent:event', {
              type: 'RUN_FINISHED',
              response: { type: 'text', content: navText },
              ...(navConvId ? { conversationId: navConvId } : {}),
              ...(navMsgId ? { messageId: navMsgId } : {}),
            } satisfies AgentEvent);
            return;
          }

          // Lane 3: Summary
          if (decision.lane === 'summary' && !ac.signal.aborted) {
            const { response: summaryResponse, lookupMs: summaryMs } = await runSummary(ctx.role);
            if (!ac.signal.aborted) {
              turnRecorded = true;
              const { conversationId: sumConvId, messageId: sumMsgId } = await recordSummaryTurn({
                ctx, userMessage: message, response: summaryResponse,
                conversationId: input?.conversationId, lookupMs: summaryMs,
              });
              if (ac.signal.aborted) return;
              sessionHistory.push({ role: 'user', content: message });
              const summaryText = renderResponseText(summaryResponse);
              if (summaryText) sessionHistory.push({ role: 'assistant', content: summaryText });
              trimSessionHistory(sessionHistory);
              socket.emit('agent:event', {
                type: 'RUN_FINISHED',
                response: summaryResponse,
                ...(sumConvId ? { conversationId: sumConvId } : {}),
                ...(sumMsgId ? { messageId: sumMsgId } : {}),
              } satisfies AgentEvent);
              return;
            }
          }

          // Broad company financial health: three canonical report reads in
          // parallel, deterministic insight card, zero LLM/schema fallback. A
          // throw here (any read fails — Promise.all is fail-fast) fails OPEN to
          // the full ReAct loop below rather than surfacing a generic error, so a
          // transient DB/P&L failure degrades to a slower-but-correct answer
          // instead of a hard error. Matches the fail-open posture of the other
          // deterministic lanes.
          if (decision.lane === 'financial' && !ac.signal.aborted) {
            try {
              const financial = await runFinancialOverview();
              if (!ac.signal.aborted) {
                turnRecorded = true;
                const { conversationId: finConvId, messageId: finMsgId } = await recordSummaryTurn({
                  ctx,
                  userMessage: message,
                  response: financial.response,
                  conversationId: input?.conversationId,
                  lookupMs: financial.lookupMs,
                  model: 'financial-overview-lane',
                  intentBucket: 'financial',
                  toolCallCount: financial.toolCallCount,
                  toolTrace: financial.toolTrace,
                });
                if (ac.signal.aborted) return;
                sessionHistory.push({ role: 'user', content: message });
                const financialText = renderResponseText(financial.response);
                if (financialText) sessionHistory.push({ role: 'assistant', content: financialText });
                trimSessionHistory(sessionHistory);
                socket.emit('agent:event', {
                  type: 'RUN_FINISHED',
                  response: financial.response,
                  ...(finConvId ? { conversationId: finConvId } : {}),
                  ...(finMsgId ? { messageId: finMsgId } : {}),
                } satisfies AgentEvent);
                return;
              }
            } catch (e) {
              // Fail open to ReAct — do NOT surface a generic error. Log so the
              // fallback rate is observable alongside the lane's success metrics.
              console.error('[agent-socket] financial lane failed, falling back to ReAct', e);
            }
          }

          // Canonical one-report questions do not need tool selection or
          // model-authored JSON. The backing business service produces a typed
          // card directly, eliminating both ReAct and final_schema latency.
          if (decision.lane === 'report' && decision.reportRequest && !ac.signal.aborted) {
            const report = await runDeterministicReport(decision.reportRequest);
            if (!ac.signal.aborted) {
              turnRecorded = true;
              const { conversationId: reportConvId, messageId: reportMsgId } = await recordSummaryTurn({
                ctx,
                userMessage: message,
                response: report.response,
                conversationId: input?.conversationId,
                lookupMs: report.lookupMs,
                model: 'deterministic-report-lane',
                intentBucket: 'report',
                toolCallCount: report.toolCallCount,
                toolTrace: report.toolTrace,
              });
              if (ac.signal.aborted) return;
              sessionHistory.push({ role: 'user', content: message });
              const reportText = renderResponseText(report.response);
              if (reportText) sessionHistory.push({ role: 'assistant', content: reportText });
              trimSessionHistory(sessionHistory);
              socket.emit('agent:event', {
                type: 'RUN_FINISHED',
                response: report.response,
                ...(reportConvId ? { conversationId: reportConvId } : {}),
                ...(reportMsgId ? { messageId: reportMsgId } : {}),
              } satisfies AgentEvent);
              return;
            }
          }

          // Lane 2: Single-tool lookup
          if (decision.lane === 'lookup' && decision.lookupQuery && !ac.signal.aborted) {
            const { response: lookupResponse, lookupMs: lkMs, toolCallCount } = await runLookup(decision.lookupQuery, ctx.role);
            if (!ac.signal.aborted) {
              turnRecorded = true;
              const { conversationId: lkConvId, messageId: lkMsgId } = await recordLookupTurn({
                ctx, userMessage: message, response: lookupResponse,
                conversationId: input?.conversationId, lookupMs: lkMs, toolCallCount,
              });
              if (ac.signal.aborted) return;
              sessionHistory.push({ role: 'user', content: message });
              const lkText = renderResponseText(lookupResponse);
              if (lkText) sessionHistory.push({ role: 'assistant', content: lkText });
              trimSessionHistory(sessionHistory);
              socket.emit('agent:event', {
                type: 'RUN_FINISHED',
                response: lookupResponse,
                ...(lkConvId ? { conversationId: lkConvId } : {}),
                ...(lkMsgId ? { messageId: lkMsgId } : {}),
              } satisfies AgentEvent);
              return;
            }
          }
        }

        const { response, conversationId: convId, assistantMessageId } = await runAgent({
          ctx,
          message,
          conversationId: input?.conversationId,
          priorMessages: sessionHistory.slice(),
          emit,
          signal: ac.signal,
          awaitAck,
        });
        turnRecorded = assistantMessageId !== undefined;
        if (!ac.signal.aborted) {
          // Fold this completed turn into session memory for the next question.
          sessionHistory.push({ role: 'user', content: message });
          const assistantText = renderResponseText(response);
          if (assistantText) sessionHistory.push({ role: 'assistant', content: assistantText });
          trimSessionHistory(sessionHistory);
          const doneEvent: AgentEvent = {
            type: 'RUN_FINISHED',
            response,
            ...(convId ? { conversationId: convId } : {}),
            ...(assistantMessageId ? { messageId: assistantMessageId } : {}),
          };
          socket.emit('agent:event', doneEvent);
        }
      } catch (e) {
        if (!ac.signal.aborted) console.error('[agent-socket] chat failed', e);
        // Generic message only — never relay raw error text over the wire.
        if (!ac.signal.aborted) {
          socket.emit('agent:event', { type: 'RUN_ERROR', message: 'Đã có lỗi khi xử lý. Vui lòng thử lại.' } satisfies AgentEvent);
        }
      } finally {
        try {
          if (ac.signal.aborted && !turnRecorded) {
            await recordAbortedTurn({
              ctx,
              userMessage: message,
              conversationId: input?.conversationId,
              elapsedMs: performance.now() - turnStartedAt,
            });
          }
        } finally {
          settleTurn();
        }
        if (current === ac) current = null;
      }
    });

    socket.on('agent:cancel', () => current?.abort());
    socket.on('disconnect', (reason) => {
      console.log(`[agent-socket] disconnected: ${user.username ?? user.userId} (${reason})`);
      // Resolve any in-flight acks as timeout so their promises don't hang.
      for (const resolve of pendingAcks.values()) resolve({ actionId: '', status: 'timeout' });
      pendingAcks.clear();
      current?.abort();
    });
  });
}
