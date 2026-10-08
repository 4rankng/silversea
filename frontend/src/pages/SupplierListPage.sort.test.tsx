import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

import { ToastProvider } from '../components/shared/Toast';
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

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>{/* card 071026211100: the page answers exports with the house toast */}<SupplierListPage /></ToastProvider>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastGetUrl(): string {
  const calls = apiMock.get.mock.calls.filter(([url]) => String(url).startsWith('/suppliers?'));
  return String(calls[calls.length - 1]?.[0] ?? '');
}

describe('SupplierListPage server-side sort headers', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/suppliers');
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

    fireEvent.click(screen.getByRole('button', { name: 'Tên nhà cung cấp' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('page=1');
      expect(lastGetUrl()).toContain('sortBy=name');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tên nhà cung cấp' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortDir=desc');
      expect(lastGetUrl()).toContain('page=1');
    });
  }, 20_000);

  it('exposes each data column\'s backend sort key through its header button', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();

    const sortKeys: Array<[string, string]> = [
      ['Tên viết tắt', 'shortName'],
      ['Người liên hệ', 'contactPerson'],
      ['SĐT', 'phone'],
      ['Mã số thuế', 'taxCode'],
      ['Công nợ', 'payable'],
    ];
    for (const [label, key] of sortKeys) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(lastGetUrl()).toContain(`sortBy=${key}`));
    }
    // The last-clicked column announces direction via its header cell.
    expect(screen.getByRole('button', { name: 'Công nợ' }).closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  }, 20_000);

  it('omits sort params entirely on a plain load until a header is pressed', async () => {
    renderPage();
    expect(await screen.findAllByText('Garage Auto 123')).toBeTruthy();
    expect(lastGetUrl()).not.toContain('sortBy');
    expect(lastGetUrl()).not.toContain('sortDir');
  });

  it('names row menus and keeps nested keyboard actions separate from row navigation', async () => {
    renderPage();
    const menu = await screen.findByRole('button', { name: 'Tùy chọn nhà cung cấp Garage Auto 123' });
    expect(menu).toHaveAttribute('type', 'button');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const row = menu.closest('tr');
    expect(row).not.toBeNull();
    fireEvent.keyDown(within(row!).getByRole('button', { name: 'Sửa' }), { key: ' ' });
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    fireEvent.keyDown(row!, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('/suppliers/1');
  });
});

describe('SupplierListPage — URL sort seed (freeze-halting small, card 20261002_274 follow-through)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.get.mockResolvedValue({
      items: [supplierFixture(1, 'Garage Auto 123')],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it('seeds the server sort from ?sortBy/&sortDir on load (deep link honored by the first fetch)', async () => {
    window.history.replaceState({}, '', '/suppliers?sortBy=name&sortDir=asc');
    renderPage();

    await waitFor(() => {
      const call = apiMock.get.mock.calls.find(([url]) => String(url).includes('/suppliers?'));
      expect(call).toBeTruthy();
      const u = new URL(String(call![0]), 'http://localhost');
      expect(u.searchParams.get('sortBy')).toBe('name');
      expect(u.searchParams.get('sortDir')).toBe('asc');
    });
    window.history.replaceState({}, '', '/suppliers');
  });

  it('ignores a dir-only pair (no sortBy → no sort param)', async () => {
    window.history.replaceState({}, '', '/suppliers?sortDir=desc');
    renderPage();

    await waitFor(() => {
      const call = apiMock.get.mock.calls.find(([url]) => String(url).includes('/suppliers?'));
      expect(call).toBeTruthy();
      const u = new URL(String(call![0]), 'http://localhost');
      expect(u.searchParams.get('sortBy')).toBeNull();
    });
    window.history.replaceState({}, '', '/suppliers');
  });
});
