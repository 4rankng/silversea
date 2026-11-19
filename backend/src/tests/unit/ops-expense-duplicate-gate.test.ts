/**
 * Ticket 18/11 Task 4.1 — the two HARD 409 paths of the Ops expense write.
 * The no-invoice family's same-type duplicate gate ignores
 * `duplicateConfirmed` (the invoice family keeps card 141026230720's
 * warn-then-confirm), and a Số hóa đơn may exist only once per lô compared
 * case/whitespace-insensitively. The decisions are pure; the database reads
 * behind them (findLiveDuplicateOpsExpenses /
 * findLiveDuplicateOpsInvoiceNumber) apply these exact rules.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  opsExpenseDuplicateGate,
  normalizeOpsInvoiceNumber,
  duplicateOpsInvoiceMessage,
} from '../../services/ops-expenses.service';

describe('opsExpenseDuplicateGate — no-invoice family is HARD, invoice family keeps confirm', () => {
  test('no-invoice types (requiresInvoice false/null/undefined) hard-block whatever the flag says', () => {
    assert.equal(opsExpenseDuplicateGate(false), 'HARD');
    assert.equal(opsExpenseDuplicateGate(false, true), 'HARD', 'duplicateConfirmed must NOT unlock the no-invoice family');
    assert.equal(opsExpenseDuplicateGate(null), 'HARD');
    assert.equal(opsExpenseDuplicateGate(null, true), 'HARD');
    assert.equal(opsExpenseDuplicateGate(undefined, true), 'HARD');
  });

  test('invoice types keep the warn-then-confirm law', () => {
    assert.equal(opsExpenseDuplicateGate(true), 'WARN', 'unconfirmed invoice duplicate still warns');
    assert.equal(opsExpenseDuplicateGate(true, true), 'PASS', 'explicit confirm lets the invoice duplicate save');
    assert.equal(opsExpenseDuplicateGate(true, false), 'WARN');
  });
});

describe('normalizeOpsInvoiceNumber — case/space-insensitive identity', () => {
  test('the classic variants fold to one key', () => {
    assert.equal(normalizeOpsInvoiceNumber(' TD-20260923-001 '), normalizeOpsInvoiceNumber('td-20260923-001'));
    assert.equal(normalizeOpsInvoiceNumber('TD 001'), normalizeOpsInvoiceNumber('td001'));
    assert.equal(normalizeOpsInvoiceNumber('TD\t001\n'), 'td001');
  });

  test('different documents stay distinct', () => {
    assert.notEqual(normalizeOpsInvoiceNumber('TD-001'), normalizeOpsInvoiceNumber('TD-002'));
    assert.notEqual(normalizeOpsInvoiceNumber('TD-001'), normalizeOpsInvoiceNumber('TD-001A'));
  });

  test('a whitespace-only number folds to the empty key', () => {
    assert.equal(normalizeOpsInvoiceNumber('   '), '');
    assert.equal(normalizeOpsInvoiceNumber('\t'), '');
  });
});

describe('duplicateOpsInvoiceMessage — the 409 names the invoice number', () => {
  test('message carries the declared number and the lô scope', () => {
    assert.equal(
      duplicateOpsInvoiceMessage('TD-20260923-001'),
      'Số hóa đơn TD-20260923-001 đã tồn tại trên lô này.',
    );
  });
});
