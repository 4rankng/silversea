import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const update = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
vi.mock('../../api/customerServiceFinanceClient', () => ({ customerServiceFinanceClient: { updateTreasuryAccountFund: update, createTreasuryAccount: create } }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { TreasuryAccountDrawer } from './TreasuryAccountDrawer';
import type { TreasuryPosition } from '../../api/customerServiceFinanceClient';
async function select(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}`) }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
describe('treasury account empty submit', () => {
  it('routes empty submit through the app inline error, native validation disabled', async () => {
    render(<TreasuryAccountDrawer onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản' }));
    // The app's own red inline notice renders; the browser's native bubble is
    // suppressed because the form opts out of constraint validation.
    expect(await screen.findByRole('alert')).toHaveTextContent('Chọn nguồn quỹ và điền đầy đủ thông tin hợp lệ');
    expect(document.querySelector('form.treasury-account-form')).toHaveAttribute('novalidate');
  });
});

describe('treasury account fund setup', () => {
  it('requires explicit legacy classification, keeps version and retries unknown response with the same key', async () => {
    update.mockReset().mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce({ id: 8 });
    const saved = vi.fn();
    const account = { accountId: 8, name: 'ACB công ty', fundCode: null, version: 3 } as TreasuryPosition['accounts'][number];
    render(<TreasuryAccountDrawer account={account} onClose={vi.fn()} onSaved={saved} />);
    expect(screen.getByRole('button', { name: /Nguồn quỹ/ })).toHaveTextContent('Chọn nguồn quỹ');
    await select('Nguồn quỹ', 'Quỹ TM');
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: 'Xác nhận chủ quỹ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản' }));
    await screen.findByText('Mất phản hồi');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0]).toBe(8);
    expect(update.mock.calls[0][1]).toEqual({ expectedVersion: 3, fundCode: 'TM', reason: 'Xác nhận chủ quỹ' });
    expect(update.mock.calls[0][2]).toBe(update.mock.calls[1][2]);
    expect(screen.queryByLabelText(/Số dư đầu kỳ/)).not.toBeInTheDocument();
  });
  it('creates a bank account with the explicitly selected TM fund', async () => {
    create.mockReset().mockResolvedValue({ id: 9 }); const saved = vi.fn();
    render(<TreasuryAccountDrawer onClose={vi.fn()} onSaved={saved} />);
    await select('Nguồn quỹ', 'Quỹ TM');
    for (const [label, value] of [['Mã tài khoản', 'TM-ACB'], ['Tên tài khoản', 'TM ACB'], ['Chứng từ số dư đầu kỳ', 'Sao kê'], ['Lý do', 'Thiết lập']]) fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({ type: 'BANK', fundCode: 'TM', code: 'TM-ACB', openingBalance: 0 });
  });
});
