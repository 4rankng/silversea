import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForwarderSettlementCreatePage from './ForwarderSettlementCreatePage';

const { state, mutateAsync, retryRequests, retryExpenses } = vi.hoisted(() => ({
  state: { requests: [] as Array<Record<string, unknown>>, requestsHasData: true, requestsPending: false, requestsFetching: false, requestsError: null as Error | null, expenses: [] as Array<Record<string, unknown>>, expensesHasData: true, expensesPending: false, expensesFetching: false, expensesError: null as Error | null },
  retryRequests: vi.fn(), retryExpenses: vi.fn(),
  mutateAsync: vi.fn(),
}));
vi.mock('../hooks/useForwarderQueries', () => ({
  useForwarderEligibleAdvanceRequests: () => ({ data: state.requestsPending || !state.requestsHasData ? undefined : { items: state.requests }, isPending: state.requestsPending, isFetching: state.requestsFetching, error: state.requestsError, refetch: retryRequests }),
  useUnlinkedExpenses: () => ({ data: state.expensesPending || !state.expensesHasData ? undefined : { items: state.expenses }, isPending: state.expensesPending, isFetching: state.expensesFetching, error: state.expensesError, refetch: retryExpenses }),
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
    state.expenses = [];
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
    // FB-100 (Option B): the record stays locked until the confirmation tick.
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Ứng đã nhận/ })).toBeChecked();
    expect(screen.getByPlaceholderText('Ghi chú (không bắt buộc)')).toHaveValue('Giữ bản nhập');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('FB-100 (Option B, card 141026230770) — "Ghi nhận phiếu thanh toán" bị khóa đến khi tích "Xác nhận hoàn ứng"', () => {
    state.requests = [request(1, 'Ứng đã nhận', 1000000)];
    render(page());
    const submit = screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    // Selection alone no longer unlocks the record — the tick is mandatory.
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Xác nhận hoàn ứng')).not.toBeChecked();
    fireEvent.submit(document.querySelector('form')!);
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(mutateAsync).toHaveBeenCalledOnce();
  });

  it('keeps zero summary deductions unsigned and neutral, while a positive refund retains its subtraction', () => {
    render(page());
    const expense = screen.getByText('Tổng chi phí').closest('.fset-summary__row')!.querySelector('.fset-summary__value')!;
    const refund = screen.getAllByText('Tiền hoàn lại').find(label => label.classList.contains('fset-summary__label'))!.closest('.fset-summary__row')!.querySelector('.fset-summary__value')!;
    for (const row of [expense, refund]) {
      expect(row).toHaveTextContent('0');
      expect(row.querySelector('.money')?.textContent).toBe('0 ₫');
    }
    expect(expense).not.toHaveClass('fset-summary__value--expense');
    expect(refund).not.toHaveClass('fset-summary__value--refund');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '125000' } });
    expect(refund).toHaveClass('fset-summary__value--refund');
    expect(refund.querySelector('.money')?.textContent).toBe('−125.000 ₫');
    expect(expense.querySelector('.money')?.textContent).toBe('0 ₫');
    expect(document.querySelector('.fset-summary__total--negative')?.querySelector('.money')).toHaveTextContent('-125.000');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '0' } });
    expect(refund.querySelector('.money')?.textContent).toBe('0 ₫');
    expect(refund).not.toHaveClass('fset-summary__value--refund');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('FB-100 (c, card 141026230770) — "Tiền hoàn lại" nhận số âm khi chi phí vượt tạm ứng', async () => {
    // Phiếu cân đối đúng ngữ cảnh tiêu đề: ứng 1.000.000, chi phí 1.250.000 →
    // hoàn lại −250.000 (assertSettlementBalanced: tạm ứng − chi phí − hoàn lại = 0).
    state.requests = [request(1, 'Ứng đã nhận', 1000000)];
    state.expenses = [{
      id: 21, buyAmount: 1250000, completionStatus: 'COMPLETED', expenseType: 'TOLL',
      tripId: 5, tripCode: 'T-QA-1', containerNumbers: 'CONT-QA-1',
      departureDate: '2026-09-17', createdAt: '2026-09-17T00:00:00.000Z',
    }];
    const { container } = render(page());
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    // Group check-all mang chung nhãn CONT-QA-1 — chọn đúng ô của khoản chi.
    const expenseBox = container.querySelector('label.fset-check-item--expense input[type="checkbox"]')!;
    fireEvent.click(expenseBox);
    expect(expenseBox).toBeChecked();
    const refund = screen.getByPlaceholderText('0') as HTMLInputElement;
    // Không còn ràng buộc min — trình duyệt từ chối submit khi input số âm bị
    // đánh dấu :invalid, nên chính thuộc tính này là thứ chặn "ghi nhận số âm".
    expect(refund).not.toHaveAttribute('min');
    fireEvent.change(refund, { target: { value: '-250000' } });
    expect(refund).toHaveValue('-250.000'); // grouped signed display (spec 19/10 FIX CHI PHÍ mục 2)
    expect(document.querySelector('.fset-summary__total .money')).toHaveTextContent('0 ₫');
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      totalExpenseAmount: 1250000, refundAmount: -250000, note: undefined,
      advanceRequestIds: [1], tripExpenseIds: [21],
    }));
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
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
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
    // No ADVANCE checkboxes are offered (the FB-100 confirmation tick is the
    // only checkbox on the page and never selects funding).
    expect(screen.queryByRole('checkbox', { name: /giao|nhận đủ/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi nhận phiếu thanh toán' })).toBeDisabled();
  });

  it('retains the selected advance and note after an API failure', async () => {
    state.requests = [request(1, 'Ứng đã nhận', 1000000)];
    mutateAsync.mockRejectedValueOnce(new Error('Tạm ứng vừa được sử dụng'));
    render(page());
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    fireEvent.change(screen.getByPlaceholderText('Ghi chú (không bắt buộc)'), { target: { value: 'Giữ lại ghi chú' } });
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
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
