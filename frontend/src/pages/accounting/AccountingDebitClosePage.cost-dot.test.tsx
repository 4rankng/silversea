// Card 191026181942 (KT8) — the leading cost-state track. SIL-727 amends the
// track's law on this board: a PICKABLE row hosts the selection checkbox (the
// same `useTableRowSelection` state the row click drives), a LOCKED row keeps
// the red dot naming the missing cost. The money cells keep their muted
// "Thiếu …" labels (§1); the row is never flooded red (selection state owns
// that channel). The dot track stays pinned, and the ticket's money matrix
// opens essential-locked (card KT4 as amended by SIL-727).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, sendRequests, confirmReq, withdrawReq, listRounds, createRound } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  sendRequests: vi.fn(),
  confirmReq: vi.fn(),
  withdrawReq: vi.fn(),
  listRounds: vi.fn(),
  createRound: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: sendRequests,
  confirmRateAdjustments: confirmReq,
  withdrawRateAdjustments: withdrawReq,
  listSettlementRounds: listRounds,
  createSettlementRound: createRound,
    setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
  reconcileAndHideDebitLots: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import { hasMissingCost } from './AccountingDebitClosePage.columns';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

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
  costLockedAt: '2026-09-24T00:00:00.000Z',
  ...over,
});

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
afterEach(() => { window.matchMedia = originalMatchMedia; });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  // Desktop board: the dot column is a board concept.
  window.matchMedia = (media): MediaQueryList => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
});

describe('hasMissingCost — the dot predicate (card 191026181942 KT8)', () => {
  it('a fully priced row carries no dot', () => {
    expect(hasMissingCost(row())).toBe(false);
  });

  it.each([
    ['cuocThu', { thu: { ...RATES, cuocThu: null } }],
    ['tongThu', { thu: { ...RATES, tongThu: null } }],
    ['cuocTraDv', { tra: { ...CARRIER_RATES, cuocTraDv: null } }],
    ['phiRu', { tra: { ...CARRIER_RATES, phiRu: null } }],
    ['tong1', { tra: { ...CARRIER_RATES, tong1: null } }],
  ] as const)('a missing %s field lights the dot', (_field, over) => {
    expect(hasMissingCost(row(over as Partial<AccountingDebitBoardRow>))).toBe(true);
  });
});

describe('the leading cost-state track on the board', () => {
  it('SIL-727 — the track hosts the checkbox on pickable rows and keeps the dot for locked ones', async () => {
    listBoard.mockResolvedValue({
      items: [
        // Pickable + complete → the checkbox affordance, no dot.
        row(),
        // Pickable + a missing breakdown → still the checkbox; the muted
        // "Thiếu …" money label names the lack instead of the track.
        row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', tra: { ...CARRIER_RATES, cuocTraDv: null } }),
        // Locked (PENDING) + a missing breakdown → the dot names the lack.
        row({ shipmentId: 3, code: 'SHP-26-0003', billOrBooking: 'BL-3', tra: { ...CARRIER_RATES, cuocTraDv: null }, adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } }),
      ],
      total: 3,
    });
    renderPage();
    await screen.findByText('BL-1');

    const boardRegion = within(screen.getByRole('region', { name: 'Bảng kế hoạch điều động tổng hợp' }));
    const checkbox1 = boardRegion.getByRole('checkbox', { name: 'Chọn lô BL-1' });
    expect(checkbox1.getAttribute('aria-checked')).toBe('false');
    const checkbox2 = boardRegion.getByRole('checkbox', { name: 'Chọn lô BL-2' });
    expect(checkbox2).toBeTruthy();
    expect(boardRegion.queryByRole('img', { name: 'Thiếu chi phí' })).toBeNull();
    expect(boardRegion.getByText('Thiếu cước trả ĐV')).toHaveClass('debit-missing');

    // The locked row keeps the dot in ITS leading cell (the pending zone),
    // with the tooltip naming the lack.
    const pendingRegion = within(screen.getByRole('region', { name: 'Bảng chờ xác nhận điều chỉnh cước' }));
    const dots = pendingRegion.getAllByRole('img', { name: 'Thiếu chi phí' });
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('title', 'Thiếu chi phí');
    expect(dots[0].closest('tr')?.textContent).toContain('BL-3');
  });

  it('the money cell stays muted prose (§1) — the track never floods red', async () => {
    listBoard.mockResolvedValue({ items: [row({ tra: { ...CARRIER_RATES, tong1: null } })], total: 1 });
    renderPage();
    // Tổng 1 is essential — visible by default, its missing label still names
    // the field in the muted face; the pickable row's track hosts the
    // checkbox, and no red dot floods beside it.
    expect(await screen.findByText('Thiếu tổng trả')).toHaveClass('debit-missing');
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Thiếu chi phí' })).toBeNull();
  });

  it('SIL-772 — all nine Rev2 groups open on the board and the picker is gone', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    // The visibility picker died with the old matrix — no 'Cột hiển thị'.
    expect(screen.queryByRole('button', { name: /Cột hiển thị/ })).toBeNull();
    // …and the board opens on the NINE Rev2 groups, nothing hidden.
    for (const label of ['Lô', 'Hàng hóa & Cont', 'Phương tiện', 'Cước phải thu', 'Tổng thu', 'Cước phải trả', 'Tổng trả & Chi phí ngoài', 'Lợi nhuận', 'Ghi chú & Đối soát']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('phone records never render the dot track as a fact', async () => {
    window.matchMedia = (media): MediaQueryList => ({
      media, matches: media === '(max-width: 640px)', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    });
    listBoard.mockResolvedValue({ items: [row({ tra: { ...CARRIER_RATES, tong1: null } })], total: 1 });
    renderPage();
    const record = await screen.findByRole('article', { name: 'BL-1' });
    expect(within(record).queryByRole('img', { name: 'Thiếu chi phí' })).toBeNull();
    // The per-field muted labels still carry the fact on the card face.
    expect(within(record).getByText('Thiếu tổng trả')).toBeTruthy();
  });
});
