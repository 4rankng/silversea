import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForwarderAdvancesPage from './ForwarderAdvancesPage';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: vi.fn() },
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));

const LIST_URL = '/forwarder/me/advance-requests';

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { id: 1, amount: '2000000', reason: 'Tạm ứng mua dầu', status: 'RECORDED', createdAt: '2026-08-01T01:00:00.000Z' },
      {
        id: 2, amount: '1500000', reason: 'Tạm ứng phí cầu đường', status: 'VOIDED',
        createdAt: '2026-08-02T01:00:00.000Z', approverName: 'Ngân', approvedAt: '2026-08-03T01:00:00.000Z',
      },
    ],
    page: 1,
    limit: 25,
    pageSize: 25,
    total: 30,
    totalPages: 2,
    statusCounts: { RECORDED: 5, VOIDED: 3 },
    statusAmounts: { RECORDED: 10_000_000, VOIDED: 6_000_000 },
    counts: { RECORDED: 5, VOIDED: 3 },
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ForwarderAdvancesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForwarderAdvancesPage server pagination', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith(LIST_URL)) return Promise.resolve(makeEnvelope());
      if (url.startsWith('/forwarder/me/advance-balance')) return Promise.resolve({ outstanding: '500000' });
      return Promise.resolve({ items: [] });
    });
  });

  it('fetches with explicit page/limit and renders server full-set counts + pagination', async () => {
    renderPage();

    expect(await screen.findByText('Tạm ứng mua dầu')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(`${LIST_URL}?page=1&limit=25`);

    // Filter pills carry the server's full-set statusCounts (5+3=8), not the
    // page's 30-row filtered total.
    const allPill = screen.getByRole('button', { name: /Tất cả/ });
    expect(allPill.textContent).toContain('8');
    const pendingPill = screen.getByRole('button', { name: /Đã ghi nhận/ });
    expect(pendingPill.textContent).toContain('5');

    // Hero KPI subtitle is full-set too.
    expect(screen.getByText('8 phiếu tạm ứng')).toBeInTheDocument();

    // Pagination is wired to the server envelope (30 rows / 25 per page → 2 pages).
    expect(screen.getByRole('navigation', { name: 'Phân trang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });

  it('forwards status + page params; a filter change resets the page to 1', async () => {
    renderPage();
    expect(await screen.findByText('Tạm ứng mua dầu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(`${LIST_URL}?page=2&limit=25`);
    });

    // From page 2, picking a status pill must land back on page 1 with the filter.
    fireEvent.click(screen.getByRole('button', { name: /Đã ghi nhận/ }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(`${LIST_URL}?status=RECORDED&page=1&limit=25`);
    });
  });

  it('retries a failed list with disabled loading feedback and returns the same records', async () => {
    let resolveRetry!: (value: ReturnType<typeof makeEnvelope>) => void;
    let listCalls = 0;
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith(LIST_URL)) {
        listCalls += 1;
        if (listCalls === 1) return Promise.reject(new Error('Unavailable'));
        return new Promise((resolve) => { resolveRetry = resolve; });
      }
      return Promise.resolve({ items: [], outstanding: '0' });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(screen.getByRole('button', { name: 'Đang tải lại…' })).toBeDisabled();
    await waitFor(() => expect(resolveRetry).toBeDefined());
    expect(screen.queryByText('Chưa có phiếu tạm ứng')).toBeNull();
    resolveRetry(makeEnvelope());
    expect(await screen.findByText('Tạm ứng mua dầu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đang tải lại…' })).toBeNull();
    expect(apiGet).toHaveBeenCalledWith(`${LIST_URL}?page=1&limit=25`);
  });

  it('shows the empty state and no pagination when the requester has no requests', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith(LIST_URL)) {
        return Promise.resolve(makeEnvelope({
          items: [], total: 0, totalPages: 1, statusCounts: {}, statusAmounts: {}, counts: {},
        }));
      }
      if (url.startsWith('/forwarder/me/advance-balance')) return Promise.resolve({ outstanding: '0' });
      return Promise.resolve({ items: [] });
    });

    renderPage();

    expect(await screen.findByText('Chưa có phiếu tạm ứng')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Phân trang' })).toBeNull();
  });
});
