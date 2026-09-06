import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '@tingting/shared';

const getRoutesList = vi.fn();

vi.mock('../../api/configClient', () => ({
  configClient: { getRoutesList: (...args: unknown[]) => getRoutesList(...args) },
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({
  useBackShortcut: () => {},
}));

vi.mock('../../hooks/useDropdownDismiss', () => ({
  useDropdownDismiss: () => {},
}));

// Auth identity is mutable per test: null (no provider, full mode) by
// default; the dispatcher-mode test points it at a DISPATCHER user.
const authState = vi.hoisted(() => ({ context: null as null | { user: { userId: number; username: string; role: string } } }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => authState.context,
}));

vi.mock('../../hooks/useCRUD', () => ({
  useCRUD: () => ({
    editingId: null,
    showAddForm: false,
    saving: false,
    deleting: null,
    error: null,
    setShowAddForm: vi.fn(),
    setEditingId: vi.fn(),
    cancelForm: vi.fn(),
    doCreate: vi.fn(),
    doUpdate: vi.fn(),
    doDelete: vi.fn(),
  }),
}));

import RoutesConfigPage from './RoutesConfigPage';

function makeRoute(id: number, name: string): Route {
  return {
    id,
    code: `RT-${id}`,
    name,
    shortName: null,
    loadPoint: 'Hải Phòng',
    distanceKm: 120,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Route;
}

const routes = [makeRoute(1, 'Hải Phòng - Nội Bài'), makeRoute(2, 'Hải Phòng - Quế Võ')];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RoutesConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getRoutesList.mockReset().mockResolvedValue(routes);
});

// DISPATCHER create-only mode: Casbin grants POST /routes but no PUT/DELETE,
// so the per-row Sửa/Xoá menu (and its action column) must not render while
// the header "Thêm tuyến" button stays available.
describe('RoutesConfigPage dispatcher create-only mode', () => {
  afterEach(() => { authState.context = null; });

  it('keeps the create button and hides the per-row action menu', async () => {
    authState.context = { user: { userId: 9, username: 'dieuvan', role: 'DISPATCHER' } };
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');

    expect(screen.getByRole('button', { name: /Thêm tuyến/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.routes-table thead th')).toHaveLength(6);
    expect(container.querySelector('.record-table__action')).toBeNull();
  });

  it('renders the action column for full catalog editors', async () => {
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');

    expect(container.querySelectorAll('.routes-table thead th')).toHaveLength(7);
    expect(container.querySelector('.record-table__action')).not.toBeNull();
  });
});
