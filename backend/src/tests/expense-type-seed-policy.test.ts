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
    // CUSTOMS is in this list on purpose (card 20260928_181, commit 9f88d006):
    // it used to sit in NEITHER set, which produced the contradictory
    // requiresInvoice:false + substituteEvidenceAllowed:false — the approval
    // gate and the evidence gate disagreeing with nothing saying so. It is a
    // real service with real documentation (forwarder.service.ts requires a
    // `declarationNumber` for it), so it belongs here, not in the untouched
    // group below. Reclassifying it again means editing this list on purpose.
    assert.deepEqual([...INVOICE_REQUIRED_EXPENSE_TYPE_CODES].sort(), [
      'LIFTING', 'LOWERING', 'WEIGHING', 'INFRASTRUCTURE', 'INSPECTION',
      'CUSTOMS',
      'LIFT_EMPTY', 'LIFT_CARGO', 'YARD_STORAGE_LIFT', 'LOWER_EMPTY', 'LOWER_CARGO',
      'YARD_STORAGE', 'CONTAINER_DEMURRAGE', 'FEE_EXTENSION', 'FEE_CLEANING',
      'FEE_SCANNING', 'FEE_STEVEDORING', 'FEE_LABOR', 'FEE_WAREHOUSE',
    ].sort(), 'exact invoice-bearing catalog, including the customer chi-hộ list');
  });

  test('the no-invoice class keeps substitute evidence; every other code stays untouched', () => {
    // KB §3.5.3 (K3.69, SIL-1055) — CHỈ bốn loại được cân nhắc bằng chứng thay
    // thế; pin the exact list so a fifth code cannot drift in silently.
    assert.deepEqual([...NO_INVOICE_EXPENSE_TYPE_CODES].sort(), [
      'INSPECTION_SVC', 'OTHER', 'ROAD_REPAIR', 'ZONE_SURCHARGE',
    ].sort(), 'exact substitute-evidence list of KB §3.5.3 (K3.69)');
    for (const code of NO_INVOICE_EXPENSE_TYPE_CODES) {
      const policy = expenseTypeSeedPolicy(code);
      assert.equal(policy.requiresInvoice, false, `${code} stays no-invoice`);
      assert.equal(policy.substituteEvidenceAllowed, true, `${code} keeps substitute evidence`);
      assert.ok(OPS_EXPENSE_TYPE_DEFAULTS[code], `${code} must exist in the shared defaults catalog`);
    }
    // Codes outside both classes keep the historical shape: no invoice flag,
    // no substitute evidence — the seed changes nothing about them. This is
    // the sanctioned nhóm Giao nhận/Phát sinh Ops of KB §3.5.3 ("không hóa
    // đơn: gõ tên phí trùng tên loại có hóa đơn không làm khoản có hóa đơn").
    // CUSTOMS is deliberately NOT in this group any more (see above).
    // SIL-1055: FUEL is BACK in this group — KB §3.5.3 does not allow fuel
    // substitute evidence (card 20261004_355 had moved it into the
    // no-invoice class; that placement was wrong against the KB).
    for (const code of ['ROAD_TOLL', 'FUEL']) {
      const policy = expenseTypeSeedPolicy(code);
      assert.equal(policy.requiresInvoice, false, `${code} untouched`);
      assert.equal(policy.substituteEvidenceAllowed, false, `${code} untouched`);
    }
  });
});
