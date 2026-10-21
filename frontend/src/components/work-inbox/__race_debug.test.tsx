// SCRATCH — race reproduction for card t_f21689bd. Not to be committed.
import type * as ApiModule from '../../lib/api';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleWorkInbox } from './RoleWorkInbox';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

function RouterLocation() {
  const location = useLocation();
  return <output data-testid="inbox-location">{location.pathname}{location.search}</output>;
}

function renderInbox(ui: React.ReactElement, initialEntry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, { wrapper: ({ children }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{children}<RouterLocation /></MemoryRouter>
    </QueryClientProvider>
  ) });
}
vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof ApiModule>(),
  api: { get: apiGet, post: apiPost },
}));

const now = new Date().toISOString();

function response(items: Array<Record<string, unknown>>, asOf = now) {
  return {
    asOf,
    timezone: 'Asia/Ho_Chi_Minh',
    counts: { action: 0, waiting: 0, done: 0 },
    page: 1,
    limit: 100,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    items,
  };
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

describe('UI43 race debug', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    window.history.replaceState(null, '', '/');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('debug: preserves restored queue and page through scope hydration', async () => {
    const t0 = Date.now();
    const stamps: string[] = [];
    apiGet.mockImplementation(async (path: string) => {
      stamps.push(`+${Date.now() - t0}ms ${path}`);
      return response([]);
    });
    const route = '/portal/shipments?tab=1&page=2';
    window.history.replaceState(null, '', route);
    const view = renderInbox(<RoleWorkInbox role="customer" title="Theo dõi lô hàng" description="Mô tả" customerId={null} scopeReady={false} />, route);
    expect(apiGet).not.toHaveBeenCalled();

    view.rerender(<RoleWorkInbox role="customer" title="Theo dõi lô hàng" description="Mô tả" customerId={7} scopeReady />);
    await screen.findByText('Không có việc trong nhóm này.');

    view.rerender(<RoleWorkInbox role="customer" title="Theo dõi lô hàng" description="Mô tả" customerId={7} scopeReady={false} />);
    view.rerender(<RoleWorkInbox role="customer" title="Theo dõi lô hàng" description="Mô tả" customerId={7} scopeReady />);
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThanOrEqual(2));
    await act(async () => { await delay(60); });
    const calls = apiGet.mock.calls.map(([path]) => String(path));
    // eslint-disable-next-line no-console
    console.log(`RACE-DEBUG elapsed=+${Date.now() - t0}ms calls=${calls.length}\n  ${stamps.join('\n  ')}`);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.every((path) => path.includes('view=WAITING&page=2'))).toBe(true);
    expect(screen.getByTestId('inbox-location').textContent).toBe(route);
  });
});
