import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// DISPATCHER now has full edit/delete access (matching CUS). The action
// column and per-row menu render for all catalog-editor roles.
describe('RoutesConfigPage dispatcher edit/delete access', () => {
  afterEach(() => { authState.context = null; });

  it('shows the create button and per-row action menu for DISPATCHER', async () => {
    authState.context = { user: { userId: 9, username: 'dieuvan', role: 'DISPATCHER' } };
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');

    expect(screen.getByRole('button', { name: /Thêm tuyến/ })).toBeInTheDocument();
    // Card 20260922_22: columns render by data presence — the fixture fills
    // code/loadPoint/distanceKm, so name + those three + actions = 5.
    expect(container.querySelectorAll('.routes-table thead th')).toHaveLength(5);
    expect(container.querySelector('.record-table__action')).not.toBeNull();
  });

  it('renders the action column for full catalog editors', async () => {
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');

    // Card 20260922_22: columns render by data presence — the fixture fills
    // code/loadPoint/distanceKm, so name + those three + actions = 5.
    expect(container.querySelectorAll('.routes-table thead th')).toHaveLength(5);
    expect(container.querySelector('.record-table__action')).not.toBeNull();
  });
});


describe('UI-CD-09 catalog query whitespace', () => {
  it('normalizes API queries while preserving the typed search', async () => {
    renderPage();
    await screen.findAllByText('Hải Phòng - Nội Bài');
    const input = screen.getByRole('textbox', { name: 'Tìm tuyến đường' });
    fireEvent.change(input, { target: { value: '  que  vo  ' } });
    await waitFor(() => expect(getRoutesList).toHaveBeenLastCalledWith('que vo'));
    expect(input).toHaveValue('  que  vo  ');
    getRoutesList.mockClear();
    fireEvent.change(input, { target: { value: 'que vo' } });
    expect(getRoutesList).not.toHaveBeenCalled();
    expect(input).toHaveValue('que vo');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
  });
});
