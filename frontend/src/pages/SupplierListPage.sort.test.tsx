/**
 * Card (freeze-halting small, lead 2026-10-03): /suppliers ignored sort
 * params in the URL entirely — QA's gate seeded ?sortBy=&sortDir= and the
 * page fetched unsorted until a header was pressed. The page must seed its
 * table filters bag from the URL on mount so the server sort honors the
 * deep link (readTableSort semantics: absent/invalid → no sort).
 */
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierType, type Supplier } from '@tingting/shared';
import type * as ApiModule from '../lib/api';

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
    items: [supplierFixture(1, 'Garage Auto 123', [SupplierType.CARRIER])],
    total: 1,
    page: 1,
    pageSize: 10,
  });
});

describe('SupplierListPage — URL sort seed (freeze-halting small)', () => {
  it('seeds the server sort from ?sortBy/&sortDir on load', async () => {
    window.history.replaceState({}, '', '/suppliers?sortBy=name&sortDir=asc');
    renderPage();

    await waitFor(() => {
      const call = apiMock.get.mock.calls.find(([url]) => String(url).includes('/suppliers?'));
      expect(call).toBeTruthy();
      const u = new URL(String(call![0]), 'http://localhost');
      expect(u.searchParams.get('sortBy')).toBe('name');
      expect(u.searchParams.get('sortDir')).toBe('asc');
    });
  });

  it('ignores an invalid dir and keeps the contract shape (absent sortBy → no sort param)', async () => {
    window.history.replaceState({}, '', '/suppliers?sortDir=desc');
    renderPage();

    await waitFor(() => {
      const call = apiMock.get.mock.calls.find(([url]) => String(url).includes('/suppliers?'));
      expect(call).toBeTruthy();
      const u = new URL(String(call![0]), 'http://localhost');
      expect(u.searchParams.get('sortBy')).toBeNull();
    });
  });
});
