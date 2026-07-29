import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { newEnforcer, type Enforcer } from 'casbin';
import { Role } from '@tingting/shared';
import { assertCanMakeGovernanceAction } from '../services/governance-policy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(__dirname, '../casbin/model.conf');
const policyPath = path.resolve(__dirname, '../casbin/policy.csv');

let enforcerPromise: Promise<Enforcer> | null = null;
const enforcer = () => (enforcerPromise ??= newEnforcer(modelPath, policyPath));
const canWriteCompanyInfo = async (role: Role) =>
  (await enforcer()).enforce(role, 'config', 'write');

describe('company-info route-mount RBAC', () => {
  test('ADMIN, MANAGER, and ACCOUNTANT can submit company information', async () => {
    for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]) {
      assert.equal(await canWriteCompanyInfo(role), true, `${role} should have config write access`);
      assert.doesNotThrow(
        () => assertCanMakeGovernanceAction('PRICE_CONFIG_CHANGE', role),
        `${role} should be able to create the governed company-info change`,
      );
    }
  });

  test('portal roles cannot submit company information', async () => {
    for (const role of [Role.DRIVER, Role.FORWARDER, Role.CUSTOMER, Role.CLERK]) {
      assert.equal(await canWriteCompanyInfo(role), false, `${role} must not have config write access`);
      assert.throws(
        () => assertCanMakeGovernanceAction('PRICE_CONFIG_CHANGE', role),
        `${role} must not create the governed company-info change`,
      );
    }
  });
});
