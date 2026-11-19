import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import { OpsAccountantTab } from './OpsAccountantTab';

const { apiGet, apiPost, authUser } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), authUser: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  api: { get: apiGet, post: apiPost, patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));
// Card 191026160000 (§3c): the tab role-gates the KT-duyệt action; the
// legacy no-reviewer pins below run as a non-finance reader.
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authUser() }) }));

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
    authUser.mockReset().mockReturnValue(null);
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
    grouping: { groups: [], totals: { withInvoice: '0', withoutInvoice: '0', grand: '0', rawGrand: '0', excludedNegative: '0' } },
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
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ opsSettlementId: 3, opsSettlementCode: 'OS-2609-0001' })] });
      if (url.startsWith('/ops/admin/settlements')) {
        return Promise.resolve({ items: [{ id: 3, code: 'OS-2609-0001', status: 'RECORDED', totalAmount: '350000', note: null, createdAt: '2026-09-07T00:00:00.000Z', approvedAt: null, opsUserId: 7, opsUserName: 'Ops A' }] });
      }
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    // SIL-858 — the row's [Xem phiếu] button is gone; the sheet opens from
    // the Phiếu quyết toán Ops table below.
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    expect(await screen.findByText('Đang tải phiếu quyết toán…')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Phiếu quyết toán Ops' })).toBeInTheDocument();
  });

  it('surfaces a failed settlement detail with a retry that loads the sheet', async () => {
    let failDetail = true;
    apiGet.mockImplementation((url: string) => {
      if (url === '/ops/admin/settlements/3') {
        return failDetail ? Promise.reject(new Error('Mất kết nối')) : Promise.resolve(settlementDetail);
      }
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ opsSettlementId: 3, opsSettlementCode: 'OS-2609-0001' })] });
      if (url.startsWith('/ops/admin/settlements')) {
        return Promise.resolve({ items: [{ id: 3, code: 'OS-2609-0001', status: 'RECORDED', totalAmount: '350000', note: null, createdAt: '2026-09-07T00:00:00.000Z', approvedAt: null, opsUserId: 7, opsUserName: 'Ops A' }] });
      }
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được phiếu quyết toán');
    failDetail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    const dialog = screen.getByRole('dialog', { name: 'Phiếu quyết toán Ops' });
    await waitFor(() => expect(within(dialog).getByText('OS-2609-0001')).toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();
  });

  // Card 191026160000 — a missing receipt photo is neutral "không có ảnh"
  // (paper invoices reach the accountant), never a debt badge.
  it('shows missing receipt as neutral absence without approving it implicitly', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve({ items: url.startsWith('/ops/admin/expenses') ? [expense({ hasPhoto: false })] : [] }));
    renderTab();
    await screen.findByText('BL-9');
    expect(screen.getByRole('button', { name: 'Không có ảnh' })).toBeInTheDocument();
    expect(screen.queryByText('Nợ chứng từ')).toBeNull();
    expect(screen.queryByRole('button', { name: /duyệt/i })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

// Card 191026160000 (§3c) — "Ops lên chi phí → mục hoàn tạm ứng không hiện
// bên kế toán": an Ops chi chỉ reaches the ĐNTT (hoàn tạm ứng) axis after kế
// toán confirms it; that confirm used to live only in Kiểm soát phơi phiếu.
// The tab now states the duyệt state and offers the SAME batch confirm
// (/expense-accounting/confirm) phơi phiếu uses. Cases CP2-A3.
describe('OpsAccountantTab — KT-duyệt axis (card 191026160000 §3c)', () => {
  it('CP2-A3: an unconfirmed chi shows "Chưa duyệt" for a reader and the Duyệt button for kế toán', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ version: 1, confirmedAt: null })] });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    expect(screen.getByRole('columnheader', { name: 'Duyệt KT' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Duyệt$/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/expense-accounting/confirm',
      { entries: [{ sourceKind: 'OPS', sourceId: 5, expectedVersion: 1 }] },
    ));
  });

  it('CP2-A3: a non-finance role sees the state, never the button', async () => {
    authUser.mockReturnValue({ userId: 8, role: 'CUS' });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ version: 1, confirmedAt: null })] });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    expect(screen.getByText('Chưa duyệt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Duyệt$/ })).toBeNull();
  });

  it('CP2-A3: a confirmed chi states who-when ("Đã duyệt …"), no button', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) {
        return Promise.resolve({ items: [expense({ version: 1, confirmedAt: '2026-10-19T02:00:00.000Z' })] });
      }
      if (url.startsWith('/ops/admin/settlements')) {
        return Promise.resolve({ items: [] });
      }
      return Promise.resolve({ items: [] });
    });
    renderTab();
    expect(await screen.findByText('Đã duyệt 19/10/2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Duyệt$/ })).toBeNull();
  });

  it('CP2-A3: a refusal (thiếu hóa đơn) surfaces through the toast, not silence', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockRejectedValue(new Error('Bổ sung số và ngày hóa đơn trước khi đối chiếu.'));
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ version: 1, confirmedAt: null })] });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: /^Duyệt$/ }));
    expect(await screen.findByText(/Bổ sung số và ngày hóa đơn trước khi đối chiếu/)).toBeInTheDocument();
  });
});

// SIL-858 — the Chi phí Ops tab rework: Kỳ chi + Người-lập-lệnh-chi filters,
// the 3 lot-identity columns (Khách hàng/Nhà máy, Số tờ khai, Số HĐ with the
// no-invoice 'X'), 'Đã hủy / lịch sử' rows fully hidden, Trạng thái showing
// the settlement voucher code, and Ghi chú as the last column (the row-level
// [Xem phiếu] button is gone — the sheet opens from the phiếu table).
describe('OpsAccountantTab — SIL-858 accountant board rework', () => {
  const mockBoard = (items: Array<Record<string, unknown>>) => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
  };

  it('ẩn hoàn toàn dòng Đã hủy / lịch sử khỏi bảng', async () => {
    mockBoard([
      expense({ version: 1 }),
      expense({ id: 6, approvalStatus: 'VOIDED', note: 'đã hủy rồi' }),
      expense({ id: 7, approvalStatus: 'REJECTED', note: 'bị từ chối' }),
    ]);
    renderTab();
    expect(await screen.findByText('BL-9')).toBeInTheDocument();
    expect(screen.queryByText('Đã hủy / lịch sử')).toBeNull();
    expect(screen.queryByText('đã hủy rồi')).toBeNull();
    expect(screen.queryByText('bị từ chối')).toBeNull();
  });

  it('đủ 3 cột mới: Khách hàng/Nhà máy, Số tờ khai, Số HĐ (phí không hóa đơn hiện X)', async () => {
    mockBoard([
      expense({
        version: 1, requiresInvoice: false, invoiceNumber: null,
        customerName: 'Long Minh', factoryName: 'Nhà máy Long Minh',
        declarationNumber: null, note: 'đài phụ chứng chi phícont',
      }),
    ]);
    renderTab();
    expect(await screen.findByText('BL-9')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Khách hàng / Nhà máy' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Số tờ khai' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Số HĐ' })).toBeInTheDocument();
    expect(screen.getByText('Long Minh')).toBeInTheDocument();
    expect(screen.getByText('Nhà máy Long Minh')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument(); // phí không hóa đơn → 'X'
    expect(screen.getByText('—')).toBeInTheDocument(); // lô-chung → tờ khai trống
    expect(screen.getByText('đài phụ chứng chi phícont')).toBeInTheDocument();
  });

  it('Trạng thái hiện SỐ PHIẾU quyết toán; chưa tất toán giữ Chưa quyết toán', async () => {
    mockBoard([
      expense({ id: 5, version: 1, opsSettlementId: 3, opsSettlementCode: 'OS-2611-0009' }),
      expense({ id: 6, version: 1, opsSettlementId: null, opsSettlementCode: null }),
    ]);
    renderTab();
    expect(await screen.findByText('OS-2611-0009')).toBeInTheDocument();
    expect(screen.getByText('Chưa quyết toán')).toBeInTheDocument();
    expect(screen.queryByText('Đã lập phiếu')).toBeNull();
    // The row-level sheet button is gone; the phiếu table's Xem stays.
    expect(screen.queryByRole('button', { name: 'Xem phiếu' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Ghi chú' })).toBeInTheDocument();
  });

  it('bộ lọc Kỳ chi + Người lập lệnh chi đẩy from/to/opsUserId vào truy vấn', async () => {
    mockBoard([expense({ version: 1 })]);
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ version: 1 })] });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      if (url.startsWith('/expense-accounting/catalog')) {
        return Promise.resolve({ opsUsers: [{ id: 7, name: 'Ops A' }], expenseTypes: [], accounts: [] });
      }
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/11/2026' } });
    fireEvent.blur(screen.getByLabelText('Từ ngày'));
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '30/11/2026' } });
    fireEvent.blur(screen.getByLabelText('Đến ngày'));
    fireEvent.click(screen.getByRole('button', { name: 'Người lập lệnh chi' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ops A' }));
    await waitFor(() => expect(apiGet.mock.calls.some(([url]) => String(url).includes('opsUserId=7'))).toBe(true));
    const urls = apiGet.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('from=2026-11-01'))).toBe(true);
    expect(urls.some((url) => url.includes('to=2026-11-30'))).toBe(true);
  });
});
