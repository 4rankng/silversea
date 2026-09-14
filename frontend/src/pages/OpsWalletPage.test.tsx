import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';
import OpsWalletPage from './OpsWalletPage';

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: apiPost, patch: apiPatch, delete: vi.fn(), upload: vi.fn() },
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
  amount: '90000', paidAt: '2026-09-07', note: null, approvalStatus: 'PENDING',
  rejectionReason: null, opsSettlementId: null, hasPhoto: false, paidById: 7,
  paidByName: 'Ops A', createdAt: '2026-09-07T00:00:00.000Z',
  ...overrides,
});

describe('OpsWalletPage (OpsVanHanh §5)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/wallet/summary')) {
        return Promise.resolve({
          totalAdvance: '2000000', approved: '350000', pending: '90000',
          rejected: '0', balance: '1560000',
        });
      }
      if (url.startsWith('/ops/wallet/expenses')) return Promise.resolve({ items: [expense()] });
      if (url.startsWith('/ops/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
  });

  it('renders the four cards with the server-computed formula', async () => {
    renderPage();
    expect(await screen.findByText(/1\.560\.000/)).toBeInTheDocument();
    // Card labels also appear in the history status column — assert presence.
    expect(screen.getAllByText('Đã ghi nhận').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đã trả lại').length).toBeGreaterThan(0);
  });

  it('flags entries without photos as Nợ chứng từ', async () => {
    renderPage();
    expect(await screen.findByText('Nợ chứng từ')).toBeInTheDocument();
  });

  it('submits an advance request with amount + reason', async () => {
    apiPost.mockResolvedValue({ id: 99, status: 'PENDING' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Xin Tạm Ứng/ }));

    const amountInput = await screen.findByLabelText(/Số tiền \(VND\)/);
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

  it('lets the author edit a pending expense (PRD §5.5 sửa)', async () => {
    apiPatch.mockResolvedValue(expense({ amount: '120000' }));
    renderPage();
    await screen.findByText('SS-1');

    fireEvent.click(screen.getByRole('button', { name: /Sửa khoản chi SS-1/ }));
    const dialog = await screen.findByRole('dialog', { name: /Sửa khoản chi SS-1/ });
    expect(dialog).toBeInTheDocument();
    // Prefilled with the current amount.
    const amountInput = within(dialog).getByLabelText(/Số tiền \(VND\)/) as HTMLInputElement;
    expect(amountInput.value).toContain('90.000');
    fireEvent.change(amountInput, { target: { value: '120000' } });
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
});
