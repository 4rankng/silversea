import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingEntry } from '@tingting/shared';
const create = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { createVoucher: create } }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseVoucherDrawer } from './ExpenseVoucherDrawer';
const entry = { sourceKind: 'OPS', sourceId: 1, version: 2, status: 'RECORDED', locked: true, customerId: 12, customerName: 'Khách A', feeName: 'Giao nhận', shipmentCode: 'BL-1', amount: 500000, customerChargeAmount: 300000, outstandingReceivable: 300000, outstandingPayable: 500000 } as ExpenseAccountingEntry;
async function select(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}$`) }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function show(accounts: Array<{ id: number; name: string; fundCode: 'COMPANY' | 'TM' | null }> = [{ id: 5, name: 'ACB', fundCode: 'COMPANY' }]) {
  const saved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ExpenseVoucherDrawer entries={[entry]} direction="IN" accounts={accounts} onSaved={saved} onClose={vi.fn()} /></QueryClientProvider>);
  return saved;
}
describe('expense cash receipt', () => {
  beforeEach(() => { create.mockReset(); });
  it('posts a partial receipt even for a locked expense and preserves retry identity after an unknown result', async () => {
    create.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce({ id: 1 });
    const saved = show();
    await select('Nguồn quỹ', 'Quỹ công ty'); await select('Tài khoản', 'ACB');
    fireEvent.change(screen.getByLabelText(/Mã tham chiếu/), { target: { value: 'PT-01' } });
    fireEvent.change(screen.getByLabelText(/Số thu · Giao nhận/), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi phiếu' }));
    await screen.findByText('Mất phản hồi');
    expect(screen.getByLabelText(/Số thu · Giao nhận/)).toHaveValue(100000);
    fireEvent.click(screen.getByRole('button', { name: 'Ghi phiếu' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ direction: 'IN', treasuryAccountId: 5, entries: [{ sourceKind: 'OPS', sourceId: 1, expectedVersion: 2, amount: 100000 }] });
    expect(create.mock.calls[0][1]).toBe(create.mock.calls[1][1]);
  });
  it('does not guess an unclassified account fund and links directly to setup', async () => {
    show([{ id: 5, name: 'ACB công ty', fundCode: null }]);
    await select('Nguồn quỹ', 'Quỹ công ty');
    expect(screen.getByRole('status')).toHaveTextContent('Cần cấu hình');
    expect(screen.getByRole('link', { name: 'Mở Sổ quỹ / ngân hàng' })).toHaveAttribute('href', '/finance/treasury');
    fireEvent.click(screen.getByRole('button', { name: /Tài khoản$/ }));
    expect(screen.queryByRole('option', { name: 'ACB công ty' })).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects an amount above the outstanding receivable while keeping its draft', () => {
    show(); fireEvent.change(screen.getByLabelText(/Số thu · Giao nhận/), { target: { value: '400000' } });
    expect(screen.getByRole('button', { name: 'Ghi phiếu' })).toBeDisabled();
    expect(screen.getByLabelText(/Số thu · Giao nhận/)).toHaveValue(400000);
    expect(create).not.toHaveBeenCalled();
  });
});
