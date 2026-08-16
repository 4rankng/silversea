import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupplierType } from '@tingting/shared';
import type { Supplier } from '@tingting/shared';

const suppliersState = {
  data: undefined as { items: Supplier[]; total: number } | undefined,
  isLoading: false,
  error: null as unknown,
};

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useSuppliers: () => suppliersState,
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
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
    render(<SuppliersView />);

    expect(screen.getByText('Công ty Vận tải Biển Đông')).toBeTruthy();
    expect(screen.getByText('Lê Văn Tài')).toBeTruthy();
    expect(screen.getByText('0912345678')).toBeTruthy();
    expect(screen.getByText('Vận chuyển')).toBeTruthy();
    expect(screen.getByText('Cảng')).toBeTruthy();
    expect(screen.getByText('Ngừng hoạt động')).toBeTruthy();
  });

  it('shows loading then empty states', () => {
    suppliersState.isLoading = true;
    const { rerender } = render(<SuppliersView />);
    expect(screen.getByText('Đang tải…')).toBeTruthy();

    suppliersState.isLoading = false;
    suppliersState.data = { items: [], total: 0 };
    rerender(<SuppliersView />);
    expect(screen.getByText('Chưa có nhà thầu phụ nào')).toBeTruthy();
  });

  it('renders no mutation affordances and no payable links (read-only)', () => {
    suppliersState.data = { items: [supplier()], total: 1 };
    render(<SuppliersView />);
    expect(screen.queryByRole('button', { name: /thêm|sửa|xóa/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
