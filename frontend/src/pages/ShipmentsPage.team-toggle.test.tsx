// Ticket 18/11 Task 1.2 — the CUS-only [Hiện thông tin lô hàng team] switch
// on /shipments. Pins: exact label, default OFF (per mount), CUS-only
// visibility, and that ON threads `team=true` into the workspace list call
// (the backend's cusVisibilityCondition arm-2 widening, schema z.enum
// ['true','false']). Focused render — no drawer interactions here; those stay
// pinned by ShipmentsPage.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/shared/Toast';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { apiGet, authState } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  authState: { user: { role: 'CUS', userId: 7 } as { role: string; userId?: number } },
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }));

import ShipmentsPage from './ShipmentsPage';

const emptyList = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  statusCounts: { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0 },
  items: [],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/shipments']}>
          <ShipmentsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function workspaceCalls(): string[] {
  return apiGet.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/shipments/cus-workspace')
      && !url.includes('/containers')
      && !/\/cus-workspace\/\d+/.test(url));
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(emptyList);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ShipmentsPage — team visibility toggle (ticket 18/11 Task 1.2)', () => {
  it('renders the exact label, default OFF, and no team param in the list call', async () => {
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: 'Hiện thông tin lô hàng team' });
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(workspaceCalls().length).toBeGreaterThan(0));
    for (const url of workspaceCalls()) expect(url).not.toContain('team=');
  });

  it('threads team=true into the workspace list call when switched ON', async () => {
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: 'Hiện thông tin lô hàng team' });
    await waitFor(() => expect(workspaceCalls().length).toBeGreaterThan(0));
    fireEvent.click(toggle);
    await waitFor(() => expect(workspaceCalls().some((url) => url.includes('team=true'))).toBe(true));
  });

  it('hides the toggle outside role CUS (backend law never scopes other roles)', async () => {
    authState.user = { role: Role.ADMIN, userId: 1 };
    renderPage();
    await waitFor(() => expect(workspaceCalls().length).toBeGreaterThan(0));
    expect(screen.queryByRole('checkbox', { name: 'Hiện thông tin lô hàng team' })).toBeNull();
    authState.user = { role: 'CUS', userId: 7 };
  });

  it('resets to OFF on remount — the switch is per-mount state, never URL state', async () => {
    const first = renderPage();
    const toggle = await screen.findByRole('checkbox', { name: 'Hiện thông tin lô hàng team' });
    await waitFor(() => expect(workspaceCalls().length).toBeGreaterThan(0));
    fireEvent.click(toggle);
    await waitFor(() => expect(workspaceCalls().some((url) => url.includes('team=true'))).toBe(true));
    first.unmount();
    renderPage();
    const fresh = await screen.findByRole('checkbox', { name: 'Hiện thông tin lô hàng team' });
    expect(fresh).not.toBeChecked();
  });
});
