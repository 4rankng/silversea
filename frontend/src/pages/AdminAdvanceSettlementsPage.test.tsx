import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAdvanceSettlementsPage from './AdminAdvanceSettlementsPage';

const { settlementsQuery, checkSettlement, authUser } = vi.hoisted(() => ({
  settlementsQuery: vi.fn(),
  checkSettlement: vi.fn(),
  authUser: vi.fn(),
}));
vi.mock('../hooks/useForwarderQueries', () => ({
  useAdminSettlements: settlementsQuery,
  useAdminAdvanceBalances: () => ({ data: { items: [], totalOutstanding: 0 } }),
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
