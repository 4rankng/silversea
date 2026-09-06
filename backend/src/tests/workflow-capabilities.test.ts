import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { getCapabilities } from '../services/user.service';

describe('customer-service finance capabilities', () => {
  before(async () => {
    await initEnforcer();
  });

  test('exposes only the role-authorized workflow capabilities', async () => {
    const clerk = await getCapabilities(Role.CUS);
    assert.ok(clerk.includes('shipments.read'));
    assert.ok(clerk.includes('shipments.write'));
    // Reconcile-now workflow moved out of the CUS clerk's hands (2026-09-06):
    // recoverable-costs stays an ACCOUNTANT/MANAGER/OPS surface.
    assert.ok(!clerk.includes('recoverable_costs.read'));
    assert.ok(!clerk.includes('recoverable_costs.request'));
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
