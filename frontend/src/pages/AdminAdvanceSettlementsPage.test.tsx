import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAdvanceSettlementsPage from './AdminAdvanceSettlementsPage';

const { settlementsQuery, checkSettlement, authUser, balancesQuery, eligibilityQuery, createForForwarder } = vi.hoisted(() => ({
  settlementsQuery: vi.fn(),
  checkSettlement: vi.fn(),
  authUser: vi.fn(),
  balancesQuery: vi.fn(),
  eligibilityQuery: vi.fn(),
  createForForwarder: vi.fn(),
}));
vi.mock('../hooks/useForwarderQueries', () => ({
  useAdminSettlements: settlementsQuery,
  useAdminAdvanceBalances: balancesQuery,
  useAdminSettlementEligibility: eligibilityQuery,
  useCreateAdvanceSettlementForForwarder: createForForwarder,
}));
vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({
    data: { forwarderExpenseTypes: [{ code: 'FUEL', name: 'Nhiên liệu' }] },
  }),
}));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: authUser() }) }));
vi.mock('../api/forwarderClient', () => ({
  forwarderClient: { checkAdvanceSettlement: checkSettlement },
}));
// SIL-1056 — the create dialog announces a landed phiếu through the shared
// toast; the page suite pins the toast copy + the row-button law, the toast
// internals have their own suite.
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const response = { items: [], totalPages: 1, statusCounts: { DRAFT: 4, RECORDED: 3 }, statusAmounts: {} };
beforeEach(() => {
  settlementsQuery.mockReset().mockReturnValue({ data: response, isLoading: false });
  checkSettlement.mockReset();
  toastMock.mockReset();
  authUser.mockReset().mockReturnValue({ userId: 3, role: 'ACCOUNTANT' });
  balancesQuery.mockReset().mockReturnValue({ data: { items: [], totalOutstanding: 0 } });
  eligibilityQuery.mockReset().mockReturnValue({ data: { advances: [], expenses: [] }, isPending: false, isError: false, error: null });
  createForForwarder.mockReset().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 77, code: 'PC-26-0077' }),
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AdminAdvanceSettlementsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminAdvanceSettlementsPage draft filter', () => {
  it('uses the full-set draft count and sends the exact draft status', () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Chưa hoàn tất4' }));
    expect(settlementsQuery).toHaveBeenLastCalledWith({ status: 'DRAFT', page: 1, limit: 50 });
    expect(container).not.toHaveTextContent('undefined');
    expect(screen.getByRole('button', { name: 'Tất cả7' })).toBeInTheDocument();
  });

  it('renders zero when the server has no draft records', () => {
    settlementsQuery.mockReturnValue({ data: { ...response, statusCounts: { RECORDED: 3 } }, isLoading: false });
    const { container } = renderPage();
    expect(screen.getByRole('button', { name: 'Chưa hoàn tất0' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('undefined');
  });
});

// Card 191026160000 (§3b) — DUYỆT PHIẾU HOÀN ỨNG cho kế toán trên tab
// "Phiếu hoàn ứng" (chiphispec round 2: "không có mục click -> tích chọn
// hoàn ứng"). Cases CP2-A2.
const settlementRow = (overrides: Record<string, unknown> = {}) => ({
  id: 41, version: 3, code: 'PC-26-0041', forwarderId: 9,
  totalExpenseAmount: '1200000', refundAmount: '200000', status: 'RECORDED',
  checkedBy: null, checkedAt: null, approvedBy: 9, approvedAt: '2026-10-18T02:00:00.000Z',
  note: null, createdAt: '2026-10-18T02:00:00.000Z',
  forwarderName: 'Nguyễn Văn Giao', checkerName: null, approverName: 'Nguyễn Văn Giao',
  linkedExpenses: [], linkedRequests: [],
  ...overrides,
});

describe('AdminAdvanceSettlementsPage — DUYỆT PHIẾU HOÀN ỨNG (card 191026160000 §3b)', () => {
  it('CP2-A2: a RECORDED phiếu without an accountant check offers the duyệt button; clicking posts the check', async () => {
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow()], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    checkSettlement.mockResolvedValue(settlementRow({ checkedBy: 3, checkedAt: '2026-10-19T03:00:00.000Z', checkerName: 'Nguyễn Thị Mai' }));
    renderPage();

    // Desktop grid + mobile card both render the action — one click asserts the call.
    fireEvent.click(screen.getAllByRole('button', { name: 'XÁC NHẬN HOÀN ỨNG' })[0]);
    await waitFor(() => expect(checkSettlement).toHaveBeenCalledWith(41, 3));
  });

  it('CP2-A2: once kế toán đã duyệt (checkedBy ≠ submitter) the button is gone and the KT line shows', () => {
    settlementsQuery.mockReturnValue({
      data: {
        ...response,
        items: [settlementRow({ checkedBy: 3, checkedAt: '2026-10-19T03:00:00.000Z', checkerName: 'Nguyễn Thị Mai' })],
        totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {},
      },
      isLoading: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'XÁC NHẬN HOÀN ỨNG' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Đã duyệt (KT):').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nguyễn Thị Mai').length).toBeGreaterThan(0);
  });

  it('CP2-A2: a refusal surfaces as text and never silently clears the button', async () => {
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow()], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    checkSettlement.mockRejectedValue(new Error('Phiếu đã được kế toán duyệt.'));
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'XÁC NHẬN HOÀN ỨNG' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiếu đã được kế toán duyệt.');
  });

  it('CP2-A2: non-finance roles never see the duyệt button', () => {
    authUser.mockReturnValue({ userId: 5, role: 'CUS' });
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow()], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'XÁC NHẬN HOÀN ỨNG' })).not.toBeInTheDocument();
  });

  it('CP2-A2: a legacy Option-B row (checkedBy = submitter) stays duyệt-able', () => {
    settlementsQuery.mockReturnValue({
      data: {
        ...response,
        items: [settlementRow({ checkedBy: 9, checkedAt: '2026-10-18T02:00:00.000Z', checkerName: 'Nguyễn Văn Giao' })],
        totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {},
      },
      isLoading: false,
    });
    renderPage();
    expect(screen.getAllByRole('button', { name: 'XÁC NHẬN HOÀN ỨNG' }).length).toBeGreaterThan(0);
  });
});

// ── SIL-487 — "Lập phiếu hoàn ứng" cho kế toán (nghiệp vụ chi hộ) ──────────
// Unblocks SIL-176: QA tạo được phiếu RECORDED rồi test /check replay.
const staffBalances = {
  data: {
    items: [{ forwarderId: 9, name: 'Nguyễn Huy Hoàng', outstanding: '100000' }],
    totalOutstanding: 100000,
  },
};
const eligibleData = {
  advances: [
    { id: 8141, amount: '100000', reason: 'Chi hộ phơi', status: 'RECORDED', createdAt: '2026-10-21T00:00:00.000Z', requesterId: 9 },
  ],
  expenses: [
    { id: 501, tripId: 12, expenseType: 'FUEL', buyAmount: '60000', completionStatus: 'COMPLETED', note: null, createdAt: '2026-10-22T00:00:00.000Z', tripCode: 'TRIP-12', departureDate: '2026-10-22T00:00:00.000Z', truckPlate: '51C-123.45', containerNumbers: 'XYZU1234567' },
    { id: 502, tripId: 13, expenseType: 'FUEL', buyAmount: '40000', completionStatus: 'IN_PROGRESS', note: null, createdAt: '2026-10-23T00:00:00.000Z', tripCode: 'TRIP-13', departureDate: '2026-10-23T00:00:00.000Z', truckPlate: '51C-999.99', containerNumbers: null },
  ],
};

function openCreateDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Lập phiếu hoàn ứng/ }));
}

describe('AdminAdvanceSettlementsPage — Lập phiếu hoàn ứng (SIL-487)', () => {
  it('finance roles see the create button; MANAGER reads the tab but must not create', () => {
    const accountant = renderPage();
    expect(screen.getByRole('button', { name: /Lập phiếu hoàn ứng/ })).toBeInTheDocument();
    accountant.unmount();
    authUser.mockReturnValue({ userId: 5, role: 'MANAGER' });
    renderPage();
    expect(screen.queryByRole('button', { name: /Lập phiếu hoàn ứng/ })).not.toBeInTheDocument();
  });

  it('dialog lists staff with outstanding advances; picking one fetches their eligibility', () => {
    balancesQuery.mockReturnValue(staffBalances);
    renderPage();
    openCreateDialog();
    const dialog = screen.getByRole('dialog', { name: 'Lập phiếu hoàn ứng cho nhân viên' });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    expect(eligibilityQuery).toHaveBeenLastCalledWith(9);
  });

  it('R4: submit stays blocked without a basis; advance, expense-only, or refund-only each unlock it (CR-011)', () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    renderPage();
    openCreateDialog();
    const submit = screen.getByRole('button', { name: /Ghi nhận phiếu/ });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    // Nothing picked yet: submit blocked by the missing FB-100 tick (the
    // suggested refund shows the staff's outstanding balance).
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /100\.000 ₫/ }));
    expect(submit).toBeDisabled(); // tick still missing (FB-100)
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    expect(submit).toBeEnabled();
  });

  it('R4 (CR-011): expenses-only basis — approved unlinked expense unlocks submit without any advance', () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    renderPage();
    openCreateDialog();
    const submit = screen.getByRole('button', { name: /Ghi nhận phiếu/ });
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /60\.000 ₫/ }));
    expect(submit).toBeDisabled(); // tick still missing
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    expect(submit).toBeEnabled();
  });

  it('R4 (CR-011): refund-only basis — a non-zero signed refund unlocks submit without any pick', () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    renderPage();
    openCreateDialog();
    const submit = screen.getByRole('button', { name: /Ghi nhận phiếu/ });
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.change(screen.getByLabelText('Tiền hoàn lại'), { target: { value: '50000' } });
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    expect(submit).toBeEnabled();
  });

  it('R3: an expense Ops has not signed off cannot be picked', () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    renderPage();
    openCreateDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    const incomplete = screen.getByRole('checkbox', { name: /40\.000 ₫/ });
    expect(incomplete).toBeDisabled();
  });

  it('R6: ghi nhận posts the payload for the picked staff, advance and COMPLETED expense, then closes', async () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    const mutateAsync = vi.fn().mockResolvedValue({ id: 77, code: 'PC-26-0077' });
    createForForwarder.mockReturnValue({ mutateAsync, isPending: false, error: null, reset: vi.fn() });
    renderPage();
    openCreateDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /100\.000 ₫/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /60\.000 ₫/ }));
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: /Ghi nhận phiếu/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      forwarderId: 9,
      // SIL-751 — the refund box auto-fills tạm ứng − chi phí (100.000 −
      // 60.000), so the phiếu balances on the first submit; the old pin
      // expected the stay-at-0 refund that hit the 400 'Phiếu chưa cân đối'.
      refundAmount: 40000,
      note: undefined,
      advanceRequestIds: [8141],
      tripExpenseIds: [501],
    }));
    // SIL-1056 — 200/201 announces itself: green toast naming the landed
    // phiếu (the old close was silent and kế toán doubted the phiếu landed).
    expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Đã ghi nhận phiếu hoàn ứng PC-26-0077 thành công.' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lập phiếu hoàn ứng cho nhân viên' })).not.toBeInTheDocument());
  });

  it('R6: a refusal keeps the dialog open and surfaces the API message', async () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Phiếu chưa cân đối: tạm ứng 100000, chi phí 60000, hoàn lại 0'));
    createForForwarder.mockReturnValue({ mutateAsync, isPending: false, error: new Error('Phiếu chưa cân đối: tạm ứng 100000, chi phí 60000, hoàn lại 0'), reset: vi.fn() });
    renderPage();
    openCreateDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: /Ghi nhận phiếu/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiếu chưa cân đối');
    expect(screen.getByRole('dialog', { name: 'Lập phiếu hoàn ứng cho nhân viên' })).toBeInTheDocument();
  });

  it('R2: no outstanding advances anywhere → the dialog says so instead of an empty list', () => {
    renderPage();
    openCreateDialog();
    expect(screen.getByText('Không có tạm ứng nào còn tồn trên hệ thống.')).toBeInTheDocument();
  });
});

// ── SIL-1056 — dòng phiếu KHÔNG còn nút xanh 'Lập phiếu hoàn ứng' ──────────
// The phiếu ITSELF is the tất toán (the unified balance formula nets the
// signed refundAmount), so the old SIL-728 row-level recovery button double-
// counted and read as a way to re-create a phiếu that already exists. A phiếu
// row offers only 'Xem phiếu' + 'XÁC NHẬN HOÀN ỨNG' (§3b, chỉ khi chưa duyệt).

describe('AdminAdvanceSettlementsPage — nút thừa trên dòng phiếu (SIL-1056)', () => {
  it('a RECORDED negative-refund phiếu row shows NO Lập phiếu hoàn ứng button — only Xem phiếu (+ XÁC NHẬN HOÀN ỨNG while unchecked)', () => {
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow({ code: 'PT-2611-0010', refundAmount: '-2479000' })], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    renderPage();
    const region = screen.getByRole('region', { name: 'Danh sách phiếu hoàn ứng' });
    expect(within(region).queryByRole('button', { name: 'Lập phiếu hoàn ứng' })).not.toBeInTheDocument();
    expect(within(region).getAllByRole('link', { name: 'Xem phiếu' }).length).toBeGreaterThan(0);
    // Still unchecked → the §3b duyệt action stays available on the same row.
    expect(within(region).getAllByRole('button', { name: 'XÁC NHẬN HOÀN ỨNG' }).length).toBeGreaterThan(0);
  });

  it('a phiếu that owes the staff (refundAmount > 0) or is not RECORDED never offered one either — law unchanged', () => {
    settlementsQuery.mockReturnValue({
      data: {
        ...response,
        items: [
          settlementRow({ id: 42, refundAmount: '200000' }),
          settlementRow({ id: 43, status: 'DRAFT', refundAmount: '-4300000' }),
        ],
        totalPages: 1, statusCounts: { RECORDED: 1, DRAFT: 1 }, statusAmounts: {},
      },
      isLoading: false,
    });
    renderPage();
    const region = screen.getByRole('region', { name: 'Danh sách phiếu hoàn ứng' });
    expect(within(region).queryByRole('button', { name: 'Lập phiếu hoàn ứng' })).not.toBeInTheDocument();
  });
});

// ── SIL-839 (QA fail fd0f7f14) — phiếu chỉ-quyết-toán-tạm ứng không hiện trống ──
// The 9 legacy vouchers (PT-2611-0007…) settle advance REQUESTS without trip
// expenses; the row must show those links (staff name + request chips), never
// the three 'Chưa có …' placeholders.
describe('AdminAdvanceSettlementsPage — phiếu tạm ứng shows linked requests (SIL-839)', () => {
  const requestOnly = settlementRow({
    code: 'PT-2611-0007',
    linkedRequests: [
      { id: 8141, version: 1, requesterId: 9, requesterNameSnapshot: 'Vũ Đình Cường', amount: '20000000', reason: 'Ứng chi hộ chi phí vận chuyển', status: 'RECORDED', approvedBy: 2, approvedAt: '2026-11-12T01:00:00.000Z', createdAt: '2026-11-12T01:00:00.000Z', allocatedAmount: '20000000' },
      { id: 8155, version: 1, requesterId: 9, requesterNameSnapshot: 'Vũ Đình Cường', amount: '5000000', reason: 'Ứng chi phí bốc xếp', status: 'RECORDED', approvedBy: 2, approvedAt: '2026-11-13T01:00:00.000Z', createdAt: '2026-11-13T01:00:00.000Z', allocatedAmount: '5000000' },
    ],
  });

  it('a request-only phiếu renders the staff name + the request chips — no empty prose', () => {
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [requestOnly], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    const { container } = renderPage();
    const region = screen.getByRole('region', { name: 'Danh sách phiếu hoàn ứng' });
    // The staff the phiếu settles rides the customer line (nhân sự attached).
    expect(within(region).getAllByText('Nguyễn Văn Giao').length).toBeGreaterThan(0);
    // Each settled request renders a chip with its allocated amount.
    expect(within(region).getAllByText(/Tạm ứng 12\/11\/2026 · Ứng chi hộ chi phí vận chuyển/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Ứng chi phí bốc xếp/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain('20.000.000');
    expect(container.textContent).toContain('5.000.000');
    // The absence prose never fires when request links exist.
    expect(within(region).queryAllByText('Chưa có khoản chi liên kết')).toHaveLength(0);
    expect(container).not.toHaveTextContent('Chưa có khách hàng');
  });

  it('a legacy balance-only phiếu (no request links) still shows its staff + refund — no empty prose (SIL-839 QA 68646e82: PT-2611-0005/-0006, PT-2610-0002)', () => {
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow({ code: 'PT-2611-0006', totalExpenseAmount: '0', refundAmount: '100000' })], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    const { container } = renderPage();
    const region = screen.getByRole('region', { name: 'Danh sách phiếu hoàn ứng' });
    // The staff the phiếu settles rides the customer line even without links.
    expect(within(region).getAllByText('Nguyễn Văn Giao').length).toBeGreaterThan(0);
    // No trip facts on a balance-only phiếu — route cell shows the '—' face.
    expect(within(region).getAllByText('—').length).toBeGreaterThan(0);
    // The settled refund is the phiếu's real content in the breakdown cell.
    expect(within(region).getAllByText('Hoàn lại tạm ứng').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('100.000');
    // The absence prose never fires on a named phiếu.
    expect(container).not.toHaveTextContent('Chưa có khách hàng');
    expect(within(region).queryAllByText('Chưa có tuyến đường')).toHaveLength(0);
    expect(within(region).queryAllByText('Chưa có khoản chi liên kết')).toHaveLength(0);
  });

  it('a phiếu with no staff, no requests and no expenses keeps the absence prose', () => {
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow({ forwarderName: null })], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    renderPage();
    const region = screen.getByRole('region', { name: 'Danh sách phiếu hoàn ứng' });
    expect(within(region).getAllByText('Chưa có khách hàng').length).toBeGreaterThan(0);
    // No plan/request facts → the route cell keeps the '—' face (never a fake route).
    expect(within(region).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(region).getAllByText('Chưa có khoản chi liên kết').length).toBeGreaterThan(0);
  });
});
