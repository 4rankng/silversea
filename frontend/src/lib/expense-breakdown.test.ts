import { describe, expect, it } from 'vitest';
import { groupExpensesForSettlementSlip, rowContainerLabel, type SettlementExpenseLike } from './expense-breakdown';

const row = (over: Partial<SettlementExpenseLike> = {}): SettlementExpenseLike => ({
  expenseType: 'LIFTING',
  buyAmount: '100000',
  containerNumber: null,
  departureDate: '2026-11-01',
  shipmentId: 1,
  customerName: 'LONGMINH',
  billRef: 'R8B-472',
  tradeDirection: 'IMPORT',
  declarationNumber: null,
  lotContainerNumbers: ['MSKU1234570', 'MSKU1234565'],
  lotDeclarationNumbers: ['10859073650'],
  ...over,
});

describe('groupExpensesForSettlementSlip (SIL-811)', () => {
  it('Chung lô rows head under the lot merged roll-call — never "Không rõ container"', () => {
    const blocks = groupExpensesForSettlementSlip([row()], []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].identityTitle)
      .toBe('LONGMINH · Bill: R8B-472 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565');
    expect(blocks[0].identityTitle).not.toContain('Không rõ container');
  });

  it('a group assigned one cont shows that cont', () => {
    const blocks = groupExpensesForSettlementSlip([
      row({ containerNumber: 'MSKU1234570', declarationNumber: '10859073650' }),
    ], []);
    expect(blocks[0].identityTitle)
      .toBe('LONGMINH · Bill: R8B-472 · TK: 10859073650 · MSKU1234570');
  });

  it('partial per-cont rows keep one block each; lot-wide rows keep their own merged block', () => {
    const blocks = groupExpensesForSettlementSlip([
      row({ containerNumber: 'MSKU1234570', declarationNumber: 'TK-A' }),
      row({ containerNumber: null, buyAmount: '50000' }),
    ], []);
    expect(blocks).toHaveLength(2);
    const titles = blocks.map((block) => block.identityTitle);
    expect(titles).toContain('LONGMINH · Bill: R8B-472 · TK: TK-A · MSKU1234570');
    // The lot-wide block covers BOTH conts → merged roll-call with the lot's tờ khai.
    expect(titles).toContain('LONGMINH · Bill: R8B-472 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565');
  });

  it('Ops chọn tất cả số cont → cộng gộp into one merged block', () => {
    const blocks = groupExpensesForSettlementSlip([
      row({ containerNumber: 'MSKU1234570', declarationNumber: 'TK-A', buyAmount: '100000' }),
      row({ containerNumber: 'MSKU1234565', declarationNumber: 'TK-B', buyAmount: '200000' }),
    ], []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].identityTitle).toBe('LONGMINH · Bill: R8B-472 · TK: TK-A, TK-B · 2 cont: MSKU1234570, MSKU1234565');
    expect(blocks[0].total).toBe(300000);
  });

  it('blocks travel chronologically by earliest departure date', () => {
    const blocks = groupExpensesForSettlementSlip([
      row({ shipmentId: 2, departureDate: '2026-11-05' }),
      row({ shipmentId: 1, departureDate: '2026-11-01' }),
    ], []);
    expect(blocks.map((block) => block.key)).toEqual(['1:lot', '2:lot']);
    expect(blocks[0].minDepartureDate).toBe('2026-11-01');
  });

  it('EXPORT lots read Booking, and missing bill keeps the honest fallback', () => {
    const blocks = groupExpensesForSettlementSlip([
      row({ tradeDirection: 'EXPORT', billRef: 'BK-9-2611' }),
      row({ shipmentId: 2, billRef: null, lotContainerNumbers: [] }),
    ], []);
    const titles = blocks.map((block) => block.identityTitle);
    expect(titles).toContain('LONGMINH · Booking: BK-9-2611 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565');
    expect(titles).toContain('LONGMINH · Bill: Chưa có số Bill/Booking · TK: 10859073650');
  });

  it('byType sums per fee label for the card chips', () => {
    const blocks = groupExpensesForSettlementSlip([
      row({ expenseType: 'LIFTING', buyAmount: '100000' }),
      row({ expenseType: 'LIFTING', buyAmount: '50000' }),
      row({ expenseType: 'WEIGHING', buyAmount: '30000' }),
    ], []);
    expect(blocks[0].byType.get('Nâng container')).toBe(150000);
    expect(blocks[0].byType.get('Cân hàng')).toBe(30000);
    expect(blocks[0].total).toBe(180000);
  });
});

describe('rowContainerLabel (SIL-811)', () => {
  it('assigned cont → bare number; lot-wide → merged roll-call; nothing → Phí chung lô', () => {
    expect(rowContainerLabel(row({ containerNumber: 'MSKU1234570' }))).toBe('MSKU1234570');
    expect(rowContainerLabel(row())).toBe('2 cont: MSKU1234570, MSKU1234565');
    expect(rowContainerLabel(row({ lotContainerNumbers: [] }))).toBe('Phí chung lô');
    expect(rowContainerLabel(row())).not.toBe('Không rõ container');
  });
});
