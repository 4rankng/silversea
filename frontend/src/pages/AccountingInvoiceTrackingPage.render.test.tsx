// SIL-762 REV2 — the 8-column multi-line grid contract. Each grouped cell
// renders its inner lines; read-only lot facts auto-fill from the lot and
// Master Data (Mã KH · MST), Cột 4/5/7 are inline-edit inputs that commit on
// blur, and Cột 8 carries the progress vocabulary + the per-row Lưu và Ẩn.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listInvoiceTracking: vi.fn(),
  createInvoiceTracking: vi.fn(),
  updateInvoiceTracking: vi.fn(),
  deleteInvoiceTracking: vi.fn(),
}));
const authState = vi.hoisted(() => ({ role: 'ADMIN' }));
vi.mock('../api/invoiceTrackingClient', () => client);
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authState.role } }) }));
const csv = vi.hoisted(() => ({ downloadCSV: vi.fn() }));
vi.mock('../lib/csv', () => csv);

import AccountingInvoiceTrackingPage, { buildPeriodPresets } from './AccountingInvoiceTrackingPage';
import type { InvoiceTrackingRow } from '@tingting/shared';

const wireRow: InvoiceTrackingRow = {
  id: 900,
  shipmentId: 1201,
  tripId: null,
  containerNumber: 'CSNU2510003',
  containerType: "20'DC",
  tradeDirection: 'EXPORT',
  shipmentCode: 'SHP-2611-00424',
  customerName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  invoiceNumber: null,
  invoiceAmount: '0',
  supplierPayment: '0',
  difference: '0',
  taxCode: '0301234567',
  supplierName: null,
  comAmount: null,
  comNote: null,
  invoiceSentAt: null,
  note: null,
  progress: 'CHUA_GUI',
  expenseDate: '2026-11-05',
  expenseId: null,
  transportDate: '2026-11-05',
  bookingRef: 'SIL762BOOK77',
  blNumber: null,
  factoryName: 'Nhà máy Bích Hỏa',
  shippingLineName: 'MSC',
  customerCode: 'KH-017',
  dnttNumbers: ['ĐNTT-102'],
  isAutoSynced: true,
  noInvoice: false,
  hiddenAt: null,
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

beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset());
});

/** The RAC select trigger shows the selected value; the accessibility
 *  fallback mirrors ALL options into a hidden native select, so assertions
 *  read the trigger button, never the whole td text. */
function progressTriggerText(): string {
  const trigger = document.querySelector('td[data-label="Tiến độ xử lý"] button[aria-haspopup="listbox"]');
  return trigger?.textContent?.trim() ?? '';
}

describe('the 8-column multi-line grid (SIL-762 rev2)', () => {
  it('renders exactly the 8 contract headers for a writing role', async () => {
    renderBoard([wireRow]);
    await screen.findByText('CSNU2510003');
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim() || th.getAttribute('aria-label') || '');
    expect(headers).toEqual([
      'Chọn dòng', // checkbox column (aria-label only)
      'STT',
      'Khách hàng & Lô',
      'Cont & Chứng từ',
      'Đầu vào (Mua HĐ)',
      'Đối soát số tiền',
      'Chênh lệch',
      'Ghi chú & ĐNTT',
      'Tiến độ xử lý',
    ]);
  });

  it('groups lot identity into Cột 2/3 multi-line cells — auto MST, no manual re-typing', async () => {
    renderBoard([wireRow]);
    await screen.findByText('CSNU2510003');

    const customerCell = screen.getByText('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH').closest('td')!;
    expect(customerCell).toHaveAttribute('data-label', 'Khách hàng & Lô');
    expect(customerCell.textContent).toContain('KH-017 · 0301234567');
    expect(customerCell.textContent).toContain('Nhà máy Bích Hỏa');
    expect(customerCell.textContent).toContain('05/11/2026');

    const contCell = screen.getByText('CSNU2510003').closest('td')!;
    expect(contCell).toHaveAttribute('data-label', 'Cont & Chứng từ');
    expect(contCell.textContent).toContain("20'DC · Xuất");
    expect(contCell.textContent).toContain('SIL762BOOK77');
    expect(contCell.textContent).toContain('MSC');
    expect(document.body.textContent ?? '').not.toContain('EXPORT');
  });

  it('an auto-synced row without invoice facts reads Chưa lấy HĐ in Cột 8', async () => {
    renderBoard([wireRow]);
    await screen.findByText('CSNU2510003');
    expect(progressTriggerText()).toBe('Chưa lấy HĐ');
    // The per-row quick hide rides the same cell.
    expect(screen.getByRole('button', { name: 'Lưu và Ẩn dòng CSNU2510003' })).toBeInTheDocument();
  });

  it('a captured invoice reads Đã có HĐ instead of Chưa lấy HĐ', async () => {
    renderBoard([{ ...wireRow, invoiceNumber: 'HD-C18-01' }]);
    await screen.findByDisplayValue('HD-C18-01');
    expect(progressTriggerText()).toBe('Đã có HĐ');
  });

  it('computes Chênh lệch bold = thu − trả − trả KH on the row', async () => {
    renderBoard([{ ...wireRow, id: 902, invoiceNumber: 'HD-KH-1', invoiceAmount: '12000000', supplierPayment: '8000000', comAmount: '1750000' }]);
    await screen.findByDisplayValue('HD-KH-1');
    const td = document.querySelector('td[data-label="Chênh lệch"]')!;
    expect(td.textContent).toBe(`${2250000 .toLocaleString('vi-VN')} ₫`);
    expect(td.className).toContain('ivt-diff');
  });

  it('Cột 4 inline edits commit on blur — one PATCH per finished edit', async () => {
    client.updateInvoiceTracking.mockResolvedValue({});
    renderBoard([wireRow]);
    const supplier = await screen.findByLabelText('Nhà cung cấp HĐ — CSNU2510003');
    fireEvent.change(supplier, { target: { value: 'CÔNG TY IN ACHAU' } });
    fireEvent.blur(supplier);
    await waitFor(() => expect(client.updateInvoiceTracking).toHaveBeenCalledTimes(1));
    expect(client.updateInvoiceTracking).toHaveBeenCalledWith(900, { supplierName: 'CÔNG TY IN ACHAU' });

    // The date accepts dd/mm/yyyy and lands as ISO.
    const sentAt = screen.getByLabelText('Ngày gửi HĐ — CSNU2510003');
    fireEvent.change(sentAt, { target: { value: '09/11/2026' } });
    fireEvent.blur(sentAt);
    await waitFor(() => expect(client.updateInvoiceTracking).toHaveBeenCalledTimes(2));
    expect(client.updateInvoiceTracking).toHaveBeenLastCalledWith(900, { invoiceSentAt: '2026-11-09' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an invalid Ngày gửi HĐ never fires a PATCH', async () => {
    renderBoard([wireRow]);
    const sentAt = await screen.findByLabelText('Ngày gửi HĐ — CSNU2510003');
    fireEvent.change(sentAt, { target: { value: 'chưa gửi' } });
    fireEvent.blur(sentAt);
    await new Promise((r) => setTimeout(r, 300));
    expect(client.updateInvoiceTracking).not.toHaveBeenCalled();
  });

  it('Cột 5 money inputs commit integers; blank Trả KH means null (not 0)', async () => {
    client.updateInvoiceTracking.mockResolvedValue({});
    renderBoard([{ ...wireRow, id: 903, invoiceAmount: '12000000' }]);
    const thu = await screen.findByLabelText('Số tiền thu — CSNU2510003');
    expect(thu).toHaveValue('12000000');
    fireEvent.change(thu, { target: { value: '13000000' } });
    fireEvent.blur(thu);
    const traKH = screen.getByLabelText('Số tiền trả KH — CSNU2510003');
    fireEvent.change(traKH, { target: { value: '1750000' } });
    fireEvent.blur(traKH);
    await waitFor(() => expect(client.updateInvoiceTracking).toHaveBeenCalledTimes(2));
    expect(client.updateInvoiceTracking).toHaveBeenCalledWith(903, { invoiceAmount: 13000000 });
    expect(client.updateInvoiceTracking).toHaveBeenLastCalledWith(903, { comAmount: 1750000 });
  });

  it('selecting Không lấy HĐ hides the row through the same Lưu và Ẩn law', async () => {
    client.updateInvoiceTracking.mockResolvedValue({});
    renderBoard([wireRow]);
    await screen.findByText('CSNU2510003');
    // The select is a React Aria control: click trigger, click option.
    const trigger = document.querySelector('td[data-label="Tiến độ xử lý"] button[aria-haspopup="listbox"]') as HTMLElement;
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'Không lấy HĐ' }));
    await waitFor(() => expect(client.updateInvoiceTracking).toHaveBeenCalledTimes(1));
    expect(client.updateInvoiceTracking).toHaveBeenCalledWith(900, { noInvoice: true, hidden: true });
  });

  it('Lưu và Ẩn ticks "Không lấy hóa đơn" and hides every selected row (bulk)', async () => {
    client.updateInvoiceTracking.mockResolvedValue({});
    renderBoard([wireRow, { ...wireRow, id: 901, containerNumber: 'CSNU4520000' }]);
    await screen.findByText('CSNU2510003');
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn dòng CSNU2510003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn dòng CSNU4520000/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu và Ẩn \(2\)/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu và Ẩn' }));
    await waitFor(() => expect(client.updateInvoiceTracking).toHaveBeenCalledTimes(2));
    expect(client.updateInvoiceTracking.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { noInvoice: true, hidden: true },
      { noInvoice: true, hidden: true },
    ]);
  });

  it('the hidden filter refetches with includeHidden so the trace stays queryable', async () => {
    renderBoard([{ ...wireRow, noInvoice: true, hiddenAt: '2026-11-09T00:00:00.000Z' }]);
    await screen.findByText('CSNU2510003');
    expect(client.listInvoiceTracking.mock.calls.at(-1)?.[2]).toEqual({ includeHidden: false });

    fireEvent.click(screen.getByRole('button', { name: /Dòng đã ẩn/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Hiện cả dòng đã ẩn/ }));
    await waitFor(() => expect(client.listInvoiceTracking.mock.calls.at(-1)?.[2]).toEqual({ includeHidden: true }));
  });

  it('a hidden row carries the Bỏ ẩn affordance and reads Không lấy HĐ', async () => {
    renderBoard([{ ...wireRow, noInvoice: true, hiddenAt: '2026-11-09T00:00:00.000Z' }]);
    await screen.findByText('CSNU2510003');
    // includeHidden=false by default — the mock returns the row regardless.
    expect(screen.getByRole('button', { name: 'Bỏ ẩn dòng' })).toBeInTheDocument();
    expect(progressTriggerText()).toBe('Không lấy HĐ');
  });

  it('exports the rev2 data sheet: same fields, one row per container', async () => {
    renderBoard([wireRow]);
    await screen.findByText('CSNU2510003');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    const [filename, headers, body] = csv.downloadCSV.mock.calls[0] as [string, string[], unknown[][]];
    expect(filename).toBe('theo-doi-hoa-don.xlsx');
    expect(headers.slice(0, 6)).toEqual(['STT', 'Ngày vận chuyển', 'Khách hàng', 'Mã KH', 'MST', 'Nhà máy']);
    expect(headers).toContain('Số tiền thu');
    expect(headers).toContain('Số tiền trả KH');
    expect(headers).toContain('Chênh lệch');
    expect(headers).toContain('Số ĐNTT');
    expect(body[0][headers.indexOf('Số Container')]).toBe('CSNU2510003');
  });
});

describe('buildPeriodPresets — the month-end law (invoice-tracking 400 fix)', () => {
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

describe('read-only CUS board (write roles only get editors)', () => {
  it('drops the checkbox column and renders money as text for a reader', async () => {
    authState.role = 'CUS';
    try {
      client.listInvoiceTracking.mockResolvedValue({
        rows: [{ ...wireRow, invoiceAmount: '12000000', supplierPayment: '8000000' }],
        totals: { invoice: 12000000, paid: 8000000, difference: 4000000, com: 0 },
      });
      renderBoard([{ ...wireRow, invoiceAmount: '12000000', supplierPayment: '8000000' }]);
      await screen.findByText('CSNU2510003');
      expect(document.querySelector('thead th[aria-label="Chọn dòng"]')).toBeNull();
      expect(document.querySelector('.ivt-inline-input')).toBeNull();
      const moneyTd = document.querySelector('td[data-label="Đối soát số tiền"]')!;
      expect(moneyTd.textContent).toContain('Thu KH: 12.000.000 ₫');
      expect(moneyTd.textContent).toContain('Trả NCC: 8.000.000 ₫');
    } finally {
      authState.role = 'ADMIN';
    }
  });
});
