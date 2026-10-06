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
        <AccountingWorkInbox />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getWorkInboxMock.mockReset().mockImplementation((_view: string, _page: number) => Promise.resolve(envelope(_view)));
});

/**
 * Card 061026043646 — the WAITING lane ("Đang bị chặn") loading announcement
 * extracted as "Đang tảiđang bị chặn…": the message was built from separate
 * JSX text children ("Đang tải ", label, "…") and node-boundary extraction
 * (accessibility snapshots, QA probes) trims each text node and joins with no
 * separator, eating the boundary space. Same law as OpsQueryFeedback
 * (card 051026230609): the message must be ONE text node.
 */

/** Mimics name-from-contents extraction: per TEXT-NODE trim, join with no
 *  separator — the path that produced the glued announcement in the report. */
function extractedText(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push((walker.currentNode.textContent ?? '').trim());
  return parts.join('');
}

describe('AccountingWorkInbox loading announcement (card 061026043646)', () => {
  it('keeps the space between "Đang tải" and the "Đang bị chặn" lane label under node-boundary extraction', () => {
    getWorkInboxMock.mockImplementation((view: string) =>
      view === 'WAITING' ? new Promise(() => {}) : Promise.resolve(envelope(view)));
    renderInbox();
    const lane = document.querySelector('.accounting-work-inbox__lane.is-waiting');
    expect(lane).toBeTruthy();
    const status = lane!.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(extractedText(status!)).toBe('Đang tải đang bị chặn…');
  });
});

describe('AccountingWorkInbox server-side column sort', () => {
  it('QA-101: an empty lane renders as a compact status row, not a tall empty panel', async () => {
    renderInbox();
    const emptyStates = await screen.findAllByText('Không có hồ sơ trong nhóm này.');
    expect(emptyStates.length).toBeGreaterThanOrEqual(1);
    for (const state of emptyStates) {
      expect(state.className).toContain('is-empty');
    }
    // Count + refresh control stay visible in the lane header.
    expect(screen.getByText('Sẵn sàng xử lý')).toBeTruthy();
  });
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

    // Go to page 2 first so the reset is observable. The lane swaps to its
    // loading state while refetching (no placeholder data), so each step waits
    // for the headers to come back before clicking again.
    fireEvent.click(screen.getAllByText('Sau')[0]);
    await waitFor(() => expect(lastActionCall().page).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(lastActionCall()).toMatchObject({ page: 1, sort: { sortBy: 'freshness', sortDir: 'asc' } }));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Cập nhật' }).getAttribute('aria-sort')).toBe('ascending'));

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(lastActionCall()).toMatchObject({ page: 1, sort: { sortBy: 'freshness', sortDir: 'desc' } }));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Cập nhật' }).getAttribute('aria-sort')).toBe('descending'));

    fireEvent.click(screen.getByRole('button', { name: 'Hồ sơ' }));
    await waitFor(() => expect(lastActionCall()).toMatchObject({ page: 1, sort: { sortBy: 'title', sortDir: 'asc' } }));
  });
});
