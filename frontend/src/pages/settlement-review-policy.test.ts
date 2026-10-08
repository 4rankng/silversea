import { describe, expect, it } from 'vitest';
import { settlementBalanceSummary } from './SettlementPrintPage';

describe('direct advance-settlement accounting policy', () => {
  it('shows the persisted refund separately from the remaining settlement difference', () => {
    // Card 2026-10-05_1544 added a `notice` to the same return value. Both
    // original assertions keep their exact `balance` and `label` — the refund
    // is still part of the balance, not netted out of it.
    expect(settlementBalanceSummary(700_000, 630_000, 70_000)).toEqual({
      balance: 0,
      label: 'Chênh lệch sau quyết toán',
      notice: null,
    });
    expect(settlementBalanceSummary(700_000, 630_000, 0)).toEqual({
      balance: 70_000,
      label: 'Còn dư chưa hoàn',
      notice: 'Công ty yêu cầu hoàn trả tạm ứng',
    });
  });
});

/** Card 2026-10-05_1544 (spec 5.10) — "số tiền còn lại = ĐNTT − đã ứng; nếu
 *  dương: Cty thanh toán hoàn ứng; nếu âm: Cty yêu cầu hoàn trả tạm ứng".
 *
 *  This module's balance runs the OPPOSITE way (đã ứng − ĐNTT − đã hoàn), so the
 *  notice is mapped back onto the spec's wording. What decides which side owes
 *  whom is the money itself, so each case is pinned on a DIFFERENT number, not
 *  on the label alone. */
describe('card 2026-10-05_1544 — settlement notice says who owes whom', () => {
  it('asks the driver to return the money when the advance exceeds the spend', () => {
    // Advanced 700k, spent 630k, nothing returned → 70k still with the driver.
    const r = settlementBalanceSummary(700_000, 630_000, 0);
    expect(r.balance).toBe(70_000);
    expect(r.notice).toBe('Công ty yêu cầu hoàn trả tạm ứng');
  });

  it('tells the company to settle when the spend exceeds the advance', () => {
    // Advanced 300k, spent 450k → the company owes the driver 150k.
    const r = settlementBalanceSummary(300_000, 450_000, 0);
    expect(r.balance).toBe(-150_000);
    expect(r.notice).toBe('Công ty thanh toán hoàn ứng');
  });

  it('stays silent once the settlement balances', () => {
    expect(settlementBalanceSummary(300_000, 300_000, 0).notice).toBeNull();
  });

  it('counts a recorded refund, so a balanced sheet reads as balanced', () => {
    // Advanced 700k, spent 630k, 70k already returned → nothing left either way.
    const r = settlementBalanceSummary(700_000, 630_000, 70_000);
    expect(r.balance).toBe(0);
    expect(r.notice).toBeNull();
  });
});