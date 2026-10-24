import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Card 20261006_391 — the two customer CSV exports (the strip "Xuất Excel"
 * and the bulk bar "Xuất CSV đã chọn") downloaded with no busy feedback and
 * an unguarded await: a failed download died as an unhandled rejection. Both
 * handlers follow the FinancePage export contract (QA PASSED 06/10): busy
 * label on the button, success toast, error toast.
 */

const getCustomers = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const downloadCSV = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('../api/configClient', () => ({
  configClient: { getCustomers },
}));
vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../lib/csv', () => ({ downloadCSV }));
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../hooks/useQueries', () => ({
  useCustomerLedgerEntries: vi.fn(() => ({ data: [] })),
}));

import CustomersPage from './CustomersPage';

const customer = {
  id: 7,
  // Realistic stored shape (SIL-169): legal names live in ALL CAPS in the
  // catalog; the table renders them title-case — "Công Ty TNHH Ánh Dương".
  name: 'CÔNG TY TNHH ÁNH DƯƠNG',
  shortName: 'Ánh Dương',
  taxCode: '0101234567',
  contactPerson: 'Nguyễn Văn Bình',
  phone: '0901234567',
  creditLimit: 50000000,
  status: 'ACTIVE',
  updatedAt: '2026-10-06T03:45:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The table row of the seeded customer. jsdom renders BOTH faces (the mobile
 * card list and the desktop table), so the title-cased name matches twice —
 * the row is the match that sits inside a <tr>. */
async function nameRow() {
  const cells = await screen.findAllByText('Công Ty TNHH Ánh Dương');
  const row = cells.map((cell) => cell.closest('tr')).find((tr) => tr !== null);
  if (!row) throw new Error('customer row not found');
  return row;
}

beforeEach(() => {
  getCustomers.mockReset().mockResolvedValue({ items: [customer], total: 1 });
  apiGet.mockReset().mockResolvedValue({ items: [] });
  downloadCSV.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
});

describe('CustomersPage CSV export feedback (card 20261006_391)', () => {
  it('strip export shows a busy label while building and toasts success when ready', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Xuất Excel' });
    let resolveCsv: () => void = () => {};
    downloadCSV.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveCsv = resolve; }),
    );

    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeTruthy();

    resolveCsv();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith({ kind: 'success', message: 'Đã xuất danh sách khách hàng' });
  });

  it('strip export toasts an error when the download fails', async () => {
    renderPage();
    downloadCSV.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(await screen.findByRole('button', { name: 'Xuất Excel' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ kind: 'error', message: 'Chưa xuất được danh sách khách hàng — vui lòng thử lại.' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy());
  });

  it('bulk-bar selected export shows a busy label and toasts success when ready', async () => {
    renderPage();
    // Row selection from the keyboard (card 20260929_207 contract): Enter on
    // the focused row toggles it, bypassing the interactive-child rule that
    // makes row clicks ambiguous in a dense table.
    fireEvent.keyDown(await nameRow(), { key: 'Enter' });
    const btn = await screen.findByRole('button', { name: 'Xuất CSV đã chọn' });
    let resolveCsv: () => void = () => {};
    downloadCSV.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveCsv = resolve; }),
    );

    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeTruthy();

    resolveCsv();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất CSV đã chọn' })).toBeTruthy());
    expect(toast).toHaveBeenCalledWith({ kind: 'success', message: 'Đã xuất khách hàng đã chọn' });
  });

  it('bulk-bar selected export toasts an error when the download fails', async () => {
    renderPage();
    fireEvent.keyDown(await nameRow(), { key: 'Enter' });
    downloadCSV.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(await screen.findByRole('button', { name: 'Xuất CSV đã chọn' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ kind: 'error', message: 'Chưa xuất được danh sách đã chọn — vui lòng thử lại.' }));
  });
});

describe('CustomersPage table contract (SIL-169) + updatedAt carry (card 061026172805, FB-007)', () => {
  it('renders the 7-column verdict header and the title-cased identity', async () => {
    renderPage();
    // The verdict's column set: identity, MST, address, merged contact,
    // payment term, debt, kebab. The retired columns (Trạng thái, Cước thu /
    // trả, Cập nhật, split contact) must not come back as headers. (jsdom
    // renders both faces, so headers may also appear as mobile labels —
    // query all matches.)
    for (const header of ['Khách hàng', 'MST', 'Địa chỉ', 'Liên hệ', 'Hạn thanh toán', 'Công nợ']) {
      expect((await screen.findAllByText(header)).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Trạng thái')).toBeNull();
    expect(screen.queryByText('Cước thu / trả')).toBeNull();
    expect(screen.queryByText('Cập nhật')).toBeNull();
    // The stored ALL-CAPS name renders title-case with the abbreviation chip
    // (both the mobile card face and the table face).
    expect((await screen.findAllByText('Công Ty TNHH Ánh Dương')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ánh Dương').length).toBeGreaterThan(0);
  });

  it('the last-updated timestamp moved into the detail drawer (FB-007 carry)', async () => {
    renderPage();
    await nameRow();
    // SIL-169 retired the Cập nhật COLUMN; the datum rides the row drawer —
    // the seeded row must still surface its formatted last-updated value.
    fireEvent.click(screen.getByRole('button', { name: 'Mở hồ sơ CÔNG TY TNHH ÁNH DƯƠNG' }));
    const drawer = await screen.findByRole('dialog', { name: 'Chi tiết Ánh Dương' });
    // formatDateTimeVN renders "HH:mm:ss D/M/YYYY" (time part is TZ-dependent;
    // 03:45Z stays on 6/10 in every VN-adjacent zone, so pin the date alone).
    expect(drawer.textContent).toContain('6/10/2026');
  });

  it('the inline header metrics render with stable testids (SIL-169 verdict a)', async () => {
    renderPage();
    await nameRow();
    // The aging projection is unavailable in this suite's mock env — the
    // overdue and risk metrics read the honest '—', never a fake 0. The idle
    // metric's ledger feed IS available (empty: no customer ever
    // transacted), so it reports a real 0.
    for (const testId of ['cus-metric-overdue', 'cus-metric-risk']) {
      const metric = screen.getByTestId(testId);
      expect(metric.textContent).toContain('—');
    }
    expect(screen.getByTestId('cus-metric-idle30').textContent).toContain('0 KH');
  });
});
