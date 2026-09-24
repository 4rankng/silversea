// Card 20260923_13 — Sổ quỹ section on /ops/wallet (ADR 2026-09-24-ops-fund-book-scoped-read).
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';
import OpsWalletPage from './OpsWalletPage';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <OpsWalletPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const fundBook = (overrides: Record<string, unknown> = {}) => ({
  items: [
    { key: 'advance-1', date: '2026-09-20', kind: 'ADVANCE', label: 'Tạm ứng: ứng phí cảng', reference: null, amount: '1000000' },
    { key: 'ops-expense-5', date: '2026-09-22', kind: 'EXPENSE', label: 'Chi phí: OTHER — bốc xếp', reference: null, amount: '-600000' },
  ],
  closing: '400000', walletBalance: '400000', outstandingAdvanceBalance: '400000', matches: true,
  ...overrides,
});

describe('OpsWalletPage Sổ quỹ (card 20260923_13)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/wallet/summary')) {
        return Promise.resolve({ totalAdvance: '1000000', approved: '600000', pending: '0', rejected: '0', returned: '0', balance: '400000' });
      }
      if (url.startsWith('/ops/wallet/fund-book')) return Promise.resolve(fundBook());
      if (url.startsWith('/ops/wallet/expenses')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
  });

  it('renders the read-only book: own entries, thu/chi split, running balance, khớp state', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: 'Sổ quỹ' })).toBeInTheDocument();
    expect(await screen.findByText('Tạm ứng: ứng phí cảng')).toBeInTheDocument();
    expect(screen.getByText('Chi phí: OTHER — bốc xếp')).toBeInTheDocument();
    expect(screen.getAllByText('1.000.000')).toHaveLength(2); // thu cell + running balance after row 1
    expect(screen.getByText('600.000')).toBeInTheDocument();
    expect(screen.getByText(/Số dư cuối sổ:/)).toBeInTheDocument();
    expect(screen.getByText(/Còn phải hoàn ứng \(theo kế toán\):/)).toBeInTheDocument();
    expect(screen.getByText('Đã khớp với báo cáo tổng hợp hoàn ứng')).toBeInTheDocument();
  });

  it('shows the empty state before any cash event is booked', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/wallet/summary')) return Promise.resolve({ totalAdvance: '0', approved: '0', pending: '0', rejected: '0', returned: '0', balance: '0' });
      if (url.startsWith('/ops/wallet/fund-book')) {
        return Promise.resolve({ items: [], closing: '0', walletBalance: '0', outstandingAdvanceBalance: '0', matches: true });
      }
      return Promise.resolve({ items: [] });
    });
    renderPage();
    expect(await screen.findByRole('region', { name: 'Sổ quỹ' })).toBeInTheDocument();
    expect(await screen.findByText('Chưa có khoản tạm ứng/hoàn ứng nào được ghi sổ.')).toBeInTheDocument();
  });

  it('reports chưa khớp honestly instead of hiding the discrepancy', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/wallet/fund-book')) return Promise.resolve(fundBook({ matches: false, closing: '400000', outstandingAdvanceBalance: '500000' }));
      if (url.startsWith('/ops/wallet/summary')) return Promise.resolve({ totalAdvance: '1000000', approved: '600000', pending: '0', rejected: '0', returned: '0', balance: '400000' });
      return Promise.resolve({ items: [] });
    });
    renderPage();
    expect(await screen.findByText('Chưa khớp — cần đối chiếu với kế toán')).toBeInTheDocument();
  });
});
