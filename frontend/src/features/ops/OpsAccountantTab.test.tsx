import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import { OpsAccountantTab } from './OpsAccountantTab';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  api: { get: apiGet, post: apiPost, patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OpsAccountantTab />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const expense = (overrides: Record<string, unknown> = {}) => ({
  id: 5, shipmentId: 10, shipmentCode: 'SS-9', containerNumber: null,
  expenseTypeCode: 'NANGHA', expenseTypeName: 'Nâng/hạ', requiresInvoice: true,
  amount: '350000', paidAt: '2026-09-07', note: null, approvalStatus: 'PENDING',
  rejectionReason: null, opsSettlementId: null, hasPhoto: true, paidById: 7,
  paidByName: 'Ops A', createdAt: '2026-09-07T00:00:00.000Z',
  ...overrides,
});

describe('OpsAccountantTab (OpsVanHanh §5.4)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) {
        return Promise.resolve({ items: [expense()] });
      }
      if (url.startsWith('/ops/admin/settlements')) {
        return Promise.resolve({
          items: [{
            id: 3, code: 'OS-2609-0001', status: 'PENDING', totalAmount: '350000',
            note: null, createdAt: '2026-09-07T00:00:00.000Z', approvedAt: null,
            opsUserId: 7, opsUserName: 'Ops A',
          }],
        });
      }
      return Promise.resolve({ items: [] });
    });
  });

  it('lists pending expenses with the payer and debt state', async () => {
    renderTab();
    expect(await screen.findByText('SS-9')).toBeInTheDocument();
    expect(screen.getAllByText('Ops A').length).toBeGreaterThan(0);
    expect(screen.getByText('Ảnh')).toBeInTheDocument();
  });

  it('approves and rejects via the admin endpoints (reject requires reason)', async () => {
    apiPost.mockResolvedValue(expense());
    renderTab();
    await screen.findByText('SS-9');

    // Exact 'Duyệt' so the settlement batch's 'Duyệt phiếu' button is excluded.
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/ops/admin/expenses/5/approve', {});
    });

    // Reject flow: open the reason dialog, require text.
    fireEvent.click(screen.getByRole('button', { name: /Từ chối khoản chi/ }));
    const dialog = await screen.findByRole('dialog', { name: /Từ chối khoản chi/ });
    expect(dialog).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Từ chối' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Lý do từ chối/), { target: { value: 'Ảnh mờ' } });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/ops/admin/expenses/5/reject', { reason: 'Ảnh mờ' });
    });
  });

  it('shows pending settlement batches with the approve control', async () => {
    apiPost.mockResolvedValue({});
    renderTab();
    expect(await screen.findByText('OS-2609-0001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Duyệt phiếu/ })).toBeInTheDocument();
  });
});
