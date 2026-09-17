import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingEntry } from '@tingting/shared';
const update = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { update } }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseEntryDrawer } from './ExpenseEntryDrawer';
const entry = { sourceKind: 'OPS', sourceId: 7, version: 2, status: 'RECORDED', feeName: 'Giao nhận', amount: 500000, customerChargeAmount: 300000, expenseDate: '2026-09-16', shipmentCode: 'BL-7', locked: false, photoStorageKeys: [], canViewPayments: true, receivedAmount: 0, paidAmount: 0, payerKind: 'USER', payerUserId: 3, payerName: 'OPS' } as unknown as ExpenseAccountingEntry;
function show(chargeOnly = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  render(<QueryClientProvider client={client}><ExpenseEntryDrawer entry={entry} staff={[{ id: 3, name: 'OPS' }]} chargeOnly={chargeOnly} onClose={close} /></QueryClientProvider>);
  return close;
}
describe('expense charge correction', () => {
  beforeEach(() => { update.mockReset().mockResolvedValue(entry); });
  it('allows negotiated charge less than spend and does not write payment data', async () => {
    show();
    fireEvent.change(screen.getByLabelText(/Thực thu — thu khách/), { target: { value: '200000' } });
    fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Thỏa thuận khách hàng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toEqual({ expectedVersion: 2, reason: 'Thỏa thuận khách hàng', customerChargeAmount: 200000, recoveryNote: null });
  });
  it('accepts an explicit zero charge for an inclusive rate', async () => {
    show();
    fireEvent.change(screen.getByLabelText(/Thực thu — thu khách/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Trọn gói' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].customerChargeAmount).toBe(0);
  });
  it('retains input and stays open when optimistic version is stale', async () => {
    update.mockRejectedValue(new Error('Khoản chi đã thay đổi, hãy mở lại'));
    const close = show();
    fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Đổi giá' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điều chỉnh' }));
    await screen.findByText('Khoản chi đã thay đổi, hãy mở lại');
    expect(screen.getByLabelText(/Thực thu — thu khách/)).toHaveValue(300000);
    expect(close).not.toHaveBeenCalled();
  });
});
