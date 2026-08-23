import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Supplier } from '@tingting/shared';
import type { TableSortState } from '../../../lib/table-sort';

const { useSuppliersMock } = vi.hoisted(() => ({
  useSuppliersMock: vi.fn(),
}));

vi.mock('../../../hooks/useCatalogQueries', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../hooks/useCatalogQueries')>();
  return {
    ...original,
    useSuppliers: useSuppliersMock,
    useAllCustomers: () => ({ data: [] }),
  };
});

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import { SuppliersView } from './SuppliersView';

const suppliers: Supplier[] = [
  { id: 1, name: 'Garage Zeta', shortName: '', status: 'ACTIVE', types: ['FUEL'] },
  { id: 2, name: 'An Auto', shortName: '', status: 'INACTIVE', types: null },
] as unknown as Supplier[];

interface CapturedCall {
  page?: number;
  search?: string;
  sort?: TableSortState | null;
}

function lastCall(): CapturedCall {
  const calls = useSuppliersMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [page, search, sort] = calls[calls.length - 1] as [number?, string?, TableSortState | null?];
  return { page, search, sort };
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SuppliersView />
    </QueryClientProvider>,
  );
}

describe('SuppliersView server-side sort headers', () => {
  beforeEach(() => {
    useSuppliersMock.mockReset();
    useSuppliersMock.mockReturnValue({
      data: { items: suppliers, total: 25, page: 1, pageSize: 10 },
      isLoading: false,
      error: null,
    });
  });

  it('sends sortBy/sortDir through useSuppliers, toggles asc→desc, and resets to page 1', async () => {
    renderView();
    expect(await screen.findAllByText('Garage Zeta')).toBeTruthy();
    expect(lastCall().sort ?? null).toBeNull();

    // 25 suppliers at page size 10 → three pages; move to page 2 first.
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastCall().page).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: 'Tên' }));
    await waitFor(() => {
      expect(lastCall().page).toBe(1);
      expect(lastCall().sort).toEqual({ by: 'name', dir: 'asc' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tên' }));
    await waitFor(() => expect(lastCall().sort).toEqual({ by: 'name', dir: 'desc' }));
  });

  it('maps each data column header to its backend sort key', async () => {
    renderView();
    expect(await screen.findAllByText('Garage Zeta')).toBeTruthy();

    const sortKeys: Array<[string, string]> = [
      ['Liên hệ', 'contactPerson'],
      ['SĐT', 'phone'],
      ['Loại', 'types'],
      ['Trạng thái', 'status'],
    ];
    for (const [label, key] of sortKeys) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      // eslint-disable-next-line no-await-in-loop -- sequential clicks each await their own render
      await waitFor(() => expect(lastCall().sort).toEqual({ by: key, dir: 'asc' }));
    }
  });
});
