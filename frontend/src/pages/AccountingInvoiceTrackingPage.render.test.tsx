// Card 20260922_52 (rework v2) — RED-first regression for the internal-id leak.
//
// Operator screenshot 23/09: the board rendered "Số hóa đơn:
// INV-EMPTY-1790038443239-q10-q63uv3" rows on staging. Root cause is a leaked
// q10 integration-fixture row (backend/src/tests/q10-soft-delete.test.ts writes
// it straight into the application DB), and the page echoed invoiceNumber /
// shipmentCode / customerName verbatim. Design law 2026-09-19 (cards
// 20260919_38/39): internal ids and machine-generated codes never render as
// visible text — the cell shows the house empty value instead.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { businessDateISO } from '../lib/format';
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

// Card 20260927_152: the bespoke `.invoice-tracking-search` shell is gone — the
// text query now rides the shared `FilterBar` search slot. The filtering
// behaviour it drove is unchanged, so this pins the behaviour, not the shell.
describe('invoice-tracking filter bar search', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
  });

  it('narrows the rows through the shared search slot', async () => {
    renderBoard([realRow, { ...realRow, id: 13, invoiceNumber: 'HD-XYZ-9' }]);
    await screen.findByText('Số hóa đơn: HD-C18-01');

    fireEvent.change(screen.getByLabelText('Tìm theo số HĐ, MST, lô, cont'), { target: { value: 'HD-XYZ-9' } });

    expect(screen.queryByText('Số hóa đơn: HD-C18-01')).toBeNull();
    expect(screen.getByText('Số hóa đơn: HD-XYZ-9')).toBeInTheDocument();
  });
});

// Card 20261002_285 AC1. RED-first: the period scopes the QUERY, so it is a
// filter condition — but `hasActiveFilters` ignored it, and `clearFilters` never
// reset it. Two empty-state buttons were labelled "Xóa bộ lọc ngày" ("clear the
// DATE filter"; the landed copy is the shorter "Xóa bộ lọc") while calling a
// handler that could not touch the date, and a period-only filter armed no reset.
describe('invoice-tracking period is a resettable filter condition (card 20261002_285)', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
  });

  it('arms the bar reset for a period that differs from the default', async () => {
    renderBoard([]);
    await screen.findByText('Không tìm thấy hóa đơn nào trong kỳ đã chọn');
    // The default period is not a filter, so the strip reset stays disabled.
    expect(screen.getByRole('button', { name: 'Xóa lọc' })).toBeDisabled();

    // "Tháng trước" always differs from the default (1st of this month → today).
    // The preset group is a tablist, so its entries carry role="tab".
    fireEvent.click(screen.getByRole('tab', { name: /Tháng trước/ }));

    expect(screen.getByRole('button', { name: 'Xóa lọc' })).toBeEnabled();
  });

  it('Xóa lọc returns the query to the default period', async () => {
    renderBoard([]);
    await screen.findByText('Không tìm thấy hóa đơn nào trong kỳ đã chọn');
    fireEvent.click(screen.getByRole('tab', { name: /Tháng trước/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xóa lọc' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Xóa lọc' }));

    const today = businessDateISO();
    await waitFor(() => {
      const calls = client.listInvoiceTracking.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toBe(`${today.slice(0, 7)}-01`);
      expect(calls[calls.length - 1]?.[1]).toBe(today);
    });
    expect(screen.getByRole('button', { name: 'Xóa lọc' })).toBeDisabled();
  });
});
