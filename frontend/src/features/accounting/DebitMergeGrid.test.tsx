/**
 * Task 2.3 (18/11) — DebitMergeGrid: the ONE 6-column-group reconciliation
 * grid shared by /accounting/ghep-bo-debit and /shipments-debit.
 *
 * Pinned contractually:
 *  - the 6 group headers EXACT ('Thông tin Lô hàng', 'Container',
 *    'Cước phải thu', 'PHÍ CHI HỘ (Có hóa đơn)', 'PHÍ KHÔNG HÓA ĐƠN',
 *    'KIỂM SOÁT') and the 4 chi-hộ sub-group headers EXACT;
 *  - fee rows land in the right sub-group cells (catalog mapping is the
 *    service's law — here the grid just renders the wire);
 *  - money law: null = EMPTY cell, known 0 = muted '0' (never fabricated);
 *  - the amber law: a known non-zero Tổng TC carries the warn class, a
 *    settled 0 does not (SIL-801);
 *  - the merge-tag law: a rev-group member's Cước cell shows
 *    «Ghép thu cước cùng Lô 1» with the F-2 reason as tooltip (SIL-546/F-2);
 *  - containers: SIL-912 — EVERY container renders as its OWN <tr> (never
 *    merged into one row, no stacked lines, no expansion step); lot-level
 *    money renders once on the lot's FIRST container row so the totals foot
 *    can never double, and the internal SHP-* code never reaches the screen;
 *  - pagination rides the shared Pagination with page sizes [20, 50];
 *  - the column picker (card 20260928_193 mechanism) hosts show/hide;
 *  - Khóa lô / Chọn Debit gating: canLock/canChooseDebit + the completeness
 *    signal (Chọn Debit needs every picked lot LOCKED).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebitMergeGrid, MERGE_TAG_LABEL, PENDING_FEE_TIP, DEBIT_MERGE_PAGE_SIZES, debitMergeHeadLabelOccluded, debitMergeStickyBand, type DebitMergeGridProps } from './DebitMergeGrid';
import type { DebitMergeItem } from '@tingting/shared';

const mergeRow = (over: Partial<DebitMergeItem> = {}): DebitMergeItem => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerId: 1,
  customerName: 'KH A',
  factoryName: 'NM A',
  routeName: 'Hải Phòng → Bắc Ninh',
  deliveryDate: '2026-11-18',
  billOrBookNumber: 'BL-1',
  creatorName: null,
  creatorCode: null,
  containers: [{ id: 1, containerNumber: 'BSIU1234567', containerType: "20'DC" }],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

function renderGrid(props: Partial<DebitMergeGridProps> = {}, rows: DebitMergeItem[] = [mergeRow()]) {
  return render(
    <DebitMergeGrid
      rows={rows}
      storageKey="debit-merge-test-cols"
      selection={new Set<number>()}
      onSelectionChange={vi.fn()}
      canLock
      canChooseDebit
      onLockSelected={vi.fn()}
      onChooseDebit={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('DebitMergeGrid — CR-011.2 Q6 mã cặp', () => {
  it('renders the Cặp #N chip on rows with a live pair and omits it otherwise', () => {
    renderGrid({}, [
      mergeRow({ shipmentId: 101, pairId: 42 }),
      mergeRow({ shipmentId: 102, code: 'SHP-26-0002', billOrBookNumber: 'BL-2', pairId: null }),
    ]);
    expect(screen.getByText('Cặp #42')).toBeTruthy();
    expect(screen.queryByText(/Cặp #\d/)).not.toBeNull();
    // The unpaired lot carries no chip of its own.
    const unpairedCell = screen.getByText('BL-2').closest('td');
    expect(unpairedCell?.querySelector('.debit-merge-pair-chip')).toBeNull();
  });

  it('the chip names the Kẹp pair code in a tooltip', () => {
    renderGrid({}, [mergeRow({ pairId: 7 })]);
    expect(screen.getByTitle('Mã cặp ghép chuyến (Kẹp)').textContent).toBe('Cặp #7');
  });
});

describe('DebitMergeGrid — 6 nhóm cột với tiêu đề CHÍNH XÁC', () => {
  // KB §10.8.4 (24/11): the house date law is DD/MM/YYYY — the shared grid
  // (Chi phí - Quyết toán AND Ghép bộ Debit) printed the raw ISO date.
  it('prints the Ngày column as DD/MM/YYYY', () => {
    renderGrid();
    const cell = document.querySelector<HTMLElement>('tbody td[data-col="ngay"]');
    expect(cell?.textContent).toBe('18/11/2026');
  });

  it('renders all six group headers verbatim', () => {
    renderGrid();
    for (const header of [
      'Thông tin Lô hàng', 'Container', 'Cước phải thu',
      'PHÍ CHI HỘ (Có hóa đơn)', 'PHÍ KHÔNG HÓA ĐƠN', 'KIỂM SOÁT',
    ]) {
      expect(screen.getByText(header)).toBeTruthy();
    }
  });

  it('renders the four chi-hộ sub-group headers verbatim + the group-5 FIVE leaf labels (SIL-876)', () => {
    renderGrid();
    const table = document.querySelector('table.debit-merge__table') as HTMLElement;
    for (const header of [
      'Phí CSHT',
      'Phí nâng-cont / Lưu kho hàng lẻ',
      'Phí hạ-cont / Phí bốc xếp',
      'Phí khác',
      'Phí GN OP TC',
      'Phí PS OP TC',
    ]) {
      // Scoped to the table: the column picker repeats the leaf labels.
      expect(within(table).getAllByText(header).length).toBeGreaterThan(0);
    }
    // The five group-5 leaves EXACT — mỗi họ Ops một cột Thực thu (AUI-04,
    // audit 2026-11-27: the twins name their Ops side so the picker list and
    // the header row carry no bare duplicate); Tên phí đóng cột.
    const leafHeaders = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent);
    expect(leafHeaders).toContain('Phí GN OP TC');
    expect(leafHeaders).toContain('Thực thu (GN OP TC)');
    expect(leafHeaders).toContain('Phí PS OP TC');
    expect(leafHeaders).toContain('Thực thu (PS OP TC)');
    expect(leafHeaders).toContain('Tên phí');
    // Container example from the ticket: BSIU1234567 | 20'DC renders per line.
    expect(within(table).getAllByText('BSIU1234567').length).toBeGreaterThan(0);
    expect(within(table).getAllByText("20'DC").length).toBeGreaterThan(0);
  });

  it('stacks the chi-hộ fee rows in their OWN sub-group cells (wire-in, wire-out)', () => {
    renderGrid({}, [mergeRow({
      chiHo: {
        csht: [{ invoiceNumber: 'HD-CS1', amount: '50000' }],
        lift: [{ invoiceNumber: 'HD-L1', amount: '1200000', actualAmount: '1150000' }],
        drop: [{ invoiceNumber: 'HD-D1', amount: '980000', actualAmount: '980000' }],
        other: [{ invoiceNumber: 'HD-K1', amount: '300000', feeName: 'Phí vệ sinh' }],
      },
    })]);
    const table = document.querySelector('table.debit-merge__table') as HTMLElement;
    const hd = (label: string) => within(table).getAllByText(label);
    expect(hd('HD-CS1')).toHaveLength(1);
    expect(within(table).getAllByText('50.000').length).toBeGreaterThan(0);
    expect(hd('HD-L1')).toHaveLength(1);
    expect(within(table).getAllByText('1.150.000').length).toBeGreaterThan(0);
    expect(hd('HD-D1')).toHaveLength(1);
    expect(hd('HD-K1')).toHaveLength(1);
    expect(within(table).getAllByText('Phí vệ sinh').length).toBeGreaterThan(0);
  });
});

describe('DebitMergeGrid — money laws', () => {
  // SIL-1081 (K2.120, KB Ch.10 money law) — supersedes the old EMPTY face
  // this suite used to pin: a wire-null money cell ghosts the em-dash '—' on
  // EVERY leaf (never an empty face, never a fabricated 0); a REAL 0 keeps
  // the muted '0 ₫'.
  it('SIL-1081: mọi ô tiền null (thu/tổng/Tổng TC) ghost —, không ô rỗng, không 0 bịa', () => {
    renderGrid();
    for (const col of ['cuoc', 'lachHuyen', 'phuPhi', 'phatSinh', 'tong', 'tongTc']) {
      const cell = document.querySelector(`td[data-col="${col}"]`) as HTMLElement;
      expect(cell.textContent!.trim(), col).toBe('—');
      expect(cell.querySelector('.debit-merge-money__zero'), col).toBeNull();
    }
  });

  it('SIL-1081: cell map lô 1210 — CƯỚC 7.904.000 / LẠCH HUYỆN · PHỤ PHÍ · PHÁT SINH — / TỔNG 7.904.000', () => {
    renderGrid({}, [mergeRow({
      revenue: { cuoc: '7904000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '7904000' },
    })]);
    // The grid's money face is formatMoney (suffix-less) — the ' ₫' suffix is
    // the chot-debit board's formatCurrency face, not this grid's.
    expect(document.querySelector('td[data-col="cuoc"]')!.textContent).toBe('7.904.000');
    for (const col of ['lachHuyen', 'phuPhi', 'phatSinh']) {
      expect(document.querySelector(`td[data-col="${col}"]`)!.textContent!.trim(), col).toBe('—');
    }
    expect(document.querySelector('td[data-col="tong"]')!.textContent).toBe('7.904.000');
  });

  it('SIL-1081: 0 thật vẫn định dạng 0 muted (computed zero is a value, không nhầm —)', () => {
    renderGrid({}, [mergeRow({ revenue: { cuoc: '0', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' } })]);
    const cuocCell = document.querySelector('td[data-col="cuoc"]')!;
    expect(cuocCell.textContent).toBe('0');
    expect(cuocCell.querySelector('.debit-merge-money__zero')).toBeTruthy();
  });

  it('SIL-801: known non-zero Tổng TC carries the warn class; settled 0 stays muted; the warn rule sits AFTER the base rule', async () => {
    
    
    renderGrid({}, [
      mergeRow({ shipmentId: 101, billOrBookNumber: 'BL-A', control: { tongTc: '306619500', lockStatus: 'OPEN', lockedAt: null } }),
      mergeRow({ shipmentId: 102, billOrBookNumber: 'BL-B', control: { tongTc: '0', lockStatus: 'OPEN', lockedAt: null } }),
    ]);
    const warn = document.querySelector('td[data-col="tongTc"] .debit-merge-money__warn');
    expect(warn?.textContent).toContain('306.619.500');
    const zeroCell = document.querySelectorAll('td[data-col="tongTc"]')[1]!;
    expect(zeroCell.querySelector('.debit-merge-money__warn')).toBeNull();
    expect(zeroCell.querySelector('.debit-merge-money__zero')).toBeTruthy();

    // The cascade law (QA FAIL 1ae5afcb): the --warn rule must follow the
    // base __value rule in the stylesheet, or the tone silently dies.
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.indexOf('.debit-merge-money__value {')).toBeGreaterThan(-1);
    expect(css.indexOf('.debit-merge-money__warn')).toBeGreaterThan(css.indexOf('.debit-merge-money__value {'));
    expect(css).toMatch(/\.debit-merge-money__warn\s*\{\s*color: var\(--warning-text\);/);
  });

  it('F-2/SIL-546: the rev-group member shows the merge tag with the full reason as tooltip; the principal shows none', () => {
    renderGrid({}, [
      mergeRow({
        shipmentId: 201, billOrBookNumber: 'BL-P', revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2,
        revenue: { cuoc: '3150000', cuocReason: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: '3150000' },
      }),
      mergeRow({
        shipmentId: 202, billOrBookNumber: 'BL-M', revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2,
        revenue: { cuoc: '0', cuocReason: 'Ghép cước cùng Bill BL-P', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' },
      }),
    ]);
    const memberCell = document.querySelectorAll('tr[data-shipment-id="202"] td[data-col="cuoc"]')[0]!;
    const tag = within(memberCell as HTMLElement).getByText(MERGE_TAG_LABEL);
    expect(tag.getAttribute('title')).toBe('Ghép cước cùng Bill BL-P');
    const principalRow = document.querySelector('tr[data-shipment-id="201"]')!;
    expect(principalRow.querySelector('.debit-merge-money__mergetag')).toBeNull();
  });
});

describe('DebitMergeGrid — containers (SIL-912: mỗi container một dòng riêng)', () => {
  const SIL912_CONTS = [
    { id: 1, containerNumber: 'RTAU4011047', containerType: "20'DC" },
    { id: 2, containerNumber: 'RTAU4011052', containerType: "20'DC" },
    { id: 3, containerNumber: 'MSMU7208543', containerType: "40'HC" },
  ];

  it('renders ONE <tr> per container — a multi-container lot is never merged into one row', () => {
    renderGrid({}, [mergeRow({ billOrBookNumber: 'BL-1', containers: SIL912_CONTS })]);
    // Three containers → three body rows; each cont/contType cell carries
    // exactly ONE value (the audit's R3P-677-R repro: 'RTAU4011047
    // RTAU4011052' merged in one row must never render again).
    const contCells = [...document.querySelectorAll('tbody td[data-col="cont"]')];
    expect(contCells.map((cell) => cell.textContent)).toEqual(['RTAU4011047', 'RTAU4011052', 'MSMU7208543']);
    const typeCells = [...document.querySelectorAll('tbody td[data-col="contType"]')];
    expect(typeCells.map((cell) => cell.textContent)).toEqual(["20'DC", "20'DC", "40'HC"]);
    expect(document.querySelectorAll('tbody tr.debit-merge__row')).toHaveLength(3);
    // The old compression affordances stay dead: no stacked cont lines, no
    // toggle, no child rows.
    expect(document.querySelector('td[data-col="cont"] .debit-merge-cell__line')).toBeNull();
    expect(document.querySelector('.debit-merge__cont-toggle')).toBeNull();
    expect(document.querySelector('tr.debit-merge__child-row')).toBeNull();
  });

  it('a container-less lot still renders exactly one row (cont reads —)', () => {
    renderGrid({}, [mergeRow({ containers: [] })]);
    expect(document.querySelectorAll('tbody tr.debit-merge__row')).toHaveLength(1);
    expect(document.querySelector('td[data-col="cont"]')!.textContent).toBe('—');
    expect(document.querySelector('td[data-col="contType"]')!.textContent).toBe('');
  });

  // SIL-944 (K9.19) — the dedicated 'Thông số' leaf: the LCL label + the
  // 'Ghép cước cùng Bill X' note (SIL-1094, KB §6.3 K6.32) render once per
  // LOT (first container row); FCL
  // rows keep the cell empty. The KB's verbatim face is the Thu/Trả class
  // pair the wire's lclParams carries.
  it('Thông số: an LCL lot renders its label + Ghép cước cùng Bill once, an FCL lot an empty cell', () => {
    const first = renderGrid({}, [mergeRow({
      cargoMode: 'LCL',
      lclParams: { label: 'Lẻ · Thu: 5T · Trả: 10T', ghepCungRef: 'BL-9' },
    })]);
    const paramsCell = first.container.querySelector('tbody td[data-col="thongSo"]')!;
    expect(paramsCell.textContent).toContain('Lẻ · Thu: 5T · Trả: 10T');
    expect(paramsCell.textContent).toContain('Ghép cước cùng Bill BL-9');
    first.unmount();

    // A 2-cont LCL lot: the note renders on the FIRST row only.
    const second = renderGrid({}, [mergeRow({
      containers: SIL912_CONTS.slice(0, 2),
      cargoMode: 'LCL',
      lclParams: { label: 'Lẻ · Thu: CONT20.LIGHT', ghepCungRef: null },
    })]);
    const paramsCells = [...second.container.querySelectorAll('tbody td[data-col="thongSo"]')];
    expect(paramsCells).toHaveLength(2);
    expect(paramsCells[0].textContent).toContain('Lẻ · Thu: CONT20.LIGHT');
    expect(paramsCells[0].textContent).not.toContain('Ghép cước cùng Bill');
    expect(paramsCells[1].textContent!.trim()).toBe('');
    second.unmount();

    // FCL (no lclParams on the wire) → empty cell, never a fabricated dash-row.
    const third = renderGrid({}, [mergeRow({ cargoMode: 'FCL' })]);
    expect(third.container.querySelector('tbody td[data-col="thongSo"]')!.textContent!.trim()).toBe('');
  });

  it('money law: lot-level money renders ONCE per lot — continuation rows keep EMPTY cells, never a fabricated 0', () => {
    renderGrid({}, [mergeRow({
      containers: SIL912_CONTS.slice(0, 2),
      revenue: { cuoc: '1000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '1000' },
      control: { tongTc: '5000', lockStatus: 'OPEN', lockedAt: null },
    })]);
    const cuocCells = document.querySelectorAll('tbody td[data-col="cuoc"]');
    expect(cuocCells).toHaveLength(2);
    expect(cuocCells[0].textContent).toContain('1.000');
    expect(cuocCells[1].textContent!.trim()).toBe('');
    expect(cuocCells[1].querySelector('.debit-merge-money__zero')).toBeNull();
    const tongTcCells = document.querySelectorAll('tbody td[data-col="tongTc"]');
    expect(tongTcCells[0].textContent).toContain('5.000');
    expect(tongTcCells[1].textContent!.trim()).toBe('');
  });

  it('totals foot stays LOT-level: a split lot is summed once, never doubled', () => {
    renderGrid({}, [
      mergeRow({
        shipmentId: 1, billOrBookNumber: 'BL-A', containers: SIL912_CONTS.slice(0, 2),
        revenue: { cuoc: '1000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '1000' },
        control: { tongTc: '5000', lockStatus: 'OPEN', lockedAt: null },
      }),
      mergeRow({
        shipmentId: 2, billOrBookNumber: 'BL-B',
        containers: [SIL912_CONTS[2]!],
        revenue: { cuoc: '250000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '250000' },
        control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
      }),
    ]);
    const foot = (key: string) => document.querySelector(`tfoot td[data-col="${key}"]`)!;
    // 1.000 (lot A, counted ONCE despite its two container rows) + 250.000.
    expect(foot('cuoc').textContent).toBe('251.000');
    expect(foot('tongTc').textContent).toBe('5.000');
    // The visible money column agrees with the foot: only ONE rendered cước
    // value per lot (lot A's continuation row is empty).
    expect([...document.querySelectorAll('tbody td[data-col="cuoc"]')]
      .filter((cell) => cell.textContent!.trim() !== '')).toHaveLength(2);
  });

  it('pick checkboxes stay lot-bound across a lot’s container rows — one tap flips them all', () => {
    function Harness() {
      const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
      return (
        <DebitMergeGrid
          rows={[mergeRow({ shipmentId: 101, billOrBookNumber: 'BL-1', containers: SIL912_CONTS.slice(0, 2) })]}
          storageKey="debit-merge-sil912-pick"
          selection={selection}
          onSelectionChange={(id, next) => setSelection((current) => {
            const set = new Set(current);
            if (next) set.add(id);
            else set.delete(id);
            return set;
          })}
          canLock
          canChooseDebit
          onLockSelected={vi.fn()}
          onChooseDebit={vi.fn()}
        />
      );
    }
    render(<Harness />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Chọn lô BL-1' }) as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]!);
    for (const box of boxes) expect(box.checked).toBe(true);
    fireEvent.click(boxes[0]!);
    for (const box of boxes) expect(box.checked).toBe(false);
  });

  it('SHP-* never renders: the lot cell is the Bill/Booking, missing one falls back to #id', () => {
    renderGrid({}, [
      mergeRow({ shipmentId: 101, billOrBookNumber: 'BL-1', code: 'SHP-26-0001' }),
      mergeRow({ shipmentId: 102, billOrBookNumber: null, code: 'SHP-26-0002' }),
    ]);
    const firstLot = document.querySelector('tr[data-shipment-id="101"] td[data-col="lot"]')!;
    expect(firstLot.textContent).toBe('BL-1');
    const secondLot = document.querySelector('tr[data-shipment-id="102"] td[data-col="lot"]')!;
    expect(secondLot.textContent).toBe('#102');
    expect(document.body.textContent).not.toContain('SHP-26-0001');
    expect(document.body.textContent).not.toContain('SHP-26-0002');
  });

  it('group-5 money law: Phí GN/PS OP TC render ONE line per fee of the family (SIL-896 r11), Thực thu stays the summed cell', () => {
    renderGrid({}, [mergeRow({
      noInvoice: {
        gnFee: '650000', gnPaid: '450000', psFee: null, psPaid: null,
        fees: [
          { name: 'Làm hàng luồng xanh', amount: '450000', side: 'gn' },
          { name: 'Chọn vỏ', amount: '200000', side: 'gn' },
        ],
      },
    })]);
    const gnCell = document.querySelector('td[data-col="gnFee"]')!;
    const gnLines = gnCell.querySelectorAll('.debit-merge-cell__line');
    expect(gnLines).toHaveLength(2);
    expect(gnLines[0]).toHaveTextContent('450.000');
    expect(gnLines[1]).toHaveTextContent('200.000');
    expect(document.querySelector('td[data-col="gnPaid"]')!.textContent).toContain('450.000');
    // SIL-1081 — wire-null Ps Thực-thu (MoneyCell) ghosts '—'; the Ps FEE
    // column is a fee stack (SIL-896 r11): no fees of the family → the empty
    // cell face stays (no line to name, not a money value).
    expect(document.querySelector('td[data-col="psFee"]')!.textContent!.trim()).toBe('');
    expect(document.querySelector('td[data-col="psPaid"]')!.textContent!.trim()).toBe('—');
    expect(document.querySelector('td[data-col="noInvTenPhi"]')!).toHaveTextContent('Làm hàng luồng xanh');
  });

  it('SIL-896 round 11: the two pending fees render as SEPARATE red money lines 450.000₫ / 50.000₫ — no 500.000₫ aggregate — with their catalog names', () => {
    // QA repro (lot MATS7539769000, build 2530c955): the aggregated
    // 500.000₫ cell + empty TÊN PHÍ failed round 10 — each fee must show
    // its own amount line, positionally paired with the named lines.
    renderGrid({}, [mergeRow({
      noInvoice: {
        gnFee: '500000', gnPaid: null, psFee: null, psPaid: null, gnFeePending: true,
        fees: [
          { name: 'Hải quan luồng xanh', amount: '450000', side: 'gn', pending: true },
          { name: 'Chọn vỏ', amount: '50000', side: 'gn', pending: true },
        ],
      },
    })]);
    const moneyCell = document.querySelector('td[data-col="gnFee"]')!;
    const moneyLines = moneyCell.querySelectorAll('.debit-merge-cell__line');
    expect(moneyLines).toHaveLength(2);
    expect(moneyLines[0]).toHaveTextContent('450.000');
    expect(moneyLines[1]).toHaveTextContent('50.000');
    expect(moneyCell.textContent).not.toContain('500.000');
    for (const line of moneyLines) {
      expect(line.className).toContain('debit-merge-cell__line--pending');
      expect(line.getAttribute('title')).toBe(PENDING_FEE_TIP);
    }
    const nameCell = document.querySelector('td[data-col="noInvTenPhi"]')!;
    const lines = nameCell.querySelectorAll('.debit-merge-cell__line');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Hải quan luồng xanh');
    expect(lines[1]).toHaveTextContent('Chọn vỏ');
    for (const line of lines) {
      expect(line.className).toContain('debit-merge-cell__line--pending');
      expect(line.getAttribute('title')).toBe(PENDING_FEE_TIP);
    }
  });
});

describe('DebitMergeGrid — toolbar: pagination, column picker, actions', () => {
  it('paginates client-side; page sizes are exactly [20, 50]', () => {
    const rows = Array.from({ length: 45 }, (_, index) => mergeRow({ shipmentId: index + 1, billOrBookNumber: `BL-${index + 1}` }));
    renderGrid({}, rows);
    const body = document.querySelectorAll('tbody tr.debit-merge__row');
    expect(body).toHaveLength(20);
    // The rows-per-page choices are exactly [20, 50] (the ticket's set).
    expect(DEBIT_MERGE_PAGE_SIZES).toEqual([20, 50]);
    // The shared Pagination controls render below the table.
    expect(document.querySelector('.ds-pagination')).toBeTruthy();
  });

  it('hosts the column picker and hides a chosen leaf column via the persisted choice', () => {
    const view = renderGrid();
    // The picker hosts the show/hide control (card 20260928_193 mechanism);
    // its exact chrome differs by filter-bar mode, the caption is constant.
    expect(screen.getByText('Cột hiển thị')).toBeTruthy();
    view.unmount();
    // Hide via the persisted-choice path the hook reads on MOUNT (storage,
    // not the URL — the hook's own law).
    localStorage.setItem('debit-merge-test-cols', JSON.stringify(['factory']));
    render(
      <DebitMergeGrid
        rows={[mergeRow()]}
        storageKey="debit-merge-test-cols"
        selection={new Set<number>()}
        onSelectionChange={vi.fn()}
        canLock
        canChooseDebit
        onLockSelected={vi.fn()}
        onChooseDebit={vi.fn()}
      />,
    );
    expect(document.querySelector('th[data-col="factory"]')).toBeNull();
    expect(document.querySelector('th[data-col="route"]')).not.toBeNull();
  });

  it('Khóa lô / Chọn Debit disable with reasons: no permission, no pick, incomplete costs', () => {
    const onLockSelected = vi.fn();
    const onChooseDebit = vi.fn();
    const openRow = mergeRow({ shipmentId: 101, control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null } });
    const lockedRow = mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } });
    const props: Partial<DebitMergeGridProps> = {
      selection: new Set<number>([101]),
      onLockSelected,
      onChooseDebit,
      canLock: false,
      canChooseDebit: false,
    };
    const view = renderGrid(props, [openRow]);
    const rerenderGrid = (next: Partial<DebitMergeGridProps>, rows: DebitMergeItem[]) => view.rerender(
      <DebitMergeGrid
        rows={rows}
        storageKey="debit-merge-test-cols"
        selection={new Set<number>()}
        onSelectionChange={vi.fn()}
        canLock
        canChooseDebit
        onLockSelected={vi.fn()}
        onChooseDebit={vi.fn()}
        {...next}
      />,
    );
    const lock = document.querySelector('button.debit-merge__action:not(.debit-merge__action--primary)') as HTMLButtonElement;
    const choose = document.querySelector('button.debit-merge__action--primary') as HTMLButtonElement;
    // The DisabledActionTip law: aria-disabled + aria-describedby reason.
    expect(lock.getAttribute('aria-disabled')).toBe('true');
    expect(lock.getAttribute('aria-describedby')).toBe('debit-merge-lock-disabled-reason');
    expect(document.getElementById('debit-merge-lock-disabled-reason')?.textContent).toContain('Cần quyền khóa lô hàng.');
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById('debit-merge-choose-disabled-reason')?.textContent).toContain('Tài khoản không có quyền chọn Debit.');

    // With permissions but an OPEN pick: Chọn Debit names the completeness law.
    rerenderGrid({ selection: new Set<number>([101]), onLockSelected, onChooseDebit, canLock: true, canChooseDebit: true }, [openRow]);
    expect(document.getElementById('debit-merge-choose-disabled-reason')?.textContent).toContain('đã khóa');
    expect(document.getElementById('debit-merge-lock-disabled-reason')).toBeNull();

    // A LOCKED pick arms Chọn Debit; Khóa lô is replaced by the read-only
    // Đã khóa face (24/11, mục 11 — the unwired slot has no lock reason tip).
    rerenderGrid({ selection: new Set<number>([101]), onLockSelected, onChooseDebit, canLock: true, canChooseDebit: true }, [lockedRow]);
    fireEvent.click(document.querySelector('button.debit-merge__action--primary')!);
    expect(onChooseDebit).toHaveBeenCalledTimes(1);
    expect(document.getElementById('debit-merge-lock-disabled-reason')).toBeNull();
    expect(document.querySelector<HTMLElement>('.debit-merge__action--locked-state')?.textContent).toBe('Đã khóa');
  });

  it('NV phụ trách column only renders when the page asks (team mode)', () => {
    const { rerender } = renderGrid({ showCreator: false }, [mergeRow({ creatorName: 'Lê Văn Tài', creatorCode: 'NV001' })]);
    expect(document.querySelector('th[data-col="creator"]')).toBeNull();
    rerender(
      <DebitMergeGrid
        rows={[mergeRow({ creatorName: 'Lê Văn Tài', creatorCode: 'NV001' })]}
        storageKey="debit-merge-test-cols"
        showCreator
        selection={new Set<number>()}
        onSelectionChange={vi.fn()}
        canLock
        canChooseDebit
        onLockSelected={vi.fn()}
        onChooseDebit={vi.fn()}
      />,
    );
    const table = document.querySelector('table.debit-merge__table') as HTMLElement;
    expect(within(table).getAllByText('NV phụ trách').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Lê Văn Tài').length).toBeGreaterThan(0);
  });

  it('the totals foot EQUALS the rendered page money cells; a column with no known value reads — (redesign 23/10 + u14 AC-4)', () => {
    const first = renderGrid({}, [
      mergeRow({ shipmentId: 1, revenue: { cuoc: '1000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '1000' }, control: { tongTc: '250000', lockStatus: 'OPEN', lockedAt: null } }),
      mergeRow({ shipmentId: 2, billOrBookNumber: 'BL-2', revenue: { cuoc: '250000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: null }, control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null } }),
    ]);
    const foot = (key: string) => document.querySelector(`tfoot td[data-col="${key}"]`)!;
    expect(foot('cuoc').textContent).toBe('251.000');
    // No known value behind Lạch Huyện → '—', never 0.
    expect(foot('lachHuyen').textContent).toBe('—');
    // Tổng ignores the null (knowns-sum) and still shows 1.000 from row 1.
    expect(foot('tong').textContent).toBe('1.000');
    expect(foot('tongTc').textContent).toBe('250.000');
    // Amber on the known non-zero Tổng TC sum only.
    expect(foot('tongTc').classList.contains('debit-merge__totals-cell--warn')).toBe(true);
    first.unmount();
    // The all-pending foot: every money cell reads '—'.
    renderGrid({}, [mergeRow({ shipmentId: 3 })]);
    for (const key of ['cuoc', 'lachHuyen', 'phuPhi', 'phatSinh', 'tong', 'tongTc']) {
      expect(document.querySelector(`tfoot td[data-col="${key}"]`)!.textContent).toBe('—');
    }
  });
});

describe('SIL-883 — chi phí đỏ/đen tức thời + hard-block', () => {
  const pendingFee = { invoiceNumber: '360402', amount: '7603200', pending: true };
  const approvedFee = { invoiceNumber: '360403', amount: '1200000' };
  const PENDING_TIP = 'Chờ kế toán duyệt chi phí';

  const reasonFor = (tipId: string): string | null =>
    document.getElementById(`${tipId}-disabled-reason`)?.textContent ?? null;

  it('renders a saved-but-unapproved fee line red with the duyệt tooltip, approved lines black', () => {
    renderGrid({}, [mergeRow({ chiHo: { csht: [pendingFee, approvedFee], lift: [], drop: [], other: [] } })]);
    // the pending fee renders TWICE (Số HĐ + Tiền stack lines) — both red+tipped
    const pending = screen.getAllByTitle(PENDING_TIP);
    expect(pending).toHaveLength(2);
    for (const line of pending) expect(line.className).toContain('debit-merge-cell__line--pending');
    expect(pending.map((line) => line.textContent).join(' ')).toContain('7.603.200');
    // the approved sibling carries neither the class nor the tooltip
    const approved = screen.getByText('1.200.000');
    expect(approved.className).not.toContain('debit-merge-cell__line--pending');
    expect(approved.getAttribute('title')).toBeNull();
  });

  it('paints pending no-invoice fee lines red with the duyệt tooltip; a family with no fee lines renders the empty money cell', () => {
    renderGrid({}, [mergeRow({ noInvoice: { gnFee: '200000', gnPaid: null, psFee: null, psPaid: null, gnFeePending: true, fees: [{ name: 'Cước bốc xe', amount: '200000', side: 'gn', pending: true }] } })]);
    const line = document.querySelector('td[data-col="gnFee"] .debit-merge-cell__line');
    expect(line).toBeTruthy();
    expect(line!.className).toContain('debit-merge-cell__line--pending');
    expect(line!.getAttribute('title')).toBe(PENDING_TIP);
    expect(line!.textContent).toBe('200.000');
    const psCell = document.querySelector('td[data-col="psFee"]')!;
    expect(psCell.querySelector('.debit-merge-cell__line')).toBeNull();
    expect(psCell.querySelector('.debit-merge-money')).toBeTruthy();
  });

  it('hard-blocks Khóa lô / Chọn Debit / Xuất Debit Note while a selected lot carries pending fees', () => {
    const rows = [
      mergeRow({ shipmentId: 1 }),
      mergeRow({ shipmentId: 2, billOrBookNumber: 'BL-77', control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null, pendingFeeCount: 3 } }),
    ];
    renderGrid({ canExportDebitNote: true, onExportDebitNote: vi.fn(), selection: new Set([1, 2]) }, rows);
    expect(reasonFor('debit-merge-lock')).toBe('Không thể khóa lô: Lô BL-77 còn 3 khoản chi phí chưa được Kế toán duyệt.');
    expect(reasonFor('debit-merge-choose')).toBe('Không thể chọn Debit: Lô BL-77 còn 3 khoản chi phí chưa được Kế toán duyệt.');
    expect(reasonFor('debit-merge-export')).toBe('Không thể xuất Debit Note: Lô BL-77 còn 3 khoản chi phí chưa được Kế toán duyệt.');
  });

  it('unblocks the money chain the moment the pending count reaches 0 (duyệt/từ chối landed)', () => {
    const onLockSelected = vi.fn();
    const rows = [
      mergeRow({ shipmentId: 1, control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null, pendingFeeCount: 0 } }),
    ];
    renderGrid({ canExportDebitNote: true, onExportDebitNote: vi.fn(), selection: new Set([1]), onLockSelected }, rows);
    fireEvent.click(screen.getByRole('button', { name: 'Khóa lô' }));
    expect(onLockSelected).toHaveBeenCalledWith([1]);
    expect(reasonFor('debit-merge-lock')).toBeNull();
  });

  it('docks the sticky zone: group 1+2 cells carry data-sticky with measured offsets, the last one the separator', () => {
    renderGrid();
    const first = document.querySelector<HTMLElement>('thead th[data-col="ngay"]');
    expect(first).toBeTruthy();
    expect(first!.hasAttribute('data-sticky')).toBe(true);
    expect(first!.style.left).toBe('0px');
    const contType = document.querySelector<HTMLElement>('thead th[data-col="contType"]');
    expect(contType!.hasAttribute('data-sticky')).toBe(true);
    const last = document.querySelector('thead th[data-sticky-last]');
    expect(last).toBeTruthy();
    // SIL-944 (K9.19): the 'Thông số' leaf joins group 2, so the zone edge
    // (the data-sticky-last separator) moved from contType to it.
    expect(last!.getAttribute('data-col')).toBe('thongSo');
    // body cells dock too
    const bodyCell = document.querySelector<HTMLElement>('tbody td[data-col="contType"][data-sticky]');
    expect(bodyCell).toBeTruthy();
  });
});

describe('CR-010.1 — SIL-897 sticky hardening + SIL-900 dropdown picker + SIL-901 pick column', () => {
  it('SIL-901: the pick checkbox is the FIRST leaf, sticky-docked; Trạng thái keeps the lock chip only', () => {
    const onSelectionChange = vi.fn();
    renderGrid({ selection: new Set<number>(), onSelectionChange }, [mergeRow({ shipmentId: 101, billOrBookNumber: 'BL-1' })]);
    const leafHeaders = [...document.querySelectorAll<HTMLElement>('thead tr:last-child th')].map((th) => th.getAttribute('data-col'));
    expect(leafHeaders[0]).toBe('pick');
    const pickTh = document.querySelector<HTMLElement>('thead th[data-col="pick"]');
    expect(pickTh!.hasAttribute('data-sticky')).toBe(true);
    expect(pickTh!.style.left).toBe('0px');
    // The checkbox rides the first BODY cell and keeps the lot-level aria label.
    const pickCell = document.querySelector<HTMLElement>('tbody td[data-col="pick"]');
    expect(pickCell!.hasAttribute('data-sticky')).toBe(true);
    const checkbox = pickCell!.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox!.getAttribute('aria-label')).toBe('Chọn lô BL-1');
    // Trạng thái is chip-only: no checkbox left at the far right.
    const statusCell = document.querySelector<HTMLElement>('tbody td[data-col="trangThai"]');
    expect(statusCell!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(statusCell!.textContent).toContain('Mở');
    // Selection still drives the money actions through the same callback.
    fireEvent.click(checkbox!);
    expect(onSelectionChange).toHaveBeenCalledWith(101, true);
  });

  it('SIL-901 QA round: the pick header carries the page select-all «Tất cả» — picks/clears the page and re-syncs from row picks', () => {
    // A stateful harness mirrors the pages' Set selection so the header's
    // checked/indeterminate sync is proven end-to-end, not via a spy.
    function Harness() {
      const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
      const rows = [
        mergeRow({ shipmentId: 1, billOrBookNumber: 'BL-1' }),
        mergeRow({ shipmentId: 2, billOrBookNumber: 'BL-2' }),
      ];
      return (
        <DebitMergeGrid
          rows={rows}
          storageKey="debit-merge-select-all"
          selection={selection}
          onSelectionChange={(id, next) => setSelection((current) => {
            const set = new Set(current);
            if (next) set.add(id);
            else set.delete(id);
            return set;
          })}
          canLock
          canChooseDebit
          onLockSelected={vi.fn()}
          onChooseDebit={vi.fn()}
        />
      );
    }
    render(<Harness />);
    const headerBox = screen.getByRole('checkbox', { name: 'Tất cả' }) as HTMLInputElement;
    expect(headerBox.checked).toBe(false);
    expect(headerBox.indeterminate).toBe(false);
    // ONE tap picks every row of the current page.
    fireEvent.click(headerBox);
    expect(headerBox.checked).toBe(true);
    for (const label of ['Chọn lô BL-1', 'Chọn lô BL-2']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(true);
    }
    // Clearing ONE row re-syncs the header to the indeterminate dash…
    fireEvent.click(screen.getByLabelText('Chọn lô BL-1'));
    expect(headerBox.checked).toBe(false);
    expect(headerBox.indeterminate).toBe(true);
    // …and restoring it returns the header to fully checked.
    fireEvent.click(screen.getByLabelText('Chọn lô BL-1'));
    expect(headerBox.checked).toBe(true);
    expect(headerBox.indeterminate).toBe(false);
    // The second tap clears the whole page.
    fireEvent.click(headerBox);
    expect(headerBox.checked).toBe(false);
    for (const label of ['Chọn lô BL-1', 'Chọn lô BL-2']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(false);
    }
  });

  it('SIL-901: select-all covers exactly the CURRENT page — page 2 rows stay untouched until their own tap', () => {
    const onSelectionChange = vi.fn();
    const rows = Array.from({ length: DEBIT_MERGE_PAGE_SIZES[0] + 1 }, (_, index) => mergeRow({ shipmentId: index + 1, billOrBookNumber: `BL-${index + 1}` }));
    renderGrid({ onSelectionChange }, rows);
    const headerBox = screen.getByRole('checkbox', { name: 'Tất cả' });
    fireEvent.click(headerBox);
    const picked = onSelectionChange.mock.calls.filter(([, next]) => next === true).map(([id]) => id);
    expect(picked).toEqual(Array.from({ length: DEBIT_MERGE_PAGE_SIZES[0] }, (_, index) => index + 1));
    expect(onSelectionChange).not.toHaveBeenCalledWith(DEBIT_MERGE_PAGE_SIZES[0] + 1, true);
  });

  it('SIL-900: the toolbar hosts ONE dropdown trigger, never the raw checkbox panel', () => {
    renderGrid();
    const trigger = document.querySelector('button.column-picker__trigger');
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger!.textContent).toContain('Cột hiển thị');
    // The 26-checkbox block is closed until the trigger opens it.
    expect(document.querySelector('.column-picker__options')).toBeNull();
  });

  it('AUI-04 (audit 2026-11-27): picker labels disambiguate the repeated Số HĐ/Tiền leaves and the Thực thu twins', () => {
    renderGrid();
    fireEvent.click(document.querySelector('button.column-picker__trigger')!);
    // Group 4 leaves carry their fee-family qualifier; group 5's Thực thu
    // twins name their Ops side instead of two identical bare labels.
    expect(screen.getByText('CSHT · Số HĐ')).toBeTruthy();
    expect(screen.getByText('Nâng/Lưu kho · Tiền')).toBeTruthy();
    expect(screen.getByText('Hạ/Bốc xếp · Thực chi')).toBeTruthy();
    expect(screen.getByText('Phí khác · Số tiền')).toBeTruthy();
    // The renamed twins appear TWICE — picker option + grid leaf header.
    expect(screen.getAllByText('Thực thu (GN OP TC)')).toHaveLength(2);
    expect(screen.getAllByText('Thực thu (PS OP TC)')).toHaveLength(2);
    // The grid keeps the SHORT leaf header — the subs row disambiguates
    // in-table; the 'Thực thu' twins are the only grid-visible rename.
    expect(document.querySelector('th[data-col="cshtHd"]')!.textContent).toContain('Số HĐ');
    expect(document.querySelector('th[data-col="gnPaid"]')!.textContent).toContain('Thực thu (GN OP TC)');
  });

  it('SIL-897: offsets are width sums re-measured on every commit, and every sticky cell carries an explicit opaque z', () => {
    // TSX law: the measure reads WIDTHS (scroll-invariant), not viewport
    // deltas; the effect is dep-free so no commit can render stale docks.
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.tsx'), 'utf8');
    expect(tsx).toMatch(/acc \+= cell\.getBoundingClientRect\(\)\.width;/);
    expect(tsx).not.toMatch(/getBoundingClientRect\(\)\.left - tableLeft/);
    expect(tsx).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?observer\.observe\(table\);[\s\S]*?\n {2}\}\);/);
    // CSS law: explicit z per layer, left cluster above its row peers, all
    // docks opaque — a transparent or z-tied dock lets scrolled money and
    // group headers bleed through.
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const zOf = (selector: string): string | null => {
      const rule = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
      return rule?.match(/z-index:\s*(\d+)/)?.[1] ?? null;
    };
    expect(zOf('.debit-merge__table [data-sticky]')).toBe('1');
    expect(zOf('.debit-merge__table thead tr:last-child th')).toBe('3');
    expect(zOf('.debit-merge__table thead tr:last-child th[data-sticky]')).toBe('4');
    expect(zOf('.debit-merge__subs-row th')).toBe('4');
    expect(zOf('.debit-merge__table thead .debit-merge__subs-row th[data-sticky]')).toBe('5');
    expect(zOf('.debit-merge__groups-row th')).toBe('5');
    expect(zOf('.debit-merge__table thead .debit-merge__groups-row th[data-sticky]')).toBe('6');
    expect(zOf('.debit-merge__table tfoot td[data-sticky]')).toBe('2');
    // Opaque docks.
    expect(css).toMatch(/\.debit-merge__table \[data-sticky\] \{[^}]*background: var\(--surface, #ffffff\)/);
  });

  it('SIL-897 r9: the vertical pins are measured row heights, never hardcoded px', () => {
    // QA round 8: the rows render 28/29/28px while the old CSS pinned the
    // sub band at 31px and the leaf band at 60px — every vertically-pinned
    // pane ran a 3px slit between the group band and the sub band with
    // scrolled body rows bleeding through, and sub labels read as sunk into
    // the column band ('PHÍ KHÁC đè lên vùng row column-header').
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.tsx'), 'utf8');
    expect(tsx).toMatch(/--debit-merge-subs-top/);
    expect(tsx).toMatch(/--debit-merge-leaf-top/);
    expect(tsx).toMatch(/headRows\[0\]\?\.getBoundingClientRect\(\)\.height/);
    expect(tsx).toMatch(/headRows\[1\]\?\.getBoundingClientRect\(\)\.height/);
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.debit-merge__subs-row th \{[^}]*top: var\(--debit-merge-subs-top, 31px\)/);
    expect(css).toMatch(/\.debit-merge__table thead tr:last-child th \{[^}]*top: var\(--debit-merge-leaf-top, 60px\)/);
  });

  it('SIL-897 r9: header labels wrap in the no-truncate span and the sweep hides partial occlusion', () => {
    // QA round 8: 'PHÍ HẠ-CONT / PHÍ BỐC XẾP' reading 'XẾP' — a label half
    // under the dock. The law: wrap every thead label in the sweep span and
    // hide it whole while its cell straddles the dock edge (the label only —
    // the cell keeps its opaque background, so nothing bleeds through).
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.tsx'), 'utf8');
    const labelSpans = tsx.match(/className="debit-merge__head-label"/g) ?? [];
    expect(labelSpans.length).toBe(4); // groups row, subs row, leaf row, SIL-901 pick header's «Tất cả» label
    expect(tsx).toMatch(/debitMergeHeadLabelOccluded\(labelRect\.left, labelRect\.right, zoneEdge\)/);
    expect(tsx).toMatch(/onScroll=\{onPaneScroll\}/);
    expect(tsx).toMatch(/requestAnimationFrame/);
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.debit-merge__head-label\[data-occluded\] \{[^}]*visibility: hidden/);
  });

  it('SIL-1180: the sweep also hides a label straddling the pane\'s RIGHT fold before any scroll', () => {
    // At scrollLeft=0 the CƯỚC PHẢI THU band straddled the pane's right fold
    // and its centered title read chopped mid-word ('CƯỚC PHẢI…'). The same
    // no-half-glyph predicate now guards the fold too, measured from
    // clientWidth so a classic vertical scrollbar narrows the fold.
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.tsx'), 'utf8');
    expect(tsx).toMatch(/const foldEdge = paneRect\.left \+ pane\.clientWidth;/);
    expect(tsx).toMatch(/debitMergeHeadLabelOccluded\(labelRect\.left, labelRect\.right, foldEdge\)/);
  });

  it('SIL-1180: group + sub header titles wrap at spaces, never anywhere, and every token column has a th+td floor', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Wrap-at-spaces law (§4): keep-all + normal overflow-wrap on both band
    // rows, beating the base th/td nowrap later in the file.
    expect(css).toMatch(/\.debit-merge__groups-row th \{[^}]*white-space: normal;[^}]*overflow-wrap: normal;[^}]*word-break: keep-all/s);
    expect(css).toMatch(/\.debit-merge__subs-row th \{[^}]*white-space: normal;[^}]*overflow-wrap: normal;[^}]*word-break: keep-all/s);
    // Per-group-column floors on BOTH th and td (§2).
    expect(css).toMatch(/\.debit-merge__table th\.debit-merge-col--ngay,\s*\.debit-merge__table td\[data-col='ngay'\] \{\s*min-width: 84px;/);
    expect(css).toMatch(/\.debit-merge__table th\.debit-merge-col--lot,\s*\.debit-merge__table td\[data-col='lot'\] \{\s*min-width: 140px;/);
    expect(css).toMatch(/\.debit-merge__table th\.debit-merge-col--cont,\s*\.debit-merge__table td\[data-col='cont'\] \{\s*min-width: 120px;/);
    expect(css).toMatch(/\.debit-merge__table th\.debit-merge-col--contType,\s*\.debit-merge__table td\[data-col='contType'\] \{\s*min-width: 96px;/);
    expect(css).toMatch(/\.debit-merge__table th\.debit-merge-col--trangThai,\s*\.debit-merge__table td\[data-col='trangThai'\] \{\s*min-width: 90px;/);
    // The money floors live on the td side as well as the th side.
    expect(css).toMatch(/\.debit-merge__table td\[data-col='tongTc'\] \{\s*text-align: right;\s*font-variant-numeric: tabular-nums;\s*min-width: 110px;/);
    expect(css).toMatch(/\.debit-merge__table td\.debit-merge-cell--pick \{[^}]*min-width: 72px;/);
  });

  it('SIL-897 r9: the occlusion predicate hides only a cell straddling the dock edge', () => {
    const zone = 460;
    // Fully right of the dock — visible.
    expect(debitMergeHeadLabelOccluded(520, 780, zone)).toBe(false);
    // Fully swallowed — the opaque dock covers it, label stays (no flicker).
    expect(debitMergeHeadLabelOccluded(120, 430, zone)).toBe(false);
    // Straddling the edge — the half-glyph case, hidden.
    expect(debitMergeHeadLabelOccluded(120, 540, zone)).toBe(true);
    // Touching the edge exactly (fractional-px guard) — visible.
    expect(debitMergeHeadLabelOccluded(120, 460.5, zone)).toBe(false);
    expect(debitMergeHeadLabelOccluded(459.5, 780, zone)).toBe(false);
    // One full px inside the zone — straddling, hidden.
    expect(debitMergeHeadLabelOccluded(459, 780, zone)).toBe(true);
  });

  it('SIL-897 r10: a filter-driven rows change resets the horizontal scroll (the board re-enters at the sticky zone)', () => {
    // QA round 10 (MATS7539769000 → '9000' while scrolled): the reflowed
    // result put the CƯỚC PHẢI THU group behind the opaque sticky dock —
    // values in the DOM, invisible on screen. The AC resets scrollLeft = 0
    // on a filter change.
    const baseProps = {
      storageKey: 'debit-merge-test-cols',
      selection: new Set<number>(),
      onSelectionChange: vi.fn(),
      canLock: true,
      canChooseDebit: true,
      onLockSelected: vi.fn(),
      onChooseDebit: vi.fn(),
    };
    const wide = [mergeRow({ shipmentId: 101 }), mergeRow({ shipmentId: 102, billOrBookNumber: 'BL-2' })];
    const narrowed = [mergeRow({ shipmentId: 201, billOrBookNumber: 'MATS7539769000' })];
    const { rerender } = render(<DebitMergeGrid {...baseProps} rows={wide} />);
    const pane = document.querySelector<HTMLElement>('.debit-merge__pane');
    expect(pane).toBeTruthy();
    pane!.scrollLeft = 700;
    expect(pane!.scrollLeft).toBe(700);
    rerender(<DebitMergeGrid {...baseProps} rows={narrowed} />);
    expect(pane!.scrollLeft).toBe(0);
    // The SAME rows array (pagination tap, toolbar re-render) never snaps —
    // the sil852 safePage law keeps a page-2 view in place.
    pane!.scrollLeft = 700;
    rerender(<DebitMergeGrid {...baseProps} rows={narrowed} />);
    expect(pane!.scrollLeft).toBe(700);
    // And a fresh result set re-enters left again (the round-10 repro path).
    rerender(<DebitMergeGrid {...baseProps} rows={wide.map((row) => ({ ...row }))} />);
    expect(pane!.scrollLeft).toBe(0);
  });
});

describe('SIL-923 — the post-lock toolbar slot (Khóa lô → Mở khóa lô / Đã khóa; 24/11: no đề nghị flow)', () => {
  const lockedRow = () => mergeRow({ control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } });

  it('swaps the lock button for [Mở khóa lô] when every picked lot is LOCKED and the viewer clears the unlock trio', () => {
    const onUnlockSelected = vi.fn();
    renderGrid({ selection: new Set<number>([101]), canUnlock: true, onUnlockSelected }, [lockedRow()]);
    expect(screen.queryByRole('button', { name: 'Khóa lô' })).toBeNull();
    const unlock = screen.getByRole('button', { name: 'Mở khóa lô' });
    expect(unlock.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(unlock);
    expect(onUnlockSelected).toHaveBeenCalledWith([101]);
  });

  it('shows the read-only Đã khóa face (no ticketing) for a viewer without unlock clearance', () => {
    renderGrid({ selection: new Set<number>([101]), canUnlock: false }, [lockedRow()]);
    expect(screen.queryByRole('button', { name: 'Khóa lô' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở khóa lô' })).toBeNull();
    // 24/11 (mục 11): static face + pointer to the unlock trio, never a button.
    // (The Trạng thái cell of a locked lot also reads 'Đã khóa' — query the
    // toolbar face by its class.)
    const locked = document.querySelector<HTMLElement>('.debit-merge__action--locked-state');
    expect(locked?.textContent).toBe('Đã khóa');
    expect(locked?.getAttribute('title')).toBe('Liên hệ Kế toán hoặc Quản trị viên để mở khóa nếu cần điều chỉnh');
    expect(screen.queryByRole('button', { name: 'Đề nghị điều chỉnh' })).toBeNull();
  });

  it('keeps [Khóa lô] while any picked lot is still OPEN even with the unlock props wired', () => {
    renderGrid({ selection: new Set<number>([101]), canUnlock: true, onUnlockSelected: vi.fn() }, [mergeRow()]);
    expect(screen.getByRole('button', { name: 'Khóa lô' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mở khóa lô' })).toBeNull();
    expect(screen.queryByText('Đã khóa')).toBeNull();
  });

  it('shows the live selection count while picking (24/11, mục 13)', () => {
    renderGrid({ selection: new Set<number>([101, 102]) }, [mergeRow(), mergeRow({ shipmentId: 102 })]);
    expect(screen.getByRole('status').textContent).toBe('Đã chọn 2 lô');
  });

  it('unwired post-lock slot (no handlers) degrades to the read-only Đã khóa face', () => {
    renderGrid({ selection: new Set<number>([101]), canUnlock: false, onUnlockSelected: undefined }, [lockedRow()]);
    expect(screen.queryByRole('button', { name: 'Mở khóa lô' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đề nghị điều chỉnh' })).toBeNull();
    expect(document.querySelector<HTMLElement>('.debit-merge__action--locked-state')?.getAttribute('title')).toBe('Liên hệ Kế toán hoặc Quản trị viên để mở khóa nếu cần điều chỉnh');
  });
});

describe('SIL-1024 — phí chờ duyệt kèm giờ lưu (HH:MM, giờ VN)', () => {
  const savedAt = '2026-11-25T08:30:00.000Z'; // 15:30 giờ Việt Nam

  it('dòng chi-hộ chờ duyệt hiện tên phí kèm giờ lưu; dòng đã duyệt không có', () => {
    renderGrid({}, [mergeRow({
      chiHo: {
        csht: [], lift: [], drop: [],
        other: [
          { invoiceNumber: null, amount: '100000', feeName: 'Đảo vỏ', pending: true, savedAt },
          { invoiceNumber: '999', amount: '200000', feeName: 'Vệ sinh cont', pending: false },
        ],
      },
    })]);
    expect(screen.getByText('Đảo vỏ · 15:30')).toBeTruthy();
    expect(screen.getByText('Vệ sinh cont').textContent).toBe('Vệ sinh cont');
  });

  it('dòng phí không hóa đơn chờ duyệt hiện giờ lưu trên cột Tên phí', () => {
    renderGrid({}, [mergeRow({
      noInvoice: {
        gnFee: '450000', gnPaid: null, psFee: '100000', psPaid: null,
        fees: [
          { name: 'Chọn vỏ', amount: '450000', side: 'gn', pending: true, savedAt },
          { name: 'Đóng hàng', amount: '50000', side: 'ps', pending: false },
        ],
      },
    })]);
    expect(screen.getByText('Chọn vỏ · 15:30')).toBeTruthy();
    expect(screen.getByText('Đóng hàng').textContent).toBe('Đóng hàng');
  });

  it('chờ duyệt mà thiếu stamp thì không bịa giờ', () => {
    renderGrid({}, [mergeRow({
      chiHo: {
        csht: [], lift: [], drop: [],
        other: [{ invoiceNumber: null, amount: '100000', feeName: 'Đảo vỏ', pending: true }],
      },
    })]);
    expect(screen.getByText('Đảo vỏ').textContent).toBe('Đảo vỏ');
  });
});

describe('DebitMergeGrid — dock-width policy: the sticky zone yields to a squeezed pane', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // `clientWidth` is patched with defineProperty (a getter shadow on the
    // prototype), so it needs its own restore.
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  /** jsdom lays nothing out: give every element a fixed 200×28 box so the
   *  candidate zones measure 1800px (full 9 leaves) / 600px (identity trio)
   *  / 200px (pick rail), and patch the pane width separately. */
  function stubGeometry(paneWidth: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function stubRect(this: Element) {
      return { width: 200, height: 28, left: 0, top: 0, right: 200, bottom: 28, x: 0, y: 0, toJSON: () => ({}) };
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => paneWidth,
    });
  }

  it('the band policy keeps the widest dock that still leaves a usable scroll window', () => {
    const zones = { full: 1800, compact: 600, phone: 200 };
    // Unreadable pane width (jsdom, collapsed pane) — the viewport media law
    // decides alone; the dock never narrows on a guess.
    expect(debitMergeStickyBand(0, zones)).toBe('full');
    expect(debitMergeStickyBand(-1, zones)).toBe('full');
    // Roomy pane (sidebar collapsed on a wide screen): the full zone fits
    // beside the reserve.
    expect(debitMergeStickyBand(2400, zones)).toBe('full');
    // Sidebar expanded on a laptop-width window: the full zone would leave
    // the fee columns no scroll window — the identity trio fits.
    expect(debitMergeStickyBand(1000, zones)).toBe('compact');
    // A pane narrower than the trio: only the pick rail stays docked —
    // row identity and the money actions survive every width.
    expect(debitMergeStickyBand(300, zones)).toBe('phone');
    expect(debitMergeStickyBand(100, zones)).toBe('phone');
  });

  it('a pane too narrow for the full dock docks the identity trio only — the pick rail stays first', () => {
    stubGeometry(1000); // budget 680 admits the 600px trio, not the 1800px full zone
    renderGrid();
    // Scrolled off the dock: the tail of group 1+2 (route, contType, thông số…).
    for (const key of ['customer', 'factory', 'route', 'contType', 'thongSo']) {
      expect(document.querySelector<HTMLElement>(`thead th[data-col="${key}"]`)?.hasAttribute('data-sticky')).toBe(false);
    }
    // Still docked: the identity trio, with the pick rail first and the
    // re-docked offsets (measured width sums: pick 0 → lot 200 → cont 400).
    expect(document.querySelector<HTMLElement>('thead th[data-col="pick"]')?.getAttribute('data-sticky')).toBeDefined();
    expect(document.querySelector<HTMLElement>('thead th[data-col="pick"]')?.style.left).toBe('0px');
    expect(document.querySelector<HTMLElement>('thead th[data-col="lot"]')?.style.left).toBe('200px');
    const contTh = document.querySelector<HTMLElement>('thead th[data-col="cont"]');
    expect(contTh?.hasAttribute('data-sticky')).toBe(true);
    expect(contTh?.style.left).toBe('400px');
    expect(document.querySelector('thead th[data-sticky-last]')?.getAttribute('data-col')).toBe('cont');
    // Body cells follow the same band; the zone edge lands on cont's column.
    expect(document.querySelector<HTMLElement>('tbody td[data-col="pick"][data-sticky]')).toBeTruthy();
    expect(document.querySelector<HTMLElement>('tbody td[data-col="cont"][data-sticky]')).toBeTruthy();
    expect(document.querySelector<HTMLElement>('tbody td[data-col="contType"][data-sticky]')).toBeNull();
    // Both identity group headers keep their dock (group 1 leads at pick,
    // group 2 leads at cont's measured boundary).
    const groupHeaders = [...document.querySelectorAll<HTMLElement>('.debit-merge__groups-row th[data-sticky]')];
    expect(groupHeaders).toHaveLength(2);
    expect(groupHeaders[1]?.style.left).toBe('400px');
  });

  it('a roomy pane keeps the full dock — the policy never narrows on a guess', () => {
    stubGeometry(2400); // budget 2080 ≥ the 1800px full zone
    renderGrid();
    expect(document.querySelector<HTMLElement>('thead th[data-col="thongSo"]')?.hasAttribute('data-sticky')).toBe(true);
    expect(document.querySelector('thead th[data-sticky-last]')?.getAttribute('data-col')).toBe('thongSo');
  });

  it('the pane rides the ResizeObserver beside the table — a sidebar toggle re-measures the dock', () => {
    // The table is content-sized, so expanding the sidebar resizes the pane
    // without moving the table; only an observed pane can re-run the band
    // policy on that resize.
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.tsx'), 'utf8');
    expect(tsx).toMatch(/observer\.observe\(table\);\s*\n\s*const pane = paneRef\.current;\s*\n\s*if \(pane != null\) observer\.observe\(pane\);/);
  });

  it('the dock wears the device-pixel plug — no scrolled glyph may show through a shared boundary', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Every dock paints a separator-colored 1px strip across its left
    // boundary from its own layer, plugging the slit device-pixel snapping
    // can open between two adjacent docked cells while the pane scrolls.
    expect(css).toMatch(/\.debit-merge__table \[data-sticky\] \{[^}]*box-shadow: -1px 0 0 0 var\(--border-1\);/);
    // The zone edge keeps the plug AND the separator inset + dock shadow.
    expect(css).toMatch(/\.debit-merge__table \[data-sticky-last\] \{[^}]*box-shadow: -1px 0 0 0 var\(--border-1\), inset -1px 0 0 var\(--border-2, #cbd5e1\), 6px 0 10px -6px/);
    // The docks stay opaque (the plug paints over the boundary pixel only).
    expect(css).toMatch(/\.debit-merge__table \[data-sticky\] \{[^}]*background: var\(--surface, #ffffff\);/);
  });
});
