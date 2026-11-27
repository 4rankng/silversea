// SIL-1105 (K2.161) — the "Thêm khoản chi" drawer on Chi tiết lô hàng: with
// the machine offline, the save fetch rejects with the browser's engine
// English ('NetworkError when attempting to fetch resource.'), and the QA
// repro showed that raw banner on top of the drawer. The save catch routes
// through the site's single mapping (actionErrorMessage — the SIL-1035 law),
// so a fetch/network TypeError becomes the one Vietnamese offline sentence,
// the drafts stay in place (nothing is wiped on failure), and a REAL server
// refusal (SIL-1101's invoice-conflict 400) keeps its verbatim message.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api/errors';
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

async function fillRow(row: number, amount: string, charge = '0') {
  fireEvent.click(screen.getAllByRole('combobox', { name: /Loại chi phí lái xe/ })[row]);
  fireEvent.click((await screen.findAllByRole('option', { name: /^(?!Chọn)/ }))[0]);
  fireEvent.change(screen.getAllByLabelText(/Thực chi/)[row], { target: { value: amount } });
  fireEvent.change(screen.getAllByLabelText(/Thực thu/)[row], { target: { value: charge } });
}

beforeEach(() => {
  createBatch.mockReset().mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.'));
  confirmEntries.mockReset().mockResolvedValue([]);
  tienDuong.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, rows: [], totals: { total: 0, confirmed: 0 } });
  chiHo.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, shipmentId: 42, ngayLayPhoi: null, trangThaiLay: null, rows: [], totals: { thu: 0, tra: 0 } });
});

it('SIL-1105: offline save says it did NOT save, keeps the drafts, never the raw English', async () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} onSaved={vi.fn()} />);
  await fillRow(0, '120000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));

  const alert = await screen.findByRole('alert');
  // KB §2.5.1 K2.161 — the message must SAY the content was not saved and when
  // to retry, in Vietnamese.
  expect(alert).toHaveTextContent('Mất kết nối, chưa lưu được.');
  expect(alert).toHaveTextContent('thử lại khi có mạng');
  expect(alert.textContent).not.toContain('NetworkError when attempting to fetch resource.');
  // Content must remain — the failed save leaves the row's controls AND their
  // values in place (the catch never touches the drafts), ready to retry.
  expect(screen.getAllByLabelText(/Thực chi/)[0]).toBeEnabled();
  expect(screen.getAllByLabelText(/Thực chi/)[0]).toHaveValue('120.000');
});

it('SIL-1105: Chrome\'s "Failed to fetch" maps to the same Vietnamese sentence', async () => {
  createBatch.mockRejectedValue(new TypeError('Failed to fetch'));
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} onSaved={vi.fn()} />);
  await fillRow(0, '120000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));

  await waitFor(() => expect(screen.getByRole('alert'))
    .toHaveTextContent('Mất kết nối, chưa lưu được. Giữ nguyên nội dung và thử lại khi có mạng.'));
});

it('SIL-1101 companion: a server invoice-conflict 400 keeps its verbatim inline message', async () => {
  createBatch.mockRejectedValue(new ApiError(
    400,
    { code: 'EXPENSE_INVOICE_NUMBER_CONFLICT' },
    'Số hóa đơn QA-R2F2-119 đã tồn tại trên lô LOT-548, chuyến TC-151.',
  ));
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} onSaved={vi.fn()} />);
  await fillRow(0, '120000');
  fireEvent.click(screen.getByRole('button', { name: /Lưu 1 khoản chi/ }));

  await waitFor(() => expect(screen.getByRole('alert'))
    .toHaveTextContent('Số hóa đơn QA-R2F2-119 đã tồn tại trên lô LOT-548, chuyến TC-151.'));
});
