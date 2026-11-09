// SIL-772 — bảng chốt Debit đổi tên 'KIỂM SOÁT LÔ HÀNG' và có 2 chế độ xem
// chuyển đổi: Vận tải Hàng Cont (FCL) / Vận tải Hàng Lẻ (LCL). Mỗi chế độ
// hiện đúng dữ liệu của loại hàng đó; dữ liệu chưa phân loại (lcl null) ở
// lại FCL để không lô cũ nào mất khỏi bảng. (Nav move + label source-of-truth
// pins live in Layout.test.ts / routes.test.ts / page-heading-law.test.ts.)
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, getBootstrap } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: vi.fn(),
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
}));
vi.mock('../../api/dispatchPlanningClient', () => ({
  updateLclTruck: vi.fn(),
  mergeLclRevGroup: vi.fn(),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import { ToastProvider } from '../../components/shared/Toast';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <ToastProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AccountingDebitClosePage />
        </QueryClientProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-09',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' },
  chiPhiNgoai: null,
  loiNhuan: '1310000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

const lclBit = {
  label: 'Lẻ · Thu: 5T / Trả: 10T',
  actualTruckNo: '29H-123.45',
  billingTruckNo: null,
  revGroupId: null,
  costGroupId: null,
  ghépCùngRef: null,
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listBoard.mockResolvedValue({
    items: [
      row(),
      row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', customerName: 'KH Lẻ', containers: [], lcl: lclBit }),
    ],
    total: 2,
  });
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});

describe('AccountingDebitClosePage — SIL-772 KIỂM SOÁT LÔ HÀNG + 2 chế độ xem', () => {
  it('H1 là nhãn khách yêu cầu nguyên văn (viết hoa)', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'KIỂM SOÁT LÔ HÀNG' })).toBeInTheDocument();
  });

  it('mở mặc định chế độ FCL: chỉ hàng cont, nút LCL đếm đúng 1 lô lẻ', async () => {
    renderPage();
    await screen.findByText('BL-1');
    expect(screen.queryByText('BL-2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vận tải Hàng Cont (FCL) · 1 lô' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Vận tải Hàng Lẻ (LCL) · 1 lô' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('chuyển sang LCL hiện đúng hàng lẻ và ẩn hàng cont', async () => {
    renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Vận tải Hàng Lẻ (LCL) · 1 lô' }));
    expect(await screen.findByText('BL-2')).toBeInTheDocument();
    expect(screen.queryByText('BL-1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vận tải Hàng Lẻ (LCL) · 1 lô' })).toHaveAttribute('aria-pressed', 'true');
    // …và chuyển lại được (toggle hai chiều).
    fireEvent.click(screen.getByRole('button', { name: 'Vận tải Hàng Cont (FCL) · 1 lô' }));
    expect(await screen.findByText('BL-1')).toBeInTheDocument();
    expect(screen.queryByText('BL-2')).not.toBeInTheDocument();
  });
});
