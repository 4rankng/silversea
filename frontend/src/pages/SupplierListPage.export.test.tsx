/**
 * Card 071026211100 — the /suppliers "Xuất Excel" must answer like every
 * sibling export: busy label while the file is being built, success toast
 * after, error toast on failure (FB-053 export feedback convention).
 */
import type * as ApiModule from '../lib/api';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupplierType, type Supplier } from '@tingting/shared';

const { apiMock, csvMock, toastMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  csvMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: apiMock };
});

vi.mock('../lib/csv', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/csv')>();
  return { ...original, downloadCSV: csvMock };
});

vi.mock('../components/shared/Toast', async (importOriginal) => {
  const original = await importOriginal<typeof import('../components/shared/Toast')>();
  return { ...original, useToast: () => ({ toast: toastMock }) };
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
    types: [SupplierType.CARRIER],
    primaryType: SupplierType.CARRIER,
    chiHoDueDays: null,
    deletedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SupplierListPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SupplierListPage export feedback (card 071026211100)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    toastMock.mockClear();
    csvMock.mockReset();
    apiMock.get.mockResolvedValue({ items: [supplierFixture(1, 'Nhà xe A'), supplierFixture(2, 'Nhà xe B')], total: 2 });
  });

  it('shows the busy label while exporting and a success toast after', async () => {
    let release!: () => void;
    csvMock.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    renderPage();
    await screen.findByRole('button', { name: 'Xuất Excel' });
    const button = screen.getByRole('button', { name: 'Xuất Excel' });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('button', { name: 'Đang xuất…' })).toBeTruthy();
    await act(async () => { release(); });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Đã xuất danh sách nhà cung cấp ra tệp Excel.' }));
  });

  it('toasts an error when the export fails', async () => {
    csvMock.mockRejectedValueOnce(new Error('disk'));
    renderPage();
    await screen.findByRole('button', { name: 'Xuất Excel' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' })); });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ kind: 'error', message: 'Chưa xuất được tệp Excel — vui lòng thử lại.' }));
  });
});
