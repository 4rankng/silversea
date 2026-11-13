import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CostReviewList, CostReviewRow } from '@tingting/shared';
import type { OpsReconciliationReportRow } from '../../api/opsReconciliationReportClient';

const expenseApi = vi.hoisted(() => ({
  costReview: vi.fn(), catalog: vi.fn(), update: vi.fn(), confirm: vi.fn(), reject: vi.fn(),
}));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: expenseApi }));
const reportApi = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('../../api/opsReconciliationReportClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/opsReconciliationReportClient')>()),
  opsReconciliationReportClient: { report: reportApi.report },
}));

import CostReconciliationPage from './CostReconciliationPage';

function row(overrides: Partial<CostReviewRow> = {}): CostReviewRow {
  return {
    id: 1, sourceKind: 'OPS', sourceId: 1, version: 1, shipmentId: 1, shipmentContainerId: null,
    tripId: null, truckId: null, customerId: 1, shipmentCode: 'SS-100', tripCode: null, truckPlate: null,
    customerName: 'KH A', containerNumber: null, costGroup: 'OPS_REGULAR', expenseTypeCode: 'FEE',
    feeName: 'Phí nâng', amount: 500000, customerChargeAmount: null, invoiceNumber: null, invoiceDate: null,
    expenseDate: '2026-11-10', payerKind: 'USER', payerUserId: 5, payerName: 'Ops A', recordedById: null,
    confirmedById: null, confirmedAt: null, confirmedByName: null, note: null, recoveryNote: null,
    photoStorageKeys: [], receivedAmount: null, paidAmount: null, outstandingReceivable: null,
    outstandingPayable: null, payableEntityType: 'FORWARDER', payableEntityId: 5, linkedTripExpenseId: null,
    accountantId: null, status: 'RECORDED', evidenceMissing: true, locked: false, reconciliationId: null,
    driverName: null, routeName: null, carrierName: null, carrierCode: null,
    progress: 'CHUA_XAC_NHAN',
    confirmRef: { sourceKind: 'OPS', sourceId: 1, expectedVersion: 1 },
    duplicateCount: 1,
    ...overrides,
  } as CostReviewRow;
}

const costPayload: CostReviewList = {
  items: [], total: 0, page: 1, limit: 100,
  totals: { unconfirmedAmount: 0, confirmedAmount: 0, unconfirmedCount: 0, duplicateRows: 0 },
};

function fundRow(overrides: Partial<OpsReconciliationReportRow> = {}): OpsReconciliationReportRow {
  return {
    staffId: 5, staffName: 'NV A', dntt: 300000, advanced: 500000, advancedRecorded: 500000, remaining: 200000,
    remainingSigned: -200000, outstandingSigned: 200000, needsCollection: false,
    direction: 'CTY_YEU_CAU_HOAN_TRA', note: 'Công ty yêu cầu nhân viên hoàn trả tạm ứng',
    ...overrides,
  };
}

function page() {
  return render(
    <MemoryRouter initialEntries={['/accounting/hoan-ung']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CostReconciliationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  expenseApi.costReview.mockReset().mockResolvedValue(costPayload);
  expenseApi.catalog.mockReset().mockResolvedValue({
    staff: [], accountants: [], suppliers: [], expenseTypes: [], advances: [], pendingAdvances: [],
    opsUsers: [{ id: 5, name: 'Ops A' }], accounts: [],
  });
  expenseApi.update.mockReset().mockResolvedValue({});
  expenseApi.confirm.mockReset().mockResolvedValue({ items: [] });
  expenseApi.reject.mockReset().mockResolvedValue({ ok: true });
  reportApi.report.mockReset().mockResolvedValue({ from: null, to: null, rows: [], totals: { dntt: 0, advanced: 0, remaining: 0, remainingSigned: 0 } });
});

describe('CostReconciliationPage (SIL-779)', () => {
  it('flags a duplicate cluster (same lot + fee name + amount) for the anti-duplicate review', { timeout: 20000 }, async () => {
    expenseApi.costReview.mockResolvedValue({
      ...costPayload,
      items: [row({ duplicateCount: 2 }), row({ id: 2, sourceId: 2, duplicateCount: 2, feeName: 'phí nâng' })],
      totals: { unconfirmedAmount: 1000000, confirmedAmount: 0, unconfirmedCount: 2, duplicateRows: 2 },
    });
    page();
    await screen.findByText('Phí nâng', {}, { timeout: 5000 });
    // Both rows share the cluster, so the SERVICE flags both with the cluster
    // size (costReviewClusterCounts returns the per-key count for every row).
    const badges = await screen.findAllByText('⚠ Trùng 2 dòng cùng lô', {}, { timeout: 5000 });
    expect(badges.length).toBe(2);
    expect(screen.getByText('Dòng trùng lặp cần rà — trong trang')).toBeInTheDocument();
    // The rail totals come from the service, not client math.
    expect(screen.getByText('1.000.000 ₫')).toBeInTheDocument();
  });

  it('offers the invoice input and evidence badge WITHOUT any photo on the row', async () => {
    expenseApi.costReview.mockResolvedValue({ ...costPayload, items: [row()] });
    page();
    // evidenceMissing=true renders the neutral fact, never a blocker.
    expect(await screen.findByText('Chưa có ảnh')).toBeInTheDocument();
    // The spec's core pin: Số HĐ is fillable while Ops has uploaded nothing.
    fireEvent.change(screen.getByLabelText('Số hóa đơn Phí nâng'), { target: { value: 'HD-777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(expenseApi.update).toHaveBeenCalledWith(
      { sourceKind: 'OPS', sourceId: 1, expectedVersion: 1 },
      expect.objectContaining({ invoiceNumber: 'HD-777' }),
    ));
  });

  it('SIL-806: blank Ops feeName falls back to the expense-type catalog label on line 1', async () => {
    // UAT 12/11 — các dòng Ops khai (lô 100GX19033, 339IVN0130626, MATS8322408000)
    // thiếu tên loại phí: feeName trống → đọc nhãn danh mục theo expenseTypeCode.
    expenseApi.catalog.mockResolvedValue({
      staff: [], accountants: [], suppliers: [],
      expenseTypes: [{ code: 'LIFTING', name: 'Phí nâng container' }],
      advances: [], pendingAdvances: [],
      opsUsers: [{ id: 5, name: 'Ops A' }], accounts: [],
    });
    expenseApi.costReview.mockResolvedValue({ ...costPayload, items: [row({ feeName: '', expenseTypeCode: 'LIFTING' })] });
    page();
    expect(await screen.findByText('Phí nâng container')).toBeInTheDocument();
    // The invoice input's aria-label names the same resolved fee, never blank.
    expect(screen.getByLabelText('Số hóa đơn Phí nâng container')).toBeInTheDocument();
  });

  it('confirms through the existing batch confirm contract', async () => {
    expenseApi.costReview.mockResolvedValue({ ...costPayload, items: [row()] });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(expenseApi.confirm).toHaveBeenCalledWith([
      { sourceKind: 'OPS', sourceId: 1, expectedVersion: 1 },
    ]));
  });

  it('tick-all posts one batch confirm over the selected unconfirmed rows', async () => {
    expenseApi.costReview.mockResolvedValue({
      ...costPayload,
      items: [row(), row({ id: 3, sourceId: 3, feeName: 'Phí hạ', amount: 400000 })],
    });
    page();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn tất cả dòng chưa xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chi phí (2)' }));
    await waitFor(() => expect(expenseApi.confirm).toHaveBeenCalledTimes(1));
    expect(expenseApi.confirm.mock.calls[0][0]).toHaveLength(2);
  });

  it('refuses a rejection without a reason and posts the reason when given', async () => {
    expenseApi.costReview.mockResolvedValue({ ...costPayload, items: [row()] });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Từ chối' });
    // Card 2026-10-05_373 law: empty reason keeps the confirm disabled.
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Lý do từ chối (bắt buộc)'), { target: { value: 'Nhập trùng khoản đã đối chiếu' } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(expenseApi.reject).toHaveBeenCalledWith(
      { sourceKind: 'OPS', sourceId: 1, expectedVersion: 1 },
      'Nhập trùng khoản đã đối chiếu',
    ));
  });


  it('shows the spec fund warnings: (+) staff returns the excess, (−) company reimburses more', async () => {
    reportApi.report.mockResolvedValue({
      from: null, to: null,
      rows: [
        fundRow(),
        fundRow({ staffId: 6, staffName: 'NV B', dntt: 800000, advancedRecorded: 500000, remaining: 0, remainingSigned: 300000, outstandingSigned: 0 }),
        fundRow({ staffId: 7, staffName: 'NV C', dntt: 100000, advancedRecorded: 100000, remaining: 0, remainingSigned: 0, outstandingSigned: 0 }),
      ],
      totals: { dntt: 1200000, advanced: 1100000, remaining: 200000, remainingSigned: 100000 },
    });
    page();
    const section = await screen.findByRole('region', { name: 'Quỹ cá nhân từng nhân sự' });
    // ĐÃ ỨNG 500.000 − ĐNTT 300.000 = +200.000 → cá nhân hoàn trả về công ty.
    expect(await within(section).findByText('(+) 200.000 ₫', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(section).getByText('Cá nhân còn giữ tiền phải hoàn trả về công ty')).toBeInTheDocument();
    // ĐÃ ỨNG 500.000 − ĐNTT 800.000 = −300.000 → công ty hoàn trả thêm.
    expect(within(section).getByText('(−) 300.000 ₫')).toBeInTheDocument();
    expect(within(section).getByText('Công ty phải hoàn trả thêm cho nhân viên')).toBeInTheDocument();
    expect(within(section).getByText('Không còn chênh lệch')).toBeInTheDocument();
    // SIL-806 — the explanation line matches the row signs 100%: (−) = công ty
    // hoàn trả thêm, (+) = cá nhân trả về.
    expect(within(section).getByText(/Số dư quỹ = ĐÃ ỨNG \(tổng phiếu tạm ứng đã ghi nhận trong kỳ\) − chi phí ĐNTT đã xác nhận/)).toBeInTheDocument();
    expect(within(section).getByText(/\(−\) công ty phải hoàn trả thêm cho nhân viên; \(\+\) cá nhân còn giữ tiền phải hoàn trả về công ty\./)).toBeInTheDocument();
  });

  it('SIL-806: ĐÃ ỨNG reads the GROSS recorded phiếu sum, not the netted held remainder', async () => {
    // UAT 12/11 — Nguyễn Huy Hoàng: 5 phiếu 520.000₫ recorded nhưng đã net về
    // 0₫ held → bảng phải hiện 520.000₫ và số dư +475.000₫ (520.000 − 45.000).
    reportApi.report.mockResolvedValue({
      from: null, to: null,
      rows: [fundRow({ staffName: 'Nguyễn Huy Hoàng', dntt: 45000, advanced: 0, advancedRecorded: 520000, remaining: 0, remainingSigned: -475000, outstandingSigned: 0 })],
      totals: { dntt: 45000, advanced: 0, remaining: 0, remainingSigned: -475000 },
    });
    page();
    const section = await screen.findByRole('region', { name: 'Quỹ cá nhân từng nhân sự' });
    const spent = (await within(section).findByText('Nguyễn Huy Hoàng')).closest('tr');
    expect(spent).not.toBeNull();
    expect(within(spent as HTMLElement).getByText('520.000 ₫')).toBeInTheDocument();
    expect(within(spent as HTMLElement).getByText('(+) 475.000 ₫')).toBeInTheDocument();
    expect(within(spent as HTMLElement).getByText('Cá nhân còn giữ tiền phải hoàn trả về công ty')).toBeInTheDocument();
  });
});

describe('CostReconciliationPage read-only row (SIL-779)', () => {
  it('marks a settled lot-owned row read-only: no confirm, no reject, no invoice edit', { timeout: 20000 }, async () => {
    expenseApi.costReview.mockResolvedValue({
      ...costPayload,
      items: [row({ progress: 'DA_LAP_PHIEU', confirmedAt: '2026-11-10T00:00:00.000Z', confirmedByName: 'Kế Toán', invoiceNumber: 'HD-001' })],
    });
    page();
    await waitFor(() => {
      expect(document.body.innerHTML.includes('HD-001')).toBe(true);
    }, { timeout: 8000 });
    // The status <span> (not the filter's <option>, which carries the same
    // wording) carries the lot-owned progress.
    const statusSpan = screen.getAllByText('Đã lập phiếu').find((el) => el.tagName === 'SPAN');
    expect(statusSpan).toBeTruthy();
    expect(screen.getByText('HD-001')).toBeInTheDocument();
    expect(screen.getByText(/Kế Toán · /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).toBeNull();
    expect(screen.queryByLabelText('Số hóa đơn Phí nâng')).toBeNull();
  });
});
