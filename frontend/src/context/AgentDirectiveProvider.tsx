// AgentDirectiveProvider — the component half of the bot → SPA bridge.
//
// This file exports ONLY the AgentDirectiveProvider component so React Fast
// Refresh hot-reloads it cleanly; the context object + useAgentDirectives hook
// live in AgentDirectiveContext.tsx.
//
// The hard case is "navigate THEN open a modal on the new page": the handler
// for the target page isn't mounted yet. So open/prefill directives that find
// no registered handler are STASHED in a pending map keyed by componentId and
// replayed the instant the target page registers its handler (on mount). A
// `?agent=open:<componentId>` URL seed does the same for a cold mount / F5.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { highlightElement, isTourActive } from '../lib/agentHighlight';
import { useToast } from '../components/shared/Toast';
import { PAGE_CATALOG, type AgentDirective, type AgentRouteKey } from '@tingting/shared';
import {
  AgentDirectiveContext,
  type DirectiveOutcome,
  type OpenHandler,
} from './AgentDirectiveContext';

/** Resolve a routeKey + optional params to an SPA path via the page catalog.
 *  Typed (no more `as Record<string, unknown>` cast): the catalog knows which
 *  entries are parametric. Detail/edit routes take a single id; accept any of
 *  the common param keys the LLM may emit (id, tripId, payableId, debtId,
 *  expenseId, …) and fall back to the first numeric value present — otherwise
 *  the builder gets 0 and the user lands on an empty /path/0 page. */
export function resolvePath(routeKey: AgentRouteKey, params?: Record<string, string | number>): string {
  const entry = PAGE_CATALOG[routeKey];
  if (typeof entry.path === 'function') {
    const id =
      params?.id ??
      params?.tripId ??
      params?.payableId ??
      params?.debtId ??
      params?.expenseId ??
      (params ? Object.values(params).find((v) => typeof v === 'number' || /^\d+$/.test(String(v))) : undefined) ??
      0;
    // Pass the resolved id under the builder's declared key. Most routes read
    // `p.id`, but tire pages read `p.truckId` / `p.trailerId` — hardcoding
    // `{ id }` would land on /fleet/undefined/tires. requiresParams is declared
    // per parametric catalog entry and is the authoritative key name.
    const key = entry.requiresParams[0] ?? 'id';
    return entry.path({ [key]: id });
  }
  return entry.path;
}

export function AgentDirectiveProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const handlers = useRef<Map<string, OpenHandler>>(new Map());
  const pending = useRef<Map<string, Extract<AgentDirective, { kind: 'open' | 'prefill' }>[]>>(
    new Map(),
  );

  const flush = useCallback((componentId: string) => {
    const queued = pending.current.get(componentId);
    if (!queued || queued.length === 0) return;
    const handler = handlers.current.get(componentId);
    if (!handler) return;
    for (const d of queued) handler(d);
    pending.current.delete(componentId);
  }, []);

  const register = useCallback(
    (componentId: string, handler: OpenHandler) => {
      handlers.current.set(componentId, handler);
      flush(componentId);
    },
    [flush],
  );

  const unregister = useCallback((componentId: string) => {
    handlers.current.delete(componentId);
  }, []);

  const send = useCallback(
    (d: AgentDirective): DirectiveOutcome => {
      switch (d.kind) {
        case 'navigate': {
          const path = resolvePath(d.routeKey, d.params);
          // fade/slide-* via React Router's View Transitions integration
          // (progressive enhancement; slide-* currently render as fade).
          const animation = d.animation ?? 'fade';
          navigate(path, { viewTransition: animation !== 'none' });
          if (d.highlight?.targetId && !isTourActive()) {
            // Target page mounts async — retry briefly so route code-splitting,
            // data hooks, and drawer close animations do not make the spotlight
            // miss. Fire-and-forget: `send` stays synchronous for the chat ack
            // contract (never await here — see sendAndWait for the tour path).
            void highlightWhenReady(d.highlight.targetId, d.highlight.durationMs);
          }
          return { status: 'ok' };
        }
        case 'focus': {
          // Navigate to the page, then drop a ?focus= seed so the page's
          // useFocusDeepLink scrolls + highlights (pages without it just navigate).
          // fdur carries the optional ring duration.
          navigate(resolvePath(d.routeKey, { id: d.id }));
          const params: Record<string, string> = { focus: String(d.id) };
          if (d.durationMs) params.fdur = String(d.durationMs);
          setSearchParams(params, { replace: true });
          return { status: 'ok' };
        }
        case 'open':
        case 'prefill': {
          const handler = handlers.current.get(d.componentId);
          if (handler) {
            handler(d);
            return { status: 'ok' };
          } else {
            // Target page not mounted yet — stash for when it registers.
            const q = pending.current.get(d.componentId) ?? [];
            q.push(d);
            pending.current.set(d.componentId, q);
            return { status: 'ok', reason: 'pending-mount' };
          }
        }
        case 'toast': {
          toast({ kind: d.variant, message: d.message, duration: d.durationMs });
          return { status: 'ok' };
        }
        case 'scrollTo': {
          // Suppress while a tour owns the spotlight (activeDriver singleton guard).
          if (isTourActive()) return { status: 'ok' };
          const found = highlightElement(d.targetId, d.durationMs ?? 2000);
          return found
            ? { status: 'ok' }
            : { status: 'error', reason: 'Không tìm thấy mục cần làm nổi bật trên trang' };
        }
      }
    },
    [navigate, setSearchParams, toast],
  );

  // Async variant for the TourController: navigates then AWAITS the target
  // mounting so the spotlight lands, resolving a DirectiveOutcome whose reason
  // is 'highlight-missed' when it never appeared (graceful degradation). This
  // path ignores the tourActive guard — the tour owns the spotlight. `send`
  // (chat) stays synchronous; only the tour awaits.
  const sendAndWait = useCallback(
    async (d: AgentDirective): Promise<DirectiveOutcome> => {
      switch (d.kind) {
        case 'navigate': {
          navigate(resolvePath(d.routeKey, d.params), {
            viewTransition: (d.animation ?? 'fade') !== 'none',
          });
          if (d.highlight?.targetId) {
            const landed = await highlightWhenReady(d.highlight.targetId, d.highlight.durationMs);
            return landed ? { status: 'ok' } : { status: 'ok', reason: 'highlight-missed' };
          }
          return { status: 'ok' };
        }
        case 'scrollTo': {
          const landed = await highlightWhenReady(d.targetId, d.durationMs ?? 2000);
          return landed ? { status: 'ok' } : { status: 'ok', reason: 'highlight-missed' };
        }
        default:
          return send(d);
      }
    },
    [navigate, send],
  );

  // Cold-mount seed: a shareable/refresh-safe `?agent=open:<componentId>` (with
  // optional prefill encoded as JSON). Consumed once, then cleared — mirrors
  // how useFocusDeepLink cleans its own param.
  useEffect(() => {
    const seed = searchParams.get('agent');
    if (!seed) return;
    const decoded = decodeSeed(seed);
    if (decoded) send(decoded);
    const next = new URLSearchParams(searchParams);
    next.delete('agent');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AgentDirectiveContext.Provider value={{ send, sendAndWait, register, unregister }}>
      {children}
    </AgentDirectiveContext.Provider>
  );
}

/** Poll highlightElement until the target mounts (or 1.8s elapses), resolving
 *  true on first hit / false on timeout. Promise-returning sibling of the old
 *  fire-and-forget retry: `send` discards the promise (stays sync); `sendAndWait`
 *  awaits it to learn whether the spotlight landed (graceful degradation). */
function highlightWhenReady(targetId: string, durationMs?: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const attempt = () => {
      if (highlightElement(targetId, durationMs)) return resolve(true);
      if (performance.now() - startedAt > 1800) return resolve(false);
      window.setTimeout(attempt, 120);
    };
    window.setTimeout(attempt, 180);
  });
}

/** Parse `open:<componentId>` or `open:<componentId>:<base64-json-prefill>`. */
function decodeSeed(raw: string): Extract<AgentDirective, { kind: 'open' | 'prefill' }> | null {
  // Format: `<kind>:<componentId>[:<base64-json>]` where <kind> is the literal
  // 'open'. Splitting on ':' and taking parts[1] as the componentId avoids the
  // old bug where `indexOf(':')` landed on the kind separator and turned the
  // componentId into 'open' (losing the real id, e.g. 'addExpense', and
  // breaking every cold-mount prefill seed).
  const parts = raw.split(':');
  const componentId = parts[1];
  if (!componentId) return { kind: 'open', componentId: raw };
  if (parts.length >= 3) {
    try {
      const values = JSON.parse(atob(parts.slice(2).join(':')));
      return { kind: 'prefill', componentId, values };
    } catch {
      return { kind: 'open', componentId };
    }
  }
  return { kind: 'open', componentId };
}
