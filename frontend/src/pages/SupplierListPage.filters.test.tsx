/**
 * Card 20260927_152 — the `/suppliers` strip rides the shared `FilterBar` band.
 *
 * The page-local bar (hand-rolled `.filter-bar` + `.filter-bar__search` +
 * `.filter-bar__spacer`) is gone, so these pin the BEHAVIOUR it drove — the
 * debounced `search` param and the status/type toggles — through the shared
 * slots, not the markup that used to carry them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as ApiModule from '../lib/api';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierType, type Supplier } from '@tingting/shared';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: apiMock };
});

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { customers: [], suppliers: [] } }),
}));

vi.mock('../hooks/useFinancialQueries', () => ({
  usePayablesSummary: () => ({ data: { items: [] } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import SupplierListPage from './SupplierListPage';

function supplierFixture(id: number, name: string, types: SupplierType[] = []): Supplier {
  return {
    id,
    name,
    shortName: '',
    contactPerson: null,
    phone: null,
    taxCode: null,
    note: null,
    status: 'ACTIVE',
    linkedCustomerId: null,
    isFuelSupplier: false,
    types,
    primaryType: null,
    chiHoDueDays: null,
    cuocDueDays: null,
  } as unknown as Supplier;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SupplierListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({
    items: [
      supplierFixture(1, 'Garage Auto 123', [SupplierType.CARRIER]),
      supplierFixture(2, 'Vật tư Minh Long'),
    ],
    total: 2,
    page: 1,
    pageSize: 10,
  });
});

describe('SupplierListPage filter strip', () => {
  it('keeps directory KPIs and status pills on the same population when search returns one row', async () => {
    const directory = [supplierFixture(1, 'Garage Auto 123'), supplierFixture(2, 'Vật tư Minh Long')];
    apiMock.get.mockImplementation(async (url: string) => {
      if (url === '/suppliers/status-counts') return { all: 14, active: 12, inactive: 2, vehicles: {} };
      const searched = new URL(url, 'http://localhost').searchParams.get('search') === 'Garage';
      return { items: searched ? directory.slice(0, 1) : directory, total: searched ? 1 : 14, page: 1, pageSize: 10 };
    });
    renderPage();
    const activeKpi = (await screen.findByText('Đang hoạt động')).closest('.kpi') as HTMLElement;
    const totalKpi = screen.getByText('Tổng nhà cung cấp').closest('.kpi') as HTMLElement;
    await waitFor(() => expect(within(activeKpi).getByText('12/14 đang hoạt động')).toBeTruthy());
    expect(within(totalKpi).getByText('14 nhà cung cấp')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm nhà cung cấp theo tên' }), { target: { value: 'Garage' } });
    await waitFor(() => expect(screen.queryAllByText('Vật tư Minh Long')).toHaveLength(0));
    expect(screen.getAllByText('Garage Auto 123').length).toBeGreaterThan(0);
    expect(within(activeKpi).getByText('12/14 đang hoạt động')).toBeTruthy();
    expect(within(activeKpi).getByText('/ 14')).toBeTruthy();
    expect(within(totalKpi).getByText('14 nhà cung cấp')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tất cả · 14' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoạt động · 12' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ngừng HĐ · 2' })).toBeTruthy();
    expect(apiMock.get.mock.calls.some(([url]) => String(url).includes('search=Garage'))).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm nhà cung cấp theo tên' }), { target: { value: '' } });
    await waitFor(() => expect(screen.getAllByText('Vật tư Minh Long').length).toBeGreaterThan(0));
    expect(within(activeKpi).getByText('12/14 đang hoạt động')).toBeTruthy();
  });

  it('does not invent directory KPI counts from a loaded page while status counts are pending', async () => {
    let resolveCounts!: (value: { all: number; active: number; inactive: number; vehicles: Record<string, number> }) => void;
    const counts = new Promise<{ all: number; active: number; inactive: number; vehicles: Record<string, number> }>((resolve) => { resolveCounts = resolve; });
    apiMock.get.mockImplementation(async (url: string) => url === '/suppliers/status-counts' ? counts : {
      items: [supplierFixture(1, 'Garage Auto 123')], total: 1, page: 1, pageSize: 10,
    });
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();
    const activeKpi = screen.getByText('Đang hoạt động').closest('.kpi') as HTMLElement;
    const totalKpi = screen.getByText('Tổng nhà cung cấp').closest('.kpi') as HTMLElement;
    expect(within(activeKpi).getByText('—')).toBeTruthy();
    expect(within(totalKpi).getByText('—')).toBeTruthy();
    expect(within(activeKpi).queryByText('/ 1')).toBeNull();
    resolveCounts({ all: 14, active: 12, inactive: 2, vehicles: {} });
    await waitFor(() => expect(within(activeKpi).getByText('12/14 đang hoạt động')).toBeTruthy());
    expect(within(totalKpi).getByText('14 nhà cung cấp')).toBeTruthy();
  });

  it('renders the shared bar with the search slot and the six toggles', async () => {
    const { container } = renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();

    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // The page declares no bar markup of its own: the component owns the shell,
    // the search cell and the spacer, so exactly one bar exists.
    expect(container.querySelectorAll('.filter-bar').length).toBe(1);

    const input = within(bar).getByRole('textbox', { name: 'Tìm nhà cung cấp theo tên' });
    expect(input.getAttribute('name')).toBe('supplierSearch');
    expect(input.getAttribute('placeholder')).toBe('Tên nhà thầu, MST, người liên hệ, SĐT…');

    const chips = within(bar).getAllByRole('button');
    expect(chips.length).toBe(6);
    for (const chip of chips) expect(chip.className).toContain('filter-chip');
    // Status and type are quick toggles on this surface, never secondary
    // criteria — so no `Bộ lọc` trigger exists.
    expect(within(bar).queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
  });

  it('sends the typed search as the debounced `search` param', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm nhà cung cấp theo tên' }), {
      target: { value: 'Garage' },
    });

    await waitFor(() => {
      const calls = apiMock.get.mock.calls;
      expect(String(calls[calls.length - 1]![0])).toContain('search=Garage');
    });
  });

  it('narrows the list from a type toggle and reports it pressed', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();

    const carrierChip = screen.getByRole('button', { name: 'Nhà xe' });
    expect(carrierChip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(carrierChip);

    expect(carrierChip.getAttribute('aria-pressed')).toBe('true');
    // The page renders the card list and the worksheet table side by side
    // (`mobile-only` / `desktop-only`), so a surviving row appears twice.
    expect(screen.getAllByText('Garage Auto 123').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Vật tư Minh Long')).toHaveLength(0);
  });

  it('keeps the page and its stylesheet free of hand-rolled bar markup', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');

    expect(page).toContain("import { EmptyState, FilterBar, Pagination, useTableQueryState } from '../design-system';");
    expect(page).toContain('<FilterBar');
    expect(page).not.toContain('className="filter-bar"');
    expect(page).not.toContain('filter-bar__search');
    expect(page).not.toContain('filter-bar__spacer');
    // The page may not declare filter layout: no bar/search rule survives here.
    expect(css).not.toMatch(/\.filter-bar\b/);
  });
});
