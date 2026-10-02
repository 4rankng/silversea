import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const fundAdvance = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { fundAdvance } }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseCashDrawer } from './ExpenseCashDrawer';
const catalog = { staff: [], accounts: [{ id: 3, name: 'Quỹ test', fundCode: 'COMPANY' as const }], accountants: [], opsUsers: [{ id: 7, name: 'OPS Test' }], advances: [], suppliers: [], expenseTypes: [], pendingAdvances: [{ id: 12, opsUserId: 7, amount: 1000000, reason: 'Ứng phí cảng', date: '2026-09-17', name: 'OPS Test' }] };
beforeEach(() => { fundAdvance.mockReset().mockResolvedValue({ id: 12 }); });
// Measured, not guessed: this case drives six combobox opens plus a
// reject→retry cycle, and it exceeds the 5000ms default on its own (5.1s when
// this file runs alone, at HEAD, with no other suite in flight). It is volume of
// interaction, not a hang — the sibling case in this file, which drives half as
// many controls, still finishes inside the default. Same treatment the repo
// already gave its other measured-slow dialog tests (20260928_196 / a7adc2dd).
it('funds the selected existing request and retries with the same command key after a lost response', { timeout: 15000 }, async () => {
  fundAdvance.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce({ id: 12 });
  const onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ExpenseCashDrawer catalog={catalog} onClose={onClose} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Nhân viên OPS/ })); fireEvent.click(await screen.findByRole('option', { name: 'OPS Test' }));
  fireEvent.click(screen.getByRole('button', { name: /Yêu cầu ứng/ })); fireEvent.click(await screen.findByRole('option', { name: /Ứng phí cảng/ }));
  expect(screen.getByLabelText(/Tiền tạm ứng/)).toBeDisabled(); expect(screen.getByLabelText(/Tiền tạm ứng/)).toHaveValue(1000000);
  fireEvent.click(screen.getByRole('button', { name: /Nguồn quỹ/ })); fireEvent.click(await screen.findByRole('option', { name: 'Quỹ công ty' }));
  fireEvent.click(screen.getByRole('button', { name: /Tài khoản/ })); fireEvent.click(await screen.findByRole('option', { name: 'Quỹ test' }));
  fireEvent.change(screen.getByLabelText(/Mã tham chiếu/), { target: { value: 'BANK-12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ghi chi tạm ứng' }));
  await screen.findByText('Mất phản hồi'); expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ghi chi tạm ứng' }));
  await waitFor(() => expect(fundAdvance).toHaveBeenCalledTimes(2));
  expect(fundAdvance.mock.calls[0][0]).toMatchObject({ advanceRequestId: 12, opsUserId: 7, amount: 1000000, reason: 'Ứng phí cảng', treasuryAccountId: 3, physicalReference: 'BANK-12' });
  expect(fundAdvance.mock.calls[1][1]).toBe(fundAdvance.mock.calls[0][1]);
});
it('labels pending advance requests with business keys, never the request id', async () => {
  render(<QueryClientProvider client={new QueryClient()}><ExpenseCashDrawer catalog={catalog} onClose={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Nhân viên OPS/ })); fireEvent.click(await screen.findByRole('option', { name: 'OPS Test' }));
  fireEvent.click(screen.getByRole('button', { name: /Yêu cầu ứng/ }));
  const option = await screen.findByRole('option', { name: /Ứng phí cảng · 2026-09-17 · 1\.000\.000 ₫/ });
  expect(option.textContent).not.toMatch(/#\d/);
});
