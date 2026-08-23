import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvanceRequestStatus, Role } from '@tingting/shared';

const listAllAdvanceRequests = vi.fn();

vi.mock('../api/forwarderClient', () => ({
  forwarderClient: {
    listAllAdvanceRequests: (...args: unknown[]) => listAllAdvanceRequests(...args),
    approveAdvanceRequest: vi.fn(),
    rejectAdvanceRequest: vi.fn(),
  },
}));

vi.mock('../api/financialClient', () => ({
  financialClient: {
    getAdvanceBalances: vi.fn().mockResolvedValue({ items: [], totalOutstanding: 0 }),
  },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: Role.ADMIN } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

import AdminAdvancesPage from './AdminAdvancesPage';

function makeRequest(id: number, status: AdvanceRequestStatus, requesterName: string) {
  return {
    id,
    version: 1,
    requesterId: id + 100,
    amount: '500000',
    reason: 'Ứp phí cầu đường',
    status,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-08-20T09:30:00.000Z',
    requesterName,
    approverName: null,
  };
}

// Page-local rows are deliberately fewer than the server's full-set counts:
// KPI/pill numbers must come from statusCounts/statusAmounts, never from the
// loaded page.
const envelope = {
  items: [
    makeRequest(1, AdvanceRequestStatus.PENDING, 'An Nguyễn'),
    makeRequest(2, AdvanceRequestStatus.APPROVED, 'Bình Trần'),
  ],
  page: 1,
  limit: 50,
  total: 120,
  totalPages: 3,
  statusCounts: {
    [AdvanceRequestStatus.PENDING]: 7,
    [AdvanceRequestStatus.APPROVED]: 5,
    [AdvanceRequestStatus.REJECTED]: 2,
  },
  statusAmounts: {
    [AdvanceRequestStatus.PENDING]: 7_000_000,
    [AdvanceRequestStatus.APPROVED]: 5_000_000,
    [AdvanceRequestStatus.REJECTED]: 2_000_000,
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminAdvancesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastCallParams(): Record<string, unknown> {
  const calls = listAllAdvanceRequests.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  listAllAdvanceRequests.mockReset().mockResolvedValue(envelope);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminAdvancesPage server-driven listing', () => {
  it('forwards page/limit to the endpoint with no implicit status filter', async () => {
    renderPage();
    expect((await screen.findAllByText('An Nguyễn')).length).toBeGreaterThan(0);

    expect(lastCallParams()).toMatchObject({ page: 1, limit: 50 });
    expect(lastCallParams().status).toBeUndefined();
  });

  it('derives KPI numbers and pill counts from server statusCounts/statusAmounts', async () => {
    const { container } = renderPage();
    expect((await screen.findAllByText('An Nguyễn')).length).toBeGreaterThan(0);

    // KPI values 7/5/2 — the loaded page only holds 2 rows, so these can only
    // come from the full-set envelope aggregates.
    const kpiValues = Array.from(container.querySelectorAll('.adv-kpi__value')).map(
      (el) => el.textContent,
    );
    expect(kpiValues).toEqual(['7', '5', '2', '0']);

    // KPI meta amounts come from statusAmounts (vi-VN grouping).
    expect(screen.getAllByText('7.000.000 ₫').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5.000.000 ₫').length).toBeGreaterThan(0);

    // Filter pills carry full-set counts, including the "all" total (7+5+2).
    // (Pill label + count spans concatenate without a space in the accname.)
    expect(screen.getByRole('button', { name: 'Chờ duyệt7' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tất cả14' })).toBeTruthy();
  });

  it('renders Pagination with the server total and navigates pages', async () => {
    renderPage();
    expect((await screen.findAllByText('An Nguyễn')).length).toBeGreaterThan(0);

    const nav = screen.getByRole('navigation', { name: 'Phân trang' });
    expect(within(nav).getByText('1–50')).toBeTruthy();
    expect(within(nav).getByText('120')).toBeTruthy();

    await waitFor(() => within(nav).getByRole('button', { name: '2' }));
    within(nav).getByRole('button', { name: '2' }).click();
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2, limit: 50 }));
  });

  it('resets to page 1 when the status filter changes', async () => {
    renderPage();
    expect((await screen.findAllByText('An Nguyễn')).length).toBeGreaterThan(0);

    // Move to page 2 under the unfiltered view.
    const nav = screen.getByRole('navigation', { name: 'Phân trang' });
    within(nav).getByRole('button', { name: '2' }).click();
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    // Switching the status filter must send the filter and reset the page.
    screen.getByRole('button', { name: 'Chờ duyệt7' }).click();
    await waitFor(() =>
      expect(lastCallParams()).toMatchObject({ status: 'PENDING', page: 1 }),
    );

    // Going back to "all" drops the status param: the unfiltered page-1 query
    // is already cached (staleTime), so no new call fires — assert the filter
    // state reset (the "all" pill is active again) and that every status
    // call the endpoint saw stayed on page 1.
    const allPill = screen.getByRole('button', { name: 'Tất cả14' });
    allPill.click();
    await waitFor(() => expect(allPill.className).toContain('is-active'));
    for (const call of listAllAdvanceRequests.mock.calls) {
      const params = call[0] as Record<string, unknown>;
      if (params.status !== undefined) expect(params.page).toBe(1);
    }
  });

  it('sorts server-side: grid header click sends sortBy/sortDir and resets the page', async () => {
    renderPage();
    expect((await screen.findAllByText('An Nguyễn')).length).toBeGreaterThan(0);

    // Move to page 2 first so the sort's page reset is observable.
    const nav = screen.getByRole('navigation', { name: 'Phân trang' });
    within(nav).getByRole('button', { name: '2' }).click();
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    // Fresh column starts ascending, on page 1.
    screen.getByRole('button', { name: 'Số tiền' }).click();
    await waitFor(() =>
      expect(lastCallParams()).toMatchObject({ sortBy: 'amount', sortDir: 'asc', page: 1 }),
    );

    // Same header flips to descending.
    screen.getByRole('button', { name: 'Số tiền' }).click();
    await waitFor(() =>
      expect(lastCallParams()).toMatchObject({ sortBy: 'amount', sortDir: 'desc', page: 1 }),
    );
  });
});
