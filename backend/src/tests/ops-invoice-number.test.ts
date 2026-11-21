import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveOpsInvoiceNumber } from '../services/ops-invoice-number';

// SIL-870 — QA verdict build 32e22c12 (role hoapt, 19:50 SGT): the /advances
// 'Chi phí Ops' board showed 'unc' instead of 'X' in the SỐ HĐ column for two
// fee rows without an invoice:
//   13/11/2026  ZIMUHAI80262535  'Phí kết cấu hạ tầng'  500.000₫  invoice 'unc'
//   12/11/2026  TWNSFA000519     'Phí kết cấu hạ tầng'  500.000₫  invoice 'unc'
// The stored value is user-typed placeholder text (the field has been optional
// since SIL-834), so the digitless-value law must classify it as NO invoice —
// the FE cell then renders 'X' through its null/empty law.
describe('effectiveOpsInvoiceNumber — SIL-870 digitless placeholder law', () => {
  test('the two QA repro rows (invoice_number "unc") classify as no invoice', () => {
    assert.equal(effectiveOpsInvoiceNumber('unc'), null);
    assert.equal(effectiveOpsInvoiceNumber('unc'.trim()), null);
  });

  test('other digitless placeholder spellings classify as no invoice', () => {
    assert.equal(effectiveOpsInvoiceNumber('chưa có'), null);
    assert.equal(effectiveOpsInvoiceNumber('unclear'), null);
    assert.equal(effectiveOpsInvoiceNumber('x'), null);
    assert.equal(effectiveOpsInvoiceNumber('   '), null);
    assert.equal(effectiveOpsInvoiceNumber(''), null);
    assert.equal(effectiveOpsInvoiceNumber(null), null);
    assert.equal(effectiveOpsInvoiceNumber(undefined), null);
  });

  test('real invoice references keep their value (trimmed)', () => {
    // Numeric-heavy forms seen on the board: VAT number, document code + seq.
    assert.equal(effectiveOpsInvoiceNumber('0001234'), '0001234');
    assert.equal(effectiveOpsInvoiceNumber('TD-001'), 'TD-001');
    assert.equal(effectiveOpsInvoiceNumber(' 1C24K29/25P '), '1C24K29/25P');
    assert.equal(effectiveOpsInvoiceNumber(' ZIMUHAI80262535 '), 'ZIMUHAI80262535');
  });
});
