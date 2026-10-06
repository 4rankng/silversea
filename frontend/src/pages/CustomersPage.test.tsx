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
  name: 'Công ty TNHH Ánh Dương',
  shortName: 'Ánh Dương',
  taxCode: '0101234567',
  contactPerson: 'Nguyễn Văn Bình',
  phone: '0901234567',
  creditLimit: 50000000,
  status: 'ACTIVE',
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

/** The table row of the seeded customer, found via its unique name cell. */
async function nameRow() {
  await screen.findByText('Công ty TNHH Ánh Dương');
  const cell = screen.getByText('Công ty TNHH Ánh Dương');
  const row = cell.closest('tr');
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
