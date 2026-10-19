// Card 191026181942 (KT8) — the leading cost-state track: a red dot on rows
// that still lack cost data, so "dễ kiểm tra" is a scan down the first column
// instead of reading every money cell. The money cells keep their muted
// "Thiếu …" labels (§1); the row is never flooded red (selection state owns
// that channel). Card KT4 rides along: the dot column is pinned (non-hideable)
// and the board opens on its essential set.
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
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
  it('dots exactly the rows that lack cost data, with the tooltip naming the lack', async () => {
    listBoard.mockResolvedValue({
      items: [
        row(),
        row({ shipmentId: 2, billOrBooking: 'BL-2', tra: { ...CARRIER_RATES, cuocTraDv: null } }),
      ],
      total: 2,
    });
    const { container } = renderPage();
    await screen.findByText('BL-1');

    const dots = screen.getAllByRole('img', { name: 'Thiếu chi phí' });
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('title', 'Thiếu chi phí');
    // The dotted row is BL-2's: the dot sits in that row's leading cell.
    expect(dots[0].closest('tr')?.textContent).toContain('BL-2');
    // A complete row reads as complete in the same track — no dot element.
    const firstRow = [...container.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
    expect(firstRow[0]?.querySelector('.debit-cost-dot')).toBeNull();
  });

  it('the money cell stays muted prose (§1) — no red flood beside the dot', async () => {
    listBoard.mockResolvedValue({ items: [row({ tra: { ...CARRIER_RATES, tong1: null } })], total: 1 });
    renderPage();
    // Tổng 1 is essential — visible by default, its missing label still names
    // the field in the muted face; the dot column is the only red signal.
    expect(await screen.findByText('Thiếu tổng 1')).toHaveClass('debit-missing');
    expect(screen.getByRole('img', { name: 'Thiếu chi phí' })).toBeTruthy();
  });

  it('the dot column is pinned — the picker never offers it, and the essential default opens ≤6 columns', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(screen.getByRole('button', { name: /Cột hiển thị/ }));
    const dialog = screen.getByRole('dialog', { name: 'Cột hiển thị' });
    // Pinned columns (dot, Ngày, lô, Đối soát) are not offered at all…
    for (const label of ['Chi phí', 'Ngày', 'Thông tin lô hàng', 'Đối soát']) {
      expect(within(dialog).queryByRole('checkbox', { name: label })).toBeNull();
    }
    // …and the board opened on the essential set: the two rollups are there,
    // the breakdowns are not (one toggle away).
    expect(within(dialog).getByRole('checkbox', { name: 'Tổng thu' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Tổng 1' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Cước thu (tự động)' })).not.toBeChecked();
    expect(screen.queryByRole('columnheader', { name: 'Cước thu (tự động)' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Tổng thu' })).toBeTruthy();
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
    expect(within(record).getByText('Thiếu tổng 1')).toBeTruthy();
  });
});
