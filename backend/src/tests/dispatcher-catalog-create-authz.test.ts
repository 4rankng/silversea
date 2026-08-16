import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { requireRoles } from '../middleware/casbin';

function request(role: Role, method: string, path: string): Request {
  return {
    method,
    path,
    user: {
      userId: 1,
      username: 'dispatch-catalog-authz',
      email: null,
      fullName: 'Dispatcher Catalog Authz',
      role,
    },
  } as Request;
}

async function authorize(role: Role, method: string, path: string, resource = 'config') {
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
  await casbinAuthz(resource)(
    request(role, method, path),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode };
}

function checkCreateRoles(role: Role) {
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
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.DISPATCHER)(
    request(role, 'POST', '/trucks'),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode };
}

describe('Dispatcher resource-catalog create authorization', () => {
  before(async () => {
    await initEnforcer();
  });

  describe('Casbin config gate', () => {
    it('lets DISPATCHER create trucks, drivers, and suppliers', async () => {
      for (const path of ['/trucks', '/drivers', '/suppliers']) {
        assert.deepEqual(await authorize(Role.DISPATCHER, 'POST', path), {
          nextCalled: true,
          statusCode: 200,
        }, path);
      }
    });

    it('keeps DISPATCHER mutations closed everywhere else', async () => {
      // Same three tables — update/delete are not route-scoped allowances.
      for (const [method, path] of [
        ['PUT', '/trucks'],
        ['DELETE', '/trucks'],
        ['PUT', '/drivers'],
        ['DELETE', '/drivers'],
        ['PUT', '/suppliers'],
        ['DELETE', '/suppliers'],
      ] as const) {
        assert.deepEqual(await authorize(Role.DISPATCHER, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `${method} ${path}`);
      }
      // Other config catalogs stay fully read-only for DISPATCHER.
      for (const [method, path] of [
        ['POST', '/customers'],
        ['POST', '/routes'],
        ['POST', '/pricing-tables'],
        ['POST', '/expense-categories'],
      ] as const) {
        assert.deepEqual(await authorize(Role.DISPATCHER, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `${method} ${path}`);
      }
    });

    it('keeps read access unchanged for DISPATCHER', async () => {
      assert.deepEqual(await authorize(Role.DISPATCHER, 'GET', '/trucks'), {
        nextCalled: true,
        statusCode: 200,
      });
    });

    it('does not leak the allowance to other roles', async () => {
      for (const role of [Role.DRIVER, Role.OPS, Role.CUSTOMER, Role.CUS]) {
        assert.deepEqual(await authorize(role, 'POST', '/trucks'), {
          nextCalled: false,
          statusCode: 403,
        }, role);
      }
    });

    it('leaves MANAGER/ACCOUNTANT config writes exactly as before', async () => {
      assert.deepEqual(await authorize(Role.MANAGER, 'POST', '/routes'), {
        nextCalled: true,
        statusCode: 200,
      });
      assert.deepEqual(await authorize(Role.ACCOUNTANT, 'PUT', '/trucks'), {
        nextCalled: true,
        statusCode: 200,
      });
    });
  });

  describe('crud-factory createRoles gate', () => {
    it('admits DISPATCHER alongside the config write roles', () => {
      assert.deepEqual(checkCreateRoles(Role.DISPATCHER), { nextCalled: true, statusCode: 200 });
      assert.deepEqual(checkCreateRoles(Role.MANAGER), { nextCalled: true, statusCode: 200 });
      assert.deepEqual(checkCreateRoles(Role.ADMIN), { nextCalled: true, statusCode: 200 });
    });

    it('rejects roles outside createRoles', () => {
      assert.deepEqual(checkCreateRoles(Role.DRIVER), { nextCalled: false, statusCode: 403 });
      assert.deepEqual(checkCreateRoles(Role.CUS), { nextCalled: false, statusCode: 403 });
    });
  });
});
