import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';

const { get, suppliers, categories } = vi.hoisted(() => ({ get: vi.fn(), suppliers: vi.fn(), categories: vi.fn() }));
vi.mock('../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api')>(), api: { get } }));
vi.mock('../api/configClient', () => ({ configClient: { getAllSuppliers: suppliers, getAllExpenseCategories: categories } }));
vi.mock('../hooks/useCatalogs', () => ({ useCatalogs: () => ({ data: { trucks: [], trailers: [] } }) }));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));
import ExpenseEntryPage from './ExpenseEntryPage';

function renderPage(path = '/expenses/new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><ToastProvider><Routes>
    <Route path="/expenses/new" element={<ExpenseEntryPage />} />
    <Route path="/expenses/:id/edit" element={<ExpenseEntryPage />} />
    <Route path="/expenses" element={<div>Danh sách chi phí</div>} />
  </Routes></ToastProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  suppliers.mockResolvedValue([{ id: 1, name: 'Gara Hải Phòng', status: 'ACTIVE' }]);
  categories.mockResolvedValue([{ id: 1, name: 'Bảo hiểm', isRenewable: false, status: 'ACTIVE' }]);
  get.mockImplementation((path: string) => path.endsWith('/photos') ? Promise.resolve({ items: [] }) : Promise.reject(new Error('Không tìm thấy phiếu chi')));
});

describe('ExpenseEntryPage load and recovery', () => {
  it('does not present a blank editable financial record when detail loading fails', async () => {
    renderPage('/expenses/999/edit');
    expect(await screen.findByRole('heading', { name: 'Không tải được chi phí' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tìm thấy phiếu chi');
    expect(screen.queryByRole('button', { name: 'Cập nhật' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Số tiền (đ)', { exact: false })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Về danh sách chi phí' }));
    expect(screen.getByText('Danh sách chi phí')).toBeInTheDocument();
  });

  it('retrieves the actual record after an explicit retry', async () => {
    renderPage('/expenses/999/edit');
    await screen.findByRole('alert');
    get.mockResolvedValue({ id: 999, expenseDate: '2026-09-17', supplierId: 1, categoryId: 1, amount: '125000', paymentStatus: 'UNPAID', note: 'Hồ sơ thật', createdAt: '2026-09-17T02:00:00Z' });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByDisplayValue('Hồ sơ thật')).toBeInTheDocument();
    expect(screen.getByDisplayValue('125.000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cập nhật' })).toBeEnabled();
  });

  it('keeps the draft and blocks submission when catalogs fail, then recovers without resetting fields', async () => {
    suppliers.mockRejectedValueOnce(new Error('Mất kết nối'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh mục');
    const amount = screen.getByLabelText('Số tiền (đ)', { exact: false });
    fireEvent.change(amount, { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Giữ bản nháp của tôi' } });
    expect(screen.getByRole('button', { name: 'Lưu chi phí' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh mục' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('250.000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Giữ bản nháp của tôi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu chi phí' })).toBeEnabled();
    expect(suppliers).toHaveBeenCalledTimes(2);
  });

  it('marks every invalid required field and reports no hidden native required control on invalid submit', async () => {
    renderPage();
    const save = await screen.findByRole('button', { name: 'Lưu chi phí' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(screen.getByLabelText('Số tiền (đ)', { exact: false })).toHaveAttribute('aria-invalid', 'true');
    const selectErrors = [...document.querySelectorAll('.ds-uui-select__error')].map(e => e.textContent);
    expect(selectErrors).toContain('Vui lòng chọn nhà cung cấp');
    expect(selectErrors).toContain('Vui lòng chọn hạng mục chi phí');
    expect(screen.getByText('Số tiền phải là số dương')).toBeInTheDocument();
    // The app validates and displays itself; no offscreen native [required]
    // control participates (AC 2).
    expect(document.querySelectorAll('[required]')).toHaveLength(0);
  });
});
