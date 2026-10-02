import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';
const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: api }));
import { DriverExpenseCorrection, DriverExpenseCorrectionForm } from './DriverExpenseCorrection';
const entry = { id: 40, sourceKind: 'DRIVER', sourceId: 7, version: 3, amount: 100000, feeName: 'Trả đêm', costGroup: 'DRIVER_ROAD', expenseDate: '2026-09-22', invoiceNumber: null, invoiceDate: null, note: 'Ghi nhận', status: 'RECORDED', locked: false, confirmedAt: null, reconciliationId: null } as ExpenseAccountingEntry;
const saved = vi.fn(), closed = vi.fn(), reload = vi.fn();
function form(row = entry) { return render(<DriverExpenseCorrectionForm entry={row} onSaved={saved} onClose={closed} onReload={reload} />); }
function change() { fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '110000' } }); fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Sửa số thực chi' } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'Sửa khoản chi Trả đêm' })); }
describe('driver own-cost correction', () => {
  beforeEach(() => { vi.clearAllMocks(); api.update.mockResolvedValue({ ...entry, version: 4 }); saved.mockResolvedValue(undefined); reload.mockResolvedValue(undefined); });
  it('uses the current version and only driver-permitted fields, then refreshes saved costs', async () => {
    form(); change(); submit(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.update).toHaveBeenCalledWith({ sourceKind: 'DRIVER', sourceId: 7, expectedVersion: 3 }, { expectedVersion: 3, amount: 110000, feeName: 'Trả đêm', expenseDate: '2026-09-22', invoiceNumber: null, invoiceDate: null, note: 'Ghi nhận', reason: 'Sửa số thực chi' });
    expect(api.update.mock.calls[0][1]).not.toHaveProperty('payerKind'); expect(api.update.mock.calls[0][1]).not.toHaveProperty('customerChargeAmount');
  });
  it('rejects invalid amounts and a missing correction reason without a write', async () => {
    form(); fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '0' } }); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Kiểm tra số tiền'); expect(api.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '100000' } }); submit(); expect(api.update).not.toHaveBeenCalled();
  });
  it('blocks duplicate saves and close while the command is pending', async () => {
    api.update.mockReturnValue(new Promise(() => {})); form(); change(); submit(); submit();
    expect(api.update).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Đóng sửa khoản chi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng sửa khoản chi' })); expect(closed).not.toHaveBeenCalled();
  });
  it('keeps the draft after a failure and permits a deliberate retry', async () => {
    api.update.mockRejectedValueOnce(new Error('Mất phản hồi')); form(); change(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Mất phản hồi'); expect(screen.getByLabelText(/Thực chi/)).toHaveValue(110000);
    submit(); await waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(api.update.mock.calls[1]).toEqual(api.update.mock.calls[0]);
  });
  it.each([{ locked: true }, { confirmedAt: '2026-09-22T07:00:00Z' }, { reconciliationId: 5 }, { status: 'VOIDED' as const }])('blocks financial-state changes %o', state => {
    form({ ...entry, ...state }); expect(screen.getByRole('status')).toHaveTextContent('Liên hệ kế toán'); expect(screen.queryByRole('button', { name: 'Lưu điều chỉnh' })).not.toBeInTheDocument(); submit(); expect(api.update).not.toHaveBeenCalled();
  });
  it('explicitly reloads a conflict and submits the fresh source version', async () => {
    api.get.mockResolvedValueOnce(entry).mockResolvedValue({ ...entry, version: 4, amount: 105000 }); api.update.mockRejectedValueOnce(new Error('Khoản chi đã thay đổi. Tải lại.'));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DriverExpenseCorrection expenseId={7} onSaved={saved} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa khoản chi' })); await screen.findByLabelText(/Thực chi/); change(); submit(); await screen.findByText(/Khoản chi đã thay đổi/);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' })); await waitFor(() => expect(screen.getByLabelText(/Thực chi/)).toHaveValue(105000)); change(); submit();
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2)); expect(api.update.mock.calls[1][1].expectedVersion).toBe(4);
  });
});
