// SIL-1123 (QA 27/11, Vietnamese run) — /accounting/chot-debit must carry the
// same "Bỏ xe công ty" tick as /debt. BE labels own-fleet trips "Đội xe nội
// bộ SilverSea" (SIL-838 law), so a lot whose whole phanXe list is that
// label is an own-fleet lot. Default renders everything; the tick hides ONLY
// own-fleet-only lots (mixed fleets and external carriers stay), and
// toggling clears the row selection so a hidden lot can never keep a live
// tick while invisible.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const OWN_FLEET = 'Đội xe nội bộ SilverSea';

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

const threeFleets = (): { items: AccountingDebitBoardRow[]; total: number } => ({
  items: [
    row({ shipmentId: 1, billOrBooking: 'BL-OWN', phanXe: [OWN_FLEET] }),
    row({ shipmentId: 2, billOrBooking: 'BL-MIX', phanXe: [OWN_FLEET, 'VĂN LAN'] }),
    row({ shipmentId: 3, billOrBooking: 'BL-EXT', phanXe: ['VĂN LAN'] }),
  ],
  total: 3,
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

describe('SIL-1123 — Bỏ xe công ty on the chot-debit board', () => {
  it('default renders every lot — own-fleet, mixed and external alike, tick off', async () => {
    listBoard.mockResolvedValue(threeFleets());
    renderPage();

    expect(await screen.findByText('BL-OWN')).toBeTruthy();
    expect(screen.getByText('BL-MIX')).toBeTruthy();
    expect(screen.getByText('BL-EXT')).toBeTruthy();
    const tick = screen.getByRole('checkbox', { name: 'Bỏ xe công ty' }) as HTMLInputElement;
    expect(tick.checked).toBe(false);
  });

  it('ticking hides only own-fleet-only lots — mixed and external stay, unticking restores', async () => {
    listBoard.mockResolvedValue(threeFleets());
    renderPage();
    await screen.findByText('BL-OWN');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Bỏ xe công ty' }));
    await waitFor(() => expect(screen.queryByText('BL-OWN')).toBeNull());
    expect(screen.getByText('BL-MIX')).toBeTruthy();
    expect(screen.getByText('BL-EXT')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Bỏ xe công ty' }));
    await waitFor(() => expect(screen.getByText('BL-OWN')).toBeTruthy());
    expect(screen.getByText('BL-MIX')).toBeTruthy();
    expect(screen.getByText('BL-EXT')).toBeTruthy();
  });

  it('toggling clears the row selection — a hidden lot never keeps a live tick', async () => {
    listBoard.mockResolvedValue({
      items: [
        row({ shipmentId: 1, billOrBooking: 'BL-OWN', phanXe: [OWN_FLEET] }),
        row({ shipmentId: 3, billOrBooking: 'BL-EXT', phanXe: ['VĂN LAN'] }),
      ],
      total: 2,
    });
    renderPage();
    const ownCheckbox = (await screen.findByText('BL-OWN')).closest('tr')!
      .querySelector('input.debit-row-checkbox') as HTMLInputElement;
    fireEvent.click(ownCheckbox);
    expect(ownCheckbox.checked).toBe(true);

    // Tick hides the selected lot — clear() runs with the hide, and the
    // selection stays empty through the untick round trip.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bỏ xe công ty' }));
    await waitFor(() => expect(screen.queryByText('BL-OWN')).toBeNull());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bỏ xe công ty' }));

    const restored = (await screen.findByText('BL-OWN')).closest('tr')!
      .querySelector('input.debit-row-checkbox') as HTMLInputElement;
    expect(restored.checked).toBe(false);
    const extCheckbox = screen.getByText('BL-EXT').closest('tr')!
      .querySelector('input.debit-row-checkbox') as HTMLInputElement;
    expect(extCheckbox.checked).toBe(false);
  });
});
