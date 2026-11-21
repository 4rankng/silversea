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
import { DebitMergeGrid, MERGE_TAG_LABEL, DEBIT_MERGE_PAGE_SIZES, type DebitMergeGridProps } from './DebitMergeGrid';
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
    // Money stays lot-level: exactly ONE cước cell for the row.
    expect(document.querySelectorAll('td[data-col="cuoc"]')).toHaveLength(1);
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

  it('group-5 money law: Phí/Thực thu cells render empty when unknown, values when known', () => {
    renderGrid({}, [mergeRow({
      noInvoice: { gnFee: '650000', gnPaid: '450000', psFee: null, psPaid: null, fees: [{ name: 'Làm hàng luồng xanh', amount: '450000' }] },
    })]);
    expect(document.querySelector('td[data-col="gnFee"]')!.textContent).toContain('650.000');
    expect(document.querySelector('td[data-col="gnPaid"]')!.textContent).toContain('450.000');
    expect(document.querySelector('td[data-col="psFee"]')!.textContent!.trim()).toBe('');
    expect(document.querySelector('td[data-col="psPaid"]')!.textContent!.trim()).toBe('');
    expect(document.querySelector('td[data-col="noInvTenPhi"]')!).toHaveTextContent('Làm hàng luồng xanh');
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
