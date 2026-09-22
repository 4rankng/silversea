import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ listDepositTrackers: vi.fn(), createDepositTracker: vi.fn(), updateDepositTrackerDates: vi.fn(), markDepositRefunded: vi.fn() }));
vi.mock('../../api/depositRefundClient', () => api);
import DepositRefundTrackerPage from './DepositRefundTrackerPage';
import { ApiError } from '../../lib/api';
const row = { id: 1, billNumber: 'QA-BILL', customerName: 'QA customer', carrierName: 'QA carrier', depositAmount: '0', cvSubmittedDate: null, expectedRefundDate: null, status: 'CHUA_HOAN_CUOC', note: null, createdAt: '2026-08-01' };
function page() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DepositRefundTrackerPage /></QueryClientProvider>); }
beforeEach(() => { Object.values(api).forEach(fn => fn.mockReset()); api.listDepositTrackers.mockResolvedValue({ items: [row], total: 0, warnings: { cvOverdueCount: 1, unrefundedTotal: 0 } }); });
describe('deposit tracker workflows', () => {
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
    for (const [label, value] of [['Số Bill', 'QA-NEW'], ['Khách hàng', 'QA customer'], ['Hãng tàu', 'QA carrier'], ['Số tiền cược (₫)', '-4000000']]) fireEvent.change(form.getByLabelText(label), { target: { value } });
    fireEvent.click(form.getByRole('button', { name: 'Lưu dòng' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Số tiền cược phải là số nguyên dương'); expect(api.createDepositTracker).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Số tiền cược (₫)'), { target: { value: '4000000' } });
    api.createDepositTracker.mockRejectedValue(new Error('Không thể lưu, thử lại.'));
    fireEvent.click(form.getByRole('button', { name: 'Lưu dòng' }));
    await waitFor(() => expect(form.getByRole('alert')).toHaveTextContent('Không thể lưu, thử lại.'));
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
