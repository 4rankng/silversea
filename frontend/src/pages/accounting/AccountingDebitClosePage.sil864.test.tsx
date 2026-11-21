import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, setRates } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  setRates: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: vi.fn(),
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: setRates,
  reconcileAndHideDebitLots: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

// SIL-864 — QA verdict build 32e22c12 (role hoapt, 19:18 SGT), lô K5K5346365,
// 2 container MNBU0006614 + MNBU0006609 (VĂN LAN). Baseline cả hai dòng:
// Cước thu 4.160.000₫ / Tổng thu 4.160.000₫ / Tổng trả 1.002₫ / Lợi nhuận
// 4.158.998₫. The defect: the money was ONE lot-level value mirrored into
// both rows, and an inline edit on ONE row changed BOTH. This pins the fix:
// per-container money renders per row, and the edit commits with ITS OWN
// container id — the sibling row never moves.
const CONTAINER_6614 = 901;
const CONTAINER_6609 = 902;

function row(overrides: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow {
  return {
    shipmentId: 42,
    code: 'SHP-2611-00042',
    customerName: 'VĂN LAN',
    customerId: 7,
    carrierKeys: ['OWN'],
    ngay: '2026-11-12',
    billOrBooking: 'K5K5346365',
    containers: ['MNBU0006614 · 40HC', 'MNBU0006609 · 40HC'],
    containersDetail: [
      { id: CONTAINER_6614, container: 'MNBU0006614 · 40HC', carriers: ['VĂN LAN'], plates: [] },
      { id: CONTAINER_6609, container: 'MNBU0006609 · 40HC', carriers: ['VĂN LAN'], plates: [] },
    ],
    phanXe: ['VĂN LAN'],
    thu: { cuocThu: '4160000', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '4160000' },
    tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: '1002', tong1: '1002', phiRu: null },
    chiPhiNgoai: null,
    debitHiddenAt: null,
    loiNhuan: '4158998',
    ghiChu: null,
    adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
    costLockedAt: null,
    containerMoney: [
      {
        containerId: CONTAINER_6614,
        thu: { cuocThu: '4160000', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '4160000' },
        tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: '1002', tong1: '1002', phiRu: null },
        loiNhuan: '4158998',
      },
      {
        // The QA repro's edit: Cước thu 4.160.000 → 4.161.000 ON MNBU0006609
        // only; Phát sinh ĐV 1.002 → 2.002 on the same row.
        containerId: CONTAINER_6609,
        thu: { cuocThu: '4161000', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '4161000' },
        tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: '2002', tong1: '2002', phiRu: null },
        loiNhuan: '4158998',
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingDebitClosePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const dataRows = (container: HTMLElement) => [...container.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listBoard.mockResolvedValue({ items: [row()], total: 1 });
});

describe('per-container money rows — SIL-864 (lô K5K5346365, MNBU0006614 + MNBU0006609)', () => {
  it('renders the two container rows with THEIR OWN money — no lot mirror', async () => {
    renderPage();
    await screen.findByText('MNBU0006614 · 40HC');
    const rows = dataRows(document.body);
    expect(rows).toHaveLength(2);
    // Row 1 (MNBU0006614) keeps the baseline 4.160.000 / 1.002.
    expect(within(rows[0]).getAllByText('4.160.000 ₫').length).toBeGreaterThan(0);
    expect(within(rows[0]).getAllByText('1.002 ₫').length).toBeGreaterThan(0);
    // Row 2 (MNBU0006609) carries ITS OWN values 4.161.000 / 2.002.
    expect(within(rows[1]).getAllByText('4.161.000 ₫').length).toBeGreaterThan(0);
    expect(within(rows[1]).getAllByText('2.002 ₫').length).toBeGreaterThan(0);
    // The edit inputs differ across rows: row 2's placeholder is its own value.
    const input2 = within(rows[1]).getByPlaceholderText('4.161.000 ₫');
    expect(input2).toBeTruthy();
  });

  it('commits an inline edit on MNBU0006609 with ITS container id — never a sibling write', async () => {
    setRates.mockResolvedValue({ shipmentId: 42, containerId: CONTAINER_6609, rates: { cuocThu: 500000 } });
    renderPage();
    await screen.findByText('MNBU0006614 · 40HC');
    const rows = dataRows(document.body);
    const input2 = within(rows[1]).getByPlaceholderText('4.161.000 ₫') as HTMLInputElement;
    fireEvent.change(input2, { target: { value: '500000' } });
    fireEvent.blur(input2);
    await waitFor(() => expect(setRates).toHaveBeenCalledTimes(1));
    expect(setRates).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 42,
        containerId: CONTAINER_6609,
        rates: { cuocThu: 500000 },
      }),
      expect.anything(), // the mutation context (useMutation's second arg)
    );
  });

  it('the sibling row (MNBU0006614) commits with ITS OWN container id', async () => {
    setRates.mockResolvedValue({ shipmentId: 42, containerId: null, rates: { cuocThu: 450000 } });
    renderPage();
    await screen.findByText('MNBU0006614 · 40HC');
    const rows = dataRows(document.body);
    // Row 1's Cước thu input carries the baseline 4.160.000 (unchanged edit → no write),
    // so edit a DIFFERENT cell: Phát sinh ĐV (row 1 placeholder 1.002).
    const input1 = within(rows[0]).getByPlaceholderText('1.002 ₫') as HTMLInputElement;
    fireEvent.change(input1, { target: { value: '1500' } });
    fireEvent.blur(input1);
    await waitFor(() => expect(setRates).toHaveBeenCalledTimes(1));
    expect(setRates).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 42,
        containerId: CONTAINER_6614,
        rates: { phatSinhDv: 1500 },
      }),
      expect.anything(), // the mutation context (useMutation's second arg)
    );
  });
});
