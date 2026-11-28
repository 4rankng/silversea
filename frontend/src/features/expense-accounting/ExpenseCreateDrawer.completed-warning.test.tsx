// SIL-1246 (KB §1.1.4) — "Khai chi phí trên lô đã hoàn thành không có cảnh báo
// nào": mở drawer 'Thêm khoản chi' trên lô đã hoàn thành phải có cảnh báo để
// kế toán đối soát (lưu KHÔNG bị chặn — số liệu đã quyết toán giữ nguyên, phần
// điều chỉnh ghi nhận có kiểm soát); lô chưa hoàn thành thì không có banner.
import { render, screen } from '@testing-library/react';
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

const work = { tripId: null, shipmentId: 1600, shipmentCode: 'P2-K235', containerNumber: null };
const catalog: ExpenseAccountingCatalog = {
  staff: [{ id: 16, name: 'Kế toán' }], accounts: [], accountants: [], opsUsers: [],
  advances: [], suppliers: [{ id: 3, name: 'Nhà xe A' }], carriers: [], expenseTypes: [],
};

function renderDrawer(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  createBatch.mockReset().mockResolvedValue({ items: [] });
  confirmEntries.mockReset().mockResolvedValue([]);
  tienDuong.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, rows: [], totals: { total: 0, confirmed: 0 } });
  chiHo.mockReset().mockResolvedValue({ tripId: 10, tripCode: null, shipmentId: 42, ngayLayPhoi: null, trangThaiLay: null, rows: [], totals: { thu: 0, tra: 0 } });
});

it('lô đã hoàn thành: banner cảnh báo đối soát hiện ngay khi mở drawer, lưu vẫn được phép', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} completed onClose={vi.fn()} />);
  const banner = screen.getByRole('alert');
  expect(banner).toHaveTextContent('Lô hàng đã hoàn thành');
  expect(banner).toHaveTextContent('cần đối soát với kế toán');
  expect(banner).toHaveTextContent('Số liệu đã quyết toán giữ nguyên');
  expect(screen.getByRole('button', { name: /Lưu 1 khoản chi/ })).toBeEnabled();
});

it('lô chưa hoàn thành: không có banner cảnh báo', () => {
  renderDrawer(<ExpenseCreateDrawer work={work} catalog={catalog} onClose={vi.fn()} />);
  expect(screen.queryByText(/Lô hàng đã hoàn thành/)).not.toBeInTheDocument();
});
