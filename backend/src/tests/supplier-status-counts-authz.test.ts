/**
 * Card 071026141610 — the directory KPI/stat cards read "Không thể tải số liệu".
 *
 * Root cause: /suppliers/status-counts is gated `requireRoles(ADMIN, MANAGER,
 * DISPATCHER, CUS)` — ACCOUNTANT is missing, while the nav deliberately gives
 * the ACCOUNTANT branch BOTH /customers and /suppliers (Layout.tsx, the
 * `case 'ACCOUNTANT'` block). So an accountant loads the directory fine and gets
 * a 403 on the counts endpoint, and the KPI cards fall back to their error hint.
 *
 * Reproduced against local: ACCOUNTANT -> 200 on GET /api/suppliers (list) but
 * 403 {"error":"Không có quyền truy cập"} on GET /api/suppliers/status-counts.
 *
 * This test pins BOTH gates that stand in front of the endpoint:
 *   1. casbinAuthz('config') — the outer middleware on the whole config router
 *   2. requireRoles(...)     — the per-route guard
 * An accountant must clear both; an unrelated role must still be refused.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz, requireRoles } from '../middleware/casbin';

const STATUS_COUNTS_ROUTE_ROLES = [
  Role.ADMIN,
  Role.MANAGER,
  Role.ACCOUNTANT,
  Role.DISPATCHER,
  Role.CUS,
] as const;

function request(role: Role, method: string, path: string): Request {
  return {
    method,
    path,
    user: {
      userId: 1,
      username: 'status-counts-authz',
      email: null,
      fullName: 'Status Counts Authz',
      role,
    },
  } as Request;
}

function fakeResponse() {
  const state = { statusCode: 200 };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  return { response, state };
}

/** Casbin's `config` gate, the one mounted at index.ts on the whole router. */
async function casbinAllows(role: Role, method: string, path: string) {
  let nextCalled = false;
  const { response, state } = fakeResponse();
  await casbinAuthz('config')(
    request(role, method, path),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode: state.statusCode };
}

/** The per-route guard on /suppliers/status-counts. */
async function routeAllows(role: Role) {
  let nextCalled = false;
  const { response, state } = fakeResponse();
  requireRoles(...STATUS_COUNTS_ROUTE_ROLES)(
    request(role, 'GET', '/suppliers/status-counts'),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode: state.statusCode };
}

describe('GET /suppliers/status-counts authorization (card 071026141610)', () => {
  before(async () => {
    await initEnforcer();
  });

  it('lets ACCOUNTANT through the casbin config gate', async () => {
    assert.deepEqual(await casbinAllows(Role.ACCOUNTANT, 'GET', '/suppliers/status-counts'), {
      nextCalled: true,
      statusCode: 200,
    });
  });

  it('lets ACCOUNTANT through the per-route guard (regression pin: this was the 403)', async () => {
    assert.deepEqual(await routeAllows(Role.ACCOUNTANT), {
      nextCalled: true,
      statusCode: 200,
    });
  });

  it('keeps the accountant reachable end-to-end through both gates', async () => {
    const casbin = await casbinAllows(Role.ACCOUNTANT, 'GET', '/suppliers/status-counts');
    const route = await routeAllows(Role.ACCOUNTANT);
    assert.ok(casbin.nextCalled, 'casbin config gate must admit ACCOUNTANT');
    assert.ok(route.nextCalled, 'route guard must admit ACCOUNTANT');
  });

  it('still admits every role the directory already served', async () => {
    for (const role of [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS]) {
      assert.deepEqual(await routeAllows(role), { nextCalled: true, statusCode: 200 }, role);
    }
  });

  it('still refuses roles with no directory access at all', async () => {
    for (const role of [Role.DRIVER, Role.OPS, Role.CUSTOMER]) {
      const result = await routeAllows(role);
      assert.equal(result.nextCalled, false, role);
      assert.equal(result.statusCode, 403, role);
    }
  });
});