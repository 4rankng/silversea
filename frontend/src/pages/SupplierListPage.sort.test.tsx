import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Supplier } from '@tingting/shared';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
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

function supplierFixture(id: number, name: string): Supplier {
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
    types: [],
    primaryType: null,
    chiHoDueDays: null,
    cuocDueDays: null,
  } as unknown as Supplier;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SupplierListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastGetUrl(): string {
  const calls = apiMock.get.mock.calls;
  return String(calls[calls.length - 1]![0]);
}

describe('SupplierListPage server-side sort headers', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    // 12 total at pageSize 10 → two pages, so the page-reset proof can run.
    apiMock.get.mockResolvedValue({
      items: [supplierFixture(1, 'Garage Auto 123'), supplierFixture(2, 'Vĩnh Cường')],
      total: 12,
      page: 1,
      pageSize: 10,
    });
  });

  it('sends sortBy/sortDir to the endpoint, toggles asc→desc, and resets to page 1', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastGetUrl()).toContain('page=2'));

    fireEvent.click(screen.getByRole('button', { name: 'Tên' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('page=1');
      expect(lastGetUrl()).toContain('sortBy=name');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tên' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortDir=desc');
      expect(lastGetUrl()).toContain('page=1');
    });
  });

  it('exposes each data column\'s backend sort key through its header button', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();

    const sortKeys: Array<[string, string]> = [
      ['Người liên hệ', 'contactPerson'],
      ['SĐT', 'phone'],
      ['Mã số thuế', 'taxCode'],
      ['KH liên kết', 'linkedCustomer'],
      ['Công nợ', 'payable'],
    ];
    for (const [label, key] of sortKeys) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      // eslint-disable-next-line no-await-in-loop -- sequential clicks each await their own request
      await waitFor(() => expect(lastGetUrl()).toContain(`sortBy=${key}`));
    }
    // The last-clicked column announces direction via its header cell.
    expect(screen.getByRole('button', { name: 'Công nợ' }).closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('omits sort params entirely until a header is pressed', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();
    expect(lastGetUrl()).not.toContain('sortBy');
    expect(lastGetUrl()).not.toContain('sortDir');
  });
});
