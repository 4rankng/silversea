// SIL-1240 (K5.34 — KB Ch.5 §5.4.5) — every money field in the "Thêm khoản
// chi" drawer opens at the 1.000.000 default. QA 28/11 measured both fields
// ("Thực chi (VND)" and "Thực thu — thu khách (VND)") showing the "0"
// placeholder with an empty value; the law says the default is 1,000,000.
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const createBatch = vi.hoisted(() => vi.fn());
const confirmEntries = vi.hoisted(() => vi.fn());
const tienDuong = vi.hoisted(() => vi.fn());
const chiHo = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { createBatch, confirm: confirmEntries } }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuTienDuong: tienDuong, getPhoiPhieuChiHo: chiHo }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseCreateDrawer } from './ExpenseCreateDrawer';

const work = { tripId: 10, shipmentId: 42, shipmentCode: 'BL7', containerNumber: 'CONT7' };
const catalog = { staff: [{ id: 16, name: 'Driver' }], accounts: [], accountants: [], opsUsers: [{ id: 15, name: 'Assigned OPS' }], advances: [], suppliers: [{ id: 3, name: 'Nhà xe A' }], carriers: [], expenseTypes: [] };
const renderDrawer = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  createBatch.mockReset().mockResolvedValue({});
  confirmEntries.mockReset().mockResolvedValue([]);
  tienDuong.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, rows: [], totals: { total: 0, confirmed: 0 } });
  chiHo.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, shipmentId: 42, ngayLayPhoi: null, trangThaiLay: null, rows: [], totals: { thu: 0, tra: 0 } });
});

it('SIL-1240 (K5.34): Thực chi and Thực thu open at 1.000.000 — never a value-empty "0"', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} onSaved={vi.fn()} />);
  // The default group (Chi phí lô hàng) owns both money fields of the QA repro.
  expect(screen.getByLabelText(/Thực chi/)).toHaveValue('1.000.000');
  expect(screen.getByLabelText(/Thực thu/)).toHaveValue('1.000.000');
});

it('SIL-1240 (K5.34): a row saved without touching the money fields ships the default 1.000.000 pair', async () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} onSaved={vi.fn()} />);
  // The only edits the row needs: the fee pick. Amount/charge ride the
  // untouched K5.34 default straight through the shared create schema.
  fireEvent.click(screen.getByRole('combobox', { name: /Loại chi phí lái xe/ }));
  fireEvent.click((await screen.findAllByRole('option', { name: /^(?!Chọn)/ }))[0]);
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));

  await vi.waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
  const item = createBatch.mock.calls[0][0].items[0];
  expect([1_000_000, '1000000']).toContain(item.amount);
  expect([1_000_000, '1000000']).toContain(item.customerChargeAmount);
});
