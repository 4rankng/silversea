// A3 prose-with-path synthesis: deterministic helpers that scan a prose answer
// for a path-like token resolving to an agent-navigable route, turning it into
// a navigate directive / action chip. Extracted from orchestrator.ts verbatim
// (pure code movement); runAgent imports these one-way.
import type { AgentDirective, AgentActionChip } from '@tingting/shared';
import {
  matchRoute,
  sameRoute,
  hasOnlyNumericParams,
  NAV_HIGHLIGHT_DEFAULTS,
} from './routeMatcher';

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
