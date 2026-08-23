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

    fireEvent.click(screen.getByRole('button', { name: 'Vấn đề' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('page=1');
      expect(lastGetUrl()).toContain('sortBy=title');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Vấn đề' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortDir=desc');
      expect(lastGetUrl()).toContain('page=1');
    });
  });

  it('leaves the columns without backend sort keys as plain headers', async () => {
    renderInbox();
    expect(await screen.findAllByText('Quá hạn bàn giao')).toBeTruthy();
    // No sortable buttons on the not-yet-keyed lane columns.
    expect(screen.queryByRole('button', { name: 'Chủ sở hữu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tuổi việc' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ảnh hưởng' })).toBeNull();
  });
});
