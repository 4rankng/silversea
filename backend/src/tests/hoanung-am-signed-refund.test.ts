import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdvanceSettlementSchema,
  updateAdvanceSettlementSchema,
} from '@tingting/shared';
import { autoOffsetReversalAmount } from '../services/advance-shared.service';

/**
 * QA R30 follow-up — hoàn ứng SỐ ÂM (chi phí vượt tạm ứng).
 *
 * FB-100 (card 141026230770): "Tiền hoàn lại" của phiếu hoàn ứng là số CÓ DẤU.
 * Khi Ops chi vượt số tạm ứng đã cấp (tạm ứng 100.000, chi phí gắn chuyến
 * 150.000), phiếu cân đối phải nhận refundAmount = −50.000 — meaning Cty owes
 * Ops 50.000 thêm ("Công ty thanh toán hoàn ứng") — và phiếu vẫn ghi nhận +
 * kế toán duyệt bình thường, không bị chặn bởi sign guard nào.
 *
 * These pins are pure schema/arithmetics; the full chain (tạm ứng duyệt =
 * giải ngân → chi phí → phiếu âm → duyệt) is the local E2E probe
 * testplan/qa/scripts/2026-10-21-hoanung-am-e2e.mjs (qa/2026-10-21-hoanung-am/).
 */
describe('hoàn ứng số âm (QA R30 follow-up) — signed refundAmount contract', () => {
  it('create schema accepts a negative refundAmount (phiếu cân đối khi chi vượt tạm ứng)', () => {
    const parsed = createAdvanceSettlementSchema.parse({
      advanceRequestIds: [8141],
      tripExpenseIds: [28607],
      totalExpenseAmount: 150000,
      refundAmount: -50000,
    });
    assert.equal(parsed.refundAmount, -50000);
  });

  it('create schema accepts the negative refund sent as a numeric string', () => {
    const parsed = createAdvanceSettlementSchema.parse({
      advanceRequestIds: [1],
      refundAmount: '-50000',
    });
    assert.equal(parsed.refundAmount, -50000);
  });

  it('update schema keeps the same signed rule (kế toán điều chỉnh số hoàn lại)', () => {
    const parsed = updateAdvanceSettlementSchema.parse({
      expectedVersion: 1,
      refundAmount: -50000,
      advanceRequestIds: [1],
      tripExpenseIds: [2],
    });
    assert.equal(parsed.refundAmount, -50000);
  });

  it('still rejects non-numeric refund payloads', () => {
    assert.throws(() =>
      createAdvanceSettlementSchema.parse({ advanceRequestIds: [1], refundAmount: '1e3' }),
    );
    assert.throws(() =>
      createAdvanceSettlementSchema.parse({ advanceRequestIds: [1], refundAmount: '0x10' }),
    );
  });

  it('reversal total for a signed phiếu converges back to the advance principal (150k chi + −50k hoàn = 100k cấp)', () => {
    assert.equal(autoOffsetReversalAmount({ totalExpenseAmount: '150000', refundAmount: '-50000' }), 100000);
    // Positive-refund parity (the classic case): 80k chi + 20k hoàn = 100k.
    assert.equal(autoOffsetReversalAmount({ totalExpenseAmount: '80000', refundAmount: '20000' }), 100000);
  });
});
