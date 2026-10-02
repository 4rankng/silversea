import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SharedModule from '../../components/shared';
const api = vi.hoisted(() => ({ listDepositTrackers: vi.fn(), createDepositTracker: vi.fn(), updateDepositTrackerDates: vi.fn(), markDepositRefunded: vi.fn() }));
vi.mock('../../api/depositRefundClient', () => api);
// Card 20260923_14 put useToast on this page; the render harness supplies no
// ToastProvider, so mock it exactly as alerts.test.tsx does (test-only fix).
vi.mock('../../components/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));
import DepositRefundTrackerPage from './DepositRefundTrackerPage';
import { ApiError } from '../../lib/api';
const row = { id: 1, billNumber: 'QA-BILL', customerName: 'QA customer', carrierName: 'QA carrier', depositAmount: '0', cvSubmittedDate: null, expectedRefundDate: null, status: 'CHUA_HOAN_CUOC', note: null, createdAt: '2026-08-01' };
function page() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DepositRefundTrackerPage /></QueryClientProvider>); }
beforeEach(() => { Object.values(api).forEach(fn => fn.mockReset()); api.listDepositTrackers.mockResolvedValue({ items: [row], total: 0, warnings: { cvOverdueCount: 1, unrefundedTotal: 0 } }); });
describe('deposit tracker workflows', () => {
  // Card 20260927_152: the filter region is the ONE shared strip — the from/to
  // pair, the status criterion (inline while the strip fits two rows) and the
  // page's own Lọc / Thêm dòng actions in the bar's action slot.
  it('renders the shared filter strip and keeps both page actions', async () => {
    const { container } = page();
    await screen.findByText('QA-BILL');
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(container.querySelector('.date-range-fields')).toBeTruthy();
    expect(screen.getByLabelText('Từ ngày')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
    expect(within(bar).getByText('Trạng thái')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lọc' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm dòng' })).toBeTruthy();
    // Blank range + blank status still queries all dates (behaviour preserved).
    expect(api.listDepositTrackers).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it('keeps the date action icon beside its complete label and closes its unsaved draft without writes (UI73)', async () => {
    page(); await screen.findByText('QA-BILL');
    const action = screen.getByRole('button', { name: 'Ngày CV / số tiền' });
    const icon = action.querySelector('svg[data-icon="leading"]');
    expect(icon).not.toBeNull();
    expect(icon?.parentElement).toBe(action);
    expect(action.querySelector('[data-text]')).toHaveTextContent('Ngày CV / số tiền');
    expect(action.querySelector('[data-text] svg')).toBeNull();
    fireEvent.click(action);
    let form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
    expect(form.getByLabelText('Ngày nộp CV')).toHaveValue('');
    fireEvent.change(form.getByLabelText('Ghi chú'), { target: { value: 'Unsaved date-form draft' } });
    fireEvent.click(form.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.updateDepositTrackerDates).not.toHaveBeenCalled();
    expect(api.markDepositRefunded).not.toHaveBeenCalled();
    expect(api.createDepositTracker).not.toHaveBeenCalled();
    fireEvent.click(action);
    form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
    expect(form.getByLabelText('Ghi chú')).toHaveValue('');
    expect(form.getByLabelText('Số tiền cược (₫)')).toHaveValue('');
  });

  it('refreshes a stale refund amount and requires confirmation of the refreshed value', async () => {
    const initial = { ...row, depositAmount: '4000000' };
    const fresh = { ...row, depositAmount: '5000000' };
    api.listDepositTrackers.mockResolvedValueOnce({ items: [initial], total: 4000000 })
      .mockResolvedValue({ items: [fresh], total: 5000000 });
    api.markDepositRefunded.mockRejectedValueOnce(new ApiError(409, {}, 'Số tiền cược đã thay đổi. Tải lại và xác nhận số tiền mới.'))
      .mockResolvedValue({ ...fresh, status: 'DA_HOAN_CUOC' });
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn cược' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Xác nhận thao tác' }));
    expect(dialog.getByText(/4\.000\.000/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Đã hoàn cược' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Số tiền cược đã thay đổi');
    await waitFor(() => expect(api.listDepositTrackers).toHaveBeenCalledTimes(2));
    expect(api.markDepositRefunded).toHaveBeenCalledExactlyOnceWith(1, 4000000);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xác nhận thao tác' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('QA-BILL').closest('tr')).toHaveTextContent('5.000.000'));
    fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn cược' }));
    dialog = within(await screen.findByRole('dialog', { name: 'Xác nhận thao tác' }));
    expect(dialog.getByText(/5\.000\.000/)).toBeInTheDocument();
    expect(api.markDepositRefunded).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.getByRole('button', { name: 'Đã hoàn cược' }));
    await waitFor(() => expect(api.markDepositRefunded).toHaveBeenLastCalledWith(1, 5000000));
  });

  it('loads all dates, shows an old outstanding row and permits accounting to fill its amount', async () => {
    page(); await screen.findByText('QA-BILL'); expect(api.listDepositTrackers).toHaveBeenCalledWith(undefined, undefined, undefined);
    fireEvent.click(screen.getByRole('button', { name: /Ngày CV \/ số tiền/ }));
    const form = within(await screen.findByRole('dialog'));
    fireEvent.change(form.getByLabelText('Số tiền cược (₫)'), { target: { value: '4.000.000' } });
    fireEvent.change(form.getByLabelText('Ghi chú'), { target: { value: 'Actual deposit' } });
    api.updateDepositTrackerDates.mockResolvedValue({ ...row, depositAmount: '4000000' });
    fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledWith(1, { depositAmount: 4000000, note: 'Actual deposit', cvSubmittedDate: null, expectedRefundDate: null }));
  });
  it('keeps save failures and user input inside the create form, and rejects negative amounts', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Thêm dòng' })); const form = within(await screen.findByRole('dialog'));
    // Card 20260930_224: the money field is NumberField (unsigned grouped) — a
    // typed minus is dropped on entry, so the old negative-rejection alert is
    // unreachable by construction and the submit carries the POSITIVE digits.
    api.createDepositTracker.mockRejectedValueOnce(new Error('Không thể lưu, thử lại.'));
    for (const [label, value] of [['Số Bill', 'QA-NEW'], ['Khách hàng', 'QA customer'], ['Hãng tàu', 'QA carrier'], ['Số tiền cược (₫)', '-4000000']]) fireEvent.change(form.getByLabelText(label), { target: { value } });
    fireEvent.click(form.getByRole('button', { name: 'Lưu dòng' }));
    await waitFor(() => expect(api.createDepositTracker).toHaveBeenCalledWith(expect.objectContaining({ depositAmount: 4000000 })));
    // The failure keeps the dialog open with the user's input retained.
    expect(await form.findByRole('alert')).toHaveTextContent('Không thể lưu, thử lại.');
    expect(form.getByLabelText('Số tiền cược (₫)')).toHaveValue('4.000.000');
    expect(form.getByLabelText('Số Bill')).toHaveValue('QA-NEW');
    expect(api.createDepositTracker).toHaveBeenCalledWith(expect.objectContaining({ cvSubmittedDate: null, depositAmount: 4000000 }));
  });
  it('reports load failures and retries without claiming an empty successful result', async () => {
    api.listDepositTrackers.mockRejectedValueOnce(new Error('Không tải được dữ liệu'));
    page(); expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được dữ liệu');
    expect(screen.queryByText('Không có dòng theo dõi nào trong bộ lọc.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' })); await screen.findByText('QA-BILL');
  });
});
