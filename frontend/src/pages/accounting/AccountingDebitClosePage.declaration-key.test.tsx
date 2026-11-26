/**
 * K3.61 — the Số Bill/Book cell shows the lot's số tờ khai as the SECOND
 * display key right after Bill/Booking: 'W4A-FCL-01 · W4ADEL001, W4ADEL002'
 * (bill ref strong + ' · ' + declarations). A row without declarations
 * (null or an older wire that omits the field) renders EXACTLY as before —
 * the bare ref in the same .debit-bill-book span, no separator, no strong.
 * SIL-1075 ruling (KB Ch.10 §10.6.1) — one row per lot: the cell ALWAYS
 * carries the LOT's merged key; the per-container split is retired here.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { BOARD_COLUMNS } from './AccountingDebitClosePage.columns';

const noContext = {
  confirm: () => {},
  withdraw: () => {},
  isBusy: false,
  editBillingPlate: () => {},
  editingBillingShipmentId: null,
  onRevGroupUnmerged: () => {},
};

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 1,
  carrierKeys: [],
  ngay: '2026-11-20',
  billOrBooking: 'W4A-FCL-01',
  containers: [],
  phanXe: [],
  lcl: null,
  thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null },
  tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, tong1: null, phiRu: null },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: null,
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

function soBillBookCell(over: Partial<AccountingDebitBoardRow> = {}) {
  const column = BOARD_COLUMNS.find((entry) => entry.key === 'soBillBook')!;
  return render(<>{column.cell(row(over), noContext)}</>).container;
}

describe('K3.61 — Số Bill/Book carries the declarations right after the bill', () => {
  it("renders 'W4A-FCL-01 · W4ADEL001, W4ADEL002' with the bill ref strong", () => {
    const cell = soBillBookCell({ customsNumber: 'W4ADEL001, W4ADEL002' });
    expect(cell.textContent).toBe('W4A-FCL-01 · W4ADEL001, W4ADEL002');
    expect(cell.querySelector('.debit-bill-book strong')?.textContent).toBe('W4A-FCL-01');
  });

  it('a null customsNumber renders exactly the bare bill ref as before', () => {
    const cell = soBillBookCell({ customsNumber: null });
    expect(cell.textContent).toBe('W4A-FCL-01');
    expect(cell.querySelector('strong')).toBeNull();
    expect(cell.textContent).not.toContain('·');
  });

  it('an older wire without the field renders exactly the bare bill ref as before', () => {
    const bare = row();
    delete (bare as Partial<AccountingDebitBoardRow>).customsNumber;
    const column = BOARD_COLUMNS.find((entry) => entry.key === 'soBillBook')!;
    const cell = render(<>{column.cell(bare, noContext)}</>).container;
    expect(cell.textContent).toBe('W4A-FCL-01');
    expect(cell.querySelector('.debit-bill-book')).toBeTruthy();
  });

  it('a lot with declarations but no bill still shows the second key', () => {
    const cell = soBillBookCell({ billOrBooking: null, customsNumber: 'W4ADEL001, W4ADEL002' });
    expect(cell.textContent).toBe('Chưa có số Bill/Booking · W4ADEL001, W4ADEL002');
  });
});

describe('SIL-1075 ruling (KB Ch.10 §10.6.1) — one row per lot carries the LOT key', () => {
  // The repro lot: W4A-FCL-01, MSKU9000100 → W4ADEL001 and MSKU9000115 →
  // W4ADEL002. The lot renders ONE row and the cell shows the merged key
  // with BOTH numbers — there is no container row left to carry a subset.
  it("a 2-container lot's single row shows the merged key with BOTH numbers", () => {
    const cell = soBillBookCell({
      customsNumber: 'W4ADEL001, W4ADEL002',
      containers: ['MSKU9000100 · 20DC', 'MSKU9000115 · 20DC'],
    });
    expect(cell.textContent).toBe('W4A-FCL-01 · W4ADEL001, W4ADEL002');
  });
});
