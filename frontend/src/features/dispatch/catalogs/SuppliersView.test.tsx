import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupplierType } from '@tingting/shared';
import type { Supplier } from '@tingting/shared';

const { apiPost, apiPut, apiDelete, invalidateAllCatalogs } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  invalidateAllCatalogs: vi.fn(async () => []),
}));

const suppliersState = {
  data: undefined as { items: Supplier[]; total: number } | undefined,
  isLoading: false,
  error: null as unknown,
};

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useSuppliers: () => suppliersState,
  useAllCustomers: () => ({ data: [] }),
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../../lib/api', () => ({
  api: { post: apiPost, put: apiPut, delete: apiDelete },
}));

vi.mock('../../../api/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/keys')>()),
  invalidateAllCatalogs,
}));

import { SuppliersView } from './SuppliersView';

const supplier = (overrides: Partial<Supplier> = {}): Supplier => ({
  id: 1,
  name: 'Công ty Vận tải Biển Đông',
  contactPerson: 'Lê Văn Tài',
  phone: '0912345678',
  taxCode: null,
  partnerId: null,
  note: null,
  status: 'ACTIVE',
  linkedCustomerId: null,
  isFuelSupplier: false,
  types: [SupplierType.CARRIER],
  primaryType: SupplierType.CARRIER,
  chiHoDueDays: null,
  cuocDueDays: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('SuppliersView (dispatcher read-only)', () => {
  beforeEach(() => {
    suppliersState.data = undefined;
    suppliersState.isLoading = false;
    suppliersState.error = null;
  });

  it('renders supplier rows with contact, type label, status', () => {
    suppliersState.data = {
      items: [
        supplier(),
        supplier({ id: 2, name: 'Cảng Cát Lái', contactPerson: null, phone: null, types: [SupplierType.PORT], status: 'INACTIVE' }),
      ],
      total: 2,
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Công ty Vận tải Biển Đông')).toBeTruthy();
    expect(screen.getByText('Lê Văn Tài')).toBeTruthy();
    expect(screen.getByText('0912345678')).toBeTruthy();
    expect(screen.getByText('0912345678').closest('td')).toHaveAttribute('data-label', 'SĐT');
    expect(screen.getByText('Vận chuyển')).toBeTruthy();
    expect(screen.getByText('Cảng')).toBeTruthy();
    expect(screen.getByText('Ngừng hoạt động')).toBeTruthy();
  });

  it('shows loading then empty states', () => {
    suppliersState.isLoading = true;
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Đang tải…')).toBeTruthy();

    suppliersState.isLoading = false;
    suppliersState.data = { items: [], total: 0 };
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Chưa có nhà thầu phụ nào')).toBeTruthy();
  });

  it('renders delete buttons and no payable links — CRUD surface', () => {
    suppliersState.data = { items: [supplier()], total: 1 };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('button', { name: /xóa/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: /thêm nhà thầu phụ/i })).toBeTruthy();
  });

  it('renders its toolbar as the shared filter plane', () => {
    suppliersState.data = { items: [supplier()], total: 1 };
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );

    expect(container.querySelector('.filter-bar.filter-bar--card.list-filter-bar')).toBeTruthy();
    expect(container.querySelector('.dispatch-catalogs__toolbar')).toBeNull();
    expect(screen.getByText('1 nhà thầu phụ')).toBeTruthy();
  });

  it('the create hint names the real default — name-only lands Vận chuyển (CARRIER), other groups alone stay a pure supplier', () => {
    suppliersState.data = { items: [], total: 0 };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhà thầu phụ' }));
    // The hint must describe what the save really does (QA 26/11): the form
    // mints a carrier by default (pinned by the POST body assertion below in
    // the create test), so the copy names that default and the way out.
    const hint = screen.getByText(/hệ thống mặc định gán/);
    expect(hint.textContent).toContain('Vận chuyển');
    expect(hint.textContent).toContain('nhà cung cấp thuần');
  });

  it('creates a subcontractor through the form modal, defaulted to Vận chuyển (CARRIER), and refreshes catalogs', async () => {
    apiPost.mockReset();
    apiPost.mockResolvedValueOnce({});
    suppliersState.data = { items: [], total: 0 };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhà thầu phụ' }));
    // CR-011 §4.3.5 — a new contractor mints as a carrier so it is selectable
    // in all 4 assignment dropdowns from birth; the user may still deselect.
    expect(screen.getByRole('button', { name: 'Vận chuyển' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText(/tên nhà cung cấp/i), { target: { value: 'Nhà xe Mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhà cung cấp' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/suppliers', expect.objectContaining({
      name: 'Nhà xe Mới',
      types: ['CARRIER'],
      primaryType: 'CARRIER',
    })));
    await waitFor(() => expect(invalidateAllCatalogs).toHaveBeenCalled());
  });

  it('labels each KPI with the basis of its number', () => {
    suppliersState.data = { items: [supplier(), supplier({ id: 2, status: 'INACTIVE' })], total: 37 };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SuppliersView />
      </QueryClientProvider>,
    );

    // `total` is the whole dataset carried by the paginated response; the active
    // count is only the rows on this page. The two labels must say so.
    expect(screen.getByText('Tổng (tất cả)')).toBeTruthy();
    expect(screen.getByText('Đang hoạt động (trang này)')).toBeTruthy();
  });
});
