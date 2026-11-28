// 28/11 staging audit — the floating bulk bar: while ≥1 lot is picked the
// selection actions ALSO ride a fixed bottom bar (count + Khóa lô/Mở khóa +
// Chọn Debit + Xuất Debit Note), so a reviewer deep in the 3,249px board
// never scrolls back to the toolbar to act. Scoped to the bar itself.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DebitMergeGrid, type DebitMergeGridProps } from './DebitMergeGrid';
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
      storageKey="debit-merge-bulkbar-test-cols"
      selection={new Set<number>()}
      onSelectionChange={vi.fn()}
      canLock
      canChooseDebit
      canExportDebitNote
      onLockSelected={vi.fn()}
      onChooseDebit={vi.fn()}
      onExportDebitNote={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('DebitMergeGrid — floating bulk bar (28/11 audit)', () => {
  it('absent with no selection', () => {
    renderGrid();
    expect(screen.queryByTestId('debit-merge-bulkbar')).toBeNull();
  });

  it('appears on selection with the live count and the primary actions', () => {
    const onLockSelected = vi.fn();
    renderGrid({ selection: new Set([101]), onLockSelected }, [
      mergeRow(),
      mergeRow({ shipmentId: 102, billOrBookNumber: 'BL-2' }),
    ]);

    const bar = screen.getByTestId('debit-merge-bulkbar');
    expect(within(bar).getByText('Đã chọn 1 lô')).toBeTruthy();
    const lock = within(bar).getByRole('button', { name: 'Khóa lô' });
    within(bar).getByRole('button', { name: 'Chọn Debit' });
    within(bar).getByRole('button', { name: 'Xuất Debit Note' });

    // The bar's actions run the SAME callbacks on the SAME selection.
    lock.click();
    expect(onLockSelected).toHaveBeenCalledWith([101]);
  });

  it('the bar\u2019s Chọn Debit runs on an all-locked selection', () => {
    const onChooseDebit = vi.fn();
    renderGrid(
      { selection: new Set([101]), onChooseDebit },
      [mergeRow({ control: { tongTc: null, lockStatus: 'LOCKED', lockedAt: '2026-11-27T00:00:00Z' } })],
    );
    const bar = screen.getByTestId('debit-merge-bulkbar');
    within(bar).getByRole('button', { name: 'Chọn Debit' }).click();
    expect(onChooseDebit).toHaveBeenCalledTimes(1);
    expect(onChooseDebit.mock.calls[0]![0].map((row: DebitMergeItem) => row.shipmentId)).toEqual([101]);
  });

  it('keeps DisabledActionTip description ids unique between toolbar and bar', () => {
    renderGrid({ selection: new Set([101]) });
    // Both mounts render the lock button; their aria-describedby targets must
    // not collide (only one element may own `debit-merge-lock-disabled-reason`).
    const describedBys = [...document.querySelectorAll('button[aria-describedby]')]
      .map((button) => button.getAttribute('aria-describedby'));
    expect(describedBys.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(new Set(describedBys.filter(Boolean)).size).toBe(describedBys.filter(Boolean).length);
  });
});
