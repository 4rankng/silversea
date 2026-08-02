// useAgentChat — drives one assistant conversation.
//
// Sends a user message to the SSE endpoint and folds the streamed events into
// React state: tool activity (for the "thinking" indicator), directives
// (forwarded to the AgentDirective bridge), the streaming text bubble, and the
// final assistant answer (text | insight_card | directive).
//
// Directives arrive two ways: as a mid-stream `DIRECTIVE` event (a ui.* tool
// fired) and as the final `RUN_FINISHED` response when the whole answer IS a
// navigation. Page-changing directives are queued until `RUN_FINISHED` so the
// app does not navigate away before the assistant's final response lands.
// Event names follow the AG-UI protocol taxonomy.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agentClient,
  streamAgentChat,
  sendActionResult,
  loadSavedConversationId,
  persistConversationId,
} from '../api/agentClient';
import type { DirectiveOutcome } from '../context/AgentDirectiveContext';
import type { AgentDirective, AgentEvent, AgentMessage, AgentResponse } from '@tingting/shared';

export interface UseAgentChatOptions {
  /** Called for every directive the stream emits (navigation/open/prefill).
   *  Returns the outcome so navigate/focus can be acked back to the server. */
  onDirective?: (d: AgentDirective) => DirectiveOutcome;
}

export interface UseAgentChat {
  messages: AgentMessage[];
  isThinking: boolean;
  /** True once the server has acknowledged receipt (the `RUN_STARTED` event)
   *  but hasn't finished — lets the thinking indicator show "Đang xử lý…"
   *  (server has it) vs the initial "Đang suy nghĩ…" (still in flight). */
  received: boolean;
  /** The tool currently running, for the thinking indicator. */
  activeTool: { name: string; label?: string } | null;
  /** A pending assistant bubble being streamed token-by-token
   *  (TEXT_MESSAGE_START/CONTENT/END). Renders live while `isThinking`; the
   *  final message arrives in RUN_FINISHED. A detailed stream is preserved if
   *  the final response has degraded to a short summary. Null when no stream
   *  is active (structured card answers never stream). */
  streamingMessage: { id: string; content: string } | null;
  error: string | null;
  conversationId: string | null;
  send: (message: string, currentRouteKey?: string) => Promise<void>;
  reset: () => void;
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useAgentChat(opts: UseAgentChatOptions = {}): UseAgentChat {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [received, setReceived] = useState(false);
  const [activeTool, setActiveTool] = useState<UseAgentChat['activeTool']>(null);
  const [streamingMessage, setStreamingMessage] = useState<UseAgentChat['streamingMessage']>(null);
  const [error, setError] = useState<string | null>(null);
  // Seed from localStorage so a page reload (Vite HMR / service-worker deploy /
  // manual refresh) can rehydrate the same thread instead of starting blank.
  const [conversationId, setConversationId] = useState<string | null>(() => loadSavedConversationId());

  // Keep the latest onDirective in a ref so the streaming callback (created
  // once per send) always sees the current handler.
  const directiveRef = useRef(opts.onDirective);
  directiveRef.current = opts.onDirective;
  const abortRef = useRef<AbortController | null>(null);
  const pendingPageDirectiveRef = useRef<AgentDirective | null>(null);
  // State updates are asynchronous, so retain the complete stream in a ref for
  // the terminal event. This lets us prevent a degraded summary from erasing
  // the detailed answer the user has already seen.
  const streamedContentRef = useRef<{ id: string; content: string } | null>(null);

  // Persist the active conversationId so the thread can be resumed after a
  // reload. Cleared on logout (see useAuth → clearAgentConversation).
  useEffect(() => {
    persistConversationId(conversationId);
  }, [conversationId]);

  // Rehydrate the thread once on mount: fetch the saved conversation's messages
  // from the DB. A stale/404 id clears itself so the next send starts fresh.
  useEffect(() => {
    const saved = loadSavedConversationId();
    if (!saved) return;
    let cancelled = false;
    agentClient
      .getConversation(saved)
      .then((conv) => {
        // Don't clobber a message the user may have sent before this resolves.
        if (!cancelled && conv.messages?.length) {
          setMessages((prev) => (prev.length ? prev : conv.messages));
        }
      })
      .catch(() => {
        if (!cancelled) setConversationId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'RUN_STARTED':
        // Server has the message — upgrade the thinking indicator's label.
        setReceived(true);
        break;
      case 'TOOL_CALL_START':
        setActiveTool({ name: event.toolName, label: undefined });
        break;
      case 'TOOL_CALL_END':
        // Keep the tool name but surface its result label; cleared on RUN_FINISHED.
        setActiveTool({ name: event.toolName, label: event.label });
        break;
      case 'TEXT_MESSAGE_START':
        // Begin accumulating a streaming text bubble. Cleared by RUN_FINISHED.
        streamedContentRef.current = { id: event.messageId, content: '' };
        setStreamingMessage({ id: event.messageId, content: '' });
        break;
      case 'TEXT_MESSAGE_CONTENT':
        // Append a token delta to the in-flight streaming bubble.
        if (streamedContentRef.current?.id === event.messageId) {
          streamedContentRef.current = {
            ...streamedContentRef.current,
            content: streamedContentRef.current.content + event.delta,
          };
        }
        setStreamingMessage((prev) =>
          prev && prev.id === event.messageId
            ? { ...prev, content: prev.content + event.delta }
            : prev,
        );
        break;
      case 'TEXT_MESSAGE_END':
        // Leave the completed bubble in place until RUN_FINISHED finalizes it.
        break;
      case 'DIRECTIVE': {
        const shouldDefer = isPageChangingDirective(event.directive);
        if (shouldDefer) {
          pendingPageDirectiveRef.current = event.directive;
        }
        const outcome = shouldDefer
          ? { status: 'ok' as const, reason: 'queued-until-done' }
          : directiveRef.current?.(event.directive) ?? { status: 'ok' as const };
        // Ack queued navigate/focus directives as accepted so the server can
        // finish composing the final answer; apply the page change after done.
        if (event.requiresAck && event.actionId) {
          sendActionResult({
            actionId: event.actionId,
            status: outcome.status,
            reason: outcome.reason,
          });
        }
        break;
      }
      case 'RUN_FINISHED': {
        setActiveTool(null);
        setIsThinking(false);
        setReceived(false);
        // The final response normally replaces the streaming bubble. Keep a
        // substantially richer stream when a server fallback has collapsed the
        // final response to a short summary.
        const streamedContent = streamedContentRef.current?.content;
        streamedContentRef.current = null;
        setStreamingMessage(null);
        if (event.conversationId) setConversationId(event.conversationId);
        const response = preserveDetailedStream(event.response as AgentResponse, streamedContent);
        if (response.type === 'directive') {
          pendingPageDirectiveRef.current = null;
          // A pure-navigation answer: still surface a short confirmation bubble.
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'assistant', content: 'Đã mở trang cho bạn.', response, createdAt: new Date().toISOString() },
          ]);
          requestAnimationFrame(() => {
            window.setTimeout(() => {
              directiveRef.current?.(response.directive);
            }, 0);
          });
        } else {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'assistant', response, createdAt: new Date().toISOString() },
          ]);
          {
            const pending = pendingPageDirectiveRef.current;
            pendingPageDirectiveRef.current = null;
            if (pending) {
              requestAnimationFrame(() => {
                window.setTimeout(() => {
                  directiveRef.current?.(pending);
                }, 0);
              });
            }
          }
        }
        break;
      }
      case 'RUN_ERROR':
        pendingPageDirectiveRef.current = null;
        setActiveTool(null);
        setIsThinking(false);
        setReceived(false);
        streamedContentRef.current = null;
        setStreamingMessage(null);
        setError(event.message);
        break;
    }
  }, []);

  const send = useCallback(
    async (message: string, currentRouteKey?: string) => {
      setError(null);
      setIsThinking(true);
      setReceived(false);
      // Clear any streaming bubble left dangling by an aborted previous turn
      // (abort resolves agentClient without a RUN_FINISHED/ERROR frame, so the
      // RUN_FINISHED/ERROR clear paths don't fire — clear explicitly here).
      streamedContentRef.current = null;
      setStreamingMessage(null);
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'user', content: message, createdAt: new Date().toISOString() },
      ]);

      abortRef.current?.abort();
      pendingPageDirectiveRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamAgentChat(
          { message, conversationId: conversationId ?? undefined, currentRouteKey, signal: controller.signal },
          handleEvent,
        );
        // Stream closed. If a terminal RUN_FINISHED/RUN_ERROR frame validated,
        // the handler already cleared isThinking; if the final frame was
        // malformed and silently dropped by the parser, release the spinner so
        // the drawer doesn't hang on a perpetual "thinking" state.
        if (!controller.signal.aborted) {
          setIsThinking(false);
          setActiveTool(null);
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setIsThinking(false);
        setActiveTool(null);
        setError(e instanceof Error ? e.message : 'Lỗi không xác định');
      }
    },
    [conversationId, handleEvent],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    pendingPageDirectiveRef.current = null;
    streamedContentRef.current = null;
    setMessages([]);
    setError(null);
    setActiveTool(null);
    setIsThinking(false);
    setStreamingMessage(null);
    setConversationId(null);
  }, []);

  return { messages, isThinking, received, activeTool, streamingMessage, error, conversationId, send, reset };
}

function isPageChangingDirective(directive: AgentDirective): boolean {
  return directive.kind === 'navigate' || directive.kind === 'focus';
}

function preserveDetailedStream(
  response: AgentResponse,
  streamedContent: string | undefined,
): AgentResponse {
  if (response.type !== 'text') return response;
  const detailed = streamedContent?.trim();
  if (!detailed || /<(?:think|analysis|tool_call)\b/i.test(detailed)) return response;
  if (!isSubstantiallyMoreDetailed(detailed, response.content)) return response;
  return { ...response, content: detailed };
}

function isSubstantiallyMoreDetailed(candidate: string, summary: string): boolean {
  const normalizedCandidate = candidate.replace(/\s+/g, ' ').trim();
  const normalizedSummary = summary.replace(/\s+/g, ' ').trim();
  if (!normalizedCandidate || normalizedCandidate === normalizedSummary) return false;
  return normalizedCandidate.length >= 200
    && normalizedCandidate.length >= normalizedSummary.length + 120
    && normalizedCandidate.length >= normalizedSummary.length * 1.5;
}
