// Card 20260922_52 (rework v2) — RED-first regression for the internal-id leak.
//
// Operator screenshot 23/09: the board rendered "Số hóa đơn:
// INV-EMPTY-1790038443239-q10-q63uv3" rows on staging. Root cause is a leaked
// q10 integration-fixture row (backend/src/tests/q10-soft-delete.test.ts writes
// it straight into the application DB), and the page echoed invoiceNumber /
// shipmentCode / customerName verbatim. Design law 2026-09-19 (cards
// 20260919_38/39): internal ids and machine-generated codes never render as
// visible text — the cell shows the house empty value instead.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const csv = vi.hoisted(() => ({ downloadCSV: vi.fn() }));
vi.mock('../lib/csv', () => csv);

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
  containerType: null,
  tradeDirection: null,
  shipmentCode: 'Q10-1790165053059-q10-8h9x64-3',
  customerName: 'Q10 customer 1790165053059-q10-8h9x64 3',
  invoiceNumber: 'INV-EMPTY-1790165053059-q10-8h9x64',
  invoiceAmount: '12000000',
  supplierPayment: '8000000',
  difference: '4000000',
  taxCode: '0301234567',
  supplierName: 'CÔNG TY TNHH VẬN TẢI BIỂN ĐÔNG',
  // Card 2026-10-05_384: the row this fixture was captured from predates the
  // COM amount column, so it rides the null path like every pre-card row.
  comAmount: null,
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
  containerNumber: 'TGHU7654321',
  containerType: "40'HC",
  tradeDirection: 'IMPORT',
};

function renderBoard(rows: InvoiceTrackingRow[]) {
  client.listInvoiceTracking.mockResolvedValue({
    rows,
    totals: { invoice: 12000000, paid: 8000000, difference: 4000000, com: 0 },
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

// Card 20261005_383 — the "Cont" cell carries three DERIVED facts in one
// column (số cont / loại cont / xuất–nhập) and the export sheet grows the
// matching two Vietnamese columns. The form is untouched: these are properties
// of the container/shipment, never re-entered per invoice.
describe('invoice-tracking container facts (card 20261005_383)', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
    csv.downloadCSV.mockReset();
  });

  it('stacks số cont / loại cont / xuất–nhập in the single Cont cell', async () => {
    renderBoard([realRow]);
    await screen.findByText('Số hóa đơn: HD-C18-01');

    const contCell = screen.getByText('TGHU7654321').closest('td')!;
    expect(contCell).toHaveAttribute('data-label', 'Cont');
    expect(within(contCell).getByText("40'HC")).toBeInTheDocument();
    // IMPORT is painted as the Vietnamese label, never the raw enum.
    expect(within(contCell).getByText('Nhập')).toBeInTheDocument();
    expect(contCell.textContent).not.toContain('IMPORT');
  });

  it('falls back to the house empty value for every missing part', async () => {
    renderBoard([{ ...realRow, containerNumber: null, containerType: null, tradeDirection: null }]);
    await screen.findByText('Số hóa đơn: HD-C18-01');

    const contCells = [...document.querySelectorAll('td[data-label="Cont"]')];
    expect(contCells).toHaveLength(1);
    // One "—" per missing part: the number, the type and the direction.
    expect(contCells[0].querySelectorAll('.ivt-stack > span')).toHaveLength(3);
    expect(contCells[0].textContent).toBe('———');
  });

  it('exports the two new columns with Vietnamese headers, right after Cont', async () => {
    renderBoard([realRow]);
    await screen.findByText('Số hóa đơn: HD-C18-01');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    const [filename, headers, body] = csv.downloadCSV.mock.calls[0] as [string, string[], unknown[][]];
    expect(filename).toBe('theo-doi-hoa-don.xlsx');
    const contIndex = headers.indexOf('Cont');
    expect(headers[contIndex + 1]).toBe('Loại cont');
    expect(headers[contIndex + 2]).toBe('Xuất/Nhập');
    // The pre-existing columns survive, in order.
    expect(headers.slice(contIndex + 3, contIndex + 6)).toEqual(['MST', 'Nhà cung cấp', 'Số hóa đơn']);
    expect(body[0][contIndex + 1]).toBe("40'HC");
    expect(body[0][contIndex + 2]).toBe('Nhập');
  });

  it('exports the raw empty string — not a dash — for a missing part', async () => {
    renderBoard([{ ...realRow, containerType: null, tradeDirection: null }]);
    await screen.findByText('Số hóa đơn: HD-C18-01');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    const [, headers, body] = csv.downloadCSV.mock.calls[0] as [string, string[], unknown[][]];
    const contIndex = headers.indexOf('Cont');
    expect(body[0][contIndex + 1]).toBe('');
    expect(body[0][contIndex + 2]).toBe('');
  });
});

/** Card 2026-10-05_384 — COM becomes money, and the totals strip gains a 4th
 *  box. Two acceptance criteria live here and had no coverage before:
 *   1. a LEGACY row that only carries the free-text `comNote` must still show
 *      that text — adding an amount column must not quietly drop the note that
 *      real existing rows depend on; and
 *   2. the strip renders `Tổng COM` from the server's `totals.com`. */
describe('invoice-tracking COM cell and totals strip (card 2026-10-05_384)', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
  });

  const withCom = (over: Partial<InvoiceTrackingRow>): InvoiceTrackingRow => ({
    ...leakedRow, id: 500, comAmount: null, comNote: null, ...over,
  });

  it('shows the COM amount, and keeps the legacy note underneath when there is one', async () => {
    renderBoard([withCom({ comAmount: '1750000', comNote: 'Trừ khách 500000' })]);
    await screen.findByText('Số hóa đơn: —');
    // Assert the CELL's rendered text, so the amount and the note are checked
    // as the pair the column actually shows (stacked), not as separate lookups.
    const comCell = () => document.querySelector('td[data-label="COM"]')?.textContent ?? '';
    expect(comCell()).toContain('1.750.000');
    expect(comCell()).toContain('Trừ khách 500000');
    expect(screen.getByText('Trừ khách 500000')).toBeInTheDocument();
  });

  it('still renders a legacy text-only COM row, with no amount', async () => {
    renderBoard([withCom({ comAmount: null, comNote: 'Trừ khách 500000' })]);
    await screen.findByText('Số hóa đơn: —');
    expect(screen.getByText('Trừ khách 500000')).toBeInTheDocument();
  });

  it('falls back to the house empty value only when both are empty', async () => {
    renderBoard([withCom({ comAmount: null, comNote: null })]);
    await screen.findByText('Số hóa đơn: —');
    // No amount and no note → the row shows the house '—' placeholder.
    expect(screen.getByText('Số hóa đơn: —')).toBeInTheDocument();
  });

  it('renders a 4th totals box: Tổng COM, alongside the three pre-existing ones', async () => {
    renderBoard([withCom({ comAmount: '1750000' })]);
    // The strip grew from 3 boxes to 4. The VALUE arithmetic is pinned in
    // AccountingInvoiceTrackingPage.totals.test.ts (computeTotals is client-side
    // over the period-filtered rows); what matters here is that the box renders.
    await screen.findByText('Tổng COM');
    expect(screen.getByText('Tổng COM')).toBeInTheDocument();
    // The three pre-existing labels are still there.
    expect(screen.getByText('Hóa đơn')).toBeInTheDocument();
    expect(screen.getByText('Trả NCC')).toBeInTheDocument();
    expect(screen.getByText('Chênh lệch')).toBeInTheDocument();
  });
});
