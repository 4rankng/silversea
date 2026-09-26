import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    // Chief spec 20260926_53: MÃ TUYẾN / TÊN RÚT GỌN / KHOẢNG CÁCH are
    // mandatory columns that always render (dash for missing data) — the
    // fixture fills code/loadPoint/distanceKm, so code + name + shortName +
    // loadPoint + distance + actions = 6.
    expect(container.querySelectorAll('.routes-table thead th')).toHaveLength(6);
    expect(container.querySelector('.record-table__action')).not.toBeNull();
  });

  it('renders the action column for full catalog editors', async () => {
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');

    // Chief spec 20260926_53: mandatory columns always render — 6 with the
    // fixture (see the dispatcher test above).
    expect(container.querySelectorAll('.routes-table thead th')).toHaveLength(6);
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

describe('ListFilterBar adoption (card 20260922_38)', () => {
  it('search lives in the chief-strip header row (ListFilterBar superseded by card 20260926_59)', async () => {
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');
    expect(container.querySelector('.routes-strip__search input')).not.toBeNull();
    expect(container.querySelector('.toolbar__search')).toBeNull();
    screen.getByRole('textbox', { name: 'Tìm tuyến đường' });
  });

  it('routes the empty face through the shared EmptyState', async () => {
    getRoutesList.mockResolvedValue([]);
    renderPage();
    const face = await screen.findByText('Chưa có dữ liệu');
    expect(face.closest('.ds-empty-state')).not.toBeNull();
  });
});


describe('RoutesConfigPage chief table spec (20260926_53)', () => {
  it('renders the mandatory spec columns even when data is missing — dash, never a collapsed column', async () => {
    const sparse = [
      makeRoute(1, 'Hải Phòng - Nội Bài'),
      { ...makeRoute(2, 'C12 route'), code: null, shortName: null, distanceKm: null, loadPoint: null } as unknown as Route,
    ];
    getRoutesList.mockResolvedValue(sparse);
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');
    const headers = [...container.querySelectorAll('.routes-table thead th')].map(th => th.textContent?.trim());
    expect(headers.some(h => h?.includes('Mã Tuyến'))).toBe(true);
    expect(headers.some(h => h?.includes('Tên tuyến rút gọn'))).toBe(true);
    expect(headers.some(h => h?.includes('Khoảng cách'))).toBe(true);
    const lastRow = [...container.querySelectorAll('tbody tr')].pop()!;
    expect(lastRow.textContent).toContain('—');
  });

  it('renders clean "120 km" distance and direct hover edit/delete actions, no dots menu', async () => {
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');
    const dist = container.querySelector('tbody td.routes-table__distance');
    expect(dist?.textContent).toBe('120 km');
    expect(screen.getAllByRole('button', { name: /Sửa tuyến/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Xoá tuyến/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Tùy chọn/ })).toBeNull();
  });

  it('title carries the live route count and the strip search offers the ⌘K badge', async () => {
    const { container } = renderPage();
    await screen.findByText('Hải Phòng - Nội Bài');
    expect(container.querySelector('.routes-strip__title')?.textContent).toContain('(2)');
    expect(container.querySelector('.routes-strip__kbd')?.textContent).toBe('⌘K');
  });
});


describe('routes true grid (card 20260926_59 — chief bounce)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/config/RoutesConfigPage.css'), 'utf8');
  const tsx = readFileSync(resolve(process.cwd(), 'src/pages/config/RoutesConfigPage.tsx'), 'utf8');
  const topbar = readFileSync(resolve(process.cwd(), 'src/components/layout/Topbar.tsx'), 'utf8');

  it('renders the unit exactly once — no km km anywhere', async () => {
    getRoutesList.mockResolvedValue([
      makeRoute(1, 'KCN Đồng Văn, Ninh Bình'),
      { ...makeRoute(2, 'Hải Phòng-NEWEB'), code: null, shortName: null, distanceKm: null },
    ]);
    const { container } = renderPage();
    await screen.findByText('KCN Đồng Văn, Ninh Bình');
    const body = container.querySelector('.routes-table tbody')?.textContent ?? '';
    expect(body).toContain('120 km');
    expect(body).not.toContain('km km');
    // the class-level double-append is gone from the stylesheet
    expect(css).not.toContain("content: ' km'");
  });

  it('grid geometry: fixed columns, 36px striped rows, phone-only reflow', () => {
    expect(css).toMatch(/\.routes-table th\.routes-table__code,\n\.routes-config-page \.routes-table td\.routes-table__code \{ width: 160px;/);
    expect(css).toMatch(/td:nth-child\(3\) \{ width: 200px;/);
    expect(css).toMatch(/@container \(max-width: 640px\)/);
    expect(css).not.toMatch(/@container \(max-width: 1100px\)/);
    expect(css).toMatch(/tbody tr:nth-child\(even\)/);
  });

  it('one header row: back + count + search with kbd + create', () => {
    expect(tsx).toContain('routes-strip__back');
    expect(tsx).toContain('routes-title-count');
    expect(tsx).toContain('routes-strip__kbd');
    expect(tsx).toContain('Thêm tuyến');
    expect(tsx).not.toContain('ListFilterBar');
    // the month-picker law keeps the navigator off config routes
    expect(topbar).toMatch(/config\|fleet/);
  });
});
