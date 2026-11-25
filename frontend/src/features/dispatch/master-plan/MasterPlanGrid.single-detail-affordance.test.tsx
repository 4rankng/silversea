import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { MasterPlanGrid } from './MasterPlanGrid';

const item = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'EXPORT',
  containerCount20: 1,
  containerCount40: 1,
  containerTotal: 2,
  containerTypeSummary: '1 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [],
  ...overrides,
} as ShipmentListItem);

const longNote = 'Lái xe chú ý liên hệ thủ kho trước 30 phút để chuẩn bị bốc xếp hàng hóa cẩn thận, không làm rách bao bì.';
const longFactoryNote = '3. Lưu ý cần chú ý khi đóng/ trả hàng tại nhà máy - Lái xe đăng ký bảo vệ vào đóng/ trả cho công ty Long Minh.';

const visibleLabels = (root: ParentNode): string[] =>
  [...root.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '');

/**
 * One "Chi tiết" identity per row — card 20261004_321 (requirement 2, AC2).
 * The pre-fix row showed two same-labelled "Chi tiết" footnotes (the container
 * detail under Tổng quan hàng hóa + a note detail under Ghi chú) which read as
 * duplicates and appeared on some rows but not others. SIL-877 (QA fail build
 * 32e22c12) retires the note reveal entirely: the GHI CHÚ note wraps whole and
 * its own button opens the full dialog, so the container detail keeps the
 * "Chi tiết" identity (only where there are containers to open) and no note
 * affordance duplicates it. The rule is direction-blind — the Xuất and Nhập
 * rows render the same affordances in the same places.
 */
describe('master-plan grid detail affordances per row', () => {
  it('distinguishes container detail ("Chi tiết cont") from long-note detail ("Chi tiết")', () => {
    render(
      <MasterPlanGrid
        items={[item({ operationalNotes: longNote, factoryNotes: longFactoryNote })]}
        onAllocate={vi.fn()}
      />,
    );

    const contBtns = [...document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Chi tiết cont');
    expect(contBtns).toHaveLength(1);
    expect(contBtns[0].className).toContain('master-plan-grid__container-detail-trigger');

    expect(screen.getByRole('button', { name: 'Xem chi tiết ghi chú điều hành' })).toHaveTextContent('Chi tiết');
    expect(screen.getByRole('button', { name: 'Xem chi tiết ghi chú nhà máy' })).toHaveTextContent('Chi tiết');
    expect(screen.getByText(longNote)).toBeTruthy();
  });

  it('places and behaves identically on Xuất and Nhập rows', () => {
    const shared = { operationalNotes: longNote, factoryNotes: longFactoryNote } satisfies Partial<ShipmentListItem>;
    const { container } = render(
      <MasterPlanGrid
        items={[
          item({ id: 1, tradeDirection: 'EXPORT', ...shared }),
          item({ id: 2, tradeDirection: 'IMPORT', ...shared }),
        ]}
        onAllocate={vi.fn()}
      />,
    );

    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    const structures = rows.map((row) => visibleLabels(row));
    expect(structures[0]).toEqual(structures[1]);
    for (const labels of structures) {
      expect(labels.filter((label) => label === 'Chi tiết cont')).toHaveLength(1);
      expect(labels.filter((label) => label === 'Chi tiết')).toHaveLength(2);
    }

    const classes = rows.map((row) => [...row.querySelectorAll('button')].map((button) => button.className));
    expect(classes[0]).toEqual(classes[1]);
  });

  it('renders no "Chi tiết cont" on a row with no containers while keeping note detail triggers', () => {
    render(
      <MasterPlanGrid
        items={[item({ containerTotal: 0, containerCount20: 0, containerCount40: 0, containerTypeSummary: 'Chưa có cont', operationalNotes: longNote })]}
        onAllocate={vi.fn()}
      />,
    );

    expect([...document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Chi tiết cont')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Xem chi tiết ghi chú điều hành' })).toHaveTextContent('Chi tiết');
    expect(screen.getByText(longNote)).toBeTruthy();
  });

  it('keeps the allocated cell glyph-free and fully inside its column (AC3 clip class)', () => {
    render(
      <MasterPlanGrid
        items={[item({
          allocationStatus: 'FULLY_ALLOCATED',
          carrierAllocationSummary: [{ carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 1, count40: 0 }],
        })]}
        onAllocate={vi.fn()}
      />,
    );

    const chip = screen.getByText((_, element) =>
      Boolean(element?.classList.contains('master-plan-grid__chip')) && element?.textContent === "SilverSea: 1x20'");
    // No glyph rides the chip value — the reported clipped pencil has no node
    // to live on; the values themselves are the full-cell edit trigger.
    expect(chip.querySelectorAll('*')).toHaveLength(0);

    const cell = chip.closest('td');
    expect(cell).toBeTruthy();
    expect(cell!.querySelectorAll('svg, [data-icon]')).toHaveLength(0);
    const buttons = cell!.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Chỉnh sửa phân bổ nhà xe');
  });
});
