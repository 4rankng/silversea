import type { Request, RequestHandler } from 'express';
import { ApiError } from '../errors';
import {
  IDEMPOTENCY_ENDPOINTS,
  resolveIdempotencyKey,
} from '../services/idempotency.service';

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface MaterialWriteRule {
  method: HttpMethod;
  endpoint: string;
  canonicalAliases?: readonly string[];
  pattern: RegExp;
}

function escapeRegexPath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Dead rows pruned 2026-09-30 (card 20260930_230): the six salary-periods
// governance-action rows (exclusion/close/reopen -actions check|approve) had
// no mounts anywhere in src/routes — relics of the approval-workflow removal.
// Approval-flow relics pruned 2026-09-30 (card 20260930_230 sweep): the
// ops/advance/governance approve-reject rows, the salary -actions family, the
// trips lock transition, shipment accounting-lock activation, delete-request
// decisions, truck restore, gps backfill/recapture and fuel-invoice approval
// had no mounts left in src/routes (constants exempted in the completeness
// test with reasons).
const MATERIAL_WRITE_RULES: readonly MaterialWriteRule[] = [
  // Card 20260928_166 AC1 — the 39-truck split. The batch route shipped without
  // this declaration: runShipmentWrite's audit persist found no declared
  // material-write endpoint and every real request 500'd while the
  // service-level suite (which skips the router) stayed green.
  // Card 20260921_21/19/8+13 governance rider: the ten financial-write
  // routes wrapped in runIdempotent (see the accounting routes).
  // Card 20260923_12 — Chọn Debit settlement rounds (đợt chốt) — one more
  // financial write in the runIdempotent family.
  // Card 20260922_57 quotation xlsx import commit — the route already demanded
  // an Idempotency-Key; the durable boundary makes the key real (replays
  // return the stored response instead of always creating a new frame).
  // Ops field-operations portal (OpsVanHanh) — financial cash commands run
  // runIdempotent in routes/ops.ts with these durable endpoints.
  // Card 20260922_66/_61: quotation writes are governed (runIdempotent) —
  // declared here so the envelope 400s a key-less write with the VN message
  // instead of the audit guard's raw 500 "Material write audit context is
  // incomplete" (QA staging finding 2026-09-23). Endpoint strings MUST equal
  // the routes' runIdempotent endpoint values.
];

const DECLARED_MATERIAL_WRITE_ENDPOINTS = new Set(
  MATERIAL_WRITE_RULES.flatMap((rule) => [rule.endpoint, ...(rule.canonicalAliases ?? [])]),
);

export function listDeclaredMaterialWriteEndpoints(): string[] {
  const endpoints = new Set<string>(DECLARED_MATERIAL_WRITE_ENDPOINTS);
  for (const rule of generatedRules) {
    endpoints.add(rule.endpoint);
    for (const alias of rule.canonicalAliases ?? []) endpoints.add(alias);
  }
  return [...endpoints].sort();
}

export interface MaterialWriteMatch {
  endpoint: string;
  canonicalAliases?: readonly string[];
  method: HttpMethod;
  path: string;
}

export function matchDeclaredMaterialWrite(
  method: string,
  rawPath: string,
): MaterialWriteMatch | null {
  const rawPathWithoutQuery = rawPath.split('?')[0];
  const path = rawPathWithoutQuery.length > 1
    ? rawPathWithoutQuery.replace(/\/+$/, '')
    : rawPathWithoutQuery;
  const upperMethod = method.toUpperCase() as HttpMethod;
  const rule = allRules().find((candidate) => (
    candidate.method === upperMethod && candidate.pattern.test(path)
  ));
  return rule ? { endpoint: rule.endpoint, method: rule.method, path, ...(rule.canonicalAliases ? { canonicalAliases: rule.canonicalAliases } : {}) } : null;
}

export function getMaterialWriteContext(req: Request): {
  endpoint: string;
  idempotencyKey: string;
} | null {
  const match = matchDeclaredMaterialWrite(req.method, req.originalUrl || req.url || '');
  if (!match) return null;
  const body = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: body?._requestId,
  });
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này.');
  }
  return {
    endpoint: match.endpoint,
    idempotencyKey,
  };
}

// ── Self-declared material writes ────────────────────────────────────────────
// The registry above is hand-copied from the route files: a mount that ships
// without its row here answers 500 on every live call while service-level
// suites stay green (card 20260928_166). The declaration instead travels with
// the mount and is self-contained — express 5 router layers expose a route's
// own path but NOT the mount prefix a router was mounted under, so
// `declareMaterialWrite('endpoint.label', { path: '/api/things/:id/seal' })`
// carries the full request path (`:param` segments allowed) beside the handler
// it labels, and registers its registry rule at import time. No walk is
// needed for matching; installGeneratedMaterialWriteRules(app) walks only to
// ASSERT coverage: a mounted write route with no declaration and no bridge
// fails boot — the ship-without-declaration class becomes a boot failure
// instead of a 500 on the first live call. During the migration,
// `router.use(legacyMaterialWriteRegistry())` bridges a router whose rows
// still live in the hand-written registry above (their existence stays proven
// by the registry tests until the family migrates); the flag dies with the
// family's rows in the same commit.

const WRITE_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

interface WriteDeclaration {
  endpoint?: string;
  nonMaterialReason?: string;
}

const WRITE_DECLARATION = Symbol('materialWriteDeclaration');
const LEGACY_REGISTRY = Symbol('materialWriteLegacyRegistry');

type DeclaredHandler = RequestHandler & {
  [WRITE_DECLARATION]?: WriteDeclaration;
  [LEGACY_REGISTRY]?: boolean;
};

/** Rules generated from mount-site declarations. Additive to the static registry above. */
const generatedRules: MaterialWriteRule[] = [];

function allRules(): readonly MaterialWriteRule[] {
  return [...MATERIAL_WRITE_RULES, ...generatedRules];
}

/** `:param` segments match one path segment; literal segments are escaped — the registry's own encoding. */
function expressPathToPattern(fullPath: string): RegExp {
  const segments = fullPath.split('/').filter((segment) => segment.length > 0);
  const body = segments
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : escapeRegexPath(segment)))
    .join('/');
  return new RegExp(`^/${body}$`);
}

/**
 * Declare a mounted route a material write, with the audit endpoint label the
 * registry must carry. The endpoint MUST equal the route's runIdempotent
 * endpoint (where the route runs one) — the audit record joins on it. `method`
 * and `path` are explicit because express 5 exposes neither the route's HTTP
 * verb nor its mount prefix to middleware; `path` is the FULL request path
 * (mount prefix included, `:param` segments allowed). The registry rule is
 * registered here, at route-module import time.
 */
export function declareMaterialWrite(
  endpoint: string,
  options: { method: HttpMethod; path: string; canonicalAliases?: readonly string[] },
): RequestHandler {
  const { method, path, canonicalAliases } = options;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new Error(`declareMaterialWrite: endpoint must be a non-empty string, got ${JSON.stringify(endpoint)}`);
  }
  if (!WRITE_METHODS.has(method)) {
    throw new Error(`declareMaterialWrite('${endpoint}'): method must be one of POST/PUT/PATCH/DELETE, got ${JSON.stringify(method)}`);
  }
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw new Error(
      `declareMaterialWrite('${endpoint}'): path must be the FULL request path starting with /api/, got ${JSON.stringify(path)}`,
    );
  }
  const pattern = expressPathToPattern(path);
  if (!generatedRules.some((rule) => rule.method === method && rule.endpoint === endpoint && rule.pattern.source === pattern.source)) {
    generatedRules.push({
      method,
      endpoint,
      ...(canonicalAliases ? { canonicalAliases } : {}),
      pattern,
    });
  }
  const middleware: RequestHandler = (_req, _res, next) => { next(); };
  (middleware as DeclaredHandler)[WRITE_DECLARATION] = { endpoint };
  return middleware;
}

/**
 * Declare a mounted write route deliberately NON-material, with the reason.
 * Replaces the hand-maintained exemption list in the registry-exhaustive test:
 * the reviewed justification lives beside the mount it excuses.
 */
export function declareNonMaterialWrite(reason: string): RequestHandler {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error(`declareNonMaterialWrite: reason must be a non-empty string, got ${JSON.stringify(reason)}`);
  }
  const middleware: RequestHandler = (_req, _res, next) => { next(); };
  (middleware as DeclaredHandler)[WRITE_DECLARATION] = { nonMaterialReason: reason };
  return middleware;
}

/**
 * Migration bridge: `router.use(legacyMaterialWriteRegistry())` marks a router
 * whose material-write rows still live in the hand-written registry above.
 * Flagged routers pass the coverage walk; the registry tests keep proving the
 * rows exist. Delete the flag in the same commit that migrates the family's
 * rows to declareMaterialWrite markers.
 */
export function legacyMaterialWriteRegistry(): RequestHandler {
  const middleware: RequestHandler = (_req, _res, next) => { next(); };
  (middleware as DeclaredHandler)[LEGACY_REGISTRY] = true;
  return middleware;
}

// Minimal structural types for the express internals the walker reads: layers
// of a router's stack and the route a terminal layer carries. express exports
// no public types for these.
interface WalkerLayer {
  route?: {
    path: unknown;
    methods: Record<string, boolean>;
    stack?: { handle?: unknown }[];
  };
  handle?: unknown;
}

interface WalkerRouter {
  stack?: WalkerLayer[];
}

function isRouterLike(handle: unknown): handle is WalkerRouter {
  return typeof handle === 'function' && Array.isArray((handle as WalkerRouter).stack);
}

function declarationOf(route: NonNullable<WalkerLayer['route']>): WriteDeclaration | null {
  let found: WriteDeclaration | null = null;
  for (const layer of route.stack ?? []) {
    const declaration = (layer.handle as DeclaredHandler | undefined)?.[WRITE_DECLARATION];
    if (declaration) found = declaration;
  }
  return found;
}

function isLegacyBridged(router: WalkerRouter): boolean {
  return (router.stack ?? []).some(
    (layer) => (layer.handle as DeclaredHandler | undefined)?.[LEGACY_REGISTRY] === true,
  );
}

interface WalkedWriteRoute {
  method: HttpMethod;
  routePath: string;
  declared: boolean;
}

function walkWriteRoutes(stack: WalkerLayer[], legacyBridged: boolean, out: WalkedWriteRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of routePaths) {
        if (typeof routePath !== 'string') continue;
        for (const method of Object.keys(layer.route.methods)) {
          const upperMethod = method.toUpperCase() as HttpMethod;
          if (!WRITE_METHODS.has(upperMethod)) continue;
          const declaration = declarationOf(layer.route);
          out.push({
            method: upperMethod,
            routePath,
            declared: legacyBridged || declaration !== null,
          });
        }
      }
      continue;
    }
    if (isRouterLike(layer.handle)) {
      walkWriteRoutes(layer.handle.stack ?? [], legacyBridged || isLegacyBridged(layer.handle), out);
    }
  }
}

const installedApps = new WeakSet<object>();

/**
 * Walk a mounted express app and THROW when a write route declares nothing:
 * every mounted write route must carry a mount-site declaration
 * (declareMaterialWrite / declareNonMaterialWrite) or ride a router flagged
 * legacyMaterialWriteRegistry. Idempotent per app. index.ts calls this at
 * boot; the audit middleware installs lazily on the first request so per-file
 * test harnesses (which mount a subset of routers) get the same guarantee
 * without importing the application entry.
 */
export function installGeneratedMaterialWriteRules(app: unknown): void {
  if (app == null) return;
  if (installedApps.has(app)) return;
  installedApps.add(app);

  const appRouter = (app as WalkerRouter).stack
    ? (app as WalkerRouter)
    : (app as { router?: WalkerRouter }).router;
  if (!appRouter?.stack) return;

  const walked: WalkedWriteRoute[] = [];
  walkWriteRoutes(appRouter.stack, isLegacyBridged(appRouter), walked);

  const violations = walked
    .filter((route) => !route.declared)
    .map((route) => (
      `${route.method} (router path ${route.routePath}) is a mounted write route with no material-write declaration — ` +
      'add declareMaterialWrite(\'<endpoint>\', { path: \'/api/…\' }) beside the mount, ' +
      'declareNonMaterialWrite(\'<reason>\') if the write is deliberately non-material, ' +
      'or router.use(legacyMaterialWriteRegistry()) while the family still rides the hand-written registry'
    ));
  if (violations.length > 0) {
    throw new Error(
      `[material-write] ${violations.length} mounted write route(s) lack a declaration:\n  - ${violations.join('\n  - ')}`,
    );
  }
}
