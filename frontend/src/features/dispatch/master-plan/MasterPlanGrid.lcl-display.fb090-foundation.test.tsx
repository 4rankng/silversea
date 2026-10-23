// FB-091 — LCL rows on Kế hoạch Tổng quát.
// A containerless lot used to print "Chưa có cont" in Cảng nâng, Cảng hạ and
// Tổng quan hàng hóa: a fact it can never have (LCL + container is refused at
// intake), while the data CUS actually entered for the lot — Kho lấy, Điểm trả,
// kiện / bao bì / kg / CBM — stayed invisible on the dispatch board.
//
// LCL only: every FCL expectation in MasterPlanGrid.test.tsx must stay green
// untouched, and the XLSX export must read the same helper as the grid.

import { render, screen, within } from '@testing-library/react';
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

  it('falls back to the generic package word when CUS named no packaging', () => {
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
    expect(mapMasterPlanExportRow(lclItem())).toEqual(expect.arrayContaining([
      'Kho Lấy Hàng Đồng Nai',
      'Kho Trả Hàng Q.7',
      '5 PALLET\n1,922 tấn · 4 CBM',
    ]));
  });
});