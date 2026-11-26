// SIL-1075 (K10.29) — /accounting/chot-debit, lô FCL 2 container (QA repro
// lô 1221 QBDP-2511-01, 2 container QBDP2511004 / QBDP2511010): trước fix màn
// tách MỖI container một dòng và CẢ HAI dòng mang trọn tổng lô 4.458.714₫
// (cộng 2 dòng = gấp đôi tổng lô), đầu bảng ghi 'Lô trong kỳ: 1' trong khi
// bảng render 2 dòng.
// RULING Frank 26/11 (comment 8499) — "follow KB": KB Ch.10 §10.6.1 'Mỗi lô
// một dòng' thắng trên Kế hoạch điều động tổng hợp (the CR-009.1 / SIL-864
// container-split is retired on THIS screen) → MỘT dòng cho một lô.
// Pin:
//  - lô 2 container render ĐÚNG MỘT dòng; tổng tiền chỉ xuất hiện MỘT lần;
//  - cả hai container hiện trong ô Hàng hóa & Cont của dòng đó; mobile 1 thẻ;
//  - bộ đếm khớp bảng: 'Hiển thị 1–1 trên 1';
//  - sửa ô tiền GHIỀU cấp LÔ (containerId null trên wire).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, getBootstrap, setRates } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  getBootstrap: vi.fn(),
  setRates: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: setRates,
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

const row = (): AccountingDebitBoardRow => ({
  shipmentId: 1221,
  code: 'SHP-26-1221',
  customerName: 'Long Minh',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-24',
  billOrBooking: 'QBDP-2511-01',
  containers: ['QBDP2511004 · 20DC', 'QBDP2511010 · 20DC'],
  phanXe: ['Nhà xe A'],
  lcl: null,
  thu: { cuocThu: '3952000', lachHuyen: null, phuPs: '506714', phatSinhCus: null, tongThu: '4458714' },
  tra: { cuocTraDv: '2000', lachHuyenDv: null, phatSinhDv: null, tong1: '2000', phiRu: null },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '4456714',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
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
const originalMatchMedia = window.matchMedia;
/** jsdom has no matchMedia — the phone-card list mounts only under 640px. */
const phoneMedia = () => {
  window.matchMedia = (media): MediaQueryList => ({
    media, matches: media === '(max-width: 640px)', onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // React Aria measures the size trigger during render; jsdom reports zeros.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200, width: 280, height: 34 }));
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
  listBoard.mockResolvedValue({ items: [row()], total: 1 });
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('SIL-1075 — một lô MỘT dòng (KB Ch.10 §10.6.1, ruling comment 8499)', () => {
  it('lô 2 container: đúng MỘT dòng, tổng 4.458.714₫ xuất hiện MỘT lần, cả hai cont trên dòng đó', async () => {
    renderPage();
    await screen.findByText('QBDP2511004 · 20DC');
    expect(boardRows()).toHaveLength(1);
    const lotRow = boardRows()[0]!;
    expect(within(lotRow).getByText('QBDP2511010 · 20DC')).toBeTruthy();
    // The lot's money face renders ONCE in the table — the old per-container
    // rows summed to 8.917.428₫, double the lot total. Rollups are text;
    // the unlocked editable cells carry their money as input placeholders.
    expect(within(lotRow).getAllByText('4.458.714 ₫')).toHaveLength(1);
    expect(within(lotRow).getByPlaceholderText('3.952.000 ₫')).toBeTruthy();
    expect(within(lotRow).getByPlaceholderText('506.714 ₫')).toBeTruthy();
    expect(within(lotRow).getAllByText('4.456.714 ₫')).toHaveLength(1);
  });

  it("'Hiển thị 1–1 trên 1' khớp số dòng bảng; 'Lô trong kỳ' = 1", async () => {
    renderPage();
    await screen.findByText('QBDP2511004 · 20DC');
    expect(boardRows()).toHaveLength(1);
    expect(document.querySelector('.ds-pagination__summary')?.textContent).toBe('Hiển thị 1–1 trên 1');
    const lotStrip = screen.getByText('Lô trong kỳ').parentElement ?? document.body;
    expect(lotStrip.textContent).toContain('Lô trong kỳ');
    expect(lotStrip.textContent).toContain('1');
  });

  it('mobile 390px: MỘT thẻ cho cả lô — tiền không nhân đôi', async () => {
    phoneMedia();
    renderPage();
    const cards = await screen.findAllByRole('article', { name: 'QBDP-2511-01' });
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getAllByText('4.458.714 ₫').length).toBeGreaterThan(0);
  });

  it('sửa ô tiền trên dòng GHIỀU cấp LÔ — containerId null trên wire', async () => {
    setRates.mockResolvedValue({ shipmentId: 1221, containerId: null, rates: { cuocThu: 5000000 } });
    renderPage();
    await screen.findByText('QBDP2511004 · 20DC');
    const input = within(boardRows()[0]!).getByPlaceholderText('3.952.000 ₫') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setRates).toHaveBeenCalledTimes(1));
    expect(setRates).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: 1221, containerId: null, rates: { cuocThu: 5000000 } }),
      expect.anything(), // the mutation context (useMutation's second arg)
    );
  });
});
