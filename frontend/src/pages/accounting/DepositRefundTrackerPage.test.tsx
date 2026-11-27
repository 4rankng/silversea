import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SharedModule from '../../components/shared';
const api = vi.hoisted(() => ({ listDepositTrackers: vi.fn(), createDepositTracker: vi.fn(), updateDepositTrackerDates: vi.fn(), markDepositRefunded: vi.fn(), searchBillSuggestions: vi.fn() }));
vi.mock('../../api/depositRefundClient', () => ({ ...api, DEPOSIT_CATEGORY_LABELS: { CUOC_CONTAINER: 'Cược container', TAM_THU_SUA_CHUA: 'Tạm thu sửa chữa' } }));
// Card 20260923_14 put useToast on this page; the render harness supplies no
// ToastProvider, so mock it exactly as alerts.test.tsx does (test-only fix).
vi.mock('../../components/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedModule>()),
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));
import DepositRefundTrackerPage, { vnTodayIso } from './DepositRefundTrackerPage';
import { ApiError } from '../../lib/api';
const row = { id: 1, billNumber: 'QA-BILL', customerName: 'QA customer', carrierName: 'QA carrier', depositAmount: '0', depositDate: null, cvSubmittedDate: null, expectedRefundDate: null, status: 'CHUA_HOAN_CUOC', category: 'CUOC_CONTAINER', note: null, createdAt: '2026-08-01' };
function page() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DepositRefundTrackerPage /></QueryClientProvider>); }
beforeEach(() => { Object.values(api).forEach(fn => fn.mockReset()); api.listDepositTrackers.mockResolvedValue({ items: [row], total: 0, warnings: { cvOverdueCount: 1, unrefundedTotal: 0 } }); });
describe('deposit tracker workflows', () => {
  // KB §10.8.4 (24/11): the house date law is DD/MM/YYYY on every screen —
  // the tracker's three date columns used the retired dd/mm/yy form.
  it('prints every date column as DD/MM/YYYY', async () => {
    api.listDepositTrackers.mockResolvedValue({
      items: [{ ...row, depositDate: '2026-09-28', cvSubmittedDate: '2026-10-05', expectedRefundDate: '2026-10-19' }],
      total: 0,
      warnings: { cvOverdueCount: 1, unrefundedTotal: 0 },
    });
    const { container } = page();
    await screen.findByText('QA-BILL');
    const cell = (label: string) => container.querySelector(`td[data-label="${label}"]`)?.textContent;
    expect(cell('Ngày')).toBe('28/09/2026');
    expect(cell('Ngày nộp CV')).toBe('05/10/2026');
    expect(cell('Ngày dự kiến hoàn cược')).toBe('19/10/2026');
  });

  // Card 20260927_152: the filter region is the ONE shared strip — the from/to
  // pair, the status criterion (inline while the strip fits two rows) and the
  // page's own Lọc / Thêm cược actions in the bar's action slot.
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
    expect(screen.getByRole('button', { name: 'Thêm cược' })).toBeTruthy();
    // Blank range + blank status still queries all dates (behaviour preserved).
    expect(api.listDepositTrackers).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
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
    const todayIso = vnTodayIso();
    const initial = { ...row, depositAmount: '4000000' };
    const fresh = { ...row, depositAmount: '5000000' };
    api.listDepositTrackers.mockResolvedValueOnce({ items: [initial], total: 4000000 })
      .mockResolvedValue({ items: [fresh], total: 5000000 });
    api.markDepositRefunded.mockRejectedValueOnce(new ApiError(409, {}, 'Số tiền cược đã thay đổi. Tải lại và xác nhận số tiền mới.'))
      .mockResolvedValue({ ...fresh, status: 'DA_HOAN_CUOC' });
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn cược' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Ghi nhận hoàn cược - Bill QA-BILL' }));
    // SIL-1061 — prefill trọn số cược + ngày nhận thực tế hôm nay.
    expect(dialog.getByLabelText('Số tiền đã hoàn (₫)')).toHaveValue('4.000.000');
    expect(dialog.getByLabelText('Ngày nhận thực tế')).toHaveValue(todayIso.slice(8, 10));
    expect(dialog.getByLabelText('Tháng — Ngày nhận thực tế')).toHaveValue(todayIso.slice(5, 7));
    expect(dialog.getByLabelText('Năm — Ngày nhận thực tế')).toHaveValue(todayIso.slice(0, 4));
    fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã hoàn cược' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Số tiền cược đã thay đổi');
    expect(api.markDepositRefunded).toHaveBeenCalledExactlyOnceWith(1, { expectedDepositAmount: 4000000, recoveredAmount: 4000000, refundReceivedDate: todayIso });
    await waitFor(() => expect(api.listDepositTrackers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ghi nhận hoàn cược - Bill QA-BILL' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('QA-BILL').closest('tr')).toHaveTextContent('5.000.000'));
    fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn cược' }));
    dialog = within(await screen.findByRole('dialog', { name: 'Ghi nhận hoàn cược - Bill QA-BILL' }));
    expect(dialog.getByLabelText('Số tiền đã hoàn (₫)')).toHaveValue('5.000.000');
    expect(api.markDepositRefunded).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã hoàn cược' }));
    await waitFor(() => expect(api.markDepositRefunded).toHaveBeenLastCalledWith(1, { expectedDepositAmount: 5000000, recoveredAmount: 5000000, refundReceivedDate: todayIso }));
  });

  // SIL-1061 — lô hoàn từng phần: dòng hiện đã hoàn/còn lại, hộp hoàn cược
  // prefill phần CÒN LẠI và chặn nhập vượt.
  it('SIL-1061: a partial row shows đã hoàn/còn lại and the tick prefills the remainder', async () => {
    api.listDepositTrackers.mockResolvedValue({ items: [{ ...row, depositAmount: '2000000', recoveredAmount: '500000' }], total: 2000000, warnings: { cvOverdueCount: 0, unrefundedTotal: 1500000 } });
    page(); await screen.findByText('QA-BILL');
    expect(screen.getByText('QA-BILL').closest('tr')).toHaveTextContent('Đã hoàn 500.000 · Còn lại 1.500.000 ₫');
    fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn cược' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ghi nhận hoàn cược - Bill QA-BILL' }));
    expect(dialog.getByLabelText('Số tiền đã hoàn (₫)')).toHaveValue('1.500.000');
    expect(dialog.getByText(/Còn lại phải hoàn: 1\.500\.000 ₫ của tổng 2\.000\.000 ₫/)).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText('Số tiền đã hoàn (₫)'), { target: { value: '2.500.000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã hoàn cược' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('không được vượt số tiền cược còn lại');
    expect(api.markDepositRefunded).not.toHaveBeenCalled();
  });

  // SIL-1061 — hộp "Cập nhật hoàn cược" sửa được số đã hoàn + ngày nhận thực tế.
  it('SIL-1061: the update dialog edits the recovered amount with its actual received date', async () => {
    api.listDepositTrackers.mockResolvedValue({ items: [{ ...row, depositAmount: '2000000', recoveredAmount: '500000', refundReceivedDate: '2026-11-20' }], total: 0, warnings: { cvOverdueCount: 0, unrefundedTotal: 1500000 } });
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: /Ngày CV \/ số tiền/ }));
    const form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
    expect(form.getByLabelText('Số tiền đã hoàn (₫)')).toHaveValue('500.000');
    fireEvent.change(form.getByLabelText('Số tiền đã hoàn (₫)'), { target: { value: '2000000' } });
    fireEvent.change(form.getByLabelText('Ngày nhận thực tế'), { target: { value: '25/11/2026' } });
    api.updateDepositTrackerDates.mockResolvedValue({ ...row, status: 'DA_HOAN_CUOC', recoveredAmount: '2000000', refundReceivedDate: '2026-11-25' });
    fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledWith(1, expect.objectContaining({ recoveredAmount: 2000000, refundReceivedDate: '2026-11-25' })));
  });

  it('SIL-1061: a recovered amount without the actual received date is rejected before submit', async () => {
    api.listDepositTrackers.mockResolvedValue({ items: [{ ...row, depositAmount: '2000000' }], total: 0, warnings: { cvOverdueCount: 0, unrefundedTotal: 2000000 } });
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: /Ngày CV \/ số tiền/ }));
    const form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
    fireEvent.change(form.getByLabelText('Số tiền đã hoàn (₫)'), { target: { value: '500000' } });
    fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Số tiền đã hoàn lớn hơn 0 bắt buộc có Ngày nhận thực tế.');
    expect(api.updateDepositTrackerDates).not.toHaveBeenCalled();
  });

  it('loads all dates, shows an old outstanding row and permits accounting to fill its amount', async () => {
    page(); await screen.findByText('QA-BILL'); expect(api.listDepositTrackers).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    // SIL-878 — the auto-intake row carries Ngày cược; accounting corrects it
    // in the same dialog where it fills the amount.
    fireEvent.click(screen.getByRole('button', { name: /Ngày CV \/ số tiền/ }));
    const form = within(await screen.findByRole('dialog'));
    expect(form.getByLabelText('Ngày cược')).toHaveValue('');
    // BufferedUuiDateInput renders day/month/year segments — the first segment
    // carries the bound label, the rest use 'Tháng/Năm — {label}'.
    fireEvent.change(form.getByLabelText('Ngày cược'), { target: { value: '05' } });
    fireEvent.change(form.getByLabelText('Tháng — Ngày cược'), { target: { value: '11' } });
    fireEvent.change(form.getByLabelText('Năm — Ngày cược'), { target: { value: '2026' } });
    fireEvent.change(form.getByLabelText('Số tiền cược (₫)'), { target: { value: '4.000.000' } });
    fireEvent.change(form.getByLabelText('Ghi chú'), { target: { value: 'Actual deposit' } });
    api.updateDepositTrackerDates.mockResolvedValue({ ...row, depositAmount: '4000000', depositDate: '2026-11-05' });
    fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledWith(1, { depositDate: '2026-11-05', depositAmount: 4000000, note: 'Actual deposit', cvSubmittedDate: null, recoveredAmount: 0, refundReceivedDate: null, category: 'CUOC_CONTAINER' }));
  });

  // SIL-1125 — a stale stored expected date (an old CV+24 formula) must not
  // be re-pinned by an unrelated save: untouched, the field is OMITTED from
  // the PATCH and the backend recomputes cvSubmittedDate + 14. Rows heal on
  // their next dates-dialog save.
  it('SIL-1125: editing only the CV date omits expectedRefundDate from the PATCH', async () => {
    api.listDepositTrackers.mockResolvedValue({ items: [{ ...row, cvSubmittedDate: '2026-10-27', expectedRefundDate: '2026-11-20' }], total: 0, warnings: { cvOverdueCount: 1, unrefundedTotal: 0 } });
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: /Ngày CV \/ số tiền/ }));
    const form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
    // The stale prefill (+24d) is visible but untouched — only the CV date changes.
    expect(form.getByLabelText('Ngày dự kiến hoàn cược')).toHaveValue('20');
    fireEvent.change(form.getByLabelText('Ngày nộp CV'), { target: { value: '05/11/2026' } });
    api.updateDepositTrackerDates.mockResolvedValue(row);
    fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledTimes(1));
    const body = api.updateDepositTrackerDates.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('expectedRefundDate');
    expect(body.cvSubmittedDate).toBe('2026-11-05');
  });

  it('SIL-1125: an edited expected date rides the PATCH verbatim', async () => {
    api.listDepositTrackers.mockResolvedValue({ items: [{ ...row, cvSubmittedDate: '2026-10-27', expectedRefundDate: '2026-11-20' }], total: 0, warnings: { cvOverdueCount: 1, unrefundedTotal: 0 } });
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: /Ngày CV \/ số tiền/ }));
    const form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
    fireEvent.change(form.getByLabelText('Ngày dự kiến hoàn cược'), { target: { value: '01/12/2026' } });
    api.updateDepositTrackerDates.mockResolvedValue(row);
    fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledTimes(1));
    const body = api.updateDepositTrackerDates.mock.calls[0][1] as Record<string, unknown>;
    expect(body.expectedRefundDate).toBe('2026-12-01');
  });

  it('CR-011 §6.4: the money cell opens the inline amount editor and Lưu posts the new amount', async () => {
    api.listDepositTrackers.mockResolvedValue({ items: [{ ...row, depositAmount: '1000000' }], total: 0, warnings: { cvOverdueCount: 1, unrefundedTotal: 0 } });
    page();
    await screen.findByText('QA-BILL');
    // CHUA_HOAN_CUOC row: the money value itself is the edit trigger.
    fireEvent.click(screen.getByRole('button', { name: 'Sửa số tiền cược Bill QA-BILL' }));
    const editor = screen.getByLabelText('Sửa số tiền cược Bill QA-BILL') as HTMLInputElement;
    expect(editor).toHaveValue('1.000.000');
    fireEvent.change(editor, { target: { value: '2.500.000' } });
    api.updateDepositTrackerDates.mockResolvedValue({ ...row, depositAmount: '2500000' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledWith(1, { depositAmount: 2500000 }));
    // The editor closes after save; the invalidate() refetch refreshes totals.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument());
  });
  it('keeps save failures and user input inside the create form, and rejects negative amounts', async () => {
    page(); fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' })); const form = within(await screen.findByRole('dialog'));
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

  // Spec 5.10 Table 1.1.3: the create dialog gained Ngày cược, Ngày dự kiến
  // hoàn cược (CV + 14 default) and Trạng thái.
  it('renders the three spec 5.10 create fields and defaults Trạng thái to Chưa hoàn cược', async () => {
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' }));
    const form = within(await screen.findByRole('dialog', { name: 'Thêm cược' }));
    expect(form.getByLabelText('Ngày cược')).toHaveValue('');
    expect(form.getByLabelText('Ngày dự kiến hoàn cược')).toHaveValue('');
    const status = form.getByRole('button', { name: /Trạng thái/ });
    expect(status).toHaveTextContent('Chưa hoàn cược');
    expect(form.getByText('Bỏ trống ngày dự kiến để hệ thống tự điền ngày nộp CV + 14 ngày.')).toBeInTheDocument();
    fireEvent.click(status);
    expect(await screen.findByRole('option', { name: 'Đã hoàn cược' })).toBeInTheDocument();
  });

  it('auto-fills Ngày dự kiến hoàn cược to CV + 14 on CV change and keeps a manual override', async () => {
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' }));
    const form = within(await screen.findByRole('dialog', { name: 'Thêm cược' }));
    fireEvent.change(form.getByLabelText('Ngày nộp CV (tùy chọn)'), { target: { value: '01/10/2026' } });
    await waitFor(() => expect(form.getByLabelText('Ngày dự kiến hoàn cược')).toHaveValue('15'));
    expect(form.getByLabelText('Tháng — Ngày dự kiến hoàn cược')).toHaveValue('10');
    expect(form.getByLabelText('Năm — Ngày dự kiến hoàn cược')).toHaveValue('2026');
    // Still auto-tracked while the user has not overridden it.
    fireEvent.change(form.getByLabelText('Ngày nộp CV (tùy chọn)'), { target: { value: '05/10/2026' } });
    await waitFor(() => expect(form.getByLabelText('Ngày dự kiến hoàn cược')).toHaveValue('19'));
    // A manual override sticks across later CV changes.
    fireEvent.change(form.getByLabelText('Ngày dự kiến hoàn cược'), { target: { value: '25/10/2026' } });
    await waitFor(() => expect(form.getByLabelText('Ngày dự kiến hoàn cược')).toHaveValue('25'));
    fireEvent.change(form.getByLabelText('Ngày nộp CV (tùy chọn)'), { target: { value: '10/10/2026' } });
    expect(form.getByLabelText('Ngày dự kiến hoàn cược')).toHaveValue('25');
  });

  it('submits depositDate + status and can mark Đã hoàn cược at creation', async () => {
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' }));
    const form = within(await screen.findByRole('dialog', { name: 'Thêm cược' }));
    for (const [label, value] of [['Số Bill', 'QA-NEW'], ['Khách hàng', 'QA customer'], ['Hãng tàu', 'QA carrier'], ['Số tiền cược (₫)', '5000000']]) fireEvent.change(form.getByLabelText(label), { target: { value } });
    fireEvent.change(form.getByLabelText('Ngày cược'), { target: { value: '03/10/2026' } });
    fireEvent.change(form.getByLabelText('Ngày nộp CV (tùy chọn)'), { target: { value: '01/10/2026' } });
    fireEvent.click(form.getByRole('button', { name: /Trạng thái/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đã hoàn cược' }));
    api.createDepositTracker.mockResolvedValue(row);
    fireEvent.click(form.getByRole('button', { name: 'Lưu dòng' }));
    await waitFor(() => expect(api.createDepositTracker).toHaveBeenCalledExactlyOnceWith({
      billNumber: 'QA-NEW', customerName: 'QA customer', carrierName: 'QA carrier',
      depositAmount: 5000000, shipmentId: null,
      // SIL-1125 — the auto-tracked expected date is display-only: the user
      // never typed in the field, so the payload omits it and the backend
      // derives cvSubmittedDate + 14 (the same 15/10).
      cvSubmittedDate: '2026-10-01',
      note: null, depositDate: '2026-10-03', status: 'DA_HOAN_CUOC',
      category: 'CUOC_CONTAINER',
    }));
  });

  it('keeps the create payload at status CHUA_HOAN_CUOC with blank dates by default', async () => {
    page(); await screen.findByText('QA-BILL');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' }));
    const form = within(await screen.findByRole('dialog', { name: 'Thêm cược' }));
    for (const [label, value] of [['Số Bill', 'QA-NEW'], ['Khách hàng', 'QA customer'], ['Hãng tàu', 'QA carrier'], ['Số tiền cược (₫)', '5000000']]) fireEvent.change(form.getByLabelText(label), { target: { value } });
    api.createDepositTracker.mockResolvedValue(row);
    fireEvent.click(form.getByRole('button', { name: 'Lưu dòng' }));
    await waitFor(() => expect(api.createDepositTracker).toHaveBeenCalledExactlyOnceWith({
      billNumber: 'QA-NEW', customerName: 'QA customer', carrierName: 'QA carrier',
      depositAmount: 5000000, shipmentId: null,
      cvSubmittedDate: null, note: null, depositDate: null,
      status: 'CHUA_HOAN_CUOC',
      category: 'CUOC_CONTAINER',
    }));
  });
  it('reports load failures and retries without claiming an empty successful result', async () => {
    api.listDepositTrackers.mockRejectedValueOnce(new Error('Không tải được dữ liệu'));
    page(); expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được dữ liệu');
    expect(screen.queryByText('Không có dòng theo dõi nào trong bộ lọc.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' })); await screen.findByText('QA-BILL');
  });

  // Card 171026212000 (FB-096 verify-fail): the "Tra cứu Bill (4 số cuối)"
  // typeahead must surface real lots — including references whose printed tail
  // is not four digits — and never render a failed lookup as "no lot found".
  describe('bill suggestion typeahead', () => {
    const suggestion = {
      shipmentId: 55, billNumber: 'FB020-R21-RB1', bookingRef: null,
      billDisplay: 'FB020-R21-RB1', carrierName: 'YML', customerName: 'CÔNG TY LONG MINH',
      existingTrackerCount: 1,
    };
    async function openCreateForm() {
      page(); await screen.findByText('QA-BILL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' }));
      return within(await screen.findByRole('dialog', { name: 'Thêm cược' }));
    }

    it('queries on the fourth digit, lists matches and autofills on pick', async () => {
      api.searchBillSuggestions.mockResolvedValue([suggestion]);
      const form = await openCreateForm();
      const lookup = form.getByLabelText('Tra cứu Bill (4 số cuối)');
      fireEvent.change(lookup, { target: { value: '2' } });
      expect(api.searchBillSuggestions).not.toHaveBeenCalled();
      fireEvent.change(lookup, { target: { value: '0211' } });
      await waitFor(() => expect(api.searchBillSuggestions).toHaveBeenCalledExactlyOnceWith('0211'));
      expect(await form.findByText('Đã cược 1 lần')).toBeInTheDocument(); // warn signal rides the suggestion row
      fireEvent.click(await form.findByText('FB020-R21-RB1'));
      expect(form.getByLabelText('Số Bill')).toHaveValue('FB020-R21-RB1');
      expect(form.getByLabelText('Khách hàng')).toHaveValue('CÔNG TY LONG MINH');
      expect(form.getByLabelText('Hãng tàu')).toHaveValue('YML');
    });

    it('shows the no-match hint only after a successful empty lookup', async () => {
      api.searchBillSuggestions.mockResolvedValue([]);
      const form = await openCreateForm();
      fireEvent.change(form.getByLabelText('Tra cứu Bill (4 số cuối)'), { target: { value: '0211' } });
      expect(await form.findByText('Không có lô hàng nào khớp 0211 trong Số Bill/Số Booking. Nhập tay bên dưới.')).toBeInTheDocument();
      expect(form.queryByText(/Không tra cứu được/)).not.toBeInTheDocument();
    });

    it('reports a failed lookup as an error instead of claiming no lot exists', async () => {
      api.searchBillSuggestions.mockRejectedValueOnce(new Error('Phiên đăng nhập hết hạn'));
      const form = await openCreateForm();
      fireEvent.change(form.getByLabelText('Tra cứu Bill (4 số cuối)'), { target: { value: '0211' } });
      expect(await form.findByRole('alert')).toHaveTextContent('Không tra cứu được lô hàng (Phiên đăng nhập hết hạn)');
      expect(form.queryByText(/Không có lô hàng nào khớp/)).not.toBeInTheDocument();
    });

    // SIL-735: ô tra cứu phủ CẢ Số Bill lẫn Số Booking — lô chỉ có Số
    // Booking vẫn ra dòng gợi ý và tự điền Khách hàng + Hãng tàu.
    it('tra cứu được cả lô chỉ có Số Booking (khớp chuỗi con trên CẢ HAI trường)', async () => {
      api.searchBillSuggestions.mockResolvedValue([{
        shipmentId: 77, billNumber: null, bookingRef: 'RARBOOK-1792226038601-9bzut2',
        billDisplay: 'RARBOOK-1792226038601-9bzut2', carrierName: 'YML', customerName: 'CÔNG TY LONG MINH',
        existingTrackerCount: 0,
      }]);
      const form = await openCreateForm();
      const lookup = form.getByLabelText('Tra cứu Bill (4 số cuối)');
      expect(form.getByText(/4 số cuối của Số Bill hoặc Số Booking/)).toBeInTheDocument();
      fireEvent.change(lookup, { target: { value: '8601' } });
      await waitFor(() => expect(api.searchBillSuggestions).toHaveBeenCalledExactlyOnceWith('8601'));
      fireEvent.click(await form.findByText('RARBOOK-1792226038601-9bzut2'));
      expect(form.getByLabelText('Số Bill')).toHaveValue('RARBOOK-1792226038601-9bzut2');
      expect(form.getByLabelText('Khách hàng')).toHaveValue('CÔNG TY LONG MINH');
      expect(form.getByLabelText('Hãng tàu')).toHaveValue('YML');
    });
  });

  // ─── SIL-764 (id 885) — trường phân loại [Cược container] | [Tạm thu sửa chữa]
  describe('phân loại Cược container | Tạm thu sửa chữa (SIL-764)', () => {
    const categoryCell = (label: string) => screen.getAllByText(label)
      .filter((el) => el.closest('td')?.getAttribute('data-label') === 'Phân loại');

    it('renders each row’s Phân loại, defaulting existing rows to Cược container', async () => {
      api.listDepositTrackers.mockResolvedValue({ items: [row, { ...row, id: 2, category: 'TAM_THU_SUA_CHUA' }], total: 0, warnings: { cvOverdueCount: 0, unrefundedTotal: 0 } });
      page();
      await screen.findAllByText('QA-BILL');
      // The RAC accessibility fallback mirrors the options into a hidden
      // native <select>, so the lookup must scope to the board's cells.
      expect(categoryCell('Cược container')).toHaveLength(1);
      expect(categoryCell('Tạm thu sửa chữa')).toHaveLength(1);
    });

    it('filters the board by Phân loại', async () => {
      page();
      await screen.findByText('QA-BILL');
      fireEvent.click(screen.getByRole('button', { name: /Phân loại/ }));
      fireEvent.click(await screen.findByRole('option', { name: 'Tạm thu sửa chữa' }));
      await waitFor(() => expect(api.listDepositTrackers).toHaveBeenLastCalledWith(undefined, undefined, undefined, 'TAM_THU_SUA_CHUA'));
    });

    it('creates a Tạm thu sửa chữa row on the same board', async () => {
      page(); await screen.findByText('QA-BILL');
      fireEvent.click(screen.getByRole('button', { name: 'Thêm cược' }));
      const form = within(await screen.findByRole('dialog', { name: 'Thêm cược' }));
      for (const [label, value] of [['Số Bill', 'QA-REPAIR'], ['Khách hàng', 'QA customer'], ['Hãng tàu', 'QA carrier'], ['Số tiền cược (₫)', '2500000']]) fireEvent.change(form.getByLabelText(label), { target: { value } });
      // The RAC listbox portals to <body> — options never live inside the
      // dialog element, so the option lookup runs at screen scope.
      fireEvent.click(form.getByRole('button', { name: /Phân loại/ }));
      fireEvent.click(await screen.findByRole('option', { name: 'Tạm thu sửa chữa' }));
      api.createDepositTracker.mockResolvedValue({ ...row, id: 3, category: 'TAM_THU_SUA_CHUA' });
      fireEvent.click(form.getByRole('button', { name: 'Lưu dòng' }));
      await waitFor(() => expect(api.createDepositTracker).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        billNumber: 'QA-REPAIR',
        depositAmount: 2500000,
        category: 'TAM_THU_SUA_CHUA',
      })));
    });

    it('edits an existing row’s Phân loại through the date dialog', async () => {
      page(); await screen.findByText('QA-BILL');
      api.updateDepositTrackerDates.mockResolvedValue({ ...row, category: 'TAM_THU_SUA_CHUA' });
      fireEvent.click(screen.getByRole('button', { name: 'Ngày CV / số tiền' }));
      const form = within(await screen.findByRole('dialog', { name: 'Cập nhật hoàn cược - Bill QA-BILL' }));
      fireEvent.click(form.getByRole('button', { name: /Phân loại/ }));
      fireEvent.click(await screen.findByRole('option', { name: 'Tạm thu sửa chữa' }));
      fireEvent.click(form.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(api.updateDepositTrackerDates).toHaveBeenCalledExactlyOnceWith(1, expect.objectContaining({ category: 'TAM_THU_SUA_CHUA' })));
    });
  });
});
