import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  id: 5, shipmentId: 10, shipmentCode: 'SS-9', billRef: 'BL-9', containerNumber: null,
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
    expect(await screen.findByText('BL-9')).toBeInTheDocument();
    expect(screen.getAllByText('Ops A').length).toBeGreaterThan(0);
    expect(screen.getByText('Ảnh')).toBeInTheDocument();
  });

  it('exposes receipt inspection without any internal approval mutation', async () => {
    renderTab();
    await screen.findByText('BL-9');
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

  // The sheet modal used to mount only once `sheet.data` existed, so "Xem phiếu"
  // looked dead while the detail was in flight and stayed dead after a failure.
  const settlementDetail = {
    settlement: {
      id: 3, code: 'OS-2609-0001', status: 'RECORDED', totalAmount: '350000', note: null,
      createdAt: '2026-09-07T00:00:00.000Z', approvedAt: null, opsUserId: 7, opsUserName: 'Ops A',
    },
    grouping: { groups: [], totals: { withInvoice: '0', withoutInvoice: '0', grand: '0' } },
  };

  it('ID04 keeps missing creator labels honest while preserving settlement money and exact detail identity', async () => {
    const missingCreator = { ...settlementDetail.settlement, opsUserName: null };
    apiGet.mockImplementation((url: string) => {
      if (url === '/ops/admin/settlements/3') return Promise.resolve({ ...settlementDetail, settlement: missingCreator });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [missingCreator] });
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense()] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    const code = await screen.findByText('OS-2609-0001');
    const row = code.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Chưa rõ người lập')).toBeInTheDocument();
    expect(within(row!).queryByText('7')).not.toBeInTheDocument();
    expect(row).toHaveTextContent('350.000');
    fireEvent.click(within(row!).getByRole('button', { name: 'Xem' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/ops/admin/settlements/3'));
    expect(screen.getByRole('dialog', { name: 'Phiếu quyết toán Ops' })).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith('/ops/admin/settlements/7');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows the sheet modal loading for a settlement still in flight', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/ops/admin/settlements/3') return new Promise(() => {});
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ opsSettlementId: 3 })] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: 'Xem phiếu' }));
    expect(await screen.findByText('Đang tải phiếu quyết toán…')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Phiếu quyết toán Ops' })).toBeInTheDocument();
  });

  it('surfaces a failed settlement detail with a retry that loads the sheet', async () => {
    let failDetail = true;
    apiGet.mockImplementation((url: string) => {
      if (url === '/ops/admin/settlements/3') {
        return failDetail ? Promise.reject(new Error('Mất kết nối')) : Promise.resolve(settlementDetail);
      }
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ opsSettlementId: 3 })] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: 'Xem phiếu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được phiếu quyết toán');
    failDetail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText('OS-2609-0001')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows missing receipt as outstanding evidence without approving it implicitly', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve({ items: url.startsWith('/ops/admin/expenses') ? [expense({ hasPhoto: false })] : [] }));
    renderTab();
    await screen.findByText('BL-9');
    expect(screen.getByRole('button', { name: 'Nợ chứng từ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /duyệt/i })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
