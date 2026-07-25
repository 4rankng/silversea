/**
 * Wave 2 M3.6 — debit-note lifecycle tests.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTransition,
  isDocumentLocked,
  assertNotLocked,
  calculatePaymentAllocation,
} from '../services/debit-note-lifecycle.service';

describe('M3.6 — isValidTransition', () => {
  test('DRAFT → SENT is valid', () => {
    assert.ok(isValidTransition('DRAFT', 'SENT'));
  });
  test('SENT → PENDING_CONFIRM is valid', () => {
    assert.ok(isValidTransition('SENT', 'PENDING_CONFIRM'));
  });
  test('PENDING_CONFIRM → CONFIRMED is valid', () => {
    assert.ok(isValidTransition('PENDING_CONFIRM', 'CONFIRMED'));
  });
  test('CONFIRMED → PAID is valid', () => {
    assert.ok(isValidTransition('CONFIRMED', 'PAID'));
  });
  test('DRAFT → PAID is NOT valid', () => {
    assert.ok(!isValidTransition('DRAFT', 'PAID'));
  });
  test('PAID → anything is NOT valid (terminal)', () => {
    assert.ok(!isValidTransition('PAID', 'DRAFT'));
    assert.ok(!isValidTransition('PAID', 'SENT'));
  });
  test('CANCELED → anything is NOT valid (terminal)', () => {
    assert.ok(!isValidTransition('CANCELED', 'DRAFT'));
  });
  test('REJECTED → DRAFT is valid (can revise)', () => {
    assert.ok(isValidTransition('REJECTED', 'DRAFT'));
  });
  test('same status is always valid (idempotent)', () => {
    for (const status of ['DRAFT', 'SENT', 'CONFIRMED', 'PAID', 'CANCELED']) {
      assert.ok(isValidTransition(status as never, status as never));
    }
  });
});

describe('M3.6 — isDocumentLocked', () => {
  test('DRAFT is not locked', () => { assert.ok(!isDocumentLocked('DRAFT')); });
  test('SENT is not locked', () => { assert.ok(!isDocumentLocked('SENT')); });
  test('PENDING_CONFIRM is not locked', () => { assert.ok(!isDocumentLocked('PENDING_CONFIRM')); });
  test('CONFIRMED is locked', () => { assert.ok(isDocumentLocked('CONFIRMED')); });
  test('PARTIAL_PAID is locked', () => { assert.ok(isDocumentLocked('PARTIAL_PAID')); });
  test('PAID is locked', () => { assert.ok(isDocumentLocked('PAID')); });
  test('CANCELED is locked', () => { assert.ok(isDocumentLocked('CANCELED')); });
  test('REJECTED is not locked (can revise)', () => { assert.ok(!isDocumentLocked('REJECTED')); });
  test('null is not locked', () => { assert.ok(!isDocumentLocked(null)); });
  test('undefined is not locked', () => { assert.ok(!isDocumentLocked(undefined)); });
});

describe('M3.6 — assertNotLocked', () => {
  test('DRAFT does not throw', () => {
    assert.doesNotThrow(() => assertNotLocked('DRAFT'));
  });
  test('CONFIRMED throws 409', () => {
    assert.throws(
      () => assertNotLocked('CONFIRMED'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 409,
    );
  });
  test('null does not throw', () => {
    assert.doesNotThrow(() => assertNotLocked(null));
  });
});

describe('M3.6 — calculatePaymentAllocation', () => {
  test('exact payment → no overpayment', () => {
    const r = calculatePaymentAllocation(1_000_000, 1_000_000);
    assert.equal(r.appliedAmount, 1_000_000);
    assert.equal(r.overpayment, 0);
    assert.equal(r.remainingBalance, 0);
  });
  test('overpayment → excess stays as credit', () => {
    const r = calculatePaymentAllocation(1_000_000, 1_500_000);
    assert.equal(r.appliedAmount, 1_000_000);
    assert.equal(r.overpayment, 500_000);
    assert.equal(r.remainingBalance, 0);
  });
  test('partial payment → remaining balance', () => {
    const r = calculatePaymentAllocation(1_000_000, 400_000);
    assert.equal(r.appliedAmount, 400_000);
    assert.equal(r.overpayment, 0);
    assert.equal(r.remainingBalance, 600_000);
  });
  test('prior payment + new payment = exact → no overpayment', () => {
    const r = calculatePaymentAllocation(1_000_000, 600_000, 400_000);
    assert.equal(r.appliedAmount, 600_000);
    assert.equal(r.overpayment, 0);
    assert.equal(r.remainingBalance, 0);
  });
  test('prior payment + overpay → overpayment calculated', () => {
    const r = calculatePaymentAllocation(1_000_000, 700_000, 400_000);
    assert.equal(r.appliedAmount, 600_000);
    assert.equal(r.overpayment, 100_000);
  });
  test('zero total → all payment is overpayment', () => {
    const r = calculatePaymentAllocation(0, 500_000);
    assert.equal(r.appliedAmount, 0);
    assert.equal(r.overpayment, 500_000);
  });
});
