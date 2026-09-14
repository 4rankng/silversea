import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeOpsWalletSummary } from '../../services/ops-wallet.service';

/**
 * PRD OpsVanHanh §5.2 — the wallet formula is a P0 acceptance criterion
 * ("công thức đúng tuyệt đối (test đơn vị)"). These cases pin it down without
 * a database.
 */
describe('computeOpsWalletSummary (OpsVanHanh §5.2)', () => {
  it('subtracts approved and pending expenses from approved advances', () => {
    const summary = computeOpsWalletSummary({
      approvedAdvanceAmounts: ['5000000'],
      expenseAmounts: {
        PENDING: ['200000'],
        APPROVED: ['300000', '500000'],
        REJECTED: [],
      },
    });
    assert.equal(summary.totalAdvance, '5000000');
    assert.equal(summary.pending, '200000');
    assert.equal(summary.approved, '800000');
    assert.equal(summary.balance, '4000000');
  });

  it('reports rejected expenses but never lets them touch the balance', () => {
    const before = computeOpsWalletSummary({
      approvedAdvanceAmounts: ['1000000'],
      expenseAmounts: { PENDING: ['250000'], APPROVED: [], REJECTED: [] },
    });
    // Accountant rejects the pending entry: it leaves the pending bucket, so
    // the balance rises back without any explicit "restore" step.
    const after = computeOpsWalletSummary({
      approvedAdvanceAmounts: ['1000000'],
      expenseAmounts: { PENDING: [], APPROVED: [], REJECTED: ['250000'] },
    });
    assert.equal(before.balance, '750000');
    assert.equal(after.balance, '1000000');
    assert.equal(after.rejected, '250000');
  });

  it('returns zeros for an empty wallet', () => {
    const summary = computeOpsWalletSummary({
      approvedAdvanceAmounts: [],
      expenseAmounts: { PENDING: [], APPROVED: [], REJECTED: [] },
    });
    assert.equal(summary.balance, '0');
    assert.equal(summary.totalAdvance, '0');
  });

  it('allows a negative balance when more was spent than advanced', () => {
    const summary = computeOpsWalletSummary({
      approvedAdvanceAmounts: ['500000'],
      expenseAmounts: { PENDING: ['800000'], APPROVED: [], REJECTED: [] },
    });
    assert.equal(summary.balance, '-300000');
  });

  it('sums numeric-string amounts exactly (no float drift)', () => {
    const summary = computeOpsWalletSummary({
      approvedAdvanceAmounts: ['999999999999999'],
      expenseAmounts: { PENDING: ['1'], APPROVED: [], REJECTED: [] },
    });
    assert.equal(summary.balance, '999999999999998');
  });
});

// QA-054: approved advance-settlement refunds reduce available cash — the
// card's staging numbers (advance 75,000 · pending 23,456 · approved refund
// 75,000) must read balance −23,456, an honest debt, and each settlement's
// refund counts exactly once.
describe('ops wallet returns reconciliation', () => {
  const base = (over: Partial<Parameters<typeof computeOpsWalletSummary>[0]> = {}) => ({
    approvedAdvanceAmounts: ['75000'],
    expenseAmounts: { PENDING: ['23456'], APPROVED: [], REJECTED: [] },
    approvedRefundAmounts: ['75000'],
    ...over,
  });

  it('subtracts the approved full return — the card fixture lands at −23,456', () => {
    const out = computeOpsWalletSummary(base());
    assert.equal(out.returned, '75000');
    assert.equal(out.balance, '-23456');
  });

  it('partial returns deduct only what was returned', () => {
    const out = computeOpsWalletSummary(base({ approvedRefundAmounts: ['30000'] }));
    assert.equal(out.returned, '30000');
    assert.equal(out.balance, '21544');
  });

  it('no settlements deduct nothing (legacy shape: field absent)', () => {
    const out = computeOpsWalletSummary({
      approvedAdvanceAmounts: ['75000'],
      expenseAmounts: { PENDING: ['23456'], APPROVED: [], REJECTED: [] },
    });
    assert.equal(out.returned, '0');
    assert.equal(out.balance, '51544');
  });

  it('sums multiple approved refunds once each — no double application', () => {
    const out = computeOpsWalletSummary(base({
      approvedAdvanceAmounts: ['100000'],
      approvedRefundAmounts: ['75000', '5000'],
      expenseAmounts: { PENDING: [], APPROVED: ['10000'], REJECTED: [] },
    }));
    assert.equal(out.returned, '80000');
    assert.equal(out.balance, '10000');
  });
});
