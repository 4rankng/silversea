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
