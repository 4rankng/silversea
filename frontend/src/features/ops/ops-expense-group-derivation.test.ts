import { describe, expect, it } from 'vitest';
import { opsGroupForType } from './OpsExpenseFinancialFields';

// Card 20260928_161 — the Ops declaration form's "Nhóm chi phí" of a catalog
// row. The group must follow the row's settlement `category` (LIFT → Nâng,
// DROP → Hạ, the rest → Phí khác) through the same shared rule the server
// derives with, never the fee code: before this, only `LIFTING` / `LOWERING`
// were matched, so the chi-hộ codes `LIFT_EMPTY` / `LIFT_CARGO` /
// `YARD_STORAGE_LIFT` (and the DROP equivalents) started in "Phí khác".
describe('card 20260928_161 — nhóm chi phí suy từ category của danh mục', () => {
  it('maps LIFT / DROP / the rest to Nâng / Hạ / Phí khác', () => {
    expect(opsGroupForType({ requiresInvoice: true, category: 'LIFT' })).toBe('INVOICED_LIFT');
    expect(opsGroupForType({ requiresInvoice: true, category: 'DROP' })).toBe('INVOICED_DROP');
    for (const category of ['KHAC', 'HQGS', 'CSHT', 'PHAT_SINH', null, undefined]) {
      expect(opsGroupForType({ requiresInvoice: true, category })).toBe('INVOICED_OTHER');
    }
  });

  it('gives the chi-hộ codes the old mapping missed their real group', () => {
    // The catalog's own categories for these codes (shared/src/constants).
    expect(opsGroupForType({ requiresInvoice: true, category: 'LIFT' }), 'LIFT_EMPTY / LIFT_CARGO / YARD_STORAGE_LIFT')
      .toBe('INVOICED_LIFT');
    expect(opsGroupForType({ requiresInvoice: true, category: 'DROP' }), 'LOWER_EMPTY / LOWER_CARGO / YARD_STORAGE / CONTAINER_DEMURRAGE')
      .toBe('INVOICED_DROP');
  });

  it('leaves the no-invoice axis alone', () => {
    expect(opsGroupForType({ requiresInvoice: false, category: 'LIFT' })).toBe('OPS_REGULAR');
    expect(opsGroupForType({ requiresInvoice: null, category: 'LIFT' })).toBe('OPS_REGULAR');
    expect(opsGroupForType(undefined)).toBe('OPS_REGULAR');
  });
});
