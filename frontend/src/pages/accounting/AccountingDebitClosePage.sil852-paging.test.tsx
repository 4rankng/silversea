// SIL-852 — phân trang bảng Kiểm soát lô hàng (/accounting/chot-debit):
// hàng trăm dòng trong kỳ KHÔNG còn render một trang ~6000px. Pin:
//  - C2: 25 lô → trang 1 đúng 20 dòng; thanh điều hướng + [20, 50] dòng/trang;
//    [Trang sau] → 5 dòng còn lại; chọn 50 → trọn 25 dòng một trang;
//  - C4: chỉ mục trang clamp theo số trang còn lại (safePage law của
//    DebitMergeGrid): bộ lọc rút gọn bảng khi đang ở trang sau → dòng khớp
//    vẫn thấy, không bảng trống.
// Sidebar (C1) được pin bởi Layout.test.ts / routes.test.ts; /shipments-debit
// (C3) được pin bởi DebitMergeGrid.test.tsx ("paginates client-side").
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, getBootstrap } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
  reconcileAndHideDebitLots: vi.fn(),
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

const row = (index: number): AccountingDebitBoardRow => ({
  shipmentId: index,
  code: `SHP-26-${String(index).padStart(4, '0')}`,
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-09',
  billOrBooking: `BL-${index}`,
  containers: [`ABCZ12345${String(index).padStart(2, '0')} · 40HC`],
  phanXe: ['Nhà xe A'],
  lcl: null,
  thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1310000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
});

/** The settled board's desktop table (one tr per single-container lot). */
const boardRows = () => document.querySelectorAll('table.debit-board tbody tr');

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // React Aria measures the size trigger during render; jsdom reports zeros.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200, width: 280, height: 34 }));
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('SIL-852 — phân trang bảng Kiểm soát lô hàng (/accounting/chot-debit)', () => {
  it('C2: 25 lô trong kỳ → trang 1 đúng 20 dòng, [20, 50] dòng/trang', async () => {
    listBoard.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => row(i + 1)), total: 25 });
    renderPage();
    await waitFor(() => expect(boardRows()).toHaveLength(20));
    // The rows-per-page choices are exactly the ticket's [20, 50].
    fireEvent.click(screen.getByRole('button', { name: '20 Số dòng mỗi trang' }));
    expect(screen.getByRole('option', { name: '20' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '50' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '100' })).toBeNull();
  });

  it('C2: [Trang sau] → 5 dòng còn lại, tóm tắt 21–25 trên 25', async () => {
    listBoard.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => row(i + 1)), total: 25 });
    renderPage();
    await waitFor(() => expect(boardRows()).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(boardRows()).toHaveLength(5));
    expect(screen.getByText('21–25')).toBeTruthy();
  });

  it('C2: chọn 50 dòng/trang → trọn 25 lô nằm một trang', async () => {
    listBoard.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => row(i + 1)), total: 25 });
    renderPage();
    await waitFor(() => expect(boardRows()).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: '20 Số dòng mỗi trang' }));
    fireEvent.click(screen.getByRole('option', { name: '50' }));
    await waitFor(() => expect(boardRows()).toHaveLength(25));
    expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  });

  it('C4: lọc rút gọn bảng khi đang ở trang 2 → dòng khớp vẫn thấy, không bảng trống', async () => {
    listBoard.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => row(i + 1)), total: 25 });
    renderPage();
    await waitFor(() => expect(boardRows()).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(boardRows()).toHaveLength(5));
    // Search narrows the board to ONE lot — the open page must clamp to the
    // page that still exists and show that lot, not an empty table.
    fireEvent.change(screen.getByLabelText('Tìm lô hàng'), { target: { value: 'SHP-26-0025' } });
    await waitFor(() => expect(boardRows()).toHaveLength(1));
    expect(boardRows()[0]!.textContent).toContain('BL-25');
  });
});
