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
    assert.equal(grouping.totals.rawGrand, '0');
    assert.equal(grouping.totals.excludedNegative, '0');
  });

  // SIL-811 — the per-lot identity title (KH viết tắt · Bill/Booking + tờ
  // khai · Số cont) and the row container cell: merged roll-call for a
  // lot-wide line, bare number for a per-cont line. Never 'Không rõ container'.
  it('SIL-811 — lot-wide lines head the group with the merged cont roll-call', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({
        tradeDirection: 'IMPORT',
        declarationNumber: '10859073650',
        lotContainerNumbers: ['MSKU1234570', 'MSKU1234565'],
        lotDeclarationNumbers: ['10859073650'],
        amount: '150000',
        requiresInvoice: false,
      }),
    ]);
    const group = grouping.groups[0];
    assert.equal(group.identityTitle, 'KH A · Bill: BL-1 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565');
    assert.equal(group.withoutInvoice.items[0].containerLabel, '2 cont: MSKU1234570, MSKU1234565');
    assert.ok(!group.identityTitle.includes('Không rõ container'));
  });

  it('SIL-811 — a line assigned one cont shows that cont and its tờ khai', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({
        containerNumber: 'MSKU1234570',
        declarationNumber: '10859073650',
        lotContainerNumbers: ['MSKU1234570', 'MSKU1234565'],
        lotDeclarationNumbers: ['10859073650', '10859073651'],
        amount: '150000',
      }),
    ]);
    const group = grouping.groups[0];
    assert.equal(group.identityTitle, 'KH A · Bill: BL-1 · TK: 10859073650 · MSKU1234570');
    assert.equal(group.withInvoice.items[0].containerLabel, 'MSKU1234570');
  });

  // SIL-751 — the two staging phiếu QA reported. r4 correction (QA 4691/
  // 4703/4715, verified line by line on staging e6db602f): OS-2611-0005 has
  // NO negative row — its 5 lines are all positive and sum 1.070.000₫ while
  // the STORED header read 1.080.000₫ (an accountant amount edit moved a line
  // and never recomputed the frozen total). The r3 fixture guessed a −10.000₫
  // line; the real gap is a stale stored header, which r4 fixes by deriving
  // every phiếu header from its lines (opsSettlementTotalFromLinesSql /
  // sumOpsAmounts) and recomputing at the accountant edit. OS-2610-0001
  // keeps its genuine −50.000₫ exclusion disclosure (header 320.000₫ =
  // 200.000 + 120.000; raw lines 270.000₫).
  it('SIL-751 case OS-2611-0005 (real shape) — 5 positive lines sum 1.070.000 with no exclusion to disclose', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({ amount: '150000', expenseTypeName: 'Phí nhiên liệu/dầu', requiresInvoice: false }), // QBOBD39C
      entry({ amount: '210000', expenseTypeName: 'Cân lốp', requiresInvoice: false }), // R3Q-680-B
      entry({ amount: '60000', expenseTypeName: 'Chi công nhân tại kho', requiresInvoice: false }), // R3Q-679-D
      entry({ amount: '500000', expenseTypeName: 'Phí phục vụ kiểm hóa', requiresInvoice: false }), // R4B-CC-001
      entry({ amount: '150000', expenseTypeName: 'Phí nhiên liệu/dầu', requiresInvoice: false }), // R4B-3E-FCL1
    ]);
    // The sheet's law total and a reviewer's manual line-add AGREE — the
    // 10.000₫ gap of the bug report was the stale stored header, not the law.
    assert.equal(grouping.totals.grand, '1070000');
    assert.equal(grouping.totals.rawGrand, '1070000', 'no negative row: the raw sum equals the law total');
    assert.equal(grouping.totals.excludedNegative, '0', 'nothing to disclose — every printed line reaches the total');
  });

  it('SIL-751 case OS-2610-0001 — header 320.000 vs dòng cộng 270.000 exposes the −50.000 exclusion', () => {
    const grouping = groupOpsExpensesForSettlement([
      entry({ amount: '-50000', expenseTypeName: 'Nhân công kho' }),
      entry({ amount: '200000', expenseTypeName: 'Đổi cont' }),
      entry({ amount: '120000', expenseTypeName: 'Nhân công kho' }),
    ]);
    assert.equal(grouping.totals.grand, '320000');
    assert.equal(grouping.totals.rawGrand, '270000');
    assert.equal(grouping.totals.excludedNegative, '-50000');
    // grand excludes the negatives: grand + excludedNegative = rawGrand.
    assert.equal(BigInt(grouping.totals.grand) + BigInt(grouping.totals.excludedNegative), BigInt(grouping.totals.rawGrand));
  });
});
