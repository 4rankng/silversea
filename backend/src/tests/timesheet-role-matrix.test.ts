import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { TIMESHEET_GRID_EDITORS, TIMESHEET_MONTH_OPENERS } from '../routes/timesheet';

// SIL-862 — the /timesheet repro seat is hoangnh (role OPS 'Vận hành'): the
// grid authority must reach OPS at BOTH layers that used to deny it — the
// casbin resource enforced at mount (index.ts `casbinAuthz('timesheet')`) and
// the route-level role sets (month auto-init + grid writes). Kế toán keeps
// mode/adjustment/reconcile/reopen; DRIVER/CUS stay out entirely.

function request(role: Role, method: string): Request {
  return {
    method,
    // Probe paths only matter to the route-bypass registry: no `timesheet`
    // grant row exists today, so stay clear of any future path-scoped row.
    path: method === 'GET' ? '/months' : '/months/1/days',
    user: {
      userId: 3,
      username: 'hoangnh',
      email: null,
      fullName: 'Nguyễn Huy Hoàng',
      role,
    },
  } as Request;
}

async function authorize(role: Role, method: string): Promise<{ nextCalled: boolean; statusCode: number }> {
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
  await casbinAuthz('timesheet')(
    request(role, method),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode };
}

describe('SIL-862 timesheet role matrix', () => {
  before(async () => {
    await initEnforcer();
  });

  describe('casbin timesheet resource', () => {
    it('admits the Vận hành seat (OPS) read and write', async () => {
      assert.deepEqual(await authorize(Role.OPS, 'GET'), { nextCalled: true, statusCode: 200 });
      assert.deepEqual(await authorize(Role.OPS, 'PUT'), { nextCalled: true, statusCode: 200 });
      assert.deepEqual(await authorize(Role.OPS, 'POST'), { nextCalled: true, statusCode: 200 });
    });

    it('keeps the existing seats (DISPATCHER/ACCOUNTANT) and leadership', async () => {
      for (const role of [Role.DISPATCHER, Role.ACCOUNTANT, Role.MANAGER, Role.ADMIN]) {
        assert.deepEqual(await authorize(role, 'GET'), { nextCalled: true, statusCode: 200 }, role);
        assert.deepEqual(await authorize(role, 'PUT'), { nextCalled: true, statusCode: 200 }, role);
      }
    });

    it('keeps DRIVER and CUS out of the timesheet resource', async () => {
      for (const role of [Role.DRIVER, Role.CUS]) {
        assert.deepEqual(await authorize(role, 'GET'), { nextCalled: false, statusCode: 403 }, role);
        assert.deepEqual(await authorize(role, 'PUT'), { nextCalled: false, statusCode: 403 }, role);
      }
    });
  });

  describe('route-level role sets', () => {
    it('admits OPS to month auto-init and grid writes', () => {
      assert.ok(TIMESHEET_MONTH_OPENERS.includes(Role.OPS));
      assert.ok(TIMESHEET_GRID_EDITORS.includes(Role.OPS));
    });

    it('keeps ACCOUNTANT in month auto-init but out of grid writes', () => {
      assert.ok(TIMESHEET_MONTH_OPENERS.includes(Role.ACCOUNTANT));
      assert.ok(!TIMESHEET_GRID_EDITORS.includes(Role.ACCOUNTANT));
    });

    it('keeps DRIVER and CUS out of both sets', () => {
      for (const role of [Role.DRIVER, Role.CUS]) {
        assert.ok(!TIMESHEET_MONTH_OPENERS.includes(role), role);
        assert.ok(!TIMESHEET_GRID_EDITORS.includes(role), role);
      }
    });
  });
});
