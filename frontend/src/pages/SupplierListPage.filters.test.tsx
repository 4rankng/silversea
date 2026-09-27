/**
 * Card 20260927_152 — the `/suppliers` strip rides the shared `ListFilterBar`.
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

    const carrierChip = screen.getByRole('button', { name: 'Xe ngoài (nhà thầu vận tải)' });
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

    expect(page).toContain("import { ListFilterBar } from '../components/ListFilterBar';");
    expect(page).toContain('<ListFilterBar');
    expect(page).not.toContain('className="filter-bar"');
    expect(page).not.toContain('filter-bar__search');
    expect(page).not.toContain('filter-bar__spacer');
    // The page may not declare filter layout: no bar/search rule survives here.
    expect(css).not.toMatch(/\.filter-bar\b/);
  });
});
