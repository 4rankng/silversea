import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWorkInboxMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/financialClient', () => ({
  financialClient: {
    getWorkInbox: getWorkInboxMock,
  },
}));

import { AccountingWorkInbox } from './AccountingWorkInbox';

function inboxItem(id: string, title: string) {
  return {
    id,
    entityType: 'trip',
    entityId: Number(id.replace(/\D/g, '')) || 1,
    title,
    subtitle: 'Sẵn sàng đối soát',
    state: 'ACTION',
    priority: 90,
    dueAt: null,
    freshnessAt: '2026-08-22T08:00:00.000Z',
    blockers: [],
    advisories: [],
    nextAction: { label: 'Mở hồ sơ vận tải', targetRoute: '/accounting' },
    targetRoute: '/accounting',
    tripId: 1,
    acceptedPod: true,
    expenseApprovalPending: false,
    settlementComplete: true,
    profitabilitySnapshotReady: true,
  };
}

function envelope(view: string) {
  return {
    asOf: new Date().toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
    counts: { action: 150, waiting: 0, done: 0 },
    page: 1,
    limit: 100,
    total: 150,
    totalPages: 2,
    items: view === 'ACTION'
      ? [inboxItem('trip:1', 'TRP-0001'), inboxItem('trip:2', 'TRP-0002')]
      : [],
  };
}

function lastActionCall(): { page: number; sort?: { sortBy?: string; sortDir?: string } } {
  const actionCalls = getWorkInboxMock.mock.calls.filter((call) => call[0] === 'ACTION');
  const last = actionCalls[actionCalls.length - 1];
  return { page: last?.[1] as number, sort: last?.[2] as { sortBy?: string; sortDir?: string } | undefined };
}

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountingWorkInbox transportViewHref="/accounting?view=transport" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getWorkInboxMock.mockReset().mockImplementation((_view: string, _page: number) => Promise.resolve(envelope(_view)));
});

describe('AccountingWorkInbox server-side column sort', () => {
  it('loads lanes without sort params by default', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hồ sơ' })).toBeTruthy());
    expect(lastActionCall().page).toBe(1);
    expect(lastActionCall().sort?.sortBy).toBeUndefined();
    expect(lastActionCall().sort?.sortDir).toBeUndefined();
  });

  it('sends sortBy/sortDir on header click, flips asc → desc, and resets to page 1', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeTruthy());

    // Go to page 2 first so the reset is observable.
    fireEvent.click(screen.getAllByText('Sau')[0]);
    await waitFor(() => expect(lastActionCall().page).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(lastActionCall()).toMatchObject({ page: 1, sort: { sortBy: 'freshness', sortDir: 'asc' } }));
    expect(screen.getByRole('columnheader', { name: 'Cập nhật' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(lastActionCall()).toMatchObject({ page: 1, sort: { sortBy: 'freshness', sortDir: 'desc' } }));
    expect(screen.getByRole('columnheader', { name: 'Cập nhật' }).getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(screen.getByRole('button', { name: 'Hồ sơ' }));
    await waitFor(() => expect(lastActionCall()).toMatchObject({ page: 1, sort: { sortBy: 'title', sortDir: 'asc' } }));
  });
});
