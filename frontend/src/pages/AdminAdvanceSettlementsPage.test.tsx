import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const response = { items: [], totalPages: 1, statusCounts: { DRAFT: 4, RECORDED: 3 }, statusAmounts: {} };
beforeEach(() => {
  settlementsQuery.mockReset().mockReturnValue({ data: response, isLoading: false });
  checkSettlement.mockReset();
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
    fireEvent.click(screen.getAllByRole('button', { name: 'DUYỆT PHIẾU HOÀN ỨNG' })[0]);
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
    expect(screen.queryByRole('button', { name: 'DUYỆT PHIẾU HOÀN ỨNG' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getAllByRole('button', { name: 'DUYỆT PHIẾU HOÀN ỨNG' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiếu đã được kế toán duyệt.');
  });

  it('CP2-A2: non-finance roles never see the duyệt button', () => {
    authUser.mockReturnValue({ userId: 5, role: 'CUS' });
    settlementsQuery.mockReturnValue({
      data: { ...response, items: [settlementRow()], totalPages: 1, statusCounts: { RECORDED: 1 }, statusAmounts: {} },
      isLoading: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'DUYỆT PHIẾU HOÀN ỨNG' })).not.toBeInTheDocument();
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
    expect(screen.getAllByRole('button', { name: 'DUYỆT PHIẾU HOÀN ỨNG' }).length).toBeGreaterThan(0);
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

  it('R4: submit stays blocked until an advance is picked AND the confirm tick is on', () => {
    balancesQuery.mockReturnValue(staffBalances);
    eligibilityQuery.mockReturnValue({ data: eligibleData, isPending: false, isError: false, error: null });
    renderPage();
    openCreateDialog();
    const submit = screen.getByRole('button', { name: /Ghi nhận phiếu/ });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /100\.000 ₫/ }));
    expect(submit).toBeDisabled(); // tick still missing (FB-100)
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
      refundAmount: 0,
      note: undefined,
      advanceRequestIds: [8141],
      tripExpenseIds: [501],
    }));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /100\.000 ₫/ }));
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
