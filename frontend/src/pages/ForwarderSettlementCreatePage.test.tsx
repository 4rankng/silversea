import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForwarderSettlementCreatePage from './ForwarderSettlementCreatePage';

const { state, mutateAsync, retryRequests, retryExpenses } = vi.hoisted(() => ({
  state: { requests: [] as Array<Record<string, unknown>>, requestsHasData: true, requestsPending: false, requestsFetching: false, requestsError: null as Error | null, expensesHasData: true, expensesPending: false, expensesFetching: false, expensesError: null as Error | null },
  retryRequests: vi.fn(), retryExpenses: vi.fn(),
  mutateAsync: vi.fn(),
}));
vi.mock('../hooks/useForwarderQueries', () => ({
  useForwarderEligibleAdvanceRequests: () => ({ data: state.requestsPending || !state.requestsHasData ? undefined : { items: state.requests }, isPending: state.requestsPending, isFetching: state.requestsFetching, error: state.requestsError, refetch: retryRequests }),
  useUnlinkedExpenses: () => ({ data: state.expensesPending || !state.expensesHasData ? undefined : { items: [] }, isPending: state.expensesPending, isFetching: state.expensesFetching, error: state.expensesError, refetch: retryExpenses }),
  useCreateAdvanceSettlement: () => ({ mutateAsync, isPending: false, error: null }),
}));
vi.mock('../hooks/useCatalogs', () => ({ useCatalogs: () => ({ data: {} }) }));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));
vi.mock('../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

function request(id: number, reason: string, fundedAmount?: number, status = 'RECORDED') {
  return { id, reason, amount: '1000000', fundedAmount, status, createdAt: '2026-09-17T00:00:00.000Z' };
}
function page() { return <MemoryRouter><ForwarderSettlementCreatePage /></MemoryRouter>; }

describe('direct settlement creation from actual funded advances', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 11, code: 'HU-11' });
    state.requests = [];
    state.requestsHasData = true; state.requestsPending = false; state.requestsFetching = false; state.requestsError = null;
    state.expensesHasData = true; state.expensesPending = false; state.expensesFetching = false; state.expensesError = null;
    retryRequests.mockReset().mockResolvedValue({}); retryExpenses.mockReset().mockResolvedValue({});
  });

  it('shows initial loading rather than empty advance and expense messages', () => {
    state.requestsPending = true; state.requestsFetching = true;
    state.expensesPending = true; state.expensesFetching = true;
    render(page());
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.queryByText('Chưa có tạm ứng đã nhận đủ tiền và chưa quyết toán.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Không có chi phí nào chưa thanh toán/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
  });

  it.each(['requests', 'expenses'] as const)('shows an initial %s API failure instead of a successful empty result', (source) => {
    state[`${source}HasData`] = false;
    state[`${source}Error`] = new Error('Máy chủ không khả dụng');
    render(page());
    expect(screen.getByRole('alert')).toHaveTextContent('Máy chủ không khả dụng');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeEnabled();
    expect(source === 'requests'
      ? screen.queryByText('Chưa có tạm ứng đã nhận đủ tiền và chưa quyết toán.')
      : screen.queryByText(/Không có chi phí nào chưa thanh toán/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
  });

  it.each(['requests', 'expenses'] as const)('keeps the draft on %s failure and retries only that source without submitting', async (source) => {
    state.requests = [request(1, 'Ứng đã nhận', 1000000)];
    const rendered = render(page());
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    fireEvent.change(screen.getByPlaceholderText('Ghi chú (không bắt buộc)'), { target: { value: 'Giữ bản nhập' } });
    state[`${source}Error`] = new Error('Không thể đọc nguồn dữ liệu');
    rendered.rerender(page());
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể đọc nguồn dữ liệu');
    expect(screen.getByPlaceholderText('Ghi chú (không bắt buộc)')).toHaveValue('Giữ bản nhập');
    expect(screen.getByRole('checkbox', { name: /Ứng đã nhận/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
    fireEvent.submit(document.querySelector('form')!);
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(source === 'requests' ? retryRequests : retryExpenses).toHaveBeenCalledOnce());
    expect(source === 'requests' ? retryExpenses : retryRequests).not.toHaveBeenCalled();
    state[`${source}Fetching`] = true;
    rendered.rerender(page());
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeDisabled();
    state[`${source}Fetching`] = false; state[`${source}Error`] = null;
    rendered.rerender(page());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Ứng đã nhận/ })).toBeChecked();
    expect(screen.getByPlaceholderText('Ghi chú (không bắt buộc)')).toHaveValue('Giữ bản nhập');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('only offers fully funded recorded advances and records them in one command', async () => {
    state.requests = [
      request(1, 'Đã nhận đủ tiền', 1000000),
      request(2, 'Chưa giao tiền', 0),
      request(3, 'Giao tiền một phần', 500000),
      request(4, 'Chưa biết tiền thực giao'),
      request(5, 'Bản nháp', 1000000, 'DRAFT'),
      request(6, 'Đã hủy', 1000000, 'VOIDED'),
    ];
    render(page());
    expect(screen.getByText('Đã nhận đủ tiền')).toBeVisible();
    for (const reason of ['Chưa giao tiền', 'Giao tiền một phần', 'Chưa biết tiền thực giao', 'Bản nháp', 'Đã hủy']) {
      expect(screen.queryByText(reason)).not.toBeInTheDocument();
    }
    const submit = screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Đã nhận đủ tiền/ }));
    fireEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      totalExpenseAmount: 0, refundAmount: 0, note: undefined,
      advanceRequestIds: [1], tripExpenseIds: undefined,
    }));
    expect(await screen.findByText('Phiếu đã tạo thành công!')).toBeVisible();
    expect(screen.queryByText(/chờ duyệt|gửi phê duyệt/i)).not.toBeInTheDocument();
  });

  it('explains an empty funding selection instead of offering unrecordable advances', () => {
    state.requests = [request(2, 'Chưa giao tiền', 0), request(3, 'Giao một phần', 999999)];
    render(page());
    expect(screen.getByText('Chưa có tạm ứng đã nhận đủ tiền và chưa quyết toán.')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
  });

  it('retains the selected advance and note after an API failure', async () => {
    state.requests = [request(1, 'Ứng đã nhận', 1000000)];
    mutateAsync.mockRejectedValueOnce(new Error('Tạm ứng vừa được sử dụng'));
    render(page());
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    fireEvent.change(screen.getByPlaceholderText('Ghi chú (không bắt buộc)'), { target: { value: 'Giữ lại ghi chú' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(screen.getByRole('checkbox', { name: /Ứng đã nhận/ })).toBeChecked();
    expect(screen.getByPlaceholderText('Ghi chú (không bắt buộc)')).toHaveValue('Giữ lại ghi chú');
    expect(screen.queryByText('Phiếu đã tạo thành công!')).not.toBeInTheDocument();
  });

  it('blocks the entire selection when a refetch changes one advance eligibility', () => {
    state.requests = [request(1, 'Ứng thứ nhất', 1000000), request(2, 'Ứng thứ hai', 1000000)];
    const rendered = render(page());
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn tất cả/ }));
    state.requests = [request(1, 'Ứng thứ nhất', 1000000), request(2, 'Ứng thứ hai', 0)];
    rendered.rerender(page());
    expect(screen.getByRole('alert')).toHaveTextContent('Tạm ứng đã chọn không còn đủ điều kiện');
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
    fireEvent.submit(document.querySelector('form')!);
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn lại tạm ứng' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ứng thứ nhất/ })).not.toBeChecked();
  });
});
