// SIL-1075 (K10.29) — /accounting/chot-debit, lô FCL 2 container (QA repro
// lô 1221 QBDP-2511-01): trước fix CẢ HAI dòng container đều mang trọn tổng
// lô 4.458.714₫ (cộng 2 dòng = gấp đôi tổng lô) và đầu bảng ghi
// 'Lô trong kỳ: 1' / 'Hiển thị 1–1 trên 1' trong khi bảng render 2 dòng.
// Pin hai mặt của fix:
//  - tổng tiền của lô xuất hiện MỘT LẦN — trên dòng đầu (head); dòng
//    continuation không lặp lại tổng lô (wire: containerMoney[1] rỗng);
//  - bộ đếm phân trang đếm DÒNG render (1–2 trên 2), khớp số dòng hiển thị;
//    'Lô trong kỳ' giữ nguyên là số LÔ.
import { render, screen, within } from '@testing-library/react';
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

const CONT_HEAD = 901;
const CONT_TAIL = 902;
const HEAD_MONEY = {
  thu: { cuocThu: '3952000', lachHuyen: null, phuPs: '506714', phatSinhCus: null, tongThu: '4458714' },
  tra: { cuocTraDv: '2000', lachHuyenDv: null, phatSinhDv: null, tong1: '2000', phiRu: null },
  loiNhuan: '4456714',
};
const BLANK_MONEY = {
  thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null },
  tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, tong1: null, phiRu: null },
  loiNhuan: null,
};

const row = (): AccountingDebitBoardRow => ({
  shipmentId: 1221,
  code: 'SHP-26-1221',
  customerName: 'Long Minh',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-24',
  billOrBooking: 'QBDP-2511-01',
  containers: ['QBDP2511004 · 20DC', 'QBDP2511010 · 20DC'],
  containersDetail: [
    { id: CONT_HEAD, container: 'QBDP2511004 · 20DC', carriers: [], plates: [], declarationNumber: null },
    { id: CONT_TAIL, container: 'QBDP2511010 · 20DC', carriers: [], plates: [], declarationNumber: null },
  ],
  phanXe: ['Nhà xe A'],
  lcl: null,
  thu: HEAD_MONEY.thu,
  tra: HEAD_MONEY.tra,
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: HEAD_MONEY.loiNhuan,
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  containerMoney: [
    { containerId: CONT_HEAD, ...HEAD_MONEY },
    { containerId: CONT_TAIL, ...BLANK_MONEY },
  ],
});

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

const boardRows = () => [...document.querySelectorAll('table.debit-board tbody tr')] as HTMLElement[];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // React Aria measures the size trigger during render; jsdom reports zeros.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200, width: 280, height: 34 }));
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('SIL-1075 — tổng lô một lần + bộ đếm dòng khớp bảng', () => {
  it('2 dòng container: tổng 4.458.714₫ chỉ nằm trên dòng đầu, dòng continuation trống', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('QBDP2511004 · 20DC');
    const [head, tail] = boardRows();
    expect(boardRows()).toHaveLength(2);
    expect(within(head).getAllByText('4.458.714 ₫').length).toBeGreaterThan(0);
    expect(within(tail).queryAllByText('4.458.714 ₫')).toHaveLength(0);
    expect(within(tail).queryAllByText('3.952.000 ₫')).toHaveLength(0);
    expect(within(tail).queryAllByText('4.456.714 ₫')).toHaveLength(0);
  });

  it("bộ đếm phân trang đếm dòng render: 'Hiển thị 1–2 trên 2' (không còn 1–1 trên 1)", async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('QBDP2511004 · 20DC');
    const summary = document.querySelector('.ds-pagination__summary');
    expect(summary?.textContent).toBe('Hiển thị 1–2 trên 2');
    // 'Lô trong kỳ' stays the LOT count.
    expect(screen.getByText('Lô trong kỳ')).toBeTruthy();
  });
});
