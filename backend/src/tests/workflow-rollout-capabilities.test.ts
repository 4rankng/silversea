import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { config } from '../config';
import { getCapabilities } from '../services/user.service';
import { assertWorkflowActive } from '../middleware/workflow-rollout';

describe('customer-service finance rollout capabilities', () => {
  const originalMode = config.workflowRolloutMode;

  before(async () => {
    await initEnforcer();
  });

  after(() => {
    config.workflowRolloutMode = originalMode;
  });

  test('OFF and SHADOW keep the new workflow unreachable while preserving shipment access', async () => {
    for (const mode of ['OFF', 'SHADOW'] as const) {
      config.workflowRolloutMode = mode;
      const clerk = await getCapabilities(Role.CLERK);
      assert.ok(clerk.includes('shipments.read'));
      assert.ok(clerk.includes('shipments.write'));
      assert.ok(!clerk.some((capability) => capability.startsWith('recoverable_costs.')));

      const manager = await getCapabilities(Role.MANAGER);
      assert.ok(!manager.includes('treasury.read'));
      assert.ok(!manager.includes('profitability.read'));
      assert.ok(!manager.includes('executive_dashboard.read'));
      assert.throws(
        () => assertWorkflowActive(),
        (error: unknown) => (
          error instanceof Error
          && 'statusCode' in error
          && error.statusCode === 503
        ),
      );
    }
  });

  test('ACTIVE exposes only the role-authorized workflow capabilities', async () => {
    config.workflowRolloutMode = 'ACTIVE';
    assert.doesNotThrow(() => assertWorkflowActive());

    const clerk = await getCapabilities(Role.CLERK);
    assert.ok(clerk.includes('recoverable_costs.read'));
    assert.ok(clerk.includes('recoverable_costs.request'));
    assert.ok(!clerk.includes('treasury.read'));
    assert.ok(!clerk.includes('executive_dashboard.read'));

    const accountant = await getCapabilities(Role.ACCOUNTANT);
    assert.ok(accountant.includes('recoverable_costs.read'));
    assert.ok(accountant.includes('treasury.read'));
    assert.ok(accountant.includes('treasury.operate'));
    assert.ok(accountant.includes('profitability.read'));
    assert.ok(!accountant.includes('executive_dashboard.read'));

    const manager = await getCapabilities(Role.MANAGER);
    assert.ok(manager.includes('treasury.read'));
    assert.ok(manager.includes('treasury.operate'));
    assert.ok(manager.includes('profitability.read'));
    assert.ok(manager.includes('executive_dashboard.read'));
  });
});
