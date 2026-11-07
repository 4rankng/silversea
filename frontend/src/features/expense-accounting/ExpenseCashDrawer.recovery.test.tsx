// SIL-728 — Xác nhận hoàn ứng staff-level: the shared money drawer's third
// mode. The recovery target pre-fills the deficit and locks the person; the
// POST rides the Idempotency-Key envelope exactly like the sibling flows (đợt
// refund / funded advance), so a lost response retries with the SAME command
// key instead of booking the collection twice.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { advanceRecovery } = vi.hoisted(() => ({ advanceRecovery: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { advanceRecovery } }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseCashDrawer } from './ExpenseCashDrawer';

const catalog = { staff: [], accounts: [{ id: 3, name: 'Quỹ test', fundCode: 'COMPANY' as const }], accountants: [], opsUsers: [{ id: 7, name: 'OPS Test' }], advances: [], suppliers: [], carriers: [], expenseTypes: [], pendingAdvances: [] };
const recovery = { opsUserId: 7, staffName: 'Nguyễn Huy Hoàng', deficit: 420000 };

beforeEach(() => {
  advanceRecovery.mockReset().mockResolvedValue({ id: 91 });
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('1b2e3c4d-5f6a-4b7c-8d9e-0f1a2b3c4d5e');
});

it('pre-fills the deficit, books the recovery with the idempotency key, and retries with the same key', { timeout: 15000 }, async () => {
  advanceRecovery.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce({ id: 91 });
  const onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ExpenseCashDrawer catalog={catalog} recovery={recovery} onClose={onClose} /></QueryClientProvider>);

  // The person is locked and the deficit is pre-filled — the sheet opens ready.
  expect(screen.getByText('Nguyễn Huy Hoàng')).toBeTruthy();
  expect(screen.getByText('Số dư ứng âm đang nắm:')).toBeTruthy();
  expect(screen.getByText('420.000 ₫')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Nhân viên OPS/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Nguồn quỹ/ })); fireEvent.click(await screen.findByRole('option', { name: 'Quỹ công ty' }));
  fireEvent.click(screen.getByRole('button', { name: /Tài khoản/ })); fireEvent.click(await screen.findByRole('option', { name: 'Quỹ test' }));
  fireEvent.change(screen.getByLabelText(/Mã tham chiếu/), { target: { value: 'BIEN-NHAN-77' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ghi thu hoàn ứng' }));
  await screen.findByText('Mất phản hồi');
  expect(onClose).not.toHaveBeenCalled();
  // Same payload, same key — the retry is a replay, not a second booking.
  fireEvent.click(screen.getByRole('button', { name: 'Ghi thu hoàn ứng' }));
  await waitFor(() => expect(advanceRecovery).toHaveBeenCalledTimes(2));
  expect(advanceRecovery.mock.calls[0][0]).toMatchObject({ opsUserId: 7, amount: 420000, treasuryAccountId: 3, physicalReference: 'BIEN-NHAN-77' });
  expect(advanceRecovery.mock.calls[1][1]).toBe(advanceRecovery.mock.calls[0][1]);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('never offers an over-collection: an amount above the deficit is refused client-side', { timeout: 15000 }, async () => {
  render(<QueryClientProvider client={new QueryClient()}><ExpenseCashDrawer catalog={catalog} recovery={recovery} onClose={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Nguồn quỹ/ })); fireEvent.click(await screen.findByRole('option', { name: 'Quỹ công ty' }));
  fireEvent.click(screen.getByRole('button', { name: /Tài khoản/ })); fireEvent.click(await screen.findByRole('option', { name: 'Quỹ test' }));
  fireEvent.change(screen.getByLabelText(/Mã tham chiếu/), { target: { value: 'BIEN-NHAN-77' } });
  fireEvent.change(screen.getByLabelText(/Tiền hoàn ứng/), { target: { value: '430000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ghi thu hoàn ứng' }));
  expect(await screen.findByText('Tiền thu hồi vượt số dư ứng âm nhân viên đang nắm.')).toBeTruthy();
  expect(advanceRecovery).not.toHaveBeenCalled();
});
