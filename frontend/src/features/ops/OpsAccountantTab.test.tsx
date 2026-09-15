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
  amount: '350000', paidAt: '2026-09-07', note: null, approvalStatus: 'RECORDED',
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
            id: 3, code: 'OS-2609-0001', status: 'RECORDED', totalAmount: '350000',
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

  it('exposes receipt inspection without any internal approval mutation', async () => {
    renderTab();
    await screen.findByText('SS-9');
    expect(screen.queryByRole('button', { name: /duyệt|từ chối/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ảnh' }));
    await waitFor(() => expect(apiGet.mock.calls.some(([url]) => String(url).includes('/expenses/5/photos'))).toBe(true));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('keeps settlement detail available without a reviewer action', async () => {
    renderTab();
    expect(await screen.findByText('OS-2609-0001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /duyệt/i })).toBeNull();
  });

  it('shows missing receipt as outstanding evidence without approving it implicitly', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve({ items: url.startsWith('/ops/admin/expenses') ? [expense({ hasPhoto: false })] : [] }));
    renderTab();
    await screen.findByText('SS-9');
    expect(screen.getByRole('button', { name: 'Nợ chứng từ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /duyệt/i })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
