/**
 * FB-094 — the chốt-debit board's LCL cells: the container-params label cites
 * the thu/tra vehicle classes + "Ghép cùng Bill X", and PHÂN XE shows the two
 * plates with the orange "Báo khách (Ảo)" badge only when billing ≠ actual.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

const { BOARD_COLUMNS } = await import('./AccountingDebitClosePage.columns');

const noContext = { confirm: () => {}, withdraw: () => {}, isBusy: false };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SS-1',
  customerName: 'KH A',
  customerId: 1,
  carrierKeys: [],
  ngay: '2026-10-20',
  billOrBooking: 'BL-1',
  containers: [],
  phanXe: [],
  lcl: null,
  thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null },
  tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, tong1: null, phiRu: null },
  loiNhuan: null,
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  ...over,
});

function cellFor(key: string, target: AccountingDebitBoardRow) {
  const column = BOARD_COLUMNS.find((entry) => entry.key === key)!;
  return column.cell(target, noContext);
}

describe('FB-094 — board LCL cells', () => {
  it('container params read the LCL label + the group note, not container lines', () => {
    const view = cellFor('container', row({
      lcl: {
        label: 'Lẻ · Thu: 5T · Trả: 10T',
        actualTruckNo: '29C-1', billingTruckNo: '30C-2',
        ghépCùngRef: 'BL-9',
      },
    }));
    const { container } = render(<>{view}</>);
    expect(container.textContent).toContain('Lẻ · Thu: 5T · Trả: 10T (Ghép cùng Bill BL-9)');
  });

  it('PHÂN XE shows both plates and the orange badge only when they differ', () => {
    const differing = render(<>{cellFor('phanXe', row({
      lcl: { label: 'Lẻ', actualTruckNo: '29C-1', billingTruckNo: '30C-2', ghépCùngRef: null },
    }))}</>).container;
    expect(differing.textContent).toContain('29C-1');
    expect(differing.textContent).toContain('Báo khách (Ảo): 30C-2');
    expect(differing.querySelector('.debit-billing-badge')).toBeTruthy();

    const matching = render(<>{cellFor('phanXe', row({
      lcl: { label: 'Lẻ', actualTruckNo: '29C-1', billingTruckNo: '29C-1', ghépCùngRef: null },
    }))}</>).container;
    expect(matching.querySelector('.debit-billing-badge')).toBeNull();
  });

  it('FCL rows keep the container list and the phanXe join', () => {
    const fclContainer = render(<>{cellFor('container', row({ containers: ['MSCU1 · 40HC'] }))}</>).container;
    expect(fclContainer.textContent).toContain('MSCU1 · 40HC');
    const fcl = render(<>{cellFor('phanXe', row({ phanXe: ['Xe nhà · 30A-111'] }))}</>).container;
    expect(fcl.textContent).toContain('Xe nhà · 30A-111');
  });
});
