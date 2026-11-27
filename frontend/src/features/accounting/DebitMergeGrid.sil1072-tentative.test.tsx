/**
 * SIL-1072 (K6.55) — the TỔNG TC cell must never read as final money while
 * the lot still carries fees awaiting Kế toán duyệt (KB §6.3: chữ đỏ HOẶC
 * ghi chú "tạm tính"). QA staging build b9ab12e1, lô QBDP-2511-01: the cell
 * showed 3.954.000 in the amber warn tone with NO "tạm tính" text anywhere
 * on the page — the reader could not know the total was provisional.
 *
 * Pinned here:
 *  - pendingFeeCount > 0 on a KNOWN total → the red pending tone AND the
 *    visible "tạm tính" tag with the shared duyệt tooltip;
 *  - no pending fees → no tag, no red (the SIL-801 amber warn stays);
 *  - an UNKNOWN total stays an empty cell — the tag never fabricates a
 *    number (the null-money law; lot 1301's visibility is the fee line's
 *    job, the service-side bucket).
 */
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebitMergeGrid, PENDING_FEE_TIP, type DebitMergeGridProps } from './DebitMergeGrid';
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
      storageKey="debit-merge-sil1072-cols"
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

describe('SIL-1072 — TỔNG TC ghi rõ tạm tính khi còn phí chờ duyệt', () => {
  it('known total + pendingFeeCount > 0 → red pending tone AND the visible "tạm tính" tag', () => {
    renderGrid({}, [mergeRow({
      control: { tongTc: '3954000', lockStatus: 'OPEN', lockedAt: null, pendingFeeCount: 2 },
    })]);
    const cell = document.querySelector<HTMLElement>('tbody td[data-col="tongTc"]')!;
    const value = cell.querySelector('.debit-merge-money__value')!;
    expect(value.textContent).toBe('3.954.000');
    expect(value.className).toContain('debit-merge-money__pending');
    expect(value.getAttribute('title')).toBe(PENDING_FEE_TIP);
    const tag = cell.querySelector('.debit-merge-money__tentative')!;
    expect(tag.textContent).toBe('tạm tính');
    expect(tag.getAttribute('title')).toBe(PENDING_FEE_TIP);
    // The words exist as REAL text on the page (QA greps the whole page for
    // "tạm tính" — color alone was the bug).
    expect(cell.textContent).toContain('tạm tính');
  });

  it('no pending fees → no tag, no red; the SIL-801 amber warn tone stays', () => {
    renderGrid({}, [mergeRow({
      control: { tongTc: '3954000', lockStatus: 'OPEN', lockedAt: null, pendingFeeCount: 0 },
    })]);
    const cell = document.querySelector<HTMLElement>('tbody td[data-col="tongTc"]')!;
    const value = cell.querySelector('.debit-merge-money__value')!;
    expect(value.className).toContain('debit-merge-money__warn');
    expect(value.className).not.toContain('debit-merge-money__pending');
    expect(cell.querySelector('.debit-merge-money__tentative')).toBeNull();
    expect(cell.textContent).not.toContain('tạm tính');
  });

  it('absent pendingFeeCount (old wire) reads as no pending — the tag never appears', () => {
    renderGrid({}, [mergeRow({
      control: { tongTc: '1000000', lockStatus: 'OPEN', lockedAt: null },
    })]);
    const cell = document.querySelector<HTMLElement>('tbody td[data-col="tongTc"]')!;
    expect(cell.querySelector('.debit-merge-money__tentative')).toBeNull();
  });

  it('UNKNOWN total + pending fees → the cell ghosts — (the tag never fabricates a number, SIL-1081)', () => {
    renderGrid({}, [mergeRow({
      control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null, pendingFeeCount: 1 },
    })]);
    const cell = document.querySelector<HTMLElement>('tbody td[data-col="tongTc"]')!;
    expect(cell.textContent!.trim()).toBe('—');
    expect(cell.querySelector('.debit-merge-money__tentative')).toBeNull();
  });

  it('CSS: the tentative tag rides the pending red (#dc2626), small-note sizing', () => {
    const css = readFileSync(resolve(import.meta.dirname, './DebitMergeGrid.css'), 'utf8');
    expect(css).toMatch(/\.debit-merge-money__tentative\s*\{[^}]*color:\s*#dc2626;/s);
    expect(css).toMatch(/\.debit-merge-money__tentative\s*\{[^}]*font-size:\s*11px;/s);
  });
});
