import { Role } from '@tingting/shared';

/**
 * Route-scoped authorization grant registry (kanban card 20260930_228).
 *
 * One row per grant that the casbin middleware honors outside the casbin
 * policy: the ten hasRouteScopedRoleAllowance if-blocks plus the two
 * tripRouteAuthz allowlists, ported verbatim (patterns, role sets, and method
 * sets included — do not "improve" them here; the equivalence matrix in
 * src/tests/authz-grant-registry.test.ts holds this file to the pre-refactor
 * decision for every role × method × path cell).
 *
 * Shape follows MATERIAL_WRITE_RULES (material-write.ts): data rows plus a
 * pair of interpreter functions, no per-row behavior.
 */

/** Sentinel for rules that intentionally match every HTTP verb. */
export const ANY_METHOD = '*' as const;

export interface RouteGrantRule {
  /** Casbin resource the rule is scoped to, as passed to casbinAuthz(). */
  resource: string;
  /** HTTP verbs the rule covers; ANY_METHOD matches every verb. */
  methods: readonly string[] | typeof ANY_METHOD;
  /** Tested against req.path exactly as the pre-refactor if-blocks did. */
  pathPattern: RegExp;
  /** Roles the grant applies to. */
  roles: readonly Role[];
  /**
   * 'bypass': a matching request skips the casbin policy check (the ten
   *   hasRouteScopedRoleAllowance if-blocks — casbin is never consulted).
   * 'exclusive': a matching path never consults casbin at all; the role
   *   list is the whole decision, so out-of-list roles are hard-denied
   *   even where the policy would allow them (the two tripRouteAuthz
   *   allowlists — e.g. ADMIN is policy-wildcard yet still 403 on
   *   POST /:id/complete).
   */
  effect: 'bypass' | 'exclusive';
  /** Why the grant exists — the pre-refactor ruling comment, verbatim. */
  reason: string;
  /** The ruling that introduced the grant. */
  source: string;
}

export const ROUTE_GRANT_RULES: readonly RouteGrantRule[] = [
  {
    resource: 'shipments',
    methods: ['POST'],
    pathPattern: /^\/\d+\/recovery-facts\/?$/,
    roles: [Role.OPS],
    effect: 'bypass',
    reason: 'OPS records shipment recovery facts; OPS holds no shipments policy row, so the allowance is scoped to exactly this path.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'shipments',
    methods: ['DELETE'],
    pathPattern: /^\/\d+\/declarations\/\d+$/,
    roles: [Role.CUS, Role.DISPATCHER],
    effect: 'bypass',
    reason:
      'Card 20260921_3: declaration rows are lot metadata the CUS workboard manages — the documents modal removes a row via DELETE /:id/declarations/:declarationId. The route\'s own requireRoles keeps the intake-mutation role set; this casbin bridge stays scoped to exactly that path so general shipment delete stays closed.',
    source: 'Card 20260921_3',
  },
  {
    resource: 'config',
    methods: ['POST'],
    pathPattern: /^\/routes\/?$/,
    roles: [Role.CUS, Role.DISPATCHER],
    effect: 'bypass',
    reason:
      'The shipment-create screen is shared by CUS and Dispatchers. Permit only creation of the missing route they need; all other config writes and all route updates/deletes remain governed by the normal config policy.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'config',
    methods: ['POST'],
    pathPattern: /^\/customers\/?$/,
    roles: [Role.CUS, Role.DISPATCHER],
    effect: 'bypass',
    reason:
      'Same screen, same need for the customer catalog: CUS/Dispatchers may add the missing customer inline. POST-only and customer-scoped; the intake strip in the customers beforeCreate keeps financially material fields out of their payload, and updates/deletes stay Casbin-denied.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'config',
    methods: ['POST'],
    pathPattern: /^\/ports\/?$/,
    roles: [Role.CUS, Role.DISPATCHER],
    effect: 'bypass',
    reason:
      'Same screen, same need for the port/yard catalog (Cảng nâng/hạ): CUS/Dispatchers may add a missing port inline. POST-only; the ports CRUD stays fully Casbin-governed for every other verb and role.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'config',
    methods: ['GET'],
    pathPattern: /^\/(customers|routes)(\/|\?|$)/,
    roles: [Role.CUS],
    effect: 'bypass',
    reason:
      'CUS also needs to read the customer and route catalogs to populate the shipment-create dropdown and the catalog management pages. DISPATCHER already has config:read via Casbin policy; CUS does not, so this route-scoped GET bypass bridges the gap.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'config',
    methods: ['PUT', 'DELETE'],
    pathPattern: /^\/(customers|routes)\/\d+\/?$/,
    roles: [Role.CUS, Role.DISPATCHER],
    effect: 'bypass',
    reason:
      'CUS and DISPATCHER may update or delete identity fields on customers and routes from the catalog management pages. POST already allowed above for create; PUT/DELETE extends the same pattern to edit and undo recent creates. Financial/cost fields are stripped by intake restriction services; the beforeDelete hook enforces a 1-day age gate so only recently created entities are deletable.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'config',
    methods: ['POST', 'PUT', 'DELETE'],
    pathPattern: /^\/(trucks|drivers|suppliers)(\/\d+)?\/?$/,
    roles: [Role.DISPATCHER],
    effect: 'bypass',
    reason:
      'Dispatcher full CRUD on the three resource-catalog rows it staffs dispatch plans from (trucks, drivers, suppliers). Every other config write stays Casbin-denied.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    // Verbatim port: the pre-refactor if-block checked NO method for this
    // path, so CUS gets every verb here (GET list included). Keep ANY_METHOD.
    resource: 'config',
    methods: ANY_METHOD,
    pathPattern: /^\/fuel-price-periods(\/\d+)?\/?$/,
    roles: [Role.CUS],
    effect: 'bypass',
    reason:
      'Fuel price entry (Phương án tính cước docx §5-1): the entrants are "Kế toán/CUS" — a single-record screen [Ngày hiệu lực][Giá dầu DO/lít]. CUS has no config-tree grant, so bridge it route-scoped to the fuel-price periods resource only. Every other pricing config (rate terms, norms) stays Casbin-governed (ADMIN/MANAGER/ACCOUNTANT).',
    source: 'Phương án tính cước docx §5-1',
  },
  {
    // Card 20261001_253: the app mounts the config gate at bare '/api'
    // (index.ts:229) BEFORE the financial gate (:230), so a
    // /api/finance/billing-documents request is evaluated by the CONFIG
    // gate FIRST — where CUS (no config policy) died before the financial
    // row below ever ran. Both bare-mount gates evaluate sequentially, so
    // the grant must exist at BOTH resources: this mirror admits CUS at
    // the config gate; the financial row below admits it at its own.
    // Pattern, method and roles are identical to the financial row — no
    // other cell of the authz matrix changes.
    resource: 'config',
    methods: ['GET'],
    pathPattern: /^\/finance\/billing-documents\/\d+(\/export)?$/,
    roles: [Role.CUS],
    effect: 'bypass',
    reason:
      'Mirror of the financial debit-note read grant for the config gate: /api/finance requests pass the config gate first (mount order), so the issuing CUS must be admitted there too — settlement screen read/export of its own issued note (card 20261001_253).',
    source: 'card 20261001_253 (mount-order fix; mirrors the Card-20260930_228 financial row)',
  },
  {
    resource: 'financial',
    methods: ['GET'],
    pathPattern: /^\/finance\/billing-documents\/\d+(\/export)?$/,
    roles: [Role.CUS],
    effect: 'bypass',
    reason:
      'Debit-note document reads for the settlement screen (Chi phí - Quyết toán): the issuing CUS must read + export the note it issued. The financial policy grants no CUS row, so bridge just the two GET document routes; the routes\' own requireRoles includes CUS there and keeps every other financial surface (list, writes) denied to CUS.',
    source: 'no ruling citation in pre-refactor code',
  },
  {
    resource: 'trips',
    methods: ['POST'],
    pathPattern: /^\/\d+\/complete-external\/?$/,
    roles: [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS],
    effect: 'exclusive',
    reason:
      'Staff close for external-carrier trips (feedback 2026-09-08): the external driver has no app session, so dispatch/CUS complete on the driver\'s behalf. Distinct allowlist from the governed close-maker branch below — no evidence gate can ever apply to these trips.',
    source: 'feedback 2026-09-08',
  },
  {
    resource: 'trips',
    methods: ['POST'],
    pathPattern: /^\/\d+\/complete\/?$/,
    roles: [Role.ACCOUNTANT, Role.CUS],
    effect: 'exclusive',
    reason:
      'Governed close-maker command required by the O2C PRD: only the CUS close-maker command is exposed on the trip surface; all other CUS trip operations remain denied.',
    source: 'O2C PRD (tripRouteAuthz doc comment)',
  },
];

function matchesRequestSurface(
  rule: RouteGrantRule,
  resource: string,
  method: string,
  path: string,
): boolean {
  return rule.resource === resource
    && (rule.methods === ANY_METHOD || rule.methods.includes(method))
    && rule.pathPattern.test(path);
}

/**
 * First bypass grant whose surface (resource + method + path) and role list
 * cover the request, or undefined. Rules that match the surface but not the
 * role are skipped — same fall-through as the pre-refactor if-chain, so the
 * casbin policy still decides those requests.
 */
export function matchRouteBypassGrant(
  resource: string,
  method: string,
  path: string,
  role: Role,
): RouteGrantRule | undefined {
  return ROUTE_GRANT_RULES.find((rule) => rule.effect === 'bypass'
    && matchesRequestSurface(rule, resource, method, path)
    && rule.roles.includes(role));
}

/**
 * First exclusive grant covering the request surface, or undefined. The role
 * is deliberately not part of the match: when this returns a rule, the role
 * list IS the decision — in-list roles are allowed, everyone else is denied
 * without consulting casbin.
 */
export function matchExclusiveRouteGrant(
  resource: string,
  method: string,
  path: string,
): RouteGrantRule | undefined {
  return ROUTE_GRANT_RULES.find((rule) => rule.effect === 'exclusive'
    && matchesRequestSurface(rule, resource, method, path));
}
