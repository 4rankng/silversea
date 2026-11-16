// SIL-838 (id 967, P0, KH 15/11) — /accounting/chot-debit 5 điểm, pinned
// through the real page over mocked wire rows:
//   1. Lô: nhà máy/kho + tuyến under the customer name (FCL + LCL).
//   2. Phương tiện: EVERY row shows the full carrier name + BKS thực
//      (plates fallback; actualTruckNo wins on LCL).
//   3. (money cells render empty instead of 'Thiếu …' — pinned in
//      cost-dot / sil771 / the page test; not duplicated here.)
//   4. Ghi chú & Đối soát carries the composed note (BE composes CUS + ĐV
//      + ops notes; the cell renders whatever the wire names ghiChu).
//   5. 'Ghép cước thu khách' is GONE from the toolbar (CUS-only act).
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
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

import { ToastProvider } from '../../components/shared/Toast';
import AccountingDebitClosePage from './AccountingDebitClosePage';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

const THU = {
  cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000',
};
const TRA = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'LG Electronics',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-15',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['VĂN LAN'],
  truckPlates: ['51C-059.58'],
  factoryName: null,
  routeName: null,
  thu: { ...THU },
  tra: { ...TRA },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  window.matchMedia = (media): MediaQueryList => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
});

describe('SIL-838 điểm 1 — Lô carries nhà máy/kho + tuyến under the KH name', () => {
  it('renders both facts as muted lines below the customer name', async () => {
    listBoard.mockResolvedValue({
      items: [row({ factoryName: 'ASKEY', routeName: 'Bình Dương – Cát Lái' })],
      total: 1,
    });
    renderPage();
    const lotCell = (await screen.findByText('BL-1')).closest('td')!;
    expect(lotCell.textContent).toContain('ASKEY');
    expect(lotCell.textContent).toContain('Bình Dương – Cát Lái');
    expect(lotCell.querySelector('.debit-lot-site')?.textContent).toBe('ASKEY');
    expect(lotCell.querySelector('.debit-lot-route')?.textContent).toBe('Bình Dương – Cát Lái');
  });

  it('an LCL row carries the same facts (both tabs, one column model)', async () => {
    listBoard.mockResolvedValue({
      items: [row({
        lcl: {
          label: 'Lẻ · Thu: CONT40 · Trả: CONT40',
          actualTruckNo: '51C-123.45', billingTruckNo: null,
          ghépCùngRef: null, revGroupId: null, costGroupId: null,
        },
        factoryName: 'Kho NEWEB', routeName: 'Bắc Tân Uyên – Cát Lái',
      })],
      total: 1,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Vận tải Hàng Lẻ \(LCL\)/ }));
    const lotCell = (await screen.findByText('BL-1')).closest('td')!;
    expect(lotCell.textContent).toContain('Kho NEWEB');
    expect(lotCell.textContent).toContain('Bắc Tân Uyên – Cát Lái');
  });

  it('a lot with neither fact renders no placeholder line', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    expect(document.querySelector('.debit-lot-site')).toBeNull();
    expect(document.querySelector('.debit-lot-route')).toBeNull();
  });
});

describe('SIL-838 điểm 2 — Phương tiện shows full nhà xe + BKS thực per row', () => {
  it('FCL: carrier name AND the trip plate', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    const truckCell = (await screen.findByText('VĂN LAN')).closest('td')!;
    expect(truckCell.textContent).toContain('Thực: 51C-059.58');
  });

  it('FCL own-fleet: the fleet label rides with the plate under "Thực:" (SIL-838 QA fd0f7f14 — BE labels own trips Đội xe nội bộ SilverSea, never by plate)', async () => {
    listBoard.mockResolvedValue({
      items: [row({ phanXe: ['Đội xe nội bộ SilverSea'], truckPlates: ['51C-059.58'] })],
      total: 1,
    });
    renderPage();
    const truckCell = (await screen.findByText('Đội xe nội bộ SilverSea')).closest('td')!;
    expect(truckCell.textContent).toContain('Thực: 51C-059.58');
  });

  it('LCL: actualTruckNo wins; trip plates fill a lot without one', async () => {
    listBoard.mockResolvedValue({
      items: [
        row({
          shipmentId: 1, billOrBooking: 'BL-1',
          lcl: {
            label: 'Lẻ', actualTruckNo: '51C-123.45', billingTruckNo: null,
            ghépCùngRef: null, revGroupId: null, costGroupId: null,
          },
        }),
        row({
          shipmentId: 2, billOrBooking: 'BL-2',
          lcl: {
            label: 'Lẻ', actualTruckNo: null, billingTruckNo: null,
            ghépCùngRef: null, revGroupId: null, costGroupId: null,
          },
        }),
      ],
      total: 2,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Vận tải Hàng Lẻ \(LCL\)/ }));
    // The cell's carrier half rides NameCell (tooltip element), so the
    // "Thực:" line is broken text — assert on the row's composed text.
    const row1 = (await screen.findByText('BL-1')).closest('tr')!;
    expect(row1.textContent).toContain('Thực: 51C-123.45');
    const row2 = (await screen.findByText('BL-2')).closest('tr')!;
    expect(row2.textContent).toContain('Thực: 51C-059.58');
  });
});

describe('SIL-838 điểm 4 — Ghi chú & Đối soát carries the composed note', () => {
  it('renders the wire note (CUS + Điều vận composed server-side)', async () => {
    listBoard.mockResolvedValue({
      items: [row({ ghiChu: 'Giao giờ hành chính · Xe nâng tại kho' })],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText('Giao giờ hành chính · Xe nâng tại kho')).toBeTruthy();
  });
});

describe('SIL-838 điểm 5 — the Ghép cước thu khách act left the KT toolbar', () => {
  it('the button is gone; the other toolbar acts stay', async () => {
    listBoard.mockResolvedValue({
      items: [
        row({ shipmentId: 1, billOrBooking: 'BL-1' }),
        row({
          shipmentId: 2, billOrBooking: 'BL-2',
          lcl: {
            label: 'Lẻ', actualTruckNo: null, billingTruckNo: null,
            ghépCùngRef: 'BL-1', revGroupId: 'rg-1', costGroupId: null,
          },
        }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-1');
    expect(screen.queryByRole('button', { name: 'Ghép cước thu khách' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeTruthy();
    // The per-row/strip TÁCH NHÓM path is untouched: unmerge stays reachable.
    fireEvent.click(await screen.findByRole('button', { name: /Vận tải Hàng Lẻ \(LCL\)/ }));
    const boardRegion = await screen.findByRole('region', { name: 'Bảng kế hoạch điều động tổng hợp' });
    expect(within(boardRegion).getAllByRole('button', { name: /Tách nhóm/ }).length).toBeGreaterThan(0);
  });
});
