// routeMatcher — resolve a concrete SPA path (e.g. '/fleet/1/tires') back to a
// { routeKey, params } using PAGE_CATALOG as the single source of truth.
//
// Used by the orchestrator's "prose-with-path" guardrail (A3): when the model
// gives up and writes a destination path in plain text instead of calling
// ui.navigate, we extract the path, resolve it here, and convert the turn into
// a real navigate directive — routed through the existing terminal-ack block so
// the bubble stays honest ("đã mở / không mở được"). Deterministic and
// unit-tested; this is the safety net beneath MiniMax-M3's unreliable tool
// selection.
//
// `matchRoute` resolves ANY path that maps to an agent-navigable route
// (static or parametric). Numeric-param enforcement lives at the call site
// (the guardrail), not here, so this helper stays a pure path→route resolver.
import { AGENT_ROUTE_KEYS, PAGE_CATALOG, type AgentRouteKey } from '@tingting/shared';

export interface MatchedRoute {
  routeKey: AgentRouteKey;
  params: Record<string, string>;
}

interface CompiledRoute {
  routeKey: AgentRouteKey;
  regex: RegExp;
  paramNames: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compile once at module load. Each AGENT_ROUTE_KEY has an `agent` sub-object
// (enforced by the compile-time guard in shared/src/schemas/agent.ts), so every
// key here is a real navigable page. Static entries match their exact path;
// parametric entries turn `:truckId`-style segments into capture groups.
const COMPILED: CompiledRoute[] = (AGENT_ROUTE_KEYS as readonly AgentRouteKey[]).map((k) => {
  const entry = PAGE_CATALOG[k];
  if (typeof entry.path === 'function') {
    const paramNames: string[] = [];
    const body = entry.pathPattern.replace(/:([A-Za-z_]\w*)/g, (_, name: string) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    return { routeKey: k, regex: new RegExp(`^${body}$`), paramNames };
  }
  return { routeKey: k, regex: new RegExp(`^${escapeRegex(entry.path)}$`), paramNames: [] };
});

/** Resolve a concrete SPA path to { routeKey, params }. Query/hash are ignored.
 *  Returns null when the path matches no agent-navigable route. */
export function matchRoute(path: string): MatchedRoute | null {
  const clean = path.split(/[?#]/)[0];
  for (const r of COMPILED) {
    const m = r.regex.exec(clean);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1]);
    });
    return { routeKey: r.routeKey, params };
  }
  return null;
}

/** Structural equality: same routeKey AND identical param values. Used by the
 *  guardrail to skip synthesizing a (redundant) navigate to the page the user
 *  is already on — including a different record on the same parametric route. */
export function sameRoute(a: MatchedRoute | null, b: MatchedRoute | null): boolean {
  if (!a || !b || a.routeKey !== b.routeKey) return false;
  const ak = Object.keys(a.params);
  const bk = Object.keys(b.params);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a.params[k] === b.params[k]);
}

/** True when every param value is a positive integer. Parametric routes in this
 *  app are all id-shaped; rejecting non-numeric keeps the guardrail from acting
 *  on a hallucinated path like '/fleet/abc/tires'. Vacuously true for static
 *  routes (no params). */
export function hasOnlyNumericParams(m: MatchedRoute): boolean {
  return Object.values(m.params).every((v) => /^\d+$/.test(v));
}

// Sensible default highlight targets per page. Shared by ui.navigate (injects a
// default when the model navigates without naming a targetId) and the
// orchestrator guardrail (injects one when synthesizing a navigate from prose).
// Keep tiny — a full compile-time registry is over-engineering for v1; add an
// entry only when a page has an obvious primary action button.
export const NAV_HIGHLIGHT_DEFAULTS: Partial<Record<AgentRouteKey, string>> = {
  fleetTires: 'ttp-add-trigger',
};
