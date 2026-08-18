/**
 * RBAC for the DISPATCHER resource-catalog read grant. Dispatchers staff
 * dispatch plans and need to look up trucks, drivers, and subcontractors,
 * which all live behind the `config` Casbin resource — but catalog mutation
 * must stay closed to MANAGER/ACCOUNTANT/ADMIN. Asserts the grant is
 * read-shaped exactly, and that neighboring roles are unaffected.
 *
 * Loads the real model.conf + policy.csv into a throwaway enforcer so the
 * assertion reflects the shipped policy exactly (no running server needed).
 * Mirrors shipment-rbac.test.ts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newEnforcer, type Enforcer } from 'casbin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(__dirname, '../../casbin/model.conf');
const policyPath = path.resolve(__dirname, '../../casbin/policy.csv');

let enforcerPromise: Promise<Enforcer> | null = null;
const enforcer = () => (enforcerPromise ??= newEnforcer(modelPath, policyPath));

describe('DISPATCHER resource-catalog RBAC (read-only config)', () => {
  test('DISPATCHER can read config catalogs (trucks/drivers/suppliers)', async () => {
    assert.equal(await (await enforcer()).enforce('DISPATCHER', 'config', 'read'), true);
  });
  test('DISPATCHER cannot write config catalogs', async () => {
    assert.equal(await (await enforcer()).enforce('DISPATCHER', 'config', 'write'), false);
  });
  test('DISPATCHER cannot delete config catalogs', async () => {
    assert.equal(await (await enforcer()).enforce('DISPATCHER', 'config', 'delete'), false);
  });
  test('DISPATCHER still cannot read financial (payables on suppliers)', async () => {
    assert.equal(await (await enforcer()).enforce('DISPATCHER', 'financial', 'read'), false);
  });
});

describe('Neighboring roles unchanged by the DISPATCHER grant', () => {
  test('MANAGER keeps full config CRUD (regression guard)', async () => {
    const e = await enforcer();
    assert.equal(await e.enforce('MANAGER', 'config', 'read'), true);
    assert.equal(await e.enforce('MANAGER', 'config', 'write'), true);
    assert.equal(await e.enforce('MANAGER', 'config', 'delete'), true);
  });
  test('CUS stays denied config (clerks are not resource managers)', async () => {
    assert.equal(await (await enforcer()).enforce('CUS', 'config', 'read'), false);
  });
  test('DRIVER stays denied config', async () => {
    assert.equal(await (await enforcer()).enforce('DRIVER', 'config', 'read'), false);
  });
});
