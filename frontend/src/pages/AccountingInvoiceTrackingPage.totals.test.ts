import { describe, expect, it } from 'vitest';
import { computeTotals } from './AccountingInvoiceTrackingPage';

// Worked example from the card plan: unfiltered Tổng = 17.500.000 / 14.000.000 / 3.500.000.
describe('computeTotals', () => {
  it('sums invoice, paid and their difference from the filtered rows', () => {
    expect(computeTotals([
      { invoiceAmount: '12000000', supplierPayment: '8000000' },
      { invoiceAmount: '5500000', supplierPayment: '6000000' },
    ])).toEqual({ invoice: 17500000, paid: 14000000, difference: 3500000 });
  });

  it('returns zeros for an empty period', () => {
    expect(computeTotals([])).toEqual({ invoice: 0, paid: 0, difference: 0 });
  });
});
