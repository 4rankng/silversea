// SIL-1125 (K10.59, KB §10.10.3) — Ngày dự kiến hoàn cược read law: the value
// the API returns is ALWAYS ngày nộp công văn + 14 ngày whenever a CV date
// exists, so a stale stored row (an old CV+24-era write) self-heals on first
// read — no edit required. A row without a CV date reads empty. Pinned
// db-free on the pure read mapping; the derivation must be the SAME
// computation the create default and the update resolver fall back to.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedRefundDateFromCv,
  resolveExpectedRefundDate,
  toDepositTrackerApiRow,
  type DepositTrackerRowSelect,
} from '../../services/deposit-refund-tracker.service';

const row = (overrides: Partial<DepositTrackerRowSelect>): DepositTrackerRowSelect => ({
  id: 1,
  shipmentId: null,
  billNumber: 'K5K5346365',
  customerName: 'Khách cược QA',
  carrierName: 'Maersk',
  depositAmount: '2000000',
  depositDate: '2026-10-20',
  cvSubmittedDate: null,
  expectedRefundDate: null,
  status: 'CHUA_HOAN_CUOC',
  recoveredAmount: null,
  refundReceivedDate: null,
  category: 'CUOC_CONTAINER',
  refundPostedMovementId: null,
  refundPostedAt: null,
  refundPostedBy: null,
  note: null,
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  updatedAt: new Date('2026-10-20T00:00:00.000Z'),
  ...overrides,
});

describe('K10.59 read law — expectedRefundDate derives from cvSubmittedDate + 14 on every API read (SIL-1125)', () => {
  it('heals a stale stored row on read: cv 2026-10-27 with stored 2026-11-20 returns 2026-11-10', () => {
    const stale = row({ cvSubmittedDate: '2026-10-27', expectedRefundDate: '2026-11-20' });
    const read = toDepositTrackerApiRow(stale);
    assert.equal(read.expectedRefundDate, '2026-11-10');
    // The heal is read-side only — the rest of the row rides through untouched.
    assert.equal(read.cvSubmittedDate, '2026-10-27');
    assert.equal(read.billNumber, 'K5K5346365');
  });

  it('blank cvSubmittedDate reads empty even when a stored date lingers', () => {
    assert.equal(toDepositTrackerApiRow(row({ cvSubmittedDate: null, expectedRefundDate: null })).expectedRefundDate, null);
    assert.equal(toDepositTrackerApiRow(row({ cvSubmittedDate: null, expectedRefundDate: '2026-11-15' })).expectedRefundDate, null);
  });

  it('a row already on the rule reads back unchanged', () => {
    const correct = row({ cvSubmittedDate: '2026-11-26', expectedRefundDate: '2026-12-10' });
    assert.equal(toDepositTrackerApiRow(correct).expectedRefundDate, '2026-12-10');
  });

  it('the read derivation and the edit-path default share one computation', () => {
    for (const cv of ['2026-10-27', '2026-12-25']) {
      assert.equal(expectedRefundDateFromCv(cv), toDepositTrackerApiRow(row({ cvSubmittedDate: cv })).expectedRefundDate);
      // The update resolver's fallback (no override, no CV change) must agree
      // with the read mapping for the same CV day — one rule, one computation.
      assert.equal(
        resolveExpectedRefundDate({
          prevCvDate: cv,
          nextCvDate: cv,
          prevExpectedDate: null,
          cvSubmittedDateProvided: true,
          inputExpectedRefundDate: undefined,
        }),
        expectedRefundDateFromCv(cv),
      );
    }
    // K10.59 hand-calc pinned (the ticket's own arithmetic), plus a month
    // rollover so the day math cannot silently drift: 25/12 + 14 = 08/01/2027.
    assert.equal(expectedRefundDateFromCv('2026-10-27'), '2026-11-10');
    assert.equal(expectedRefundDateFromCv('2026-12-25'), '2027-01-08');
    assert.equal(expectedRefundDateFromCv(null), null);
  });
});
