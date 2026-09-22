import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';
import OpsWalletPage from './OpsWalletPage';

const { apiGet, apiPost, apiPatch, apiDelete } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete, upload: vi.fn() },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <OpsWalletPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const expense = (overrides: Record<string, unknown> = {}) => ({
  id: 1, shipmentId: 10, shipmentCode: 'SS-1', containerNumber: 'TSTU0000001',
  expenseTypeCode: 'CANXE', expenseTypeName: 'Cân xe', requiresInvoice: false,
  amount: '90000', paidAt: '2026-09-07', note: null, approvalStatus: 'RECORDED',
  rejectionReason: null, opsSettlementId: null, hasPhoto: false, paidById: 7,
  paidByName: 'Ops A', createdAt: '2026-09-07T00:00:00.000Z',
  ...overrides,
});

describe('OpsWalletPage (OpsVanHanh §5)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/wallet/summary')) {
        return Promise.resolve({
          totalAdvance: '2000000', approved: '350000', pending: '90000',
          rejected: '0', balance: '1560000',
        });
      }
      if (url.startsWith('/ops/wallet/expenses')) return Promise.resolve({ items: [expense()] });
      if (url.startsWith('/ops/settlements')) return Promise.resolve({ items: [] });
      if (url === '/ops/expense-types') return Promise.resolve({ items: [{ code: 'CANXE', name: 'Cân xe', requiresInvoice: false, isActive: true }] });
      return Promise.resolve({ items: [] });
    });
  });

  it('explains a failed removal and preserves the expense for retry', async () => {
    apiDelete.mockRejectedValueOnce(new Error('Không thể kết nối để xóa khoản chi'));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: 'Xóa khoản chi SS-1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText('Không thể kết nối để xóa khoản chi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xóa khoản chi SS-1' })).toBeEnabled());
    expect(apiDelete).toHaveBeenCalledOnce();
    expect(screen.getByText('Cân xe')).toBeInTheDocument();
  });

  it('prevents overlapping removal requests while deletion is pending', async () => {
    apiDelete.mockReturnValue(new Promise(() => {})); renderPage();
    const remove = await screen.findByRole('button', { name: 'Xóa khoản chi SS-1' });
    fireEvent.click(remove); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledOnce());
    expect(remove).toBeDisabled(); fireEvent.click(remove); expect(apiDelete).toHaveBeenCalledOnce();
  });

  it('distinguishes recorded expense money from the server-computed balance', async () => {
    renderPage();
    expect(await screen.findByText(/1\.560\.000/)).toBeInTheDocument();
    expect(screen.getByText('Chi phí đã ghi nhận')).toBeInTheDocument();
    expect(screen.getByText('350.000 ₫')).toBeInTheDocument();
    expect(screen.getAllByText('Đã trả lại').length).toBeGreaterThan(0);
  });

  it('card 20260922_27: a recorded request with no cash delivered is amber, not success-green', async () => {
    const original = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((url: string) => url.startsWith('/ops/wallet/advance-requests')
      ? Promise.resolve({ items: [
        { id: 10, amount: '1000000', fundedAmount: 0, reason: 'pending money', status: 'RECORDED', createdAt: '2026-09-17' },
        { id: 11, amount: '500000', fundedAmount: 500000, reason: 'received money', status: 'RECORDED', createdAt: '2026-09-17' },
      ] }) : original(url));
    renderPage();
    const labels = await screen.findAllByText('Chưa giao tiền');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const style = (label as HTMLElement).closest('span')?.getAttribute('style') ?? '';
      expect(style).toContain('--warn');
      expect(style).not.toContain('--success');
    }
    // The green token stays reserved for money actually received.
    const received = screen.getAllByText(/Đã nhận/).length;
    expect(received).toBeGreaterThan(0);
  });

  it('distinguishes an unfunded request from actual cash received', async () => {
    const original = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((url: string) => url.startsWith('/ops/wallet/advance-requests')
      ? Promise.resolve({ items: [
        { id: 10, amount: '1000000', fundedAmount: 0, reason: 'Chưa giao tiền', status: 'RECORDED', createdAt: '2026-09-17' },
        { id: 11, amount: '500000', fundedAmount: 500000, reason: 'Đã giao tiền', status: 'RECORDED', createdAt: '2026-09-17' },
      ] }) : original(url));
    renderPage();
    expect(await screen.findByText('Đã nhận 500.000 ₫')).toBeInTheDocument();
    expect(screen.getAllByText('Chưa giao tiền')).toHaveLength(2);
  });

  it('flags entries without photos as Nợ chứng từ', async () => {
    renderPage();
    expect(await screen.findByText('Nợ chứng từ')).toBeInTheDocument();
  });

  it('submits an advance request with amount + reason', async () => {
    apiPost.mockResolvedValue({ id: 99, status: 'RECORDED' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Xin Tạm Ứng/ }));

    const amountInput = await screen.findByLabelText(/Số tiền \(VND\)/);
    fireEvent.change(amountInput, { target: { value: '123.45' } });
    expect(amountInput).toHaveValue(123.45);
    expect(screen.getByRole('button', { name: /Lưu tạm ứng/ })).toBeDisabled();
    fireEvent.submit(amountInput.closest('form')!);
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(amountInput, { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText(/Lý do \/ Ghi chú/), { target: { value: 'ứng phí cảng' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu tạm ứng/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/ops/wallet/advance-requests', {
        amount: 500000,
        reason: 'ứng phí cảng',
      });
    });
  });

  it('lets the author edit a recorded unsettled expense (PRD §5.5 sửa)', async () => {
    apiPatch.mockResolvedValue(expense({ amount: '120000' }));
    renderPage();
    await screen.findByText('SS-1');

    fireEvent.click(screen.getByRole('button', { name: /Sửa khoản chi SS-1/ }));
    const dialog = await screen.findByRole('dialog', { name: /Sửa khoản chi SS-1/ });
    expect(dialog).toBeInTheDocument();
    // Prefilled with the current amount.
    const amountInput = within(dialog).getByLabelText(/Thực chi \(VND\)/) as HTMLInputElement;
    expect(amountInput).toHaveValue(90000);
    fireEvent.change(amountInput, { target: { value: '123.45' } });
    expect(amountInput).toHaveValue(123.45);
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    fireEvent.submit(dialog.querySelector('form')!);
    expect(apiPatch).not.toHaveBeenCalled();
    fireEvent.change(amountInput, { target: { value: '120000' } });
    fireEvent.change(within(dialog).getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Sửa đúng chứng từ gốc' } });
    // jsdom does not synthesize form submission from submit-button clicks
    // here; submit the form directly.
    fireEvent.submit(dialog.querySelector('form')!);

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/ops/expenses/1', expect.objectContaining({
        amount: '120000',
        expenseTypeCode: 'CANXE',
        paidAt: '2026-09-07',
      }));
    });
  });
  it('reports query failures instead of empty money/history and lets the user retry', async () => {
    apiGet.mockRejectedValue(new Error('Unavailable'));
    renderPage();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(5));
    expect(screen.queryByText('Chưa có khoản chi nào.')).not.toBeInTheDocument();
    expect(screen.queryByText('Chưa có phiếu nào.')).not.toBeInTheDocument();
    apiGet.mockImplementation((url: string) => Promise.resolve(url.includes('/summary')
      ? { balance: '123000', totalAdvance: '123000', returned: '0', approved: '0' }
      : { items: [] }));
    fireEvent.click(within(screen.getAllByRole('alert')[0]).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('123.000 ₫')).toBeInTheDocument();
  });

  it('opens settlement detail immediately and keeps a dismissible error state', async () => {
    let rejectDetail!: (reason: Error) => void;
    apiGet.mockImplementation((url: string) => {
      if (url === '/ops/settlements/12') return new Promise((_resolve, reject) => { rejectDetail = reject; });
      if (url.startsWith('/ops/settlements')) return Promise.resolve({ items: [{ id: 12, code: 'QT-12', status: 'RECORDED', totalAmount: '1000', createdAt: '2026-09-15' }] });
      return Promise.resolve({ items: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem' }));
    const detail = await screen.findByRole('dialog', { name: 'Phiếu quyết toán 12' });
    expect(within(detail).getByRole('status')).toHaveTextContent('Đang tải chi tiết quyết toán');
    await waitFor(() => expect(rejectDetail).toBeDefined());
    rejectDetail(new Error('Unavailable'));
    expect(await within(detail).findByRole('alert')).toHaveTextContent('Không tải được chi tiết quyết toán');
    fireEvent.click(within(detail).getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['VOIDED', null],
    ['REJECTED', null],
    ['RECORDED', 12],
  ])('keeps receipt viewing read-only for a %s expense linked to %s', async (approvalStatus, opsSettlementId) => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/wallet/expenses')) return Promise.resolve({ items: [expense({ approvalStatus, opsSettlementId, hasPhoto: true })] });
      if (url === '/ops/expenses/1/photos') return Promise.resolve({ items: [{ id: 91, storageKey: 'receipt.png', url: '/api/photos/receipt.png' }] });
      return Promise.resolve({ items: [] });
    });
    renderPage();
    await screen.findByText('SS-1');
    expect(screen.queryByRole('button', { name: /Sửa khoản chi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xóa khoản chi/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ảnh' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ảnh biên lai' });
    expect(await within(dialog).findByRole('button', { name: 'Xem ảnh 1' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Xóa ảnh/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Lưu|Thêm ảnh/ })).not.toBeInTheDocument();
  });

});
