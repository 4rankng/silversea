import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupOpsExpensesForSettlement } from '../../services/ops-expenses.service';

/**
 * PRD OpsVanHanh §5.3/§5.4 (docx reqs 8+10): expenses from multiple Ops on the
 * SAME lot must group under ONE mã lô — never split by payer — and each lot's
 * bảng kê splits into the Có/Không hóa đơn baskets by requires_invoice, with
 * per-lot and grand totals.
 */
describe('groupOpsExpensesForSettlement (OpsVanHanh §5.4)', () => {
  const entry = (overrides: Record<string, unknown>) => ({
    shipmentId: 1, shipmentCode: 'SS-1', customerName: 'KH A', billRef: 'BL-1',
    containerNumber: null as string | null, expenseTypeName: 'Nâng/hạ',
    requiresInvoice: true, amount: '100000', approvalStatus: 'PENDING',
    ...overrides,
  });

  it('groups entries of multiple payers under one mã lô (micro-ledger)', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({ amount: '350000', approvalStatus: 'APPROVED' }),
      entry({ expenseTypeName: 'Bồi dưỡng', requiresInvoice: false, amount: '70000' }),
    ]);
    assert.equal(grouping.groups.length, 1);
    assert.equal(grouping.groups[0].shipmentCode, 'SS-1');
    // Both entries stay in the one lot group regardless of who paid.
    assert.equal(grouping.groups[0].total, '420000');
    assert.equal(grouping.totals.grand, '420000');
  });

  it('splits the two invoice baskets per lot and totals each bucket', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({ amount: '350000' }), // with invoice
      entry({ amount: '120000' }), // with invoice
      entry({ expenseTypeName: 'Cân xe', requiresInvoice: false, amount: '80000' }),
      entry({ expenseTypeName: 'Tiền luật', requiresInvoice: false, amount: '50000' }),
    ]);
    const group = grouping.groups[0];
    assert.equal(group.withInvoice.items.length, 2);
    assert.equal(group.withInvoice.total, '470000');
    assert.equal(group.withoutInvoice.items.length, 2);
    assert.equal(group.withoutInvoice.total, '130000');
    assert.equal(group.total, '600000');
    assert.equal(grouping.totals.withInvoice, '470000');
    assert.equal(grouping.totals.withoutInvoice, '130000');
    assert.equal(grouping.totals.grand, '600000');
  });

  it('groups different lots separately, sorted by mã lô', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({ shipmentId: 2, shipmentCode: 'SS-2', amount: '10000' }),
      entry({ amount: '20000' }),
    ]);
    assert.deepEqual(grouping.groups.map((group) => group.shipmentCode), ['SS-1', 'SS-2']);
    assert.equal(grouping.totals.grand, '30000');
  });

  it('returns zero totals for an empty pool', () => {
    const grouping = groupOpsExpensesForSettlement([]);
    assert.equal(grouping.groups.length, 0);
    assert.equal(grouping.totals.grand, '0');
  });
});
