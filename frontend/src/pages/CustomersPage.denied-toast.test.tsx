import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type * as ApiLib from '../lib/api';
import type { Customer } from '@tingting/shared';

/**
 * Card 071026212000 (lead ruling, user 2026-10-08) — a permission toast may
 * fire ONLY for a genuine user-initiated denied action, and it MUST name the
 * action. The identified source is the raw error→toast mapping
 * (`toastMutationError`, CustomersPage.tsx): it echoed any `err.message`
 * verbatim, so a 403 body rendered the bare "Không có quyền truy cập" —
 * exactly the string the tester saw flashing — while aborted/raced errors and
 * non-403 bodies carrying that string (error-shape collision) could fire the
 * same red toast.
 *
 * Pre-fix behavior of the page-load flash itself is nondeterministic (4 passes
 * over staging: 0 toasts / 0 403s; the component tree has no load-time toast
 * path), so per contract the flash is recorded nondeterministic and these
 * tests pin the fixed mapping semantics at the identified source instead of
 * engineering a fake red on the flash. Tests 1-3 are honest reds: they fail
 * against the pre-fix mapping.
 */

const { toastSpy, apiMock } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiLib>();
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
  expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();
  fireEvent.click(await screen.findByText('Sửa'));
  expect(await screen.findByText('Sửa khách hàng')).toBeTruthy();
}

async function openAddModal() {
  fireEvent.click(await screen.findByRole('button', { name: /Thêm khách hàng/ }));
  expect(await screen.findByText('Tên đầy đủ')).toBeTruthy();
}

describe('permission toast policy at the customers error→toast mapping', () => {
  beforeEach(() => {
    toastSpy.mockClear();
    apiMock.get.mockReset();
    apiMock.put.mockReset();
    apiMock.post.mockReset();
    apiMock.get.mockResolvedValue({ items: [customerFixture], total: 1 });
  });

  it('a genuine denied UPDATE names the action instead of echoing the bare server body', async () => {
    // The exact body the tester's red toast showed (casbin.ts:26 shape).
    apiMock.put.mockRejectedValue(
      new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'),
    );

    renderPage();
    await openEditModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    const toast = toastSpy.mock.calls[0][0];
    expect(toast.kind).toBe('error');
    expect(toast.message).toBe('Bạn không có quyền cập nhật khách hàng.');
    expect(toast.message).not.toBe('Không có quyền truy cập');
  }, 15_000);

  it('a genuine denied CREATE names the action too', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'),
    );

    renderPage();
    await openAddModal();
    fireEvent.change(screen.getByLabelText(/Tên đầy đủ/), { target: { value: 'Công ty Mới' } });
    fireEvent.change(screen.getByLabelText(/Tên ngắn/), { target: { value: 'Mới' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Thêm khách hàng$/ }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy.mock.calls[0][0].message).toBe('Bạn không có quyền tạo khách hàng.');
  }, 15_000);

  it('an aborted/raced request toasts NOTHING', async () => {
    apiMock.put.mockRejectedValue(
      new DOMException('The user aborted a request', 'AbortError'),
    );

    renderPage();
    await openEditModal();
    const submit = screen.getByRole('button', { name: 'Cập nhật' });
    fireEvent.click(submit);

    await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
    // The catch/finally settled when the save button re-enables — any stray
    // toast would have fired before that state lands.
    await waitFor(() => expect(submit).toBeEnabled());
    expect(toastSpy).not.toHaveBeenCalled();
  }, 15_000);

  it('a NON-403 carrying the permission string never renders it (error-shape collision)', async () => {
    apiMock.put.mockRejectedValue(
      new ApiError(500, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'),
    );

    renderPage();
    await openEditModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    const toast = toastSpy.mock.calls[0][0];
    expect(toast.message).not.toContain('Không có quyền');
    expect(toast.message).toBe('Lỗi cập nhật');
  }, 15_000);

  it('a business refusal carried at 403 stays verbatim (not a permission denial)', async () => {
    // use-trip-form-submit.ts:582-586 relies on this class staying intact.
    const refusal = 'Khách hàng đã vượt hạn mức tín dụng';
    apiMock.put.mockRejectedValue(new ApiError(403, { error: refusal }, refusal));

    renderPage();
    await openEditModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy.mock.calls[0][0].message).toBe(refusal);
  }, 15_000);

  it('AC3 pin — /customers load as admin produces zero toasts, even when background queries fail', async () => {
    // All load-path queries reject with the permission body AND an abort; a
    // page load must still be silent (background queries never toast).
    apiMock.get.mockRejectedValue(
      new ApiError(403, { error: 'Không có quyền truy cập' }, 'Không có quyền truy cập'),
    );

    renderPage();
    // The rejected list query settles into the page's inline error row — the
    // deterministic signal that every load-path query has finished failing.
    expect(await screen.findByText('Không thể tải dữ liệu')).toBeTruthy();
    expect(toastSpy).not.toHaveBeenCalled();

    // And the happy path as well.
    toastSpy.mockClear();
    apiMock.get.mockReset();
    apiMock.get.mockResolvedValue({ items: [customerFixture], total: 1 });
    renderPage();
    await waitFor(() => expect(screen.findAllByText('Biển Bạc')).resolves.toBeTruthy());
    expect(toastSpy).not.toHaveBeenCalled();
  }, 15_000);
});
