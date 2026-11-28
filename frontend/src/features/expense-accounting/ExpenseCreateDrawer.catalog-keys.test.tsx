// SIL-1242 — Chứng từ (Role.CUS) bấm 'Khai chi phí' thì cả trang sập
// "can't access property \"map\" of undefined": catalog trả về theo vai từng
// thời điểm (payload role-scoped / deploy skew) có thể thiếu các khóa
// staff/suppliers/opsUsers mà dòng khai chi map qua .map/.find. Drawer phải mở
// được với catalog thiếu khóa — ô chọn người chi / nhà cung cấp vẫn render
// (danh sách rỗng), không sập trang.
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';

const createBatch = vi.hoisted(() => vi.fn());
const confirmEntries = vi.hoisted(() => vi.fn());
const tienDuong = vi.hoisted(() => vi.fn());
const chiHo = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { createBatch, confirm: confirmEntries } }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuTienDuong: tienDuong, getPhoiPhieuChiHo: chiHo }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseCreateDrawer } from './ExpenseCreateDrawer';

const work = { tripId: null, shipmentId: 42, shipmentCode: 'LG28-C35-LCL1', containerNumber: null };
// Payload đời cũ của /catalog theo vai: thiếu staff/suppliers (và có thể thiếu
// opsUsers) — chính dạng payload đã sập trang với vai Chứng từ.
const keylessCatalog = { accounts: [], accountants: [], opsUsers: [], advances: [], carriers: [], expenseTypes: [] } as unknown as ExpenseAccountingCatalog;

function renderDrawer(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  createBatch.mockReset().mockResolvedValue({ items: [] });
  confirmEntries.mockReset().mockResolvedValue([]);
  tienDuong.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, rows: [], totals: { total: 0, confirmed: 0 } });
  chiHo.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, shipmentId: 42, ngayLayPhoi: null, trangThaiLay: null, rows: [], totals: { thu: 0, tra: 0 } });
});

it('catalog thiếu staff/suppliers — drawer vẫn mở, đủ ô nhập, không sập trang', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={keylessCatalog} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Bên thực chi/ })).toHaveTextContent('Công ty trả trực tiếp');
  expect(screen.getByRole('button', { name: /Người chi/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Nhà cung cấp/ })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Loại chi phí lái xe/ })).toBeInTheDocument();
});

it('matchCarrierSupplier với catalog thiếu suppliers: chọn Nhà cung cấp không sập, hint chọn thủ công', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={keylessCatalog} carrier={{ supplierId: 3, name: 'Nhà xe A' }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Bên thực chi/ }));
  fireEvent.click(screen.getByRole('option', { name: /Nhà cung cấp/ }));
  expect(screen.getByText('Chưa có nhà xe trên tuyến này — chọn thủ công.')).toBeInTheDocument();
});
