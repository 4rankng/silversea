import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/api')>();
  return { ...original, api: apiMock };
});

import { ManagerDecisionInbox } from './ManagerDecisionInbox';

const item = (id: string, title: string) => ({
  id, entityType: 'shipment', entityId: 1, title, subtitle: null,
  state: 'ACTION', priority: 100, dueAt: null, freshnessAt: new Date().toISOString(),
  blockers: [], advisories: [], owner: null, ageHours: 1, impact: 'x',
  nextAction: null, targetRoute: '/x',
});

function renderInbox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ManagerDecisionInbox enabled />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastGetUrl(): string {
  const calls = apiMock.get.mock.calls;
  return String(calls[calls.length - 1]![0]);
}

describe('ManagerDecisionInbox server-side sort header', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    // 150 items at limit 100 → two pages, so the page-reset proof can run.
    apiMock.get.mockResolvedValue({
      asOf: new Date().toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      counts: { action: 150, waiting: 0, done: 0 },
      page: 1, limit: 100, total: 150, totalPages: 2,
      items: [item('a:1', 'Quá hạn bàn giao'), item('a:2', 'Phản hồi sai lệch')],
    });
  });

  it('sends sortBy=title asc then desc and resets to page 1', async () => {
    renderInbox();
    expect(await screen.findAllByText('Quá hạn bàn giao')).toBeTruthy();
    expect(lastGetUrl()).not.toContain('sortBy');

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastGetUrl()).toContain('page=2'));
    // Plain useQuery (no placeholderData): the table unmounts while page 2
    // loads, so wait for it to come back before clicking the header.
    const issueHeader = await screen.findByRole('button', { name: 'Vấn đề' });

    fireEvent.click(issueHeader);
    await waitFor(() => {
      expect(lastGetUrl()).toContain('page=1');
      expect(lastGetUrl()).toContain('sortBy=title');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Vấn đề' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortDir=desc');
      expect(lastGetUrl()).toContain('page=1');
    });
  });

  it('maps every lane data column to its backend sort key', async () => {
    renderInbox();
    expect(await screen.findAllByText('Quá hạn bàn giao')).toBeTruthy();

    const sortKeys: Array<[string, string]> = [
      ['Chủ sở hữu', 'ownerLabel'],
      ['Tuổi việc', 'ageHours'],
      ['Ảnh hưởng', 'impact'],
    ];
    for (const [label, key] of sortKeys) {
      // The table unmounts between refetches (no placeholderData), so each
      // successive header is awaited before clicking.
      // eslint-disable-next-line no-await-in-loop -- sequential clicks each await their own request
      fireEvent.click(await screen.findByRole('button', { name: label }));
      // eslint-disable-next-line no-await-in-loop -- sequential clicks each await their own request
      await waitFor(() => expect(lastGetUrl()).toContain(`sortBy=${key}`));
    }
  });
});
