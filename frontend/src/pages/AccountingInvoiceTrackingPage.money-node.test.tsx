// SIL-762 REV2 — Cột 6 (Chênh lệch) is the one read-only money cell: the
// whole formatted amount + unit must render as ONE text node. The staging
// defect's token-walker signature was `{formatMoney(x)} ₫` giving the browser
// two adjacent text nodes, and the ₫ broke onto its own line. The editable
// Cột 5 money inputs carry values through the DOM (input.value), so the law
// now pins the auto cell.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listInvoiceTracking: vi.fn(),
  createInvoiceTracking: vi.fn(),
  updateInvoiceTracking: vi.fn(),
  deleteInvoiceTracking: vi.fn(),
}));
vi.mock('../api/invoiceTrackingClient', () => client);
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));
vi.mock('../lib/csv', () => ({ downloadCSV: vi.fn() }));

import AccountingInvoiceTrackingPage from './AccountingInvoiceTrackingPage';
import type { InvoiceTrackingRow } from '@tingting/shared';

const row: InvoiceTrackingRow = {
  id: 901,
  shipmentId: 1300,
  tripId: 700,
  containerNumber: 'QATU0000001',
  containerType: null,
  tradeDirection: null,
  shipmentCode: 'SHP-2610-00019',
  customerName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  invoiceNumber: 'INV-386-V2',
  invoiceAmount: '12000000',
  supplierPayment: '8000000',
  difference: '4000000',
  taxCode: null,
  supplierName: 'Nhà cung cấp A',
  comAmount: null,
  comNote: null,
  invoiceSentAt: null,
  note: null,
  progress: 'CHUA_GUI',
  expenseDate: '2026-10-06',
  expenseId: 6,
  transportDate: null,
  bookingRef: null,
  blNumber: null,
  factoryName: null,
  shippingLineName: null,
  customerCode: null,
  dnttNumbers: [],
  isAutoSynced: false,
  noInvoice: false,
  hiddenAt: null,
};

function renderPage(rows: InvoiceTrackingRow[] = [row]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.listInvoiceTracking.mockResolvedValue({
    rows,
    totals: { invoice: 12000000, paid: 8000000, difference: 4000000, com: 0 },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountingInvoiceTrackingPage />
    </QueryClientProvider>,
  );
}

describe('invoice tracking — Chênh lệch renders one text node (numeric law)', () => {
  it('Cột 6 holds the whole amount + unit in a single node', async () => {
    renderPage();
    await screen.findByDisplayValue('INV-386-V2');
    const td = document.querySelector('td[data-label="Chênh lệch"]') as HTMLElement;
    expect(td).toBeTruthy();
    expect(td.textContent).toBe('4.000.000 ₫');
    const textNodes = [...td.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    expect(textNodes, 'Chênh lệch must be one text node').toHaveLength(1);
    expect(textNodes[0].textContent).toBe('4.000.000 ₫');
    // The three Cột 5 money inputs mirror the wire values (editable law).
    expect((screen.getByLabelText('Số tiền thu — QATU0000001') as HTMLInputElement).value).toBe('12000000');
    expect((screen.getByLabelText('Số tiền trả — QATU0000001') as HTMLInputElement).value).toBe('8000000');
    expect((screen.getByLabelText('Số tiền trả KH — QATU0000001') as HTMLInputElement).value).toBe('');
  });

  it('the auto cell folds the customer deduction into the difference — SIL-762 law', async () => {
    renderPage([{ ...row, comAmount: '1750000' }]);
    await screen.findByDisplayValue('INV-386-V2');
    expect(document.querySelector('td[data-label="Chênh lệch"]')?.textContent).toBe('2.250.000 ₫');
  });
});
