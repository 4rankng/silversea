// FB-091 — LCL rows on Kế hoạch Tổng quát.
// A containerless lot used to print "Chưa có cont" in Cảng nâng, Cảng hạ and
// Tổng quan hàng hóa: a fact it can never have (LCL + container is refused at
// intake), while the data CUS actually entered for the lot — Kho lấy, Điểm trả,
// kiện / bao bì / kg / CBM — stayed invisible on the dispatch board.
//
// LCL only: every FCL expectation in MasterPlanGrid.test.tsx must stay green
// untouched, and the XLSX export must read the same helper as the grid.

import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { MasterPlanGrid, cargoCellLines } from './MasterPlanGrid';
import { mapMasterPlanExportRow } from './masterPlanExport';

/** An LCL lot: no containers, no port groups, its own two sites and the CUS
 *  cargo fields the intake form fills ("5 PALLET", 1.922 kg, 4 CBM). */
const lclItem = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 91,
  shipmentCode: 'SS-000091',
  customerName: 'Công ty ABC',
  factoryName: 'Kho Trả Hàng Q.7',
  pickupWarehouseSiteName: 'Kho Lấy Hàng Đồng Nai',
  cargoMode: 'LCL',
  blNumber: 'BL-LCL-2026-091',
  bookingRef: null,
  tradeDirection: 'IMPORT',
  expectedDeliveryDate: '2026-08-20',
  packageCount: 5,
  packageType: 'PALLET',
  cargoWeightKg: '1922.00',
  cargoVolumeCbm: '4.000',
  containerCount20: 0,
  containerCount40: 0,
  containerTotal: 0,
  containerTypeSummary: null,
  totalCargoWeightKg: null,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [],
  ...overrides,
} as ShipmentListItem);

const cell = (label: string): HTMLElement => {
  const found = Array.from(document.querySelectorAll('td'))
    .find((td) => td.getAttribute('data-label') === label);
  if (!found) throw new Error(`no cell labelled ${label}`);
  return found as HTMLElement;
};

describe('MasterPlanGrid — LCL rows (FB-091)', () => {
  it('names the CUS sites in Cảng nâng / Cảng hạ instead of a container placeholder', () => {
    render(<MasterPlanGrid items={[lclItem()]} onAllocate={vi.fn()} />);
    expect(within(cell('Cảng nâng')).getByText('Kho Lấy Hàng Đồng Nai')).toBeTruthy();
    expect(within(cell('Cảng hạ')).getByText('Kho Trả Hàng Q.7')).toBeTruthy();
    // The false fact is gone from the whole row, not just those two cells.
    expect(screen.queryByText('Chưa có cont')).toBeNull();
  });

  it('reads "—" on each side when CUS has entered neither site', () => {
    render(<MasterPlanGrid items={[lclItem({ pickupWarehouseSiteName: null, factoryName: null })]} onAllocate={vi.fn()} />);
    // Exactly one placeholder per side — the lift and the drop.
    expect(within(cell('Cảng nâng')).getAllByText('—')).toHaveLength(1);
    expect(within(cell('Cảng hạ')).getAllByText('—')).toHaveLength(1);
    expect(screen.queryByText('Chưa có cont')).toBeNull();
  });

  it('keeps the sites when only one of them is missing', () => {
    render(<MasterPlanGrid items={[lclItem({ pickupWarehouseSiteName: '   ' })]} onAllocate={vi.fn()} />);
    expect(within(cell('Cảng nâng')).getByText('—')).toBeTruthy();
    expect(within(cell('Cảng hạ')).getByText('Kho Trả Hàng Q.7')).toBeTruthy();
  });

  // FB-105 §3 — the two sides SWAP with the trade direction. Hàng Xuất lấy
  // hàng tại nhà máy và giao tại kho CFS/Cảng, so a hard-coded "kho then nhà
  // máy" printed the two points on the wrong trucks.
  it('swaps the two sides for a Xuất khẩu lot (Nâng = nhà máy, Trả = kho)', () => {
    render(<MasterPlanGrid
      items={[lclItem({ tradeDirection: 'EXPORT', pickupWarehouseSiteName: 'Kho trả hàng Q.7', factoryName: 'Nhà máy Long Hậu' })]}
      onAllocate={vi.fn()}
    />);
    expect(within(cell('Cảng nâng')).getByText('Nhà máy Long Hậu')).toBeTruthy();
    expect(within(cell('Cảng hạ')).getByText('Kho trả hàng Q.7')).toBeTruthy();
    // The Nhập lot of the same two sites reads them the other way round.
    cleanup();
    render(<MasterPlanGrid
      items={[lclItem({ tradeDirection: 'IMPORT', pickupWarehouseSiteName: 'Kho trả hàng Q.7', factoryName: 'Nhà máy Long Hậu' })]}
      onAllocate={vi.fn()}
    />);
    expect(within(cell('Cảng nâng')).getByText('Kho trả hàng Q.7')).toBeTruthy();
    expect(within(cell('Cảng hạ')).getByText('Nhà máy Long Hậu')).toBeTruthy();
  });

  it('falls back to the stored lift/drop text when no catalog site was picked', () => {
    // The intake form writes the typed điểm nâng / điểm hạ into the lot's own
    // columns when CUS chose no site from the catalog (FB-105 §2), so the board
    // still names the points instead of printing '—'.
    render(<MasterPlanGrid
      items={[lclItem({
        pickupWarehouseSiteName: null,
        factoryName: null,
        pickupLocation: 'Kho CFS gõ tay',
        deliveryLocation: 'Nhà máy gõ tay',
      })]}
      onAllocate={vi.fn()}
    />);
    expect(within(cell('Cảng nâng')).getByText('Kho CFS gõ tay')).toBeTruthy();
    expect(within(cell('Cảng hạ')).getByText('Nhà máy gõ tay')).toBeTruthy();
    expect(screen.queryByText('Chưa có cont')).toBeNull();
  });

  it('prints the cargo composition and measures instead of "Chưa có cont"', () => {
    render(<MasterPlanGrid items={[lclItem()]} onAllocate={vi.fn()} />);
    const cargo = cell('Tổng quan hàng hóa');
    expect(within(cargo).getByText('5 PALLET')).toBeTruthy();
    expect(within(cargo).getByText('1,922 tấn · 4 CBM')).toBeTruthy();
    expect(screen.queryByText('Chưa có cont')).toBeNull();
  });

  it('drops the CBM measure — not the line — when the optional volume is blank', () => {
    render(<MasterPlanGrid items={[lclItem({ cargoVolumeCbm: null })]} onAllocate={vi.fn()} />);
    const cargo = cell('Tổng quan hàng hóa');
    expect(within(cargo).getByText('1,922 tấn')).toBeTruthy();
    expect(cargo.textContent).not.toContain('CBM');
  });

  it('keeps both lines when CUS entered neither measure', () => {
    render(<MasterPlanGrid items={[lclItem({ cargoWeightKg: null, cargoVolumeCbm: null })]} onAllocate={vi.fn()} />);
    const cargo = cell('Tổng quan hàng hóa');
    expect(within(cargo).getByText('5 PALLET')).toBeTruthy();
    // The collapsed placeholder is flagged so the phone record card drops it.
    expect(within(cargo).getByText('—').getAttribute('data-empty')).toBe('true');
  });

  it('renders two distinct placeholder lines when every cargo field is null', () => {
    // Intake requires these fields, but the UPDATE path writes them straight
    // through and the wire schema allows null — so a READY LCL lot can be
    // edited down to nothing. Both lines then read "—": they must still render
    // as two elements (a shared React key would collapse them into one).
    const bare = lclItem({ packageCount: null, packageType: null, cargoWeightKg: null, cargoVolumeCbm: null });
    const lines = cargoCellLines(bare);
    expect(lines.map((line) => line.text)).toEqual(['—', '—']);
    expect(lines.every((line) => line.empty)).toBe(true);
    render(<MasterPlanGrid items={[bare]} onAllocate={vi.fn()} />);
    expect(within(cell('Tổng quan hàng hóa')).getAllByText('—')).toHaveLength(2);
  });

  it('drops the packaging word when CUS named none', () => {
    expect(cargoCellLines(lclItem({ packageType: null }))[0]!.text).toBe('5');
    expect(cargoCellLines(lclItem({ packageType: null, packageCount: null }))[0]!.text).toBe('—');
  });

  it('does not narrow an LCL lot on a single-day filter, and never offers the container detail', () => {
    render(<MasterPlanGrid items={[lclItem()]} onAllocate={vi.fn()} scheduleDate="2026-08-20" />);
    expect(within(cell('Cảng nâng')).getByText('Kho Lấy Hàng Đồng Nai')).toBeTruthy();
    expect(within(cell('Tổng quan hàng hóa')).getByText('5 PALLET')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Xem chi tiết container/ })).toBeNull();
  });

  it('leaves an FCL lot on its container demand and port pair', () => {
    const fcl = {
      ...lclItem(),
      cargoMode: 'FCL' as const,
      factoryName: 'Nhà máy XYZ',
      containerCount20: 1,
      containerCount40: 2,
      containerTotal: 3,
      containerTypeSummary: '2 x 40HC + 1 x 20DC',
      totalCargoWeightKg: 41000.75,
      containerPortGroups: [{ pickupPortName: 'Cảng Cát Lái', dropoffPortName: 'Kho Bình Dương', containerSummary: '2 x 40HC + 1 x 20DC' }],
    };
    render(<MasterPlanGrid items={[fcl]} onAllocate={vi.fn()} />);
    expect(within(cell('Cảng nâng')).getByText('Cảng Cát Lái')).toBeTruthy();
    const cargo = within(cell('Tổng quan hàng hóa'));
    // Owner redesign 23/10: the demand joins onto ONE line (đủ 1 dòng).
    expect(cargo.getByText('2 x 40HC + 1 x 20DC')).toBeTruthy();
    expect(screen.queryByText('5 PALLET')).toBeNull();
  });

  it('exports the LCL row through the same helpers the grid renders', () => {
    // Positional, like masterPlanExport.test.ts: the sheet's contract is that
    // it cannot disagree with the screen, so the value must land in the right
    // COLUMN — arrayContaining would pass a swapped-column regression.
    const cells = mapMasterPlanExportRow(lclItem());
    expect(cells).toHaveLength(8);
    expect(cells[3]).toBe('Kho Lấy Hàng Đồng Nai');
    expect(cells[4]).toBe('Kho Trả Hàng Q.7');
    expect(cells[5]).toBe('5 PALLET\n1,922 tấn · 4 CBM');
  });

  it('exports a Xuất khẩu lot with the sides swapped too', () => {
    const cells = mapMasterPlanExportRow(lclItem({ tradeDirection: 'EXPORT' }));
    expect(cells[3]).toBe('Kho Trả Hàng Q.7');
    expect(cells[4]).toBe('Kho Lấy Hàng Đồng Nai');
  });
});

// SIL-589 (id 689) — the cargo cell names the lot's cargo KIND. Before the
// flag, "2 Roll / 0,01 tấn" read identical to a FCL weight line: nothing on
// the row said LCL vs FCL (customer report 29/10/2026), and a lot already
// merged into a ghép-trả-ĐV group was indistinguishable from an unmerged one.
describe('MasterPlanGrid — the Lẻ cargo flag (SIL-589)', () => {
  it('flags an LCL lot "Lẻ" at the cargo cell', () => {
    render(<MasterPlanGrid items={[lclItem()]} onAllocate={vi.fn()} />);
    const cargo = cell('Tổng quan hàng hóa');
    expect(within(cargo).getByText('Lẻ')).toBeTruthy();
    // Ungrouped by default — the Ghép marker must not appear.
    expect(within(cargo).queryByText('Lẻ · Ghép')).toBeNull();
  });

  it('marks a lot already in a ghép-trả-ĐV group "Lẻ · Ghép"', () => {
    render(<MasterPlanGrid
      items={[lclItem({ costGroupId: 'grp-sil589', costGroupOrder: 1, actualTruckNo: '15E-016.26' })]}
      onAllocate={vi.fn()}
    />);
    expect(within(cell('Tổng quan hàng hóa')).getByText('Lẻ · Ghép')).toBeTruthy();
  });

  it('flags a fulfillment-projected LCL lot too (hasActiveLclShipment wins)', () => {
    // The same predicate the CHỌN checkbox uses (isLclLotRow) — the flag can
    // never disagree with the merge-mode checkbox on the same row.
    render(<MasterPlanGrid
      items={[lclItem({ cargoMode: 'FCL' as const, hasActiveLclShipment: true })]}
      onAllocate={vi.fn()}
    />);
    expect(within(cell('Tổng quan hàng hóa')).getByText('Lẻ')).toBeTruthy();
  });

  it('never flags an FCL lot', () => {
    const fcl = {
      ...lclItem(),
      cargoMode: 'FCL' as const,
      hasActiveLclShipment: false,
      containerCount20: 1,
      containerTotal: 1,
      containerTypeSummary: '1 x 40HC',
      totalCargoWeightKg: 21000,
    };
    render(<MasterPlanGrid items={[fcl]} onAllocate={vi.fn()} />);
    expect(within(cell('Tổng quan hàng hóa')).queryByText('Lẻ')).toBeNull();
    expect(within(cell('Tổng quan hàng hóa')).queryByText('Lẻ · Ghép')).toBeNull();
  });
});

// SIL-708 (id 708, QA 30/10) — the flag's PRESENTATION. SIL-589's text-only
// voice read like every other meta line ("chỉ là chữ trơn, khó nhận biết
// nhanh"): QA wants a chip with a background, recognizable at a glance. The
// chip rides the sanctioned --chip-* recipe (SIL-478 verdict); the SIL-589
// logic (isLclLotRow + costGroupId) above is untouched.
describe('MasterPlanGrid — the Lẻ flag is a chip (SIL-708)', () => {
  it('renders the ungrouped flag as a chip with a background', () => {
    render(<MasterPlanGrid items={[lclItem()]} onAllocate={vi.fn()} />);
    const cargo = cell('Tổng quan hàng hóa');
    const chip = cargo.querySelector('.master-plan-grid__lcl-chip');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe('Lẻ');
    // The retired plain-line class is gone — no second voice for the fact.
    expect(cargo.querySelector('.master-plan-grid__lcl-flag')).toBeNull();
    expect(chip?.getAttribute('title')).toBe('Lô hàng lẻ (LCL) — chưa ghép nhóm');
  });

  it('the grouped lot keeps the chip and its BKS title', () => {
    render(<MasterPlanGrid
      items={[lclItem({ costGroupId: 'grp-sil708', costGroupOrder: 1, actualTruckNo: '15E-016.26' })]}
      onAllocate={vi.fn()}
    />);
    const chip = cell('Tổng quan hàng hóa').querySelector('.master-plan-grid__lcl-chip');
    expect(chip?.textContent).toBe('Lẻ · Ghép');
    expect(chip?.getAttribute('title')).toBe('Lô hàng lẻ đã ghép trả ĐV cùng nhóm — BKS thực 15E-016.26');
  });

  it('an FCL row carries no chip element at all', () => {
    const fcl = {
      ...lclItem(),
      cargoMode: 'FCL' as const,
      hasActiveLclShipment: false,
      containerCount20: 1,
      containerTotal: 1,
      containerTypeSummary: '1 x 40HC',
      totalCargoWeightKg: 21000,
    };
    render(<MasterPlanGrid items={[fcl]} onAllocate={vi.fn()} />);
    expect(document.querySelector('.master-plan-grid__lcl-chip')).toBeNull();
  });

  it('pins the chip to the sanctioned --chip-* recipe (tokens only, no raw hex)', () => {
    // LedgerGroupedList.test.tsx precedent: the chip recipe lives ONCE — the
    // SIL-478 tokens — and the pill geometry can't silently drift.
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const rule = css.match(/\.master-plan-grid__lcl-chip\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('height: 24px');
    expect(rule).toContain('border-radius: 999px');
    expect(rule).toContain('border: 1px solid var(--chip-open-border)');
    expect(rule).toContain('background: var(--chip-open-bg)');
    expect(rule).toContain('color: var(--chip-open-text)');
    expect(rule).toContain('white-space: nowrap');
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
