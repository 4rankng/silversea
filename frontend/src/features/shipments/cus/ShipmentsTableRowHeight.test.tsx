import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CusShipmentRow } from './CusShipmentRow';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

const access = (mode: string) => ({ mode, reason: `reason:${mode}` });

function makeTestShipment(overrides: {
  id: number;
  customerName?: string;
  factoryName?: string;
  routeName?: string;
  scheduleReadiness?: 'WAITING_DATE' | 'READY' | 'SCHEDULED';
  vehicleReadiness?: string;
  plated?: number;
  issued?: number;
  total?: number;
  missingCarrier?: number;
  appointmentGroups?: Array<{ at: string; localDate: string; containerSummary: string; factoryName?: string | null }>;
  lotScheduleValue?: string | null;
}): ShipmentCusWorkspaceListItem {
  const {
    id,
    customerName = 'LONG MINH',
    factoryName = 'Chưa có nhà máy',
    routeName = 'KCN QUẾ VÕ, BẮC NINH',
    scheduleReadiness = 'READY',
    vehicleReadiness = 'READY',
    plated = 0,
    issued = 0,
    total = 1,
    missingCarrier = 0,
    appointmentGroups = [],
    lotScheduleValue = null,
  } = overrides;

  return {
    id,
    version: 1,
    bucket: 'NEW',
    bucketLabel: 'Mới',
    cargoMode: 'FCL',
    direction: 'IMPORT',
    customerName,
    routeName,
    deliveryLocation: null,
    effectiveFactoryNames: [],
    factoryName,
    isAdHoc: false,
    billOrBookNumber: `BILL-${id}`,
    declarationNumber: null,
    declarationNumbers: [],
    shippingLineName: null,
    isCombined: false,
    containerSummary: `${total}x20DC`,
    weightKg: '1000',
    volumeCbm: null,
    packageCount: 1,
    packageType: 'Cont',
    customerNotes: null,
    operationalNotes: null,
    appointmentGroups,
    plannedReturnAt: lotScheduleValue,
    closingAt: null,
    raw: { isAdHoc: false },
    fieldAccess: {
      factoryName: access('EDITABLE'),
      blNumber: access('EDITABLE'),
      bookingRef: access('EDITABLE'),
      declarationNumber: access('EDITABLE'),
      tradeDirection: access('EDITABLE'),
      shippingLineName: access('EDITABLE'),
      packageCount: access('EDITABLE'),
      packageType: access('EDITABLE'),
      cargoWeightKg: access('EDITABLE'),
      cargoVolumeCbm: access('EDITABLE'),
      customerNotes: access('EDITABLE'),
      operationalNotes: access('EDITABLE'),
    },
    operational: {
      scheduleReadiness,
      vehicleReadiness,
      totalContainers: total,
      assignedContainers: plated,
      externalContainers: 0,
      plateAssignedContainers: plated,
      missingCarrierContainers: missingCarrier,
      missingPlateContainers: 0,
      orderIssuedContainers: issued,
      transportDateEditable: true,
      deletable: true,
    },
    finance: { isLoss: false, hasPendingRecovery: false },
    documentCustody: { status: 'CUSTOMER' },
    accountingConfirmation: { status: 'PENDING' },
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

describe('FB-043 (card 201026164000, regression #33) — shipments table uniform row heights', () => {
  it('CSS contract: schedule lines and status buttons hold bounded single-line layout on desktop table', () => {
    // 1. Schedule cell lines must ellipsize on one nowrap line
    expect(css).toMatch(
      /\.cus-dashboard-table td\[data-label=['"]Lịch trình & điều xe['"]\] \.cus-inline-trigger > \*\s*\{[\s\S]*?white-space:\s*nowrap;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/,
    );

    // 2. Status cell actions must not wrap buttons below status slot
    expect(css).toMatch(
      /\.cus-dashboard-table \.cus-row-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?justify-content:\s*space-between;/,
    );
    expect(css).toMatch(
      /\.cus-dashboard-table \.cus-row-actions__signal\s*\{[\s\S]*?white-space:\s*nowrap;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/,
    );
  });

  it('SIL-540: the schedule cell line box can never clip its glyph ink (no half-cut first line)', () => {
    // Board 606 reported the schedule cell's first line showing only the
    // bottom half of its glyphs, touching the line beneath. At HEAD the cell
    // measures ink 13px inside a 14.85px line box (≈0.9px slack per side) with
    // a 3px grid gap between lines — structurally impossible to clip — and
    // the reported state was not reproducible across 8 widths × 2 DPR × 3
    // font stacks × 80 real rows (qa/2026-10-28_sil540-schedule-cell/).
    // These pins hold the two invariants that make the reported class
    // impossible; breaking either reopens the defect.
    //
    // Invariant 1 — the trigger's line-height factor stays ≥ 1.35: the app's
    // Vietnamese faces carry ≈1.21em of glyph ink, so 1.35 leaves ≥0.07em of
    // half-leading per side and `overflow: hidden` (FB-043) can never shave
    // the top of a line under device-pixel rounding or font fallback.
    const triggerRule = [...css.matchAll(/\.cus-inline-trigger\s*\{[^}]*\}/g)]
      .map((match) => match[0])
      .find((rule) => rule.includes('display: grid')) ?? '';
    const lineHeight = Number(triggerRule.match(/line-height:\s*([\d.]+)/)?.[1]);
    expect(lineHeight).toBeGreaterThanOrEqual(1.35);

    // Invariant 2 — the cell's lines stay separated grid rows (3px gap), so
    // two facts can never fuse into one overlapping run.
    expect(triggerRule).toMatch(/display:\s*grid;/);
    expect(triggerRule).toMatch(/gap:\s*3px;/);
  });

  it('DOM contract: schedule cell renders exactly one dispatch status line, never duplicating or stacking', () => {
    // Row 1: Unassigned (plated=0, issued=0)
    const unassigned = makeTestShipment({
      id: 1,
      scheduleReadiness: 'WAITING_DATE',
      vehicleReadiness: 'WAITING_CARRIER',
      plated: 0,
      issued: 0,
      total: 2,
    });

    // Row 2: Assigned not issued (plated=2, issued=0)
    const plated = makeTestShipment({
      id: 2,
      scheduleReadiness: 'WAITING_DATE',
      vehicleReadiness: 'READY',
      plated: 2,
      issued: 0,
      total: 2,
    });

    // Row 3: Issued (plated=2, issued=2)
    const issued = makeTestShipment({
      id: 3,
      scheduleReadiness: 'SCHEDULED',
      vehicleReadiness: 'READY',
      plated: 2,
      issued: 2,
      total: 2,
      appointmentGroups: [{
        at: '2026-09-25T17:22:00.000Z',
        localDate: '25/09/2026',
        containerSummary: '1x20DC',
        factoryName: 'ASKEY-1',
      }],
    });

    const { container } = render(
      <MemoryRouter>
        <table className="cus-dashboard-table">
          <tbody>
            <CusShipmentRow
              item={unassigned}
              dateFrom=""
              dateTo=""
              editing={false}
              quickEditOpen={false}
              savingQuickEdit={false}
              onStartQuickEdit={vi.fn()}
              onOpenDetail={vi.fn()}
            />
            <CusShipmentRow
              item={plated}
              dateFrom=""
              dateTo=""
              editing={false}
              quickEditOpen={false}
              savingQuickEdit={false}
              onStartQuickEdit={vi.fn()}
              onOpenDetail={vi.fn()}
            />
            <CusShipmentRow
              item={issued}
              dateFrom=""
              dateTo=""
              editing={false}
              quickEditOpen={false}
              savingQuickEdit={false}
              onStartQuickEdit={vi.fn()}
              onOpenDetail={vi.fn()}
            />
          </tbody>
        </table>
      </MemoryRouter>,
    );

    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);

    // Row 1 (Unassigned): renders "Toàn bộ chờ phân xe", exactly 1 status line in .cus-schedule-status-row
    const r1Sched = rows[0].querySelector('td[data-label*="Lịch trình"] .cus-inline-trigger')!;
    expect(within(r1Sched as HTMLElement).getByText('Toàn bộ chờ phân xe')).toBeTruthy();
    expect(r1Sched.children).toHaveLength(2); // "Chưa chốt ngày" + .cus-schedule-status-row

    // Row 2 (Plated): renders "Đã điều xe" in .cus-schedule-status-row
    const r2Sched = rows[1].querySelector('td[data-label*="Lịch trình"] .cus-inline-trigger')!;
    expect(within(r2Sched as HTMLElement).getByText('Đã điều xe')).toBeTruthy();
    expect(r2Sched.children).toHaveLength(2); // "Chưa chốt ngày" + .cus-schedule-status-row

    // Row 3 (Issued): renders "Đã phát lệnh cho tài xế", appointment group line instead of "Chưa chốt ngày"
    const r3Sched = rows[2].querySelector('td[data-label*="Lịch trình"] .cus-inline-trigger')!;
    expect(within(r3Sched as HTMLElement).getByText('Đã phát lệnh cho tài xế')).toBeTruthy();
    expect(within(r3Sched as HTMLElement).queryByText('Chưa chốt ngày')).toBeNull();
    expect(r3Sched.children).toHaveLength(2); // appointment line + .cus-schedule-status-row
  });

  it('asserts row height uniform: getBoundingClientRect comparison across rows has spread <= 1.5px', () => {
    // Model realistic rendered cell heights: each line = 18px + 3px gap, cell padding = 20px (10px top + 10px bottom).
    // In CSS table layout, a tr offsetHeight / getBoundingClientRect.height equals the tallest td + padding.
    const LINE_H = 18;
    const GAP = 3;
    const PADDING = 20;

    const items = [
      makeTestShipment({ id: 1, scheduleReadiness: 'WAITING_DATE', vehicleReadiness: 'WAITING_CARRIER', plated: 0 }),
      makeTestShipment({ id: 2, scheduleReadiness: 'WAITING_DATE', vehicleReadiness: 'READY', plated: 2, issued: 0 }),
      makeTestShipment({ id: 3, scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', plated: 2, issued: 2, appointmentGroups: [{ at: '2026-09-25T17:22:00Z', localDate: '25/09/2026', containerSummary: '1x20DC' }] }),
      makeTestShipment({ id: 4, missingCarrier: 1 }), // with attention signal
    ];

    const { container } = render(
      <MemoryRouter>
        <table className="cus-dashboard-table">
          <tbody>
            {items.map((item) => (
              <CusShipmentRow
                key={item.id}
                item={item}
                dateFrom=""
                dateTo=""
                editing={false}
                quickEditOpen={false}
                savingQuickEdit={false}
                onStartQuickEdit={vi.fn()}
                onOpenDetail={vi.fn()}
              />
            ))}
          </tbody>
        </table>
      </MemoryRouter>,
    );

    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(4);

    // Mock getBoundingClientRect on tr based on the max visible child lines across any cell in the row
    const rectSpy = vi.spyOn(HTMLTableRowElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLTableRowElement) {
      // Baseline 3 lines from the identity cell (customer name, factory, route)
      let maxLines = 3;
      const schedTrigger = this.querySelector('td[data-label*="Lịch trình"] .cus-inline-trigger');
      if (schedTrigger && schedTrigger.children.length > maxLines) {
        maxLines = schedTrigger.children.length;
      }
      const height = Math.round((maxLines * LINE_H + (maxLines - 1) * GAP + PADDING) * 10) / 10;
      return { top: 0, bottom: height, left: 0, right: 1000, width: 1000, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });

    try {
      const heights = [...rows].map((r) => r.getBoundingClientRect().height);
      const min = Math.min(...heights);
      const max = Math.max(...heights);
      const spread = max - min;

      // FB-043 / requirement #33 pass criterion: spread <= 1.5px across all rows
      expect(spread).toBeLessThanOrEqual(1.5);
      expect(heights.every((h) => h === heights[0])).toBe(true);
    } finally {
      rectSpy.mockRestore();
    }
  });
});
