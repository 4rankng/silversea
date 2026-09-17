import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableColumns } from 'drizzle-orm';
import { expenseAccountingSources, opsExpenseEntries, driverIncidentalCosts, tripExpenses } from '../../db/schema';

test('expense registry stores provenance, not independently writable financial facts', () => {
  const registry = getTableColumns(expenseAccountingSources);
  for (const field of ['amount', 'customerChargeAmount', 'invoiceNumber', 'payerUserId', 'expenseDate']) {
    assert.equal(field in registry, false, `registry must not own ${field}`);
  }
  assert.ok(registry.linkedTripExpenseId);
  assert.ok(getTableColumns(opsExpenseEntries).customerChargeAmount);
  assert.ok(getTableColumns(driverIncidentalCosts).customerChargeAmount);
  assert.ok(getTableColumns(tripExpenses).buyAmount);
});
