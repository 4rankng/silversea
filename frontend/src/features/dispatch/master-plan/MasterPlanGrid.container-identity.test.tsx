import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { MasterPlanGrid } from './MasterPlanGrid';

/**
 * Container identity law (DIS-08, card 211026180428): every container line in
 * the master grid — the count summaries under Cảng nâng/Cảng hạ AND the count
 * lines in the "Tổng quan hàng hóa" cell — renders the SHARED
 * `.ops-container-line` class (operational-table-typography.css pins its
 * weight), while port names and the muted weight line stay regular. Before
 * this law the cargo cell rendered the same "2 x 40HC" fact at 400 while the
 * port column showed 600 — the QA wedge of round 18:04.
 */

const item = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  pickupLocation: 'Cảng Cát Lái',
  deliveryLocation: 'Kho Bình Dương',
  expectedDeliveryDate: '2026-08-20',
  customsCutoffAt: '2026-08-01T05:00:00.000Z',
  operationalNotes: null,
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [
    { pickupPortName: 'Cảng Cát Lái', dropoffPortName: 'Kho Bình Dương', containerSummary: '2 x 40HC + 1 x 20DC' },
  ],
  ...overrides,
} as ShipmentListItem);

const lineInfo = (el: Element) => ({
  text: (el.textContent || '').trim(),
  identity: el.classList.contains('ops-container-line'),
});

describe('MasterPlanGrid — container identity class wiring (DIS-08, card 211026180428)', () => {
  it('bolds the container count lines in the cargo cell AND under the ports, not the port name or weight', () => {
    const { container } = render(<MasterPlanGrid items={[item()]} onAllocate={vi.fn()} />);

    const cargoCell = container.querySelector('td[data-label="Tổng quan hàng hóa"], td[data-label="Hàng"]') as HTMLElement;
    expect(cargoCell).toBeTruthy();
    const cargoLines = Array.from(cargoCell.querySelectorAll('.master-plan-grid__line')).map(lineInfo);
    expect(cargoLines).toHaveLength(3);
    expect(cargoLines[0]).toMatchObject({ text: '2 x 40HC', identity: true });
    expect(cargoLines[1]).toMatchObject({ text: '1 x 20DC', identity: true });
    // The muted weight line is a supporting fact, not container identity.
    expect(cargoLines[2]!.text).toMatch(/tấn$/);
    expect(cargoLines[2]!.identity).toBe(false);

    for (const label of ['Cảng nâng', 'Nâng', 'Cảng hạ', 'Hạ']) {
      const portCell = container.querySelector(`td[data-label="${label}"]`) as HTMLElement;
      if (!portCell) continue;
      const blocks = Array.from(portCell.querySelectorAll('.master-plan-grid__location-block'));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const lines = Array.from(block.children);
        // First line is the port name — regular, no identity class.
        expect(lines[0]!.classList.contains('ops-container-line')).toBe(false);
        // Every container summary after it carries the identity class.
        const summaries = lines.slice(1).map(lineInfo);
        expect(summaries).toHaveLength(2);
        expect(summaries.every((s) => s.identity)).toBe(true);
      }
    }
  });

  it('keeps the "Chưa có cont" placeholder regular — a missing fact is not identity', () => {
    for (const emptySummary of [null, ''] as const) {
      const { container } = render(
        <MasterPlanGrid
          items={[item({ containerTypeSummary: emptySummary as unknown as string, containerPortGroups: [] })]}
          onAllocate={vi.fn()}
        />,
      );
      const cargoCell = container.querySelector('td[data-label="Tổng quan hàng hóa"], td[data-label="Hàng"]') as HTMLElement;
      const placeholder = Array.from(cargoCell.querySelectorAll('.master-plan-grid__line')).find((el) => el.textContent?.includes('Chưa có cont'));
      expect(placeholder, `summary=${JSON.stringify(emptySummary)}`).toBeTruthy();
      expect(placeholder!.classList.contains('ops-container-line')).toBe(false);
    }
  });

  it('leaves LCL package/measure lines regular — they are lot cargo, not container identity', () => {
    const { container } = render(
      <MasterPlanGrid
        items={[item({
          cargoMode: 'LCL',
          packageCount: 5,
          packageType: 'PALLET',
          cargoWeightKg: '1922.00',
          cargoVolumeCbm: '4.000',
        })]}
        onAllocate={vi.fn()}
      />,
    );
    const cargoCell = container.querySelector('td[data-label="Tổng quan hàng hóa"], td[data-label="Hàng"]') as HTMLElement;
    const lines = Array.from(cargoCell.querySelectorAll('.master-plan-grid__line'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.classList.contains('ops-container-line')).toBe(false);
    }
  });
});
