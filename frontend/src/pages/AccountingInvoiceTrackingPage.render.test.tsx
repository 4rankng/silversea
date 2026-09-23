// Card 20260922_52 (rework v2) — RED-first regression for the internal-id leak.
//
// Operator screenshot 23/09: the board rendered "Số hóa đơn:
// INV-EMPTY-1790038443239-q10-q63uv3" rows on staging. Root cause is a leaked
// q10 integration-fixture row (backend/src/tests/q10-soft-delete.test.ts writes
// it straight into the application DB), and the page echoed invoiceNumber /
// shipmentCode / customerName verbatim. Design law 2026-09-19 (cards
// 20260919_38/39): internal ids and machine-generated codes never render as
// visible text — the cell shows the house empty value instead.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listInvoiceTracking: vi.fn(),
  createInvoiceTracking: vi.fn(),
  updateInvoiceTracking: vi.fn(),
  deleteInvoiceTracking: vi.fn(),
}));
vi.mock('../api/invoiceTrackingClient', () => client);
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));

import AccountingInvoiceTrackingPage from './AccountingInvoiceTrackingPage';
import type { InvoiceTrackingRow } from '@tingting/shared';

/** The exact row that sat live in the dev DB (`invoice_tracking` id 88,
 *  deleted_at NULL) and reproduced the operator's screenshot. */
const leakedRow: InvoiceTrackingRow = {
  id: 88,
  shipmentId: 1201,
  tripId: 679,
  containerNumber: 'QATU1234569',
  shipmentCode: 'Q10-1790165053059-q10-8h9x64-3',
  customerName: 'Q10 customer 1790165053059-q10-8h9x64 3',
  invoiceNumber: 'INV-EMPTY-1790165053059-q10-8h9x64',
  invoiceAmount: '12000000',
  supplierPayment: '8000000',
  difference: '4000000',
  taxCode: '0301234567',
  supplierName: 'CÔNG TY TNHH VẬN TẢI BIỂN ĐÔNG',
  comNote: null,
  invoiceSentAt: null,
  note: null,
  progress: 'CHUA_GUI',
  expenseDate: '2026-09-23',
  expenseId: 5,
};

/** A real row: business identifiers must survive the guard untouched. */
const realRow: InvoiceTrackingRow = {
  ...leakedRow,
  id: 12,
  shipmentCode: 'SHP-2609-00020',
  customerName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  invoiceNumber: 'HD-C18-01',
  progress: 'CO_HD',
  expenseDate: '2026-09-22',
};

function renderBoard(rows: InvoiceTrackingRow[]) {
  client.listInvoiceTracking.mockResolvedValue({
    rows,
    totals: { invoice: 12000000, paid: 8000000, difference: 4000000 },
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountingInvoiceTrackingPage />
    </QueryClientProvider>,
  );
}

describe('invoice-tracking board never paints internal identifiers', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
  });

  it('replaces a leaked q10 fixture row with the house empty value', async () => {
    renderBoard([leakedRow]);
    await screen.findByRole('table');
    await screen.findByText(/Số hóa đơn:/);

    expect(document.body.textContent ?? "").not.toMatch(/INV-EMPTY/i);
    expect(document.body.textContent ?? "").not.toMatch(/q10/i);
    expect(document.body.textContent ?? "").not.toContain('1790165053059');
    // Col 3 (mã lô + khách hàng) and col 7 (số hóa đơn) fall back to '—'.
    expect(screen.getByText('Số hóa đơn: —')).toBeInTheDocument();
  });

  it('leaves real business identifiers untouched', async () => {
    renderBoard([realRow]);
    await screen.findByText('Số hóa đơn: HD-C18-01');

    expect(screen.getByText('SHP-2609-00020')).toBeInTheDocument();
    expect(screen.getByText('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH')).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain('Số hóa đơn: —');
  });
});
