import { describe, expect, it } from 'vitest';
import { computeTotals } from './AccountingInvoiceTrackingPage';

// Worked example from the card plan: unfiltered Tổng = 17.500.000 / 14.000.000 / 3.500.000.
// SIL-762 rewrote the law: Chênh lệch = Số tiền thu − Số tiền trả − Số tiền trả KH,
// so a row carrying a customer deduction now lowers the strip's difference.
describe('computeTotals', () => {
  it('sums invoice, paid and their difference from the filtered rows', () => {
    expect(computeTotals([
      { invoiceAmount: '12000000', supplierPayment: '8000000' },
      { invoiceAmount: '5500000', supplierPayment: '6000000' },
    ])).toEqual({ invoice: 17500000, paid: 14000000, difference: 3500000, com: 0 });
  });

  it('folds the customer deduction (Số tiền trả KH) into the difference — SIL-762 law', () => {
    expect(computeTotals([
      { invoiceAmount: '12000000', supplierPayment: '8000000', comAmount: '1750000' },
      { invoiceAmount: '5500000', supplierPayment: '6000000', comAmount: null },
    ])).toEqual({ invoice: 17500000, paid: 14000000, difference: 1750000, com: 1750000 });
  });

  it('returns zeros for an empty period', () => {
    expect(computeTotals([])).toEqual({ invoice: 0, paid: 0, difference: 0, com: 0 });
  });
});
