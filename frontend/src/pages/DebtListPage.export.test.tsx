/**
 * Card 081026230550 — the /debt "Xuất báo cáo" button downloaded the aging
 * workbook silently: no success toast, while /finance and
 * /fleet/productivity both confirm the export. The button must toast the
 * house success copy once the file lands, and keep the f802a425 error path.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCustomerAging = vi.fn();
const getBlob = vi.fn();
const getPhoiPhieuReport = vi.hoisted(() => vi.fn());
const toast = vi.fn();

vi.mock('../api/financialClient', () => ({
  financialClient: { getCustomerAging: (...args: unknown[]) => getCustomerAging(...args) },
}));

vi.mock('../api/phoiPhieuClient', () => ({
  getPhoiPhieuReport: (...args: unknown[]) => getPhoiPhieuReport(...args),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 7, role: 'ACCOUNTANT' } }),
}));

vi.mock('../lib/api', () => ({
  api: { getBlob: (...args: unknown[]) => getBlob(...args) },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

import DebtListPage from './DebtListPage';

function customer(id: number, name: string, totalOutstanding: number) {
  return {
    customerId: id,
    customerName: name,
    contactInfo: null,
    linkedSupplierId: null,
    linkedSupplierApBalance: 0,
    netBalance: totalOutstanding,
    totalOutstanding,
    aging: { current: totalOutstanding, d30: 0, d60: 0, over90: 0 },
    maxOverdueDays: 0,
  };
}

const envelope = {
  customers: [customer(1, 'Công ty A', 12_000_000)],
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
  totals: {
    total: 12_000_000, current: 12_000_000, d30: 0, d60: 0, over90: 0,
    currentCusts: 1, d30Custs: 0, d60Custs: 0, over90Custs: 0,
    overdueCount: 0, highRiskCount: 0,
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DebtListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getCustomerAging.mockReset().mockResolvedValue(envelope);
  getBlob.mockReset().mockResolvedValue(new Blob(['aging']));
  toast.mockReset();
  window.URL.createObjectURL = vi.fn(() => 'blob:export-aging');
  window.URL.revokeObjectURL = vi.fn();
});

describe('DebtListPage export feedback (card 081026230550)', () => {
  it('toasts the house success copy once the aging workbook downloads', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: /Xuất báo cáo/ });
    fireEvent.click(button);
    expect(getBlob).toHaveBeenCalledWith('/reports/receivables-aging/export');
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Đã xuất báo cáo công nợ phải thu ra tệp Excel.',
    }));
    expect(screen.getByRole('button', { name: /Xuất báo cáo/ })).toBeTruthy();
  });

  it('keeps the busy state and the error toast policy on a failed export', async () => {
    getBlob.mockRejectedValue(new Error('máy chủ bận'));
    renderPage();
    const button = await screen.findByRole('button', { name: /Xuất báo cáo/ });
    fireEvent.click(button);
    expect(await screen.findByRole('button', { name: /Xuất báo cáo/ })).toBeTruthy();
    // action-error policy: a plain server failure toasts verbatim, never the
    // fallback, and never a success copy.
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'error',
      message: 'máy chủ bận',
    }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });
});
