import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({
  api: { get: apiGetMock },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import AuditLogPage from './AuditLogPage';

function entry(id: number, userName: string) {
  return {
    id,
    timestamp: `2026-08-2${id}T08:00:00.000Z`,
    userName,
    userEmail: `${userName.toLowerCase()}@example.com`,
    action: 'ENTITY_UPDATED',
    category: 'config',
    message: `Cập nhật cấu hình ${id}`,
    payload: {},
    ipAddress: '10.0.0.8',
  };
}

beforeEach(() => {
  apiGetMock.mockReset().mockResolvedValue({ items: [entry(1, 'An'), entry(2, 'Bình')], total: 2 });
  // The page wires an IntersectionObserver for infinite scroll on the last row.
  vi.stubGlobal('IntersectionObserver', class {
    observe() { /* jsdom stub */ }
    unobserve() { /* jsdom stub */ }
    disconnect() { /* jsdom stub */ }
  });
});

function lastUrl(): string {
  const calls = apiGetMock.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? '');
}

function renderAuditPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditLogPage />
    </QueryClientProvider>,
  );
}

describe('AuditLogPage server-side column sort', () => {
  it('queries without sort params by default (newest-first server order)', async () => {
    renderAuditPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Người dùng' })).toBeTruthy());
    expect(lastUrl()).toBe('/audit-logs?page=1&limit=10');
    expect(lastUrl()).not.toContain('sortBy');
  });

  it('header click sends sortBy/sortDir asc then desc', async () => {
    renderAuditPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Người dùng' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Người dùng' }));
    await waitFor(() => expect(lastUrl()).toBe('/audit-logs?page=1&limit=10&sortBy=userName&sortDir=asc'));
    expect(screen.getByRole('columnheader', { name: 'Người dùng' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Người dùng' }));
    await waitFor(() => expect(lastUrl()).toBe('/audit-logs?page=1&limit=10&sortBy=userName&sortDir=desc'));
    expect(screen.getByRole('columnheader', { name: 'Người dùng' }).getAttribute('aria-sort')).toBe('descending');
  });
});
