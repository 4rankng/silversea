// Card 386 rework v2 — the amount cells must render the WHOLE formatted
// amount + unit as ONE text node. The staging defect's token-walker signature
// was exactly this: `{formatMoney(x)} ₫` gives the browser two adjacent text
// nodes, and the ₫ broke onto its own line inside a nowrap cell.
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
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.listInvoiceTracking.mockResolvedValue({
    rows: [row],
    totals: { invoice: 12000000, paid: 8000000, difference: 4000000, com: 0 },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountingInvoiceTrackingPage />
    </QueryClientProvider>,
  );
}

describe('invoice tracking — amount cells render one text node (numeric law)', () => {
  it('Số tiền trả and Chênh lệch hold the whole amount + unit in a single node', async () => {
    renderPage();
    await screen.findByText(/Số hóa đơn:/);
    for (const [label, expected] of [['Số tiền trả', '8.000.000 ₫'], ['Chênh lệch', '4.000.000 ₫']] as const) {
      const td = document.querySelector(`td[data-label="${label}"]`) as HTMLElement;
      expect(td).toBeTruthy();
      expect(td.textContent).toBe(expected);
      const textNodes = [...td.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      expect(textNodes, `${label} must be one text node`).toHaveLength(1);
      expect(textNodes[0].textContent).toBe(expected);
    }
  });

  it('the stacked Hóa đơn money line is one nowrap node carrying the whole amount', async () => {
    renderPage();
    await screen.findByText(/Số hóa đơn:/);
    const moneyLine = document.querySelector('td[data-label="Hóa đơn"] .ivt-stack__sub') as HTMLElement;
    expect(moneyLine).toBeTruthy();
    expect(moneyLine.textContent).toBe('Số tiền: 12.000.000 ₫');
    const textNodes = [...moneyLine.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    expect(textNodes).toHaveLength(1);
    expect(moneyLine.className).toBe('ivt-stack__sub');
  });
});
