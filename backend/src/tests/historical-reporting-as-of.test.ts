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
});
