// API client for the command-and-insight assistant.
//
// Two surfaces:
//   - REST (conversation history) via the shared `api` wrapper.
//   - Live chat via socket.io (namespace `/agent`, path `/socket.io`). The JWT
//     travels in the handshake (`auth.token`) so the bot still impersonates the
//     logged-in user — the same reason the old SSE client used raw `fetch`
//     instead of `EventSource` (which cannot send headers).
//
// `streamAgentChat` keeps the old `(input, onEvent) => Promise<void>` contract:
// it resolves on the terminal `RUN_FINISHED`/`RUN_ERROR` frame, so the chat hook
// is transport-agnostic. Each frame is still Zod-validated against
// `agentEventSchema`. Event names follow the AG-UI protocol taxonomy.
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { getToken } from '../design-system/hooks/useToken';
import { agentEventSchema, type AgentActionResult, type AgentConversation, type AgentEvent } from '@tingting/shared';

export const agentClient = {
  /** Recent conversations for the current user (sidebar history). */
  listConversations: () => api.get<AgentConversation[]>('/agent/conversations'),

  /** Full message history for one conversation (resume). */
  getConversation: (id: string) =>
    api.get<AgentConversation>(`/agent/conversations/${id}`),
};

// ── Conversation resume (survive reload) ────────────────────────────────────
// The chat thread lives in React state (useAgentChat), which is lost on a full
// page reload — and reloads DO happen: in dev, Vite HMR (the source alias for
// @tingting/shared in vite.config.ts reloads the app on a shared-schema save);
// in prod, the service-worker `controllerchange` fires on deploy. The
// conversation is already persisted server-side by persistTurn — we only need
// to remember which conversationId and rehydrate its messages on mount.
const CONVERSATION_ID_KEY = 'agent.conversationId';

export function loadSavedConversationId(): string | null {
  try {
    return localStorage.getItem(CONVERSATION_ID_KEY);
  } catch {
    return null;
  }
}

export function persistConversationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CONVERSATION_ID_KEY, id);
    else localStorage.removeItem(CONVERSATION_ID_KEY);
  } catch {
    /* storage may be unavailable (private mode) — best-effort */
  }
}

/** Drop the saved conversation (e.g. on logout) so the next session starts fresh. */
export function clearAgentConversation(): void {
  persistConversationId(null);
}

export interface StreamChatInput {
  message: string;
  conversationId?: string;
  /** The SPA route the user is on when they ask — gives the LLM page context. */
  currentRouteKey?: string;
  signal?: AbortSignal;
}

// ── Socket lifecycle ─────────────────────────────────────────────────────────
// One socket per token, lazily connected and reused. If the token changes
// (logout / re-login), the old socket is discarded so the handshake re-auths
// with the fresh token.
let cached: { token: string; socket: Socket } | null = null;

function waitForConnect(socket: Socket): Promise<Socket> {
  if (socket.connected) return Promise.resolve(socket);
  return new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onErr);
      reject(new Error('Trợ lý phản hồi quá chậm'));
    }, 10_000);
    const onConnect = () => {
      clearTimeout(timer);
      socket.off('connect_error', onErr);
      resolve(socket);
    };
    const onErr = (err: Error) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      reject(new Error(err.message || 'Không kết nối được trợ lý'));
    };
    socket.once('connect', onConnect);
    socket.once('connect_error', onErr);
  });
}

function ensureAgentSocket(): Promise<Socket> {
  const token = getToken();
  if (!token) return Promise.reject(new Error('Chưa đăng nhập'));
  if (cached && cached.token === token) return waitForConnect(cached.socket);
  // Token changed (or first connect) — drop any stale socket.
  if (cached) {
    cached.socket.disconnect();
    cached = null;
  }
  const socket = io('/agent', {
    path: '/socket.io',
    auth: { token },
    // Default transports (polling → websocket upgrade) for max compatibility
    // across the Vite proxy and prod nginx.
  });
  cached = { token, socket };
  return waitForConnect(socket);
}

/** Tear down the socket (e.g. on logout) so the next turn re-auths cleanly. */
export function disposeAgentSocket(): void {
  if (cached) {
    cached.socket.disconnect();
    cached = null;
  }
}

/**
 * Ack a directive the server tagged with `requiresAck` (navigate/focus). The
 * server awaits this before composing its final "đã mở trang…" text, so it
 * never claims success for a page the client never applied. Reuses the cached
 * socket the directive arrived on; best-effort if it has since dropped.
 */
export function sendActionResult(r: AgentActionResult): void {
  const socket = cached?.socket;
  if (socket && socket.connected) socket.emit('agent:action_result', r);
}

/**
 * Stream an assistant turn. Calls `onEvent` for each validated frame and
 * resolves on the terminal `done`/`error` frame (or on caller abort /
 * disconnect). Mirrors the old SSE contract so the chat hook is unchanged.
 */
export async function streamAgentChat(
  input: StreamChatInput,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const socket = await ensureAgentSocket();

  return new Promise<void>((resolve) => {
    let settled = false;

    const detach = () => {
      socket.off('agent:event', onFrame);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      if (onAbort && input.signal) input.signal.removeEventListener('abort', onAbort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      detach();
      resolve();
    };

    const onFrame = (raw: unknown) => {
      const result = agentEventSchema.safeParse(raw);
      if (!result.success) return; // malformed frame — keep listening
      const ev = result.data as AgentEvent;
      onEvent(ev);
      if (ev.type === 'RUN_FINISHED' || ev.type === 'RUN_ERROR') finish();
    };
    // Surface transport-level failures as an error bubble and close the turn.
    const onDisconnect = () => {
      if (settled) return;
      onEvent({ type: 'RUN_ERROR', message: 'Mất kết nối với trợ lý' } as AgentEvent);
      finish();
    };
    const onConnectError = (err: Error) => {
      if (settled) return;
      onEvent({ type: 'RUN_ERROR', message: err.message || 'Không kết nối được trợ lý' } as AgentEvent);
      finish();
    };

    // Caller abort (useAgentChat aborts the previous in-flight turn before a
    // new send) — tell the server to cancel and close this promise.
    let onAbort: (() => void) | null = null;
    if (input.signal) {
      if (input.signal.aborted) {
        socket.emit('agent:cancel');
        finish();
        return;
      }
      onAbort = () => {
        socket.emit('agent:cancel');
        finish();
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
    }

    socket.on('agent:event', onFrame);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.emit('agent:chat', {
      message: input.message,
      conversationId: input.conversationId,
      currentRouteKey: input.currentRouteKey,
    });
  });
}
