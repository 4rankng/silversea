/**
 * FB-094 + card 161026232419 — the chốt-debit board's LCL cells.
 *
 * PHÂN XE line 1 (§II.4) states the lot's REAL carrier identity and the plate
 * that ran the lane — `[Nhà xe thực tế] · Thực: [BKS thực tế]` — where the
 * carrier half is the same `row.phanXe` label the FCL cell renders
 * (subcontracted ⇒ nhà xe name, own fleet ⇒ own plate). Line 2 is the orange
 * "Báo khách (Ảo)" badge, only when the billing plate differs from the actual
 * one. The container-params cell cites the thu/tra vehicle classes +
 * "Ghép cùng Bill X".
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { BOARD_COLUMNS } from './AccountingDebitClosePage.columns';

const noContext = {
  confirm: () => {},
  withdraw: () => {},
  isBusy: false,
  editBillingPlate: () => {},
  editingBillingShipmentId: null,
};

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
  costLockedAt: '2026-09-24T00:00:00.000Z',
  ...over,
});

function cellFor(key: string, target: AccountingDebitBoardRow) {
  const column = BOARD_COLUMNS.find((entry) => entry.key === key)!;
  return column.cell(target, noContext);
}

function textOf(key: string, target: AccountingDebitBoardRow) {
  return render(<>{cellFor(key, target)}</>).container;
}

const lcl = (
  over: Partial<NonNullable<AccountingDebitBoardRow['lcl']>> = {},
): NonNullable<AccountingDebitBoardRow['lcl']> => ({
  label: 'Lẻ',
  actualTruckNo: null,
  billingTruckNo: null,
  ghépCùngRef: null,
  ...over,
});

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

  // Card 161026232419 (§II.4): line 1 carries the carrier name AND the real
  // plate — "Nhà xe Gaya · Thực: 29C-1". An own-fleet lot names its own-fleet
  // identity exactly as the FCL cell does: the own plate (phanXe label).
  it('PHÂN XE line 1 names the real carrier and labels the actual plate', () => {
    const subcontract = textOf('phanXe', row({
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '29C-1' }),
    }));
    expect(subcontract.textContent).toContain('Nhà xe Gaya · Thực: 29C-1');
    expect(subcontract.querySelector('.debit-billing-badge')).toBeNull();

    const ownFleet = textOf('phanXe', row({
      phanXe: ['29C-123.45'],
      lcl: lcl({ actualTruckNo: '29C-123.45', billingTruckNo: '29C-123.45' }),
    }));
    expect(ownFleet.textContent).toContain('29C-123.45 · Thực: 29C-123.45');
  });

  it('PHÂN XE shows both plates and the orange badge only when they differ', () => {
    const differing = textOf('phanXe', row({
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '30C-2' }),
    }));
    expect(differing.textContent).toContain('Nhà xe Gaya · Thực: 29C-1');
    expect(differing.textContent).toContain('Báo khách (Ảo): 30C-2');
    expect(differing.querySelector('.debit-billing-badge')).toBeTruthy();

    const matching = textOf('phanXe', row({
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '29C-1' }),
    }));
    expect(matching.querySelector('.debit-billing-badge')).toBeNull();
    expect(matching.textContent).toContain('Nhà xe Gaya · Thực: 29C-1');
  });

  it('PHÂN XE degrades missing carrier/plate to —, never "" or undefined', () => {
    const bare = textOf('phanXe', row({ lcl: lcl() }));
    expect(bare.textContent).toBe('—');
    expect(bare.textContent).not.toContain('undefined');

    const noCarrier = textOf('phanXe', row({
      lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '29C-1' }),
    }));
    expect(noCarrier.textContent).toContain('— · Thực: 29C-1');
    expect(noCarrier.textContent).not.toContain('undefined');

    const noPlate = textOf('phanXe', row({
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl(),
    }));
    expect(noPlate.textContent).toContain('Nhà xe Gaya · Thực: —');

    // Whitespace-only plates are absence, not data.
    const blank = textOf('phanXe', row({
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl({ actualTruckNo: '  ', billingTruckNo: '' }),
    }));
    expect(blank.textContent).toContain('Nhà xe Gaya · Thực: —');
    expect(blank.textContent).not.toContain('undefined');
  });

  it('FCL rows keep the container list and the phanXe join', () => {
    const fclContainer = textOf('container', row({ containers: ['MSCU1 · 40HC'] }));
    expect(fclContainer.textContent).toContain('MSCU1 · 40HC');
    const fcl = textOf('phanXe', row({ phanXe: ['Xe nhà · 30A-111'] }));
    expect(fcl.textContent).toBe('Xe nhà · 30A-111');
    expect(fcl.textContent).not.toContain('Thực:');
    expect(textOf('phanXe', row()).textContent).toBe('—');
  });
});

// Card 191026202000 — the board's names ride the shared NameCell: the wire
// carries the operational (short) name, the cell keeps the full name reachable
// through the tooltip law, and every grid treats a name the same way.
describe('card 191026202000 — board names ride the shared NameCell', () => {
  it('customer name renders through NameCell (title keeps the full name reachable)', () => {
    const view = textOf('lo', row({ customerName: 'CÔNG TY TNHH MTV LONG MINH' }));
    const name = view.querySelector('.name-cell');
    expect(name).toBeTruthy();
    expect(name?.textContent).toBe('CÔNG TY TNHH MTV LONG MINH');
    expect(name?.getAttribute('title')).toBe('CÔNG TY TNHH MTV LONG MINH');
    expect(name?.getAttribute('aria-label')).toBe('CÔNG TY TNHH MTV LONG MINH');
  });

  it('Phân xe labels render per-label through NameCell, not a joined bare string', () => {
    const fcl = textOf('phanXe', row({ phanXe: ['Nhà xe Gaya', 'Duyên Hải'] }));
    const names = fcl.querySelectorAll('.name-cell');
    expect(names).toHaveLength(2);
    expect(names[0].getAttribute('title')).toBe('Nhà xe Gaya');
    expect(names[1].getAttribute('title')).toBe('Duyên Hải');
    expect(fcl.textContent).toBe('Nhà xe Gaya, Duyên Hải');

    const lclCarrier = textOf('phanXe', row({
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '29C-1' }),
    }));
    expect(lclCarrier.querySelector('.name-cell')?.getAttribute('title')).toBe('Nhà xe Gaya');
    expect(lclCarrier.textContent).toContain('Nhà xe Gaya · Thực: 29C-1');
  });
});

// FB-093 (card 191026100833) — QA found the "Báo khách (Ảo)" badge read-only:
// kế toán could see the plate the customer is told but not correct it from the
// chốt-debit board. The badge is the editor's trigger (the CUS ledger's
// `billingPlateTrigger` law), so it is a real <button> that reports WHICH lot
// it opens and announces its expanded state while the panel is up.
describe('FB-093 — the "Báo khách (Ảo)" badge opens the BKS editor', () => {
  it('renders a labelled button that hands the page its own shipmentId', () => {
    const opened: number[] = [];
    const target = row({
      shipmentId: 77,
      phanXe: ['Nhà xe Gaya'],
      lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '30C-2' }),
    });
    const column = BOARD_COLUMNS.find((entry) => entry.key === 'phanXe')!;
    const { container } = render(<>{column.cell(target, { ...noContext, editBillingPlate: (id) => opened.push(id) })}</>);
    const badge = container.querySelector('.debit-billing-badge') as HTMLButtonElement;
    expect(badge.tagName).toBe('BUTTON');
    expect(badge.getAttribute('aria-label')).toBe('Sửa BKS báo khách: 30C-2');
    fireEvent.click(badge);
    expect(opened).toEqual([77]);
  });

  it('marks the badge expanded only for the lot being edited', () => {
    const badgeFor = (editingId: number | null) => {
      const target = row({ shipmentId: 77, phanXe: [], lcl: lcl({ actualTruckNo: '29C-1', billingTruckNo: '30C-2' }) });
      const { container } = render(
        <>{BOARD_COLUMNS.find((entry) => entry.key === 'phanXe')!.cell(target, { ...noContext, editingBillingShipmentId: editingId })}</>,
      );
      return container.querySelector('.debit-billing-badge')?.getAttribute('aria-expanded');
    };
    expect(badgeFor(77)).toBe('true');
    expect(badgeFor(5)).toBe('false');
  });
});
