import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoOffsetReversalAmount,
  isReleasableAutoOffsetSettlement,
  type AutoOffsetSettlementRow,
} from '../services/advance-shared.service';

/**
 * FB-033 (card 211026014819) — chi phí vừa tạo bị khóa sửa/xóa.
 *
 * The O2C create hook books an AUTO-OFFSET settlement (auto_offset_expense_id
 * set) inside the forwarder's own save transaction. Those rows are a
 * bookkeeping shadow of the expense and must be releasable by the author's own
 * edit/delete; a MANUAL phiếu hoàn ứng (auto_offset_expense_id NULL) is a real
 * kế-toán submission and keeps its immutability. These pin the pure decision
 * the release helper applies before it touches the database.
 */
describe('FB-033 auto-offset release eligibility', () => {
  const row = (over: Partial<AutoOffsetSettlementRow>): AutoOffsetSettlementRow => ({
    status: 'RECORDED',
    totalExpenseAmount: '150000',
    refundAmount: '0',
    autoOffsetExpenseId: 28601,
    ...over,
  });

  it('releases only a RECORDED auto-offset settlement', () => {
    assert.equal(isReleasableAutoOffsetSettlement(row({})), true);
    assert.equal(isReleasableAutoOffsetSettlement(row({ status: 'REVERSED' })), false);
    assert.equal(isReleasableAutoOffsetSettlement(row({ status: 'VOIDED' })), false);
  });

  it('never releases a manual phiếu hoàn ứng (auto_offset_expense_id NULL)', () => {
    assert.equal(isReleasableAutoOffsetSettlement(row({ autoOffsetExpenseId: null })), false);
  });

  it('reverses totalExpenseAmount + refundAmount — the governed-reversal total', () => {
    assert.equal(autoOffsetReversalAmount({ totalExpenseAmount: '150000', refundAmount: '0' }), 150000);
    assert.equal(autoOffsetReversalAmount({ totalExpenseAmount: '150000', refundAmount: '25000' }), 175000);
    assert.equal(autoOffsetReversalAmount({ totalExpenseAmount: '0', refundAmount: '0' }), 0);
  });

  it('keeps the reversal amount on the round2dp money contract', () => {
    // numeric(15,0) columns arrive as integer strings; the sum never drifts
    // into float noise even when a driver carries a fractional-looking string.
    assert.equal(autoOffsetReversalAmount({ totalExpenseAmount: '999999999999999', refundAmount: '1' }), 1000000000000000);
  });
});
