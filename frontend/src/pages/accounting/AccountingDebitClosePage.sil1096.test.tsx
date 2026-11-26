// SIL-1096 (KB §3.1.3, K3.5; trùng K2.69) — the chot-debit readiness answer
// to "còn thiếu gì": the four conditions (hàng hóa · giá · chứng từ · điều
// kiện kỳ) with per-condition reason + cách bổ sung, ticked when met. The old
// "Thiếu chi phí" dot is now the popover TRIGGER on EVERY row (one concept,
// one place — the dot's silence was the QA complaint). Preserved live laws:
// SIL-838 (missing money cell renders EMPTY, never prose) and SIL-772 (nine
// Rev2 groups, no visibility picker).
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentDocumentSetStatus } from '@tingting/shared';

const { listBoard, confirmReq, withdrawReq, listRounds, createRound, getShipmentDetail } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  confirmReq: vi.fn(),
  withdrawReq: vi.fn(),
  listRounds: vi.fn(),
  createRound: vi.fn(),
  getShipmentDetail: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: confirmReq,
  withdrawRateAdjustments: withdrawReq,
  listSettlementRounds: listRounds,
  createSettlementRound: createRound,
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
  reconcileAndHideDebitLots: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

vi.mock('../../api/shipmentClient', () => ({ getShipmentDetail }));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { ShipmentDetail } from '../../api/shipmentClient';

const RATES = {
  cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000',
};
const CARRIER_RATES = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-09-25',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { ...RATES },
  tra: { ...CARRIER_RATES },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

const detail = (over: Partial<ShipmentDetail> = {}): ShipmentDetail => ({
  shipment: {} as ShipmentDetail['shipment'],
  containers: [],
  documents: [],
  declarations: [],
  statusHistory: [],
  pendingChangeRequests: [],
  podReviews: [],
  carrierAssignments: [],
  hasLiveTrips: false,
  accountingLock: null,
  costLock: null,
  documentSet: {
    status: ShipmentDocumentSetStatus.COMPLETE, label: 'Đã đủ', missingDocuments: [],
    receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
  },
  freightRate: {
    latest: {
      id: 1, shipmentId: 1, tripId: null, source: 'AUTO', freightAmount: 1, surchargeAmount: 0,
      totalAmount: 1, billedKm: 1, liters: 1, fuelDelta: 0, sharePct: 0, formula: '',
      computedAt: '2026-11-25T00:00:00Z', rateTermsId: 7, pricingTableId: 5, fuelNormId: 3, fuelPricePeriodId: 9,
      override: null,
    },
    snapshotCount: 1,
  },
  statusSummary: {
    entries: [],
    phoiFacts: { total: 1, taken: 1 },
    costFacts: { total: 2, unconfirmed: 0 },
  },
  ...over,
}) as ShipmentDetail;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingDebitClosePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const originalMatchMedia = window.matchMedia;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  getShipmentDetail.mockResolvedValue(detail());
  window.matchMedia = (media): MediaQueryList => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
  // jsdom measures every rect as 0×0 — the house popover hook treats that as
  // "not measured" and keeps the panel hidden. Give the trigger a real rect
  // so the panel positions (and becomes visible) like in a browser.
  HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 24, height: 24, top: 40, left: 40, right: 64, bottom: 64, x: 40, y: 40,
    toJSON: () => ({}),
  }) as DOMRect;
});

describe('SIL-1096 — the readiness trigger on the chot-debit board', () => {
  it('the trigger answers "còn thiếu gì" on EVERY row (pickable and pending alike)', async () => {
    listBoard.mockResolvedValue({
      items: [
        row(),
        row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', tra: { ...CARRIER_RATES, cuocTraDv: null } }),
        row({ shipmentId: 3, code: 'SHP-26-0003', billOrBooking: 'BL-3', tra: { ...CARRIER_RATES, cuocTraDv: null }, adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } }),
      ],
      total: 3,
    });
    renderPage();
    await screen.findByText('BL-1');

    const triggers = screen.getAllByRole('button', { name: /Điều kiện lập bảng kê của BL-/ });
    expect(triggers).toHaveLength(3);
    // The pickable rows keep their selection checkbox beside the trigger
    // (SIL-727 track law).
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-2' })).toBeTruthy();
    // The silent dot is gone: the mark is decorative inside the trigger now.
    expect(screen.queryByRole('img', { name: 'Thiếu chi phí' })).toBeNull();
  });

  it('the dot keeps its "Thiếu chi phí" meaning as the trigger state', async () => {
    listBoard.mockResolvedValue({
      items: [
        row(),
        row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', tra: { ...CARRIER_RATES, cuocTraDv: null } }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-1');
    const complete = screen.getByRole('button', { name: 'Điều kiện lập bảng kê của BL-1 — xem còn thiếu gì' });
    const missing = screen.getByRole('button', { name: 'Điều kiện lập bảng kê của BL-2 — xem còn thiếu gì' });
    expect(complete.getAttribute('title')).toBe('Điều kiện lập bảng kê — xem còn thiếu gì');
    expect(missing.getAttribute('title')).toBe('Thiếu chi phí — xem điều kiện lập bảng kê');
  });

  it('the popover lists all four conditions — tick khi đủ, lý do + cách bổ sung khi thiếu', async () => {
    getShipmentDetail.mockResolvedValue(detail({
      documentSet: {
        status: ShipmentDocumentSetStatus.MISSING, label: 'Còn thiếu', missingDocuments: ['Bill gốc'],
        receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
      },
      statusSummary: {
        entries: [],
        phoiFacts: { total: 2, taken: 1 },
        costFacts: { total: 3, unconfirmed: 2 },
      },
    }));
    listBoard.mockResolvedValue({
      items: [row({ routeName: null, tra: { ...CARRIER_RATES, cuocTraDv: null } })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(screen.getByRole('button', { name: /Điều kiện lập bảng kê của BL-1/ }));

    const panel = await screen.findByRole('dialog', { name: 'Điều kiện lập bảng kê của BL-1' });
    // All four KB conditions listed — never silence.
    for (const label of ['Hàng hóa', 'Giá', 'Chứng từ', 'Điều kiện kỳ']) {
      expect(within(panel).getByText(label)).toBeTruthy();
    }
    // Wait for the lot's detail wire (the per-lot fetch) to land.
    await within(panel).findByText(/Hồ sơ gốc còn thiếu: Bill gốc/);

    // Giá: thiếu tuyến + phí chưa duyệt — LÝ DO + CÁCH BỔ SUNG.
    expect(within(panel).getByText(/Chưa có tuyến/)).toBeTruthy();
    expect(within(panel).getByText(/Còn 2 khoản phí chưa được Kế toán duyệt/)).toBeTruthy();
    expect(within(panel).getByText(/Cách bổ sung: chọn tuyến trên chi tiết lô/)).toBeTruthy();

    // Chứng từ: TÊN tài liệu thiếu (Lớp 2) + nhận phơi (Lớp 3).
    expect(within(panel).getByText(/Hồ sơ gốc còn thiếu: Bill gốc/)).toBeTruthy();
    expect(within(panel).getByText(/Chưa nhận phơi: 1\/2 chuyến/)).toBeTruthy();

    // Tick khi đủ, không im lặng: hàng hóa + điều kiện kỳ (trace đầy đủ) → 2
    // tick; giá + chứng từ đang thiếu → reason + cách bổ sung thay cho tick.
    expect(within(panel).getAllByRole('img', { name: 'Đủ' })).toHaveLength(2);
  });

  it('Escape closes the popover and focus returns to the trigger', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    const trigger = screen.getByRole('button', { name: /Điều kiện lập bảng kê của BL-1/ });
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Điều kiện lập bảng kê của BL-1' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Điều kiện lập bảng kê của BL-1' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('SIL-838 — the missing money cell renders EMPTY (no prose names the lack)', async () => {
    listBoard.mockResolvedValue({ items: [row({ tra: { ...CARRIER_RATES, tong1: null } })], total: 1 });
    renderPage();
    expect(await screen.findByText('BL-1')).toBeTruthy();
    expect(screen.queryByText('Thiếu tổng trả')).toBeNull();
    expect(screen.queryByText(/Thiếu/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Thiếu chi phí' })).toBeNull();
  });

  it('SIL-772 — all nine Rev2 groups open on the board and the picker is gone', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    expect(screen.queryByRole('button', { name: /Cột hiển thị/ })).toBeNull();
    for (const label of ['Lô', 'Hàng hóa & Cont', 'Phương tiện', 'Cước phải thu', 'Tổng thu', 'Cước phải trả', 'Tổng trả & Chi phí ngoài', 'Lợi nhuận', 'Ghi chú & Đối soát']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('phone records carry the readiness answer but never the dot as a fact', async () => {
    window.matchMedia = (media): MediaQueryList => ({
      media, matches: media === '(max-width: 640px)', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    });
    listBoard.mockResolvedValue({ items: [row({ tra: { ...CARRIER_RATES, tong1: null } })], total: 1 });
    renderPage();
    const record = await screen.findByRole('article', { name: 'BL-1' });
    expect(within(record).queryByRole('img', { name: 'Thiếu chi phí' })).toBeNull();
    expect(within(record).queryByText(/Thiếu/)).toBeNull();
    expect(within(record).getByRole('button', { name: /Điều kiện lập bảng kê/ })).toBeTruthy();
  });
});
