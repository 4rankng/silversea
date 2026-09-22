/**
 * Central source of truth for empty-state illustrations
 * (docs/design-guidelines.md §6 — "empty-state art routes through a resolver").
 *
 * ONE resolver, context-keyed and typed: call sites pass an `EmptyContext` —
 * the empty-state surface they render — and this module decides the art. The
 * table below is the ONLY place empty-state art is chosen; no page or component
 * picks illustrations on its own.
 *
 * Shared set: the app ships four on-brand PNG illustrations (flat emerald
 * logistics art):
 *   - empty-1.png  field delivery (worker + truck + route-map phone) -> "trips"
 *   - empty-2.png  warehouse / material handling (forklift + boxes)    -> "fleet"
 *   - empty-3.png  planner at a desk (route map on screen)             -> "ops"
 *   - empty-4.png  clipboard w/ checklist + charts + shield            -> "finance"
 *
 * A few pre-existing bespoke illustration slots (dashboard chart faces, the
 * forwarder settlement strips, the debit-note-template face) keep their own art
 * byte-for-byte for visual parity; they are named contexts in the same table,
 * so unifying them into the shared set later is a one-line change here — an
 * operator call, not a code-structure change.
 *
 * Legacy inputs still resolve: a legacy bare name ("empty-trips"), a legacy
 * path ("/assets/illustrations/empty-trips.svg"), or a category key
 * ("trips" | "fleet" | "ops" | "finance"). Unknown inputs are returned
 * unchanged so any non-empty illustration path keeps working untouched.
 */

const BASE = '/assets/illustrations';

export type EmptyCategory = 'trips' | 'fleet' | 'ops' | 'finance';

export const EMPTY_ILLUSTRATIONS: Record<EmptyCategory, string> = {
  trips: `${BASE}/empty-1.png`,
  fleet: `${BASE}/empty-2.png`,
  ops: `${BASE}/empty-3.png`,
  finance: `${BASE}/empty-4.png`,
};

/**
 * Context keys = the empty-state surfaces of the app. Pass this typed key at
 * every call site (e.g. `<EmptyState context="debts" />`) so a typo is a
 * compile error and art stays centralized here.
 */
export type EmptyContext =
  // field delivery / trips
  | 'trips'
  | 'forwarder'
  | 'routes'
  | 'matching'
  // warehouse / fleet / physical goods
  | 'fleet'
  | 'trucks'
  | 'clients'
  // planner / office / general operations
  | 'ops'
  | 'dispatch'
  | 'search'
  | 'users'
  | 'config'
  | 'notifications'
  | 'welcome'
  | 'error'
  // finance / documents / compliance
  | 'finance'
  | 'advances'
  | 'audit'
  | 'debts'
  | 'earnings'
  | 'expenses'
  | 'payables'
  | 'penalties'
  | 'penalty-reasons'
  | 'salary'
  | 'pie'
  | 'pricing'
  // pre-existing bespoke art slots (see module doc)
  | 'revenue-period'
  | 'cost-composition'
  | 'vehicle-profit'
  | 'profitable-routes'
  | 'forwarder-advance'
  | 'forwarder-expense'
  | 'debit-note-template';

/** THE empty-state art table — the single place art is chosen, per context. */
const ART_BY_CONTEXT: Record<EmptyContext, string> = {
  trips: EMPTY_ILLUSTRATIONS.trips,
  forwarder: EMPTY_ILLUSTRATIONS.trips,
  routes: EMPTY_ILLUSTRATIONS.trips,
  matching: EMPTY_ILLUSTRATIONS.trips,
  fleet: EMPTY_ILLUSTRATIONS.fleet,
  trucks: EMPTY_ILLUSTRATIONS.fleet,
  clients: EMPTY_ILLUSTRATIONS.fleet,
  ops: EMPTY_ILLUSTRATIONS.ops,
  dispatch: EMPTY_ILLUSTRATIONS.ops,
  search: EMPTY_ILLUSTRATIONS.ops,
  users: EMPTY_ILLUSTRATIONS.ops,
  config: EMPTY_ILLUSTRATIONS.ops,
  notifications: EMPTY_ILLUSTRATIONS.ops,
  welcome: EMPTY_ILLUSTRATIONS.ops,
  error: EMPTY_ILLUSTRATIONS.ops,
  finance: EMPTY_ILLUSTRATIONS.finance,
  advances: EMPTY_ILLUSTRATIONS.finance,
  audit: EMPTY_ILLUSTRATIONS.finance,
  debts: EMPTY_ILLUSTRATIONS.finance,
  earnings: EMPTY_ILLUSTRATIONS.finance,
  expenses: EMPTY_ILLUSTRATIONS.finance,
  payables: EMPTY_ILLUSTRATIONS.finance,
  penalties: EMPTY_ILLUSTRATIONS.finance,
  'penalty-reasons': EMPTY_ILLUSTRATIONS.finance,
  salary: EMPTY_ILLUSTRATIONS.finance,
  pie: EMPTY_ILLUSTRATIONS.finance,
  pricing: EMPTY_ILLUSTRATIONS.finance,
  // Bespoke legacy art slots — kept byte-identical for visual parity.
  'revenue-period': `${BASE}/empty-revenue-period.webp`,
  'cost-composition': `${BASE}/empty-cost-composition.webp`,
  'vehicle-profit': `${BASE}/empty-vehicle-profit.webp`,
  'profitable-routes': `${BASE}/empty-profitable-routes.webp`,
  'forwarder-advance': `${BASE}/forwarder-approved-advance-v1.png`,
  'forwarder-expense': `${BASE}/forwarder-unmatched-expense-v1.png`,
  'debit-note-template': `${BASE}/empty-debit-note-template.png`,
};

function toBareName(input: string): string {
  return input
    .replace(/^\//, '')
    .replace(/^assets\/illustrations\//, '')
    .replace(/\.(svg|png|webp)$/i, '')
    .trim();
}

/**
 * Resolve an empty-state illustration input to its asset path.
 *
 * Resolution order:
 *   1. typed `EmptyContext` key (preferred),
 *   2. legacy string — bare legacy name ("empty-debts"), legacy path
 *      ("/assets/illustrations/empty-debts.svg") or category key ("finance") —
 *      normalized to its context (every legacy name is `empty-` + context),
 *   3. unknown input returned unchanged (non-empty illustration paths keep
 *      working untouched),
 *   4. no input -> the general ("ops") illustration.
 */
export function resolveEmptyIllustration(input?: EmptyContext | string): string {
  if (!input) return EMPTY_ILLUSTRATIONS.ops;
  const direct = ART_BY_CONTEXT[input as EmptyContext];
  if (direct) return direct;
  const bare = toBareName(input);
  const fromBare = ART_BY_CONTEXT[bare as EmptyContext];
  if (fromBare) return fromBare;
  if (bare.startsWith('empty-')) {
    const fromLegacy = ART_BY_CONTEXT[bare.slice('empty-'.length) as EmptyContext];
    if (fromLegacy) return fromLegacy;
  }
  return input;
}
