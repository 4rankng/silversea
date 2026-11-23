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

  // CR-010 E2 (SIL-882) — the INVOICED_ invoice-number/date gate is gone:
  // a row carrying a Số HĐ without Ngày HĐ (AC: "[Duyệt] dòng có Số HĐ không
  // Ngày HĐ thành công 100%") confirms through the SAME batch endpoint.
  it('CR-010 E2: a row with Số HĐ but no Ngày HĐ duyệt thành công through the batch endpoint', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockResolvedValue({ items: [] });
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ version: 1, confirmedAt: null, invoiceNumber: 'TD-1134', invoiceDate: null })] });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: /^Duyệt$/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/expense-accounting/confirm',
      { entries: [{ sourceKind: 'OPS', sourceId: 5, expectedVersion: 1 }] },
    ));
    expect(await screen.findByText(/Đã duyệt chi phí/)).toBeInTheDocument();
  });

  // A backend refusal still surfaces verbatim through the toast — never silence.
  it('CP2-A3: a refusal (thiếu phân loại) surfaces through the toast, not silence', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockRejectedValue(new Error('Hoàn thiện phân loại, người chi và khoản thu khách trước khi đối chiếu.'));
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items: [expense({ version: 1, confirmedAt: null })] });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: /^Duyệt$/ }));
    expect(await screen.findByText(/Hoàn thiện phân loại, người chi và khoản thu khách/)).toBeInTheDocument();
  });
});

// SIL-858 — the Chi phí Ops tab rework: Kỳ chi + Người-lập-lệnh-chi filters,
// the 3 lot-identity columns (Khách hàng/Nhà máy, Số tờ khai, Số HĐ with the
// no-invoice 'X'), 'Đã hủy / lịch sử' rows fully hidden, the Số phiếu column
// showing the settlement voucher code, and Ghi chú as the last column (the
// row-level [Xem phiếu] button is gone — the sheet opens from the phiếu table).
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
      // SIL-877 (CR-009.1 3.2) — dữ liệu cũ: hóa đơn rỗng/toàn khoảng trắng
      // (pre-validation rows) vẫn phải hiện 'X', không phải chuỗi trống.
      expense({
        id: 6, version: 1, requiresInvoice: false, invoiceNumber: '   ',
        customerName: 'Long Minh 2', factoryName: null,
        declarationNumber: null, note: null,
      }),
    ]);
    renderTab();
    expect((await screen.findAllByText('BL-9')).length).toBe(2);
    expect(screen.getByRole('columnheader', { name: 'Khách hàng / Nhà máy' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Số tờ khai' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Số HĐ' })).toBeInTheDocument();
    expect(screen.getByText('Long Minh')).toBeInTheDocument();
    expect(screen.getByText('Nhà máy Long Minh')).toBeInTheDocument();
    expect(screen.getAllByText('X')).toHaveLength(2); // không hóa đơn (null + rỗng) → 'X'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // lô-chung → tờ khai trống
    expect(screen.getByText('đài phụ chứng chi phícont')).toBeInTheDocument();
  });

  it('Cột Số phiếu hiện mã phiếu quyết toán; chưa tất toán giữ Chưa quyết toán', async () => {
    mockBoard([
      expense({ id: 5, version: 1, opsSettlementId: 3, opsSettlementCode: 'OS-2611-0009' }),
      expense({ id: 6, version: 1, opsSettlementId: null, opsSettlementCode: null }),
    ]);
    renderTab();
    expect(await screen.findByText('OS-2611-0009')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Số phiếu' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Trạng thái' })).toBeNull();
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

// CR-010 E2 (SIL-882) — bulk duyệt/từ chối with ONE mandatory reason, and
// in-place Số tiền/Số HĐ edits on rows chưa đối chiếu/chưa lập phiếu.
describe('OpsAccountantTab — CR-010 E2 bulk actions + inline edit (SIL-882)', () => {
  // The file-level beforeEach lives in the first describe only, so the mock
  // history from the §3c confirm posts would leak into these counts otherwise.
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    authUser.mockReset().mockReturnValue(null);
  });
  const mockBoard = (items: Array<Record<string, unknown>>) => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/admin/expenses')) return Promise.resolve({ items });
      if (url.startsWith('/ops/admin/settlements')) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [] });
    });
  };
  const threeRows = () => [
    expense({ version: 1, confirmedAt: null }),
    expense({ id: 6, version: 1, confirmedAt: null }),
    expense({ id: 7, version: 1, confirmedAt: null }),
  ];

  // AC 2.1: "tích 3 dòng → [Duyệt đã chọn (3)] thành công 1 thao tác".
  it('AC 2.1: ticking 3 rows and [Duyệt đã chọn (3)] posts ONE batch confirm', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockResolvedValue({ items: [] });
    mockBoard(threeRows());
    renderTab();
    expect((await screen.findAllByText('BL-9')).length).toBe(3);
    expect(screen.getByRole('button', { name: 'Duyệt đã chọn (0)' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Chọn tất cả'));
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt đã chọn (3)' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/expense-accounting/confirm', {
      entries: [
        { sourceKind: 'OPS', sourceId: 5, expectedVersion: 1 },
        { sourceKind: 'OPS', sourceId: 6, expectedVersion: 1 },
        { sourceKind: 'OPS', sourceId: 7, expectedVersion: 1 },
      ],
    });
    expect(await screen.findByText(/Đã duyệt 3 khoản chi Ops/)).toBeInTheDocument();
  });

  it('AC 2.1: [Từ chối đã chọn (N)] refuses without a reason and posts ONE batch reject with it', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockResolvedValue({ items: [] });
    mockBoard(threeRows());
    renderTab();
    expect((await screen.findAllByText('BL-9')).length).toBe(3);
    fireEvent.click(screen.getByLabelText('Chọn tất cả'));
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối đã chọn (3)' }));
    const field = await screen.findByLabelText('Lý do từ chối (bắt buộc)');
    const dialog = field.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Sai số tiền, Ops khai lại' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-accounting/entries/reject-batch', {
      entries: [
        { sourceKind: 'OPS', sourceId: 5, expectedVersion: 1 },
        { sourceKind: 'OPS', sourceId: 6, expectedVersion: 1 },
        { sourceKind: 'OPS', sourceId: 7, expectedVersion: 1 },
      ],
      reason: 'Sai số tiền, Ops khai lại',
    }));
    expect(await screen.findByText(/Đã từ chối 3 khoản chi Ops/)).toBeInTheDocument();
  });

  it('AC 2.1: the per-row [Từ chối] beside [Duyệt] posts the single reject twin with the reason', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockResolvedValue({ ok: true });
    mockBoard([expense({ version: 1, confirmedAt: null })]);
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    const field = await screen.findByLabelText('Lý do từ chối (bắt buộc)');
    fireEvent.change(field, { target: { value: 'Khoản không có chứng từ hợp lệ' } });
    const dialog = field.closest('[role="dialog"]') as HTMLElement;
    // CR-010.1 (BUG-07, V25) — the modal names the lot by its Số
    // Bill/Booking; the internal shipment code never renders (fixture
    // billRef 'BL-9', shipmentCode 'SS-9').
    expect(dialog.textContent).toContain('lô BL-9');
    expect(dialog.textContent).not.toContain('SS-9');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/expense-accounting/entries/OPS/5/reject',
      { expectedVersion: 1, reason: 'Khoản không có chứng từ hợp lệ' },
    ));
  });

  // AC 2.2: "sửa 1.620.000 → 1.650.000 được" — in-place save rides the audited
  // /entries/OPS/:id/update endpoint (actor + timestamp + old → new in payload).
  it('AC 2.2: inline Số tiền edit saves the new amount through the audited update endpoint', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockResolvedValue({});
    mockBoard([expense({ version: 1, confirmedAt: null, amount: '1620000' })]);
    renderTab();
    await screen.findByText(/1\.620\.000/);
    fireEvent.click(screen.getByLabelText('Sửa số tiền dòng 5'));
    const input = screen.getByLabelText('Số tiền');
    fireEvent.change(input, { target: { value: '1650000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/expense-accounting/entries/OPS/5/update',
      { expectedVersion: 1, amount: 1650000, reason: 'Kế toán sửa trực tiếp trên bảng Chi phí Ops (CR-010 E2)' },
    ));
  });

  it('AC 2.2: inline Số HĐ edit saves the new invoice number through the same audited endpoint', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    apiPost.mockResolvedValue({});
    mockBoard([expense({ version: 1, confirmedAt: null, invoiceNumber: null })]);
    renderTab();
    await screen.findByText('BL-9');
    fireEvent.click(screen.getByLabelText('Sửa số hóa đơn dòng 5'));
    const input = screen.getByLabelText('Số hóa đơn');
    fireEvent.change(input, { target: { value: 'TD-1134' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/expense-accounting/entries/OPS/5/update',
      { expectedVersion: 1, invoiceNumber: 'TD-1134', reason: 'Kế toán sửa trực tiếp trên bảng Chi phí Ops (CR-010 E2)' },
    ));
  });

  it('AC 2.2: a row already in a phiếu quyết toán shows no edit affordance (chưa quyết toán only)', async () => {
    authUser.mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
    mockBoard([expense({ version: 1, confirmedAt: null, opsSettlementId: 3, opsSettlementCode: 'OS-2611-0009' })]);
    renderTab();
    await screen.findByText('BL-9');
    expect(screen.queryByLabelText('Sửa số tiền dòng 5')).toBeNull();
    expect(screen.queryByLabelText('Sửa số hóa đơn dòng 5')).toBeNull();
    expect(screen.getByText('OS-2611-0009')).toBeInTheDocument();
  });

  it('AC 2.2: a non-finance reader sees neither the bulk toolbar nor the select column', async () => {
    authUser.mockReturnValue({ userId: 8, role: 'CUS' });
    mockBoard([expense({ version: 1, confirmedAt: null })]);
    renderTab();
    await screen.findByText('BL-9');
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByLabelText('Chọn tất cả')).toBeNull();
    expect(screen.queryByRole('button', { name: /Từ chối/ })).toBeNull();
  });
});
