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
const csv = vi.hoisted(() => ({ downloadCSV: vi.fn() }));
vi.mock('../lib/csv', () => csv);

import AccountingInvoiceTrackingPage, { buildPeriodPresets } from './AccountingInvoiceTrackingPage';
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
  // SIL-762 — the 21-column wire grew lot-fact + sync-flag fields.
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
    await screen.findByText('QATU1234569');

    expect(document.body.textContent ?? "").not.toMatch(/INV-EMPTY/i);
    expect(document.body.textContent ?? "").not.toMatch(/q10/i);
    expect(document.body.textContent ?? "").not.toContain('1790165053059');
    // The Số hóa đơn cell falls back to the house '—' (the header carries the
    // name; the cell prints only the redacted value).
    expect(document.querySelector('td[data-label="Số hóa đơn"]')?.textContent).toBe('—');
  });

  it('leaves real business identifiers untouched', async () => {
    renderBoard([realRow]);
    await screen.findByText('HD-C18-01');

    expect(screen.getByText('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH')).toBeInTheDocument();
    expect(document.querySelector('td[data-label="Số hóa đơn"]')?.textContent).toBe('HD-C18-01');
    // SIL-762: the board keys rows on Bill / Booking (the display-key law);
    // the machine lot code has no column and must not leak as visible text.
    expect(document.body.textContent ?? "").not.toContain('SHP-2609-00020');
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
    await screen.findByText('HD-C18-01');

    fireEvent.change(screen.getByLabelText('Tìm theo số HĐ, MST, Bill, lô, cont'), { target: { value: 'HD-XYZ-9' } });

    expect(screen.queryByText('HD-C18-01')).toBeNull();
    expect(screen.getByText('HD-XYZ-9')).toBeInTheDocument();
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

// Card 20261005_383 merged số cont / loại cont / xuất–nhập into ONE cell;
// SIL-762's 21-column contract splits them back out as three board columns
// (Cont (20/40) · Xuất / Nhập · Số Container). These are properties of the
// container/shipment, never re-entered per invoice — the principle survives,
// the columns follow the contract.
describe('invoice-tracking container facts (card 20261005_383, SIL-762 columns)', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
    csv.downloadCSV.mockReset();
  });

  it('renders the type in Cont (20/40), the direction in Xuất / Nhập, the number in Số Container', async () => {
    renderBoard([realRow]);
    await screen.findByText('HD-C18-01');

    expect(screen.getByText("40'HC").closest('td')).toHaveAttribute('data-label', 'Cont (20/40)');
    // IMPORT is painted as the Vietnamese label, never the raw enum.
    expect(screen.getByText('Nhập').closest('td')).toHaveAttribute('data-label', 'Xuất / Nhập');
    expect(document.body.textContent ?? "").not.toContain('IMPORT');
    expect(screen.getByText('TGHU7654321').closest('td')).toHaveAttribute('data-label', 'Số Container');
  });

  it('falls back to the house empty value in every derived column', async () => {
    renderBoard([{ ...realRow, containerNumber: null, containerType: null, tradeDirection: null }]);
    await screen.findByText('HD-C18-01');

    expect(document.querySelector('td[data-label="Cont (20/40)"]')?.textContent).toBe('—');
    expect(document.querySelector('td[data-label="Xuất / Nhập"]')?.textContent).toBe('—');
    expect(document.querySelector('td[data-label="Số Container"]')?.textContent).toBe('—');
  });

  it('exports the 21-column sheet in the contract order', async () => {
    renderBoard([realRow]);
    await screen.findByText('HD-C18-01');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    const [filename, headers, body] = csv.downloadCSV.mock.calls[0] as [string, string[], unknown[][]];
    expect(filename).toBe('theo-doi-hoa-don.xlsx');
    expect(headers).toEqual([
      'STT', 'Ngày vận chuyển', 'Khách hàng', 'Nhà máy', 'Bill / Số tờ khai', 'Hãng tàu',
      'Cont (20/40)', 'Xuất/Nhập', 'Số Container', 'Mã khách hàng', 'Mã số thuế',
      'Nhà cung cấp HĐ', 'Số hóa đơn', 'Số tiền trả', 'Số tiền thu', 'Số tiền trả KH',
      'Chênh lệch', 'Ngày gửi HĐ', 'Ghi chú', 'Tiến độ', 'Số ĐNTT',
    ]);
    const indexOf = (label: string) => headers.indexOf(label);
    expect(body[0][indexOf('Cont (20/40)')]).toBe("40'HC");
    expect(body[0][indexOf('Xuất/Nhập')]).toBe('Nhập');
    expect(body[0][indexOf('Số Container')]).toBe('TGHU7654321');
    // SIL-762 law: Chênh lệch = thu − trả − trả KH (com null → 0).
    expect(body[0][indexOf('Số tiền trả')]).toBe(8000000);
    expect(body[0][indexOf('Số tiền thu')]).toBe(12000000);
    expect(body[0][indexOf('Số tiền trả KH')]).toBe('');
    expect(body[0][indexOf('Chênh lệch')]).toBe(4000000);
  });

  it('exports the raw empty string — not a dash — for a missing part', async () => {
    renderBoard([{ ...realRow, containerType: null, tradeDirection: null }]);
    await screen.findByText('HD-C18-01');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    const [, headers, body] = csv.downloadCSV.mock.calls[0] as [string, string[], unknown[][]];
    expect(body[0][headers.indexOf('Cont (20/40)')]).toBe('');
    expect(body[0][headers.indexOf('Xuất/Nhập')]).toBe('');
  });
});

/** Card 2026-10-05_384 — COM became money and gained a 4th totals box; SIL-762
 *  renames the column to its spec name "Số tiền trả KH". Two acceptance
 *  criteria live here:
 *   1. a LEGACY row that only carries the free-text note must still show that
 *      text — the amount column never quietly drops the note real rows carry;
 *   2. the strip renders the box from the server's `totals.com`. */
describe('invoice-tracking Số tiền trả KH cell and totals strip (card 2026-10-05_384 + SIL-762)', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
  });

  const withCom = (over: Partial<InvoiceTrackingRow>): InvoiceTrackingRow => ({
    ...leakedRow, id: 500, comAmount: null, comNote: null, ...over,
  });

  it('shows the deduction amount, and keeps the legacy note underneath when there is one', async () => {
    renderBoard([withCom({ comAmount: '1750000', comNote: 'Trừ khách 500000' })]);
    await screen.findByText(/QATU1234569/);
    // Assert the CELL's rendered text, so the amount and the note are checked
    // as the pair the column actually shows (stacked), not as separate lookups.
    const comCell = () => document.querySelector('td[data-label="Số tiền trả KH"]')?.textContent ?? '';
    expect(comCell()).toContain('1.750.000');
    expect(comCell()).toContain('Trừ khách 500000');
    expect(screen.getByText('Trừ khách 500000')).toBeInTheDocument();
  });

  it('still renders a legacy text-only deduction row, with no amount', async () => {
    renderBoard([withCom({ comAmount: null, comNote: 'Trừ khách 500000' })]);
    await screen.findByText(/QATU1234569/);
    expect(screen.getByText('Trừ khách 500000')).toBeInTheDocument();
  });

  it('falls back to the house empty value only when both are empty', async () => {
    renderBoard([withCom({ comAmount: null, comNote: null })]);
    await screen.findByText(/QATU1234569/);
    // No amount and no note → the row shows the house '—' placeholder.
    expect(document.querySelector('td[data-label="Số tiền trả KH"]')?.textContent).toBe('—');
  });

  it('renders the 4-box totals strip in the SIL-762 vocabulary', async () => {
    renderBoard([withCom({ comAmount: '1750000' })]);
    await screen.findByText(/QATU1234569/);
    // The labels exist in BOTH the strip and the thead (same vocabulary by
    // design), so multiplicity is the assertion, not uniqueness.
    for (const label of ['Số tiền thu', 'Số tiền trả', 'Số tiền trả KH', 'Chênh lệch']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });
});

describe('buildPeriodPresets — the month-end law (invoice-tracking 400 fix)', () => {
  // Operator report 12/10: clicking "Tháng trước" in October sent
  // to=2026-09-31 and the backend answered 400 "Khoảng ngày không hợp lệ:
  // 2026-09-31". The last-day helper read the PREVIOUS month's length.
  it('ends September on the 30th, not August\'s 31st', () => {
    const presets = buildPeriodPresets('2026-10-12');
    const lastMonth = presets.find(p => p.id === 'last-month')!;
    expect(lastMonth.range()).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('ends February on its real length, leap or not', () => {
    expect(buildPeriodPresets('2024-03-15').find(p => p.id === 'last-month')!.range())
      .toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(buildPeriodPresets('2025-03-15').find(p => p.id === 'last-month')!.range())
      .toEqual({ from: '2025-02-01', to: '2025-02-28' });
  });

  it('crosses the year boundary: January looks back to December', () => {
    expect(buildPeriodPresets('2026-01-08').find(p => p.id === 'last-month')!.range())
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

// ─── SIL-762 (id 883) — the combined board contract ─────────────────────────
describe('invoice-tracking 21-column combined board (SIL-762)', () => {
  beforeEach(() => {
    Object.values(client).forEach((fn) => fn.mockReset());
  });

  const autoRow: InvoiceTrackingRow = {
    ...leakedRow,
    id: 900,
    tripId: null,
    invoiceNumber: null,
    invoiceAmount: '0',
    supplierPayment: '0',
    isAutoSynced: true,
    containerNumber: 'CSNU2510001',
    bookingRef: 'BOOK-8899',
    blNumber: null,
    factoryName: 'Nhà máy Bích Hỏa',
    shippingLineName: 'MSC',
    customerCode: 'KH-017',
    dnttNumbers: ['ĐNTT-102', 'ĐNTT-105'],
    transportDate: '2026-11-05',
  };

  it('keeps the board at exactly the 21 contract headers for a writing role', async () => {
    renderBoard([autoRow]);
    await screen.findByText('CSNU2510001');
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    expect(headers).toEqual([
      '', // Checkbox chọn dòng (aria-label only)
      'STT', 'Ngày vận chuyển', 'Khách hàng', 'Nhà máy', 'Bill / Số tờ khai', 'Hãng tàu',
      'Cont (20/40)', 'Xuất / Nhập', 'Số Container', 'Mã khách hàng', 'Mã số thuế',
      'Nhà cung cấp HĐ (+)', 'Số hóa đơn', 'Số tiền trả', 'Số tiền thu', 'Số tiền trả KH',
      'Chênh lệch', 'Ngày gửi HĐ', 'Ghi chú', 'Tiến độ & Số ĐNTT',
    ]);
  });

  it('shows the Chưa lấy HĐ badge on an auto-synced row without invoice facts', async () => {
    renderBoard([autoRow]);
    await screen.findByText('CSNU2510001');
    expect(screen.getByText('Chưa lấy HĐ')).toBeInTheDocument();
    expect(screen.getByText('BOOK-8899')).toBeInTheDocument();
    expect(screen.getByText('Nhà máy Bích Hỏa')).toBeInTheDocument();
    expect(screen.getByText('MSC')).toBeInTheDocument();
    expect(screen.getByText('KH-017')).toBeInTheDocument();
    expect(screen.getByText('ĐNTT: ĐNTT-102, ĐNTT-105')).toBeInTheDocument();
    // Ngày vận chuyển reads the LOT transport date, not the tracker row date.
    expect(document.querySelector('td[data-label="Ngày vận chuyển"]')?.textContent).toContain('05/11/2026');
  });

  it('marks a no-invoice row instead of the pending badge', async () => {
    renderBoard([{ ...autoRow, noInvoice: true, hiddenAt: '2026-11-09T00:00:00.000Z' }]);
    await screen.findByText('CSNU2510001');
    expect(screen.queryByText('Chưa lấy HĐ')).toBeNull();
    expect(screen.getByText('Không lấy hóa đơn')).toBeInTheDocument();
    // Hidden rows carry the Bỏ ẩn affordance — the trace stays actionable.
    expect(screen.getByRole('button', { name: 'Bỏ ẩn dòng' })).toBeInTheDocument();
  });

  it('Lưu và Ẩn ticks "Không lấy hóa đơn" and hides every selected row', async () => {
    client.updateInvoiceTracking.mockResolvedValue({});
    renderBoard([autoRow, { ...autoRow, id: 901, containerNumber: 'CSNU4510002' }]);
    await screen.findByText('CSNU2510001');
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn dòng CSNU2510001/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn dòng CSNU4510002/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu và Ẩn \(2\)/ }));
    // The confirm dialog states the semantics; accepting fires the writes.
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu và Ẩn' }));
    await waitFor(() => expect(client.updateInvoiceTracking).toHaveBeenCalledTimes(2));
    expect(client.updateInvoiceTracking.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { noInvoice: true, hidden: true },
      { noInvoice: true, hidden: true },
    ]);
  });

  it('the hidden filter refetches with includeHidden so the trace stays queryable', async () => {
    renderBoard([{ ...autoRow, noInvoice: true, hiddenAt: '2026-11-09T00:00:00.000Z' }]);
    await screen.findByText('CSNU2510001');
    expect(client.listInvoiceTracking.mock.calls.at(-1)?.[2]).toEqual({ includeHidden: false });

    // jsdom measures the bar inline: the criterion renders directly on the
    // strip (React Aria select — click the trigger button, then the option).
    fireEvent.click(screen.getByRole('button', { name: /Dòng đã ẩn/ }));
    const option = await screen.findByRole('option', { name: /Hiện cả dòng đã ẩn/ });
    fireEvent.click(option);
    await waitFor(() => expect(client.listInvoiceTracking.mock.calls.at(-1)?.[2]).toEqual({ includeHidden: true }));
  });

  it('computes Chênh lệch = thu − trả − trả KH on the row cell', async () => {
    renderBoard([{ ...autoRow, id: 902, invoiceNumber: 'HD-KH-1', invoiceAmount: '12000000', supplierPayment: '8000000', comAmount: '1750000' }]);
    await screen.findByText('HD-KH-1');
    const td = document.querySelector('td[data-label="Chênh lệch"]')!;
    expect(td.textContent).toBe(`${2250000 .toLocaleString('vi-VN')} ₫`);
  });
});
