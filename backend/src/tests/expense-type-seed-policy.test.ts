// The seed's invoice policy per expense type: invoice-bearing ops work
// (nâng, hạ, cân hàng, cơ sở hạ tầng, kiểm hóa) demands a real invoice on
// the approval/settlement path — no substitute evidence. Only the true
// no-invoice class keeps substitute evidence. requiresInvoice gates the
// approval path; it says nothing about debit-screen editability (that lock
// follows each expense row's invoiceNumber).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseTypeSeedPolicy,
  INVOICE_REQUIRED_EXPENSE_TYPE_CODES,
  NO_INVOICE_EXPENSE_TYPE_CODES,
} from '../expense-type-seed-policy';
import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';

describe('forwarder expense type seed invoice policy', () => {
  test('the invoice-bearing ops types demand invoices — no substitute evidence at approval', () => {
    for (const code of INVOICE_REQUIRED_EXPENSE_TYPE_CODES) {
      const policy = expenseTypeSeedPolicy(code);
      assert.equal(policy.requiresInvoice, true, `${code} must require an invoice`);
      assert.equal(policy.substituteEvidenceAllowed, false, `${code} must not accept substitute evidence`);
      assert.ok(OPS_EXPENSE_TYPE_DEFAULTS[code], `${code} must exist in the shared defaults catalog`);
    }
    assert.equal(INVOICE_REQUIRED_EXPENSE_TYPE_CODES.size, 5, 'exactly the five ruled codes');
  });

  test('the no-invoice class keeps substitute evidence; every other code stays untouched', () => {
    for (const code of NO_INVOICE_EXPENSE_TYPE_CODES) {
      const policy = expenseTypeSeedPolicy(code);
      assert.equal(policy.requiresInvoice, false, `${code} stays no-invoice`);
      assert.equal(policy.substituteEvidenceAllowed, true, `${code} keeps substitute evidence`);
      assert.ok(OPS_EXPENSE_TYPE_DEFAULTS[code], `${code} must exist in the shared defaults catalog`);
    }
    // Codes outside both classes keep the historical shape: no invoice flag,
    // no substitute evidence — the seed changes nothing about them.
    for (const code of ['CUSTOMS', 'FUEL', 'ROAD_TOLL']) {
      const policy = expenseTypeSeedPolicy(code);
      assert.equal(policy.requiresInvoice, false, `${code} untouched`);
      assert.equal(policy.substituteEvidenceAllowed, false, `${code} untouched`);
    }
  });
});
