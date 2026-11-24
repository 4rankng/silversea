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
 *  - containers: SIL-876 no-compression — EVERY container renders as its own
 *    stacked line (never a '> 2' pill, no expansion step), money stays
 *    lot-level, and the internal SHP-* code never reaches the screen;
 *  - pagination rides the shared Pagination with page sizes [20, 50];
 *  - the column picker (card 20260928_193 mechanism) hosts show/hide;
 *  - Khóa lô / Chọn Debit gating: canLock/canChooseDebit + the completeness
 *    signal (Chọn Debit needs every picked lot LOCKED).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebitMergeGrid, MERGE_TAG_LABEL, PENDING_FEE_TIP, DEBIT_MERGE_PAGE_SIZES, debitMergeHeadLabelOccluded, type DebitMergeGridProps } from './DebitMergeGrid';
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

describe('DebitMergeGrid — 6 nhóm cột với tiêu đề CHÍNH XÁC', () => {
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
    // The five group-5 leaves EXACT — hai cột 'Thực thu' (mỗi họ một cột)
    // đứng cạnh Phí của họ đó; Tên phí đóng cột.
    const leafHeaders = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent);
    expect(leafHeaders).toContain('Phí GN OP TC');
    expect(leafHeaders.filter((label) => label === 'Thực thu')).toHaveLength(2);
    expect(leafHeaders).toContain('Phí PS OP TC');
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
  it('pending money renders an EMPTY cell — never 0, never —', () => {
    renderGrid();
    const cuocCell = document.querySelector('td[data-col="cuoc"]')!;
    expect(cuocCell.textContent!.trim()).toBe('');
    const tongTcCell = document.querySelector('td[data-col="tongTc"]')!;
    expect(tongTcCell.textContent!.trim()).toBe('');
  });

  it('a known 0 renders the muted zero (computed zero is a value)', () => {
    renderGrid({}, [mergeRow({ revenue: { cuoc: '0', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' } })]);
    const cuocCell = document.querySelector('td[data-col="cuoc"]')!;
    expect(cuocCell.textContent).toContain('0');
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

describe('DebitMergeGrid — containers (SIL-876: không nén)', () => {
  it('renders EVERY container as its own stacked line — no "> 2" pill, no expansion step', () => {
    renderGrid({}, [mergeRow({
      billOrBookNumber: 'BL-1',
      containers: [
        { id: 1, containerNumber: 'BSIU1234567', containerType: "20'DC" },
        { id: 2, containerNumber: 'BSIU7654321', containerType: "40'HC" },
        { id: 3, containerNumber: 'MSMU7208543', containerType: "40'HC" },
      ],
      revenue: { cuoc: '1000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '1000' },
    })]);
    const contCell = document.querySelector('td[data-col="cont"]')!;
    expect(contCell.querySelectorAll('.debit-merge-cell__line')).toHaveLength(3);
    expect(contCell).toHaveTextContent('BSIU1234567');
    expect(contCell).toHaveTextContent('BSIU7654321');
    expect(contCell).toHaveTextContent('MSMU7208543');
    const typeCell = document.querySelector('td[data-col="contType"]')!;
    expect(typeCell.querySelectorAll('.debit-merge-cell__line')).toHaveLength(3);
    // Money stays lot-level: exactly ONE cước cell for the row (tfoot's
    // totals cell excluded).
    expect(document.querySelectorAll('tbody td[data-col="cuoc"]')).toHaveLength(1);
    // The compression affordance is GONE — no toggle button anywhere.
    expect(document.querySelector('.debit-merge__cont-toggle')).toBeNull();
    expect(document.querySelector('tr.debit-merge__child-row')).toBeNull();
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
    expect(document.querySelector('td[data-col="psFee"]')!.textContent!.trim()).toBe('');
    expect(document.querySelector('td[data-col="psPaid"]')!.textContent!.trim()).toBe('');
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

    // A LOCKED pick arms Chọn Debit; Khóa lô reports everything already locked.
    rerenderGrid({ selection: new Set<number>([101]), onLockSelected, onChooseDebit, canLock: true, canChooseDebit: true }, [lockedRow]);
    fireEvent.click(document.querySelector('button.debit-merge__action--primary')!);
    expect(onChooseDebit).toHaveBeenCalledTimes(1);
    expect(document.getElementById('debit-merge-lock-disabled-reason')?.textContent).toContain('đều đã khóa');
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
    expect(last!.getAttribute('data-col')).toBe('contType');
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

  it('SIL-900: the toolbar hosts ONE dropdown trigger, never the raw checkbox panel', () => {
    renderGrid();
    const trigger = document.querySelector('button.column-picker__trigger');
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger!.textContent).toContain('Cột hiển thị');
    // The 26-checkbox block is closed until the trigger opens it.
    expect(document.querySelector('.column-picker__options')).toBeNull();
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
    expect(labelSpans.length).toBe(3); // groups row, subs row, leaf row
    expect(tsx).toMatch(/debitMergeHeadLabelOccluded\(labelRect\.left, labelRect\.right, zoneEdge\)/);
    expect(tsx).toMatch(/onScroll=\{onPaneScroll\}/);
    expect(tsx).toMatch(/requestAnimationFrame/);
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.debit-merge__head-label\[data-occluded\] \{[^}]*visibility: hidden/);
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
