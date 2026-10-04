/**
 * Card 20261004_333 — `/config/trucks/:truckId/owners` fetch-error regression.
 *
 * Before the fix the list rode `data: all = []`, so a failed fetch rendered an
 * empty owner table + "0 đối tác" — indistinguishable from a genuinely empty
 * cap table. The error state names the failure and offers "Thử lại" → refetch.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '../../lib/api/client';
import type * as UiModule from '../../components/UI';

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }));

vi.mock('../../lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: { ...actual.api, get: apiGetMock, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

vi.mock('../../components/UI', async (importOriginal) => {
  const original = await importOriginal<typeof UiModule>();
  return { ...original, useConfirm: () => ({ confirm: vi.fn(), dialog: null }) };
});

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

import TruckOwnersConfigPage from './TruckOwnersConfigPage';
import { ToastProvider } from '../../components/shared/Toast';

const ownerRow = {
  id: 1,
  truckId: 7,
  partnerName: 'Đối tác A',
  percentage: '60.00',
  role: 'INVESTOR',
  effectiveDate: '2026-01-01',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/config/trucks/7/owners']}>
          <Routes>
            <Route path="/config/trucks/:truckId/owners" element={<TruckOwnersConfigPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGetMock.mockReset().mockImplementation((path: string) => {
    if (path === '/truck-cap') return Promise.resolve({ items: [ownerRow], total: 1 });
    return Promise.resolve({ id: 7, licensePlate: '29A-12345' });
  });
});

describe('TruckOwnersConfigPage fetch-error states (card 20261004_333)', () => {
  it('shows the fetch-error state with retry instead of an empty owner table when the list query fails', async () => {
    apiGetMock.mockImplementation((path: string) => {
      if (path === '/truck-cap') return Promise.reject(new Error('500'));
      return Promise.resolve({ id: 7, licensePlate: '29A-12345' });
    });
    renderPage();

    expect(await screen.findByText('Không thể tải danh sách đối tác sở hữu', undefined, { timeout: 3000 })).toBeVisible();
    // Never the true-empty copy or the "0 đối tác" counter while the query errors.
    expect(screen.queryByText(/Chưa có đối tác sở hữu/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 đối tác/)).not.toBeInTheDocument();

    apiGetMock.mockImplementation((path: string) => {
      if (path === '/truck-cap') return Promise.resolve({ items: [ownerRow], total: 1 });
      return Promise.resolve({ id: 7, licensePlate: '29A-12345' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đối tác A')).toBeVisible();
    await waitFor(() => {
      expect(apiGetMock.mock.calls.filter(([path]) => path === '/truck-cap').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('keeps the true-empty state only when the query succeeded with zero items', async () => {
    apiGetMock.mockImplementation((path: string) => {
      if (path === '/truck-cap') return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({ id: 7, licensePlate: '29A-12345' });
    });
    renderPage();
    expect(await screen.findByText(/Chưa có đối tác sở hữu/)).toBeVisible();
    expect(screen.queryByText('Không thể tải danh sách đối tác sở hữu')).not.toBeInTheDocument();
  });
});
