import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz, tripRouteAuthz } from '../middleware/casbin';
import {
  ROUTE_GRANT_RULES,
  matchExclusiveRouteGrant,
  matchRouteBypassGrant,
} from '../middleware/authz-grants';

/**
 * Equivalence matrix for the route-scoped grant registry (card 20260930_228).
 *
 * The PRE-REFACTOR ORACLE below is a verbatim port of the ten
 * hasRouteScopedRoleAllowance if-blocks and the two tripRouteAuthz allowlists
 * as they stood in backend/src/middleware/casbin.ts at commit e6d6be87 (the
 * refactor's base). Do NOT "fix", modernize, or deduplicate anything in the
 * oracle — its only job is to freeze the old decisions so any semantic drift
 * in the registry (pattern, role set, method set, or resource scoping) fails
 * a matrix cell. If a ruling legitimately changes a grant, change the registry
 * row AND the matching oracle block in the same commit, and say why.
 */

const ALL_ROLES = Object.values(Role);
const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

// ---------------------------------------------------------------------------
// PRE-REFACTOR ORACLE — casbin.ts hasRouteScopedRoleAllowance @ e6d6be87.
// req.{user.role,method,path} replaced by parameters; everything else verbatim.
// ---------------------------------------------------------------------------
function oldHasRouteScopedRoleAllowance(
  resource: string,
  role: string | undefined,
  method: string,
  path: string,
): boolean {
  if (!role) return false;
  if (
    resource === 'shipments'
    && role === Role.OPS
    && method === 'POST'
    && /^\/\d+\/recovery-facts\/?$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'shipments'
    && [Role.CUS, Role.DISPATCHER].includes(role as Role)
    && method === 'DELETE'
    && /^\/\d+\/declarations\/\d+$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(role as Role)
    && method === 'POST'
    && /^\/routes\/?$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(role as Role)
    && method === 'POST'
    && /^\/customers\/?$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(role as Role)
    && method === 'POST'
    && /^\/ports\/?$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'config'
    && role === Role.CUS
    && method === 'GET'
    && /^\/(customers|routes)(\/|\?|$)/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(role as Role)
    && (method === 'PUT' || method === 'DELETE')
    && /^\/(customers|routes)\/\d+\/?$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'config'
    && role === Role.DISPATCHER
    && (method === 'POST' || method === 'PUT' || method === 'DELETE')
    && /^\/(trucks|drivers|suppliers)(\/\d+)?\/?$/.test(path)
  ) {
    return true;
  }
  // Verbatim: this block checked NO method — every verb matches.
  if (
    resource === 'config'
    && role === Role.CUS
    && /^\/fuel-price-periods(\/\d+)?\/?$/.test(path)
  ) {
    return true;
  }
  // Card 20261001_253 (ruling change, same-commit oracle update per this
  // file's rule): the config gate evaluates /api/finance paths FIRST (mount
  // order), so the debit-note grant mirrors at the config resource. Before
  // this ruling the mirror was absent — the grant was dead in the live mount
  // chain and CUS could not read its own issued note (the 41/42 staging cell).
  if (
    resource === 'config'
    && role === Role.CUS
    && method === 'GET'
    && /^\/finance\/billing-documents\/\d+(\/export)?$/.test(path)
  ) {
    return true;
  }
  // Card 20261002_220 (ruling change, same-commit oracle update per this
  // file's rule): PM ruled 2026-10-03 that CUS may read the quotation fee
  // catalog. Before this ruling the row was absent and CUS was denied the
  // active-fee GET, so the Chi-hộ dedicated cost columns had no source.
  if (
    resource === 'config'
    && role === Role.CUS
    && method === 'GET'
    && /^\/quotations\/fees\/active\/?$/.test(path)
  ) {
    return true;
  }
  // QA B-1 (ruling change, same-commit oracle update per this file's rule):
  // CUS must read the vehicle-size-class catalog to pick the billing class
  // in the FB-093 revenue-merge dialog. Before this ruling the row was
  // absent and the dialog's dropdown died 403, blocking the merge for CUS.
  if (
    resource === 'config'
    && role === Role.CUS
    && method === 'GET'
    && /^\/vehicle-size-classes\/?$/.test(path)
  ) {
    return true;
  }
  if (
    resource === 'financial'
    && role === Role.CUS
    && method === 'GET'
    && /^\/finance\/billing-documents\/\d+(\/export)?$/.test(path)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// PRE-REFACTOR ORACLE — the two tripRouteAuthz allowlists @ e6d6be87.
// 'allow' = next() without casbin; 'deny' = hard 403 without casbin;
// 'passthrough' = delegate to casbinAuthz('trips').
// ---------------------------------------------------------------------------
function oldTripAllowance(
  role: string | undefined,
  method: string,
  path: string,
): 'allow' | 'deny' | 'passthrough' {
  const isExternalClose = method === 'POST'
    && /^\/\d+\/complete-external\/?$/.test(path);
  if (isExternalClose) {
    const staffCloseRoles = [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS];
    if (role && staffCloseRoles.includes(role as Role)) {
      return 'allow';
    }
    return 'deny';
  }
  const isCloseRequest = method === 'POST'
    && /^\/\d+\/complete\/?$/.test(path);
  if (isCloseRequest) {
    // SIL-694 (id 806): the exclusive row admits the TRIP_FINANCIAL_CLOSE
    // close-maker set (governance-policy createRoles) — the pre-MC-4
    // ACCOUNTANT/CUS list hard-403d ADMIN/MANAGER, the roles the trips
    // screen shows the close button to.
    const closeMakerRoles = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS];
    if (role && closeMakerRoles.includes(role as Role)) {
      return 'allow';
    }
    return 'deny';
  }
  return 'passthrough';
}

// ---------------------------------------------------------------------------
// Middleware harness — same shape as dispatcher-catalog-create-authz.test.ts.
// ---------------------------------------------------------------------------
function request(role: Role | undefined, method: string, path: string): Request {
  return {
    method,
    path,
    ...(role
      ? {
        user: {
          userId: 1,
          username: 'authz-grant-registry',
          email: null,
          fullName: 'Authz Grant Registry',
          role,
        },
      }
      : {}),
  } as Request;
}

async function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => unknown,
  role: Role,
  method: string,
  path: string,
): Promise<{ nextCalled: boolean; statusCode: number }> {
  let nextCalled = false;
  let statusCode = 200;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  await middleware(
    request(role, method, path),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode };
}

function authorizeCasbin(resource: string, role: Role, method: string, path: string) {
  return runMiddleware(casbinAuthz(resource), role, method, path);
}

function authorizeTrip(role: Role, method: string, path: string) {
  return runMiddleware(tripRouteAuthz(), role, method, path);
}

// Path corpus per surface: exact matches the old regexes accepted, near-misses
// they must keep rejecting, and wildcard/trailing-slash/query edges.
const SHIPMENT_PATHS = [
  '/1/recovery-facts',
  '/1/recovery-facts/',
  '/4217/recovery-facts',
  '/1/recovery-facts//',
  '/1/recovery-facts/extra',
  '/1/declarations/5',
  '/1/declarations/5/',
  '/1/declarations/abc',
  '/1/declarations',
  '/declarations/5',
  '/1',
  '/',
] as const;

const CONFIG_PATHS = [
  '/routes',
  '/routes/',
  '/customers',
  '/customers/',
  '/ports',
  '/ports/',
  '/ports/3',
  '/customers/7',
  '/customers/7/',
  '/routes/7',
  '/routes/7/',
  '/customers/7/contacts',
  '/customers/abc',
  '/trucks',
  '/trucks/3',
  '/trucks/3/',
  '/trucks/3/assigned-driver',
  '/drivers',
  '/drivers/4',
  '/suppliers',
  '/suppliers/5',
  '/suppliers/5/',
  '/fuel-price-periods',
  '/fuel-price-periods/',
  '/fuel-price-periods/9',
  '/fuel-price-periods/9/',
  '/fuel-price-periods/x',
  '/fuel-price-periods/9/export',
  // Card 20261002_220 — the granted active-fee read, plus the near-miss
  // shapes that must stay denied.
  '/quotations/fees/active',
  '/quotations/fees/active/',
  '/quotations/fees/active/9',
  '/quotations/fees/archived',
  '/quotations/fees/active/export',
  '/pricing-tables',
  '/expense-categories',
  // QA B-1 — the granted vehicle-size-class list read, plus the near-miss
  // shapes that must stay denied (detail row, deeper paths, prefix family).
  '/vehicle-size-classes',
  '/vehicle-size-classes/',
  '/vehicle-size-classes/3',
  '/vehicle-size-classes/3/',
  '/vehicle-size-class',
  '/vehicle-size-classes/export',
  '/customers?include=archived',
  '/routes?q=',
] as const;

const FINANCIAL_PATHS = [
  '/finance/billing-documents/5',
  '/finance/billing-documents/5/',
  '/finance/billing-documents/5/export',
  '/finance/billing-documents/5/export/',
  '/finance/billing-documents/5/export/x',
  '/finance/billing-documents/x',
  '/finance/billing-documents',
  '/finance/billing-documents/',
  '/billing-documents/5',
  '/finance/other/5',
] as const;

const TRIP_PATHS = [
  '/42/complete',
  '/42/complete/',
  '/42/complete-external',
  '/42/complete-external/',
  '/42/complete-external/x',
  '/42/completed',
  '/42/cancel',
  '/42/expenses',
  '/42',
  '/',
] as const;

// Card 071026141580: 'trips' now carries ONE bypass row (wallet trip-expense
// mutations for OPS) — every other trips route is still casbin-only.
const BYPASS_RESOURCES = ['shipments', 'config', 'financial', 'trips'] as const;

describe('Route-scoped grant registry equivalence (card 20260930_228)', () => {
  before(async () => {
    await initEnforcer();
  });

  describe('registry integrity', () => {
    it('carries the ported bypass rows (ten + the 253 mirror + the 220 fee read + the 1580 wallet bridge) and two exclusive rows', () => {
      // Card 20261001_253 added one config-resource mirror of the financial
      // debit-note row: both bare-'/'api gates evaluate sequentially, so the
      // grant must be reachable at each gate the request actually passes.
      // Card 20261002_220 added one more bypass (CUS reads the active
      // quotation fee catalog) on the PM ruling of 2026-10-03.
      // Cards 351/352 (05/10, QA gap): one more bypass — the CUS delete-
      // request path (DELETE /cus-workspace/:id), the 2026-09-10 direct-CUS-
      // delete ruling that the casbin layer never had a row for.
      // Card 071026141580 ("fix all issues" 2026-10-07): one more bypass —
      // the wallet's trip-expense PUT/DELETE bridge for OPS (the payer edits/
      // deletes their own khai-chi-hô rows; casbin grants OPS trips read only).
      // QA B-1 (FB-093, staging 2026-10-16): one more bypass — CUS reads the
      // vehicle-size-class list for the revenue-merge dialog dropdown.
      // FB-086 R21 (171026175000, 2026-10-17): one more bypass — CUS reads
      // the container-type catalog list (the add-container dropdown starved
      // to its placeholder on a silent 403).
      // KB §1.2.1 (audit 24/11): kế toán no longer reaches /users — the
      // former /cus-groups bridge for ACCOUNTANT is gone (users surface is
      // policy.csv-only now: MANAGER rows + ADMIN wildcard).
      // SIL-970 (KB K10.37 §10.6.9): one more bypass — CUS chốt đợt như
      // Kế toán, the POST /debit-board/settlement-rounds bridge for CUS
      // (accounting stays read-only for CUS in policy.csv; the route guard
      // names CUS since 09541dd3, the mount-level gate was the 403).
      assert.equal(ROUTE_GRANT_RULES.length, 20);
      assert.equal(ROUTE_GRANT_RULES.filter((r) => r.effect === 'bypass').length, 18);
      assert.equal(ROUTE_GRANT_RULES.filter((r) => r.effect === 'exclusive').length, 2);
    });

    it('keeps every row fully documented and its pattern re-test-safe', () => {
      for (const rule of ROUTE_GRANT_RULES) {
        const label = `${rule.effect} ${rule.resource} ${String(rule.methods)} ${rule.pathPattern}`;
        assert.ok(rule.resource.length > 0, `${label}: resource`);
        assert.ok(rule.roles.length > 0, `${label}: roles`);
        assert.ok(rule.reason.length > 0, `${label}: reason`);
        assert.ok(rule.source.length > 0, `${label}: source`);
        assert.ok(rule.pathPattern instanceof RegExp, `${label}: pattern`);
        // A g/y flag would make repeated .test calls stateful — the registry
        // is consulted on every request, so flags must stay plain.
        assert.ok(!rule.pathPattern.global && !rule.pathPattern.sticky, `${label}: no g/y flags`);
      }
    });
  });

  describe('bypass matrix: registry decision === pre-refactor oracle', () => {
    it('agrees for every role × method × path × resource cell', () => {
      let cells = 0;
      let grants = 0;
      for (const resource of BYPASS_RESOURCES) {
        for (const path of [...SHIPMENT_PATHS, ...CONFIG_PATHS, ...FINANCIAL_PATHS, ...TRIP_PATHS]) {
          for (const method of ALL_METHODS) {
            for (const role of ALL_ROLES) {
              const oracle = oldHasRouteScopedRoleAllowance(resource, role, method, path);
              const grant = matchRouteBypassGrant(resource, method, path, role);
              assert.equal(
                grant !== undefined,
                oracle,
                `bypass drift: ${role} ${method} ${resource}${path}`,
              );
              cells += 1;
              if (oracle) grants += 1;
            }
          }
        }
      }
      // The matrix must be big enough to catch drift and actually exercise
      // grants; if either bound collapses the corpus lost a dimension.
      // Full corpus at port time: 10240 cells, 91 grants.
      assert.ok(cells >= 8 * ALL_METHODS.length * 4, `matrix too small: ${cells} cells`);
      assert.ok(grants >= 80, `grant cells collapsed: ${grants}`);
    });

    it('leaves requests without a user to the 401/normal path (oracle says no grant)', () => {
      for (const resource of BYPASS_RESOURCES) {
        for (const path of [...CONFIG_PATHS, ...TRIP_PATHS].slice(0, 5)) {
          assert.equal(
            oldHasRouteScopedRoleAllowance(resource, undefined, 'POST', path),
            false,
            `oracle must deny userless ${resource}${path}`,
          );
        }
      }
    });
  });

  describe('bypass wiring: casbinAuthz honors the registry end to end', () => {
    // Cells chosen so casbin independently DENIES (the role's policy rows, if
    // any, do not cover the probed action — e.g. OPS holds shipments read
    // since 141026230710 but the probed recovery-facts POST maps to write):
    // a next() here can only come from the grant layer, so the middleware
    // probes stay sharp on both sides of the refactor.
    const WIRING_CELLS: readonly {
      label: string;
      resource: string;
      role: Role;
      method: string;
      path: string;
    }[] = [
      { label: 'OPS records recovery facts', resource: 'shipments', role: Role.OPS, method: 'POST', path: '/1/recovery-facts' },
      { label: 'CUS removes a declaration row', resource: 'shipments', role: Role.CUS, method: 'DELETE', path: '/1/declarations/5' },
      { label: 'CUS creates a route inline', resource: 'config', role: Role.CUS, method: 'POST', path: '/routes' },
      { label: 'DISPATCHER creates a port inline', resource: 'config', role: Role.DISPATCHER, method: 'POST', path: '/ports' },
      { label: 'CUS reads the customer catalog', resource: 'config', role: Role.CUS, method: 'GET', path: '/customers' },
      { label: 'CUS reads the vehicle-size-class list (QA B-1)', resource: 'config', role: Role.CUS, method: 'GET', path: '/vehicle-size-classes' },
      { label: 'DRIVER cannot read vehicle-size-classes (CUS-only grant)', resource: 'config', role: Role.DRIVER, method: 'GET', path: '/vehicle-size-classes' },
      { label: 'CUS edits a customer identity field', resource: 'config', role: Role.CUS, method: 'PUT', path: '/customers/7' },
      { label: 'DISPATCHER deletes a supplier', resource: 'config', role: Role.DISPATCHER, method: 'DELETE', path: '/suppliers/5' },
      { label: 'CUS patches a fuel-price period (any-verb row)', resource: 'config', role: Role.CUS, method: 'PATCH', path: '/fuel-price-periods/9' },
      { label: 'CUS exports an issued debit note', resource: 'financial', role: Role.CUS, method: 'GET', path: '/finance/billing-documents/5/export' },
      { label: 'CUS cannot edit a port (POST-only grant)', resource: 'config', role: Role.CUS, method: 'PATCH', path: '/ports/3' },
      { label: 'OPS cannot ride the route-create grant', resource: 'config', role: Role.OPS, method: 'POST', path: '/routes' },
      { label: 'CUS cannot delete a billing document (GET-only grant)', resource: 'financial', role: Role.CUS, method: 'DELETE', path: '/finance/billing-documents/5' },
      { label: 'DRIVER cannot touch fuel-price periods (CUS-only grant)', resource: 'config', role: Role.DRIVER, method: 'POST', path: '/fuel-price-periods' },
    ];

    it('matches the oracle decision through the real middleware', async () => {
      for (const cell of WIRING_CELLS) {
        const oracle = oldHasRouteScopedRoleAllowance(cell.resource, cell.role, cell.method, cell.path);
        const outcome = await authorizeCasbin(cell.resource, cell.role, cell.method, cell.path);
        assert.deepEqual(
          outcome,
          oracle
            ? { nextCalled: true, statusCode: 200 }
            : { nextCalled: false, statusCode: 403 },
          `wiring drift (${cell.label}): ${cell.role} ${cell.method} ${cell.resource}${cell.path}`,
        );
      }
    });
  });

  describe('trip matrix: exclusive rows === pre-refactor allowlists', () => {
    it('classifies every role × method × path cell identically (pure layer)', () => {
      for (const path of TRIP_PATHS) {
        for (const method of ALL_METHODS) {
          for (const role of ALL_ROLES) {
            const oracle = oldTripAllowance(role, method, path);
            const grant = matchExclusiveRouteGrant('trips', method, path);
            const actual = grant === undefined
              ? 'passthrough'
              : grant.roles.includes(role)
                ? 'allow'
                : 'deny';
            assert.equal(
              actual,
              oracle,
              `exclusive drift: ${role} ${method} /api/trips${path}`,
            );
          }
        }
      }
    });

    it('matches the oracle decision through the real tripRouteAuthz middleware', async () => {
      const tripsCasbin = casbinAuthz('trips');
      for (const path of TRIP_PATHS) {
        for (const method of ALL_METHODS) {
          for (const role of ALL_ROLES) {
            const oracle = oldTripAllowance(role, method, path);
            const outcome = await authorizeTrip(role, method, path);
            if (oracle === 'allow') {
              assert.deepEqual(
                outcome,
                { nextCalled: true, statusCode: 200 },
                `trip wiring drift: ${role} ${method} /api/trips${path} must allow`,
              );
            } else if (oracle === 'deny') {
              assert.deepEqual(
                outcome,
                { nextCalled: false, statusCode: 403 },
                `trip wiring drift: ${role} ${method} /api/trips${path} must hard-deny`,
              );
            } else {
              // Passthrough: tripRouteAuthz must decide exactly what
              // casbinAuthz('trips') decides on the identical request.
              const casbinOutcome = await runMiddleware(tripsCasbin, role, method, path);
              assert.deepEqual(
                outcome,
                casbinOutcome,
                `trip passthrough drift: ${role} ${method} /api/trips${path}`,
              );
            }
          }
        }
      }
    });

    it('hard-denies DISPATCHER on the governed close even though casbin policy allows trips write (SIL-694)', async () => {
      // DISPATCHER holds `p, DISPATCHER, trips, write` in policy.csv — only
      // the exclusive effect can produce this 403 (the governed close is a
      // management/accounting action, never a dispatch one). If this ever
      // turns into a next() passthrough, the exclusive semantics silently
      // degraded into a plain bypass.
      assert.deepEqual(await authorizeTrip(Role.DISPATCHER, 'POST', '/42/complete'), {
        nextCalled: false,
        statusCode: 403,
      });
    });
  });
});

describe('Cus-groups surface after KB §1.2.1 (audit 24/11)', () => {
  // KB §1.2.1 (bản chốt 24/11 supersedes the 2026-11-19 ruling): "vai Kế toán
  // mở màn quản lý người dùng bị chặn". The accountant bridge + the
  // `p, ACCOUNTANT, users, read` policy row are gone, so /cus-groups falls
  // through to plain casbin for ACCOUNTANT — every verb (read AND write) is
  // denied; MANAGER keeps its policy rows and ADMIN its wildcard.
  it('bridges nothing for ACCOUNTANT — read and write both fall to casbin', () => {
    assert.equal(matchRouteBypassGrant('users', 'GET', '/cus-groups', Role.ACCOUNTANT), undefined);
    assert.equal(matchRouteBypassGrant('users', 'POST', '/cus-groups', Role.ACCOUNTANT), undefined);
    assert.equal(matchRouteBypassGrant('users', 'PUT', '/cus-groups/7', Role.ACCOUNTANT), undefined);
    assert.equal(matchRouteBypassGrant('users', 'PUT', '/cus-groups/7/members', Role.ACCOUNTANT), undefined);
    // general users surface stays closed for accountant
    assert.equal(matchRouteBypassGrant('users', 'POST', '/users', Role.ACCOUNTANT), undefined);
    assert.equal(matchRouteBypassGrant('users', 'PATCH', '/users/7', Role.ACCOUNTANT), undefined);
    assert.equal(matchRouteBypassGrant('users', 'DELETE', '/users/7', Role.ACCOUNTANT), undefined);
    // other roles fall through to casbin (MANAGER policy rows, ADMIN wildcard)
    assert.equal(matchRouteBypassGrant('users', 'POST', '/cus-groups', Role.MANAGER), undefined);
    assert.equal(matchRouteBypassGrant('users', 'POST', '/cus-groups', Role.ADMIN), undefined);
    assert.equal(matchRouteBypassGrant('users', 'POST', '/cus-groups', Role.DISPATCHER), undefined);
    assert.equal(matchRouteBypassGrant('users', 'POST', '/cus-groups', Role.CUS), undefined);
  });
});

describe('CUS delete-request bridge (cards 351/352)', () => {
  // QA-discovered gap (05/10 staging rung): the Xóa lô flow is the CUS
  // DIRECT delete (2026-09-10 user directive — requestShipmentDelete removed
  // the approval flow), and the route's own requireRoles(Role.CUS) admits the
  // CUS user — but the mount-level casbinAuthz('shipments') has no DELETE
  // policy for this path, so every confirm tap died with 403 "Không có quyền
  // truy cập". The house pattern for exactly this situation is a path-scoped
  // bypass bridge (declarations 20260921_3, operational-sites 20261002_263):
  // the route keeps the role set, the bridge opens only this path, general
  // shipment delete stays closed.
  it('bridges DELETE /cus-workspace/:id for CUS only (SIL-706 owner confirmation 07/11 revokes DISPATCHER)', () => {
    assert.ok(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/313', Role.CUS));
    // SIL-706: DISPATCHER revoked — does NOT match bypass grant
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/313', Role.DISPATCHER), undefined);
    // patterns are strict (no trailing-slash normalization in the matcher)
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/313/', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/313/', Role.DISPATCHER), undefined);
    // ADMIN passes the general casbin policy, not this bridge; OPS stays refused.
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/313', Role.ADMIN), undefined);
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/313', Role.OPS), undefined);
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/cus-workspace/abc', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('shipments', 'POST', '/cus-workspace/313', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('shipments', 'DELETE', '/313', Role.CUS), undefined);
  });
});

describe('Settlement-round Chọn Debit bridge (SIL-970)', () => {
  // KB K10.37 §10.6.9 — "Khi lô đã đủ chi phí, Chứng từ bấm [Khóa lô] và
  // [Chọn Debit] như Kế toán": [Chốt đợt] IS POST /debit-board/settlement-
  // rounds. The route guard names CUS (SETTLEMENT_ROUND_ROLES, 09541dd3) but
  // the mount-level casbinAuthz('accounting') gate runs first and CUS holds
  // only the accounting READ policy row, so the live repro (25/11 06:53) died
  // 403 "Không có quyền truy cập" before the route. With the real policy
  // loaded, a next() on this path can only come from the bridge — CUS has no
  // accounting write row — so the middleware probes stay sharp on both sides.
  before(async () => {
    await initEnforcer();
  });

  it('passes CUS through the accounting gate into POST /debit-board/settlement-rounds (the 403 repro)', async () => {
    assert.deepEqual(
      await authorizeCasbin('accounting', Role.CUS, 'POST', '/debit-board/settlement-rounds'),
      { nextCalled: true, statusCode: 200 },
      'CUS must clear casbin to reach the settlement-round route',
    );
  });

  it('opens exactly that surface — the grant is POST /debit-board/settlement-rounds for CUS only', () => {
    assert.ok(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds/', Role.CUS));
    // near-miss shapes the strict pattern must keep rejecting
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds/9', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds/abc', Role.CUS), undefined);
    // the write grant is POST-only; GET rides the CUS accounting READ row
    assert.equal(matchRouteBypassGrant('accounting', 'GET', '/debit-board/settlement-rounds', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'PUT', '/debit-board/settlement-rounds', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'DELETE', '/debit-board/settlement-rounds', Role.CUS), undefined);
    // other roles ride their own policy rows, never this bridge
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds', Role.MANAGER), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds', Role.ACCOUNTANT), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds', Role.ADMIN), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds', Role.DISPATCHER), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/settlement-rounds', Role.OPS), undefined);
    // the debit-note chain is not part of this grant
    assert.equal(matchRouteBypassGrant('accounting', 'GET', '/debit-board/settlement-rounds/9/debit-note-preview', Role.CUS), undefined);
    assert.equal(matchRouteBypassGrant('accounting', 'POST', '/debit-board/rate-adjustments/confirm', Role.CUS), undefined);
  });

  it('keeps CUS 403 on the sibling accounting write through the real middleware', async () => {
    assert.deepEqual(
      await authorizeCasbin('accounting', Role.CUS, 'POST', '/debit-board/rate-adjustments/confirm'),
      { nextCalled: false, statusCode: 403 },
    );
  });

  it('keeps the settlement-round list read on the CUS accounting read row (no bridge involved)', async () => {
    assert.deepEqual(
      await authorizeCasbin('accounting', Role.CUS, 'GET', '/debit-board/settlement-rounds'),
      { nextCalled: true, statusCode: 200 },
    );
  });

  it('still refuses roles without any accounting policy on the bridged path', async () => {
    assert.deepEqual(
      await authorizeCasbin('accounting', Role.DISPATCHER, 'POST', '/debit-board/settlement-rounds'),
      { nextCalled: false, statusCode: 403 },
    );
    assert.deepEqual(
      await authorizeCasbin('accounting', Role.OPS, 'POST', '/debit-board/settlement-rounds'),
      { nextCalled: false, statusCode: 403 },
    );
  });
});
