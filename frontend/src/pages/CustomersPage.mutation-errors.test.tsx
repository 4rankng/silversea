import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Customer } from '@tingting/shared';

const { toastSpy, apiMock } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: apiMock };
});

vi.mock('../hooks/useQueries', () => ({
  useCustomerLedgerEntries: () => ({ data: [] }),
  useSuppliers: () => ({ data: { items: [], total: 0 } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import CustomersPage from './CustomersPage';

const customerFixture: Customer = {
  id: 2,
  name: 'Công ty CP Vận tải Biển Bạc',
  shortName: 'Biển Bạc',
  taxCode: '0101234567',
  contactPerson: 'Phạm Thị Biển',
  phone: '02253555555',
  creditLimit: null,
  paymentTermDays: 30,
  fuelSurchargeSharePct: null,
  paymentDatePolicy: 'NEXT_BUSINESS_DAY',
  status: 'ACTIVE',
  isCarrier: false,
  debitNoteMode: 'MONTHLY',
  linkedSupplierId: null,
} as unknown as Customer;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openEditModal() {
  // The list renders asynchronously (useTableQueryState → useQuery); wait for
  // the fixture row before interacting. The mobile card exposes a direct
  // "Sửa" button; the desktop row hides its "Sửa" behind a dropdown until
  // menuOpenId matches, so the first match is the mobile one in jsdom.
  expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();
  fireEvent.click(await screen.findByText('Sửa'));
  expect(await screen.findByText(/Sửa khách hàng — Biển Bạc/)).toBeTruthy();
}

async function saveFromModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
}

describe('CustomersPage mutation error surfacing', () => {
  beforeEach(() => {
    toastSpy.mockClear();
    apiMock.put.mockReset();
    apiMock.post.mockReset();
    apiMock.delete.mockReset();
    // The list now flows through the real useTableQueryState → configClient
    // → api.get; feed the fixture so the rows (and their "Sửa" actions) render.
    apiMock.get.mockReset();
    apiMock.get.mockResolvedValue({ items: [customerFixture], total: 1 });
  });

  it('toasts the pending-governance 409 with an approval-center hint and keeps the modal open', async () => {
    const conflict = 'Đã có yêu cầu quản trị đang xử lý cho cấu hình này';
    apiMock.put.mockRejectedValue(
      new ApiError(409, { error: conflict }, conflict),
    );

    renderPage();
    await openEditModal();
    await saveFromModal();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    const [call] = toastSpy.mock.calls;
    expect(call[0].kind).toBe('error');
    expect(call[0].message).toContain(conflict);
    expect(call[0].message).toContain('Trung tâm phê duyệt');

    // The modal must stay open so the user can retry or cancel — the error is
    // NOT routed to the table slot that sits behind the modal overlay.
    expect(screen.getByText(/Sửa khách hàng — Biển Bạc/)).toBeTruthy();
  });

  it('toasts non-409 mutation errors verbatim without the governance hint', async () => {
    apiMock.put.mockRejectedValue(new ApiError(400, { error: 'MST đã tồn tại' }, 'MST đã tồn tại'));

    renderPage();
    await openEditModal();
    await saveFromModal();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy.mock.calls[0][0]).toEqual({
      kind: 'error',
      message: 'MST đã tồn tại',
      duration: 7000,
    });
    expect(screen.getByText(/Sửa khách hàng — Biển Bạc/)).toBeTruthy();
  });
});
