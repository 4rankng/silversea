import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { tripRouteAuthz } from '../middleware/casbin';

function request(role: Role, method: string, path: string): Request {
  return {
    method,
    path,
    user: {
      userId: 1,
      username: 'o2c-authz',
      email: null,
      fullName: 'O2C Authz',
      role,
    },
  } as Request;
}

async function authorize(role: Role, method: string, path: string) {
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
  await tripRouteAuthz()(
    request(role, method, path),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode };
}

describe('O2C trip close HTTP authorization', () => {
  before(async () => {
    await initEnforcer();
  });

  it('allows CUS only to create the close request', async () => {
    assert.deepEqual(await authorize(Role.CUS, 'POST', '/42/complete'), {
      nextCalled: true,
      statusCode: 200,
    });
    assert.deepEqual(await authorize(Role.ACCOUNTANT, 'POST', '/42/complete'), {
      nextCalled: true,
      statusCode: 200,
    });
    assert.deepEqual(await authorize(Role.CUS, 'PATCH', '/42'), {
      nextCalled: false,
      statusCode: 403,
    });
    assert.deepEqual(await authorize(Role.CUS, 'POST', '/42/cancel'), {
      nextCalled: false,
      statusCode: 403,
    });
  });

  it('keeps non-maker roles outside the close-maker boundary', async () => {
    for (const role of [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.DRIVER, Role.OPS]) {
      assert.deepEqual(await authorize(role, 'POST', '/42/complete'), {
        nextCalled: false,
        statusCode: 403,
      });
    }
  });
});
