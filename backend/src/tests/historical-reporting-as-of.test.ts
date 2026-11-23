import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveVietnamAsOfCutoff } from '../services/customer-receivable-authority.service';
import { computePeriodSummary, normalizeDateParam, statementPeriodBounds } from '../services/statement.service';

describe('Vietnam historical reporting cutoffs', () => {
  test('resolves a business date to next midnight in Asia/Ho_Chi_Minh', () => {
    const cutoff = resolveVietnamAsOfCutoff('2026-08-01');

    assert.equal(cutoff.businessDate, '2026-08-01');
    assert.equal(cutoff.endExclusive.toISOString(), '2026-08-01T17:00:00.000Z');
    assert.equal(cutoff.referenceDate.toISOString(), '2026-08-01T16:59:59.999Z');
    assert.equal(cutoff.explicit, true);
  });

  test('rejects impossible calendar dates instead of rolling them forward', () => {
    assert.equal(normalizeDateParam('2026-02-29'), undefined);
    assert.throws(() => resolveVietnamAsOfCutoff('2026-13-01'), /ngày hợp lệ/);
  });

  test('builds an inclusive start and end-exclusive statement range', () => {
    const bounds = statementPeriodBounds('2026-08-01', '2026-08-01');

    assert.equal(new Date(bounds.fromInclusive!).toISOString(), '2026-07-31T17:00:00.000Z');
    assert.equal(new Date(bounds.toExclusive!).toISOString(), '2026-08-01T17:00:00.000Z');
  });

  test('includes the final millisecond of the Vietnam day and excludes next midnight', () => {
    const summary = computePeriodSummary([
      { id: 1, timestamp: new Date('2026-07-31T16:59:59.999Z'), debit: '10', credit: '0', balance: '10' },
      { id: 2, timestamp: new Date('2026-07-31T17:00:00.000Z'), debit: '20', credit: '0', balance: '30' },
      { id: 3, timestamp: new Date('2026-08-01T16:59:59.999Z'), debit: '30', credit: '0', balance: '60' },
      { id: 4, timestamp: new Date('2026-08-01T17:00:00.000Z'), debit: '40', credit: '0', balance: '100' },
    ], '2026-08-01', '2026-08-01', 'CUSTOMER');

    assert.ok(summary);
    assert.equal(summary.openingBalance, 10);
    assert.equal(summary.debitTotal, 50);
    assert.equal(summary.closingBalance, 60);
  });

  // SIL-855 round 10: the ledger 'Theo khoảng' controls probed day > 12
  // (24/11→25/11 returned 0 rows, 01/11→25/11 leaked rows past 25/11, and the
  // đợt-5 range 20/04/2027→21/04/2027 had to return its period rows). The
  // bounds must keep day > 12 in the DAY slot and both bounds must bind.
  test('keeps day > 12 in the day slot for both bounds (24/11 → 25/11)', () => {
    const bounds = statementPeriodBounds('2026-11-24', '2026-11-25');

    assert.equal(new Date(bounds.fromInclusive!).toISOString(), '2026-11-23T17:00:00.000Z');
    assert.equal(new Date(bounds.toExclusive!).toISOString(), '2026-11-25T17:00:00.000Z');
  });

  test('binds a cross-year day > 12 range (20/04/2027 → 21/04/2027)', () => {
    const bounds = statementPeriodBounds('2027-04-20', '2027-04-21');

    assert.equal(new Date(bounds.fromInclusive!).toISOString(), '2027-04-19T17:00:00.000Z');
    assert.equal(new Date(bounds.toExclusive!).toISOString(), '2027-04-21T17:00:00.000Z');
  });

  test('period summary returns the đợt-5 rows inside a 2027 day > 12 range', () => {
    const summary = computePeriodSummary([
      { id: 1, timestamp: new Date('2026-11-18T09:33:32.430Z'), debit: '103067000', credit: '0', balance: '103067000' },
      { id: 2, timestamp: new Date('2027-04-20T10:00:00.000Z'), debit: '3952000', credit: '0', balance: '107019000' },
      { id: 3, timestamp: new Date('2027-04-21T10:00:00.000Z'), debit: '3952000', credit: '0', balance: '110971000' },
      { id: 4, timestamp: new Date('2027-04-22T10:00:00.000Z'), debit: '3952000', credit: '0', balance: '114923000' },
    ], '2027-04-20', '2027-04-21', 'CUSTOMER');

    assert.ok(summary);
    assert.equal(summary.openingBalance, 103_067_000);
    assert.equal(summary.debitTotal, 3_952_000 * 2);
    assert.equal(summary.closingBalance, 103_067_000 + 3_952_000 * 2);
  });

  test('the end bound excludes rows dated after the day > 12 Đến ngày', () => {
    const summary = computePeriodSummary([
      { id: 1, timestamp: new Date('2026-11-24T03:00:00.000Z'), debit: '3952000', credit: '0', balance: '3952000' },
      { id: 2, timestamp: new Date('2026-11-25T03:00:00.000Z'), debit: '3952000', credit: '0', balance: '7904000' },
      { id: 3, timestamp: new Date('2026-11-26T03:00:00.000Z'), debit: '3952000', credit: '0', balance: '11856000' },
    ], '2026-11-24', '2026-11-25', 'CUSTOMER');

    assert.ok(summary);
    assert.equal(summary.debitTotal, 3_952_000 * 2);
    assert.equal(summary.openingBalance, 0);
    assert.equal(summary.closingBalance, 3_952_000 * 2);
  });

  test('accepts day > 12 ISO params and rejects raw DD/MM text', () => {
    assert.equal(normalizeDateParam('2026-11-24'), '2026-11-24');
    assert.equal(normalizeDateParam('2027-04-20'), '2027-04-20');
    assert.equal(normalizeDateParam('24/11/2026'), undefined);
  });
});
