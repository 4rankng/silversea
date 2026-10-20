import { render, screen, fireEvent } from '@testing-library/react';
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
  tradeDirection: 'IMPORT',
  pickupLocation: 'Cảng Cát Lái',
  deliveryLocation: 'Kho Bình Dương',
  expectedDeliveryDate: '2026-08-20',
  operationalNotes: 'Giao giờ hành chính',
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

/**
 * FB-014 (card 201026112500, QA R26 standing repro): clicking a lot on Kế
 * hoạch Tổng quát must open the lot on Kế hoạch Chi tiết (/dispatch-detail)
 * for full dispatch work. The quick-view container drawer stays on its own
 * 'Chi tiết' trigger, and every other row control keeps its own behavior.
 */
describe('MasterPlanGrid lot row opens dispatch detail (FB-014)', () => {
  it('clicking a plain row cell calls onOpenDispatchDetail with the lot', () => {
    const lot = item();
    const onOpenDispatchDetail = vi.fn();
    render(
      <MasterPlanGrid
        items={[lot]}
        onAllocate={vi.fn()}
        onOpenDispatchDetail={onOpenDispatchDetail}
      />,
    );

    const customerCell = screen.getByText('Công ty ABC').closest('td')!;
    fireEvent.click(customerCell);
    expect(onOpenDispatchDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDispatchDetail).toHaveBeenCalledWith(lot);
  });

  it('the quick-view "Chi tiết" trigger keeps opening the container drawer and never navigates', () => {
    const onOpenDispatchDetail = vi.fn();
    const onViewContainers = vi.fn();
    render(
      <MasterPlanGrid
        items={[item()]}
        onAllocate={vi.fn()}
        onViewContainers={onViewContainers}
        onOpenDispatchDetail={onOpenDispatchDetail}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Xem chi tiết container của BL-2026-001' });
    fireEvent.click(trigger);
    expect(onViewContainers).toHaveBeenCalledTimes(1);
    expect(onOpenDispatchDetail).not.toHaveBeenCalled();
  });

  it('clicking the allocation action cell does not navigate', () => {
    const onOpenDispatchDetail = vi.fn();
    const onAllocate = vi.fn();
    render(
      <MasterPlanGrid
        items={[item()]}
        onAllocate={onAllocate}
        onOpenDispatchDetail={onOpenDispatchDetail}
      />,
    );

    const cell = screen.getByText('Chưa phân bổ').closest('td')!;
    fireEvent.click(cell);
    expect(onAllocate).toHaveBeenCalled();
    expect(onOpenDispatchDetail).not.toHaveBeenCalled();
  });

  it('clicking the note edit trigger does not navigate', () => {
    const onOpenDispatchDetail = vi.fn();
    render(
      <MasterPlanGrid
        items={[item()]}
        onAllocate={vi.fn()}
        onUpdateNotes={vi.fn()}
        onOpenDispatchDetail={onOpenDispatchDetail}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa ghi chú điều phối' }));
    expect(onOpenDispatchDetail).not.toHaveBeenCalled();
  });

  it('Enter on the focused row navigates; keys on inner controls stay theirs', () => {
    const onOpenDispatchDetail = vi.fn();
    render(
      <MasterPlanGrid
        items={[item()]}
        onAllocate={vi.fn()}
        onOpenDispatchDetail={onOpenDispatchDetail}
      />,
    );

    const row = document.querySelector('.master-plan-grid__row') as HTMLTableRowElement;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpenDispatchDetail).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpenDispatchDetail).toHaveBeenCalledTimes(2);
    // A keydown on an inner control (e.g. the notes textarea once editing)
    // targets that element, not the row — the row must not hijack it.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Xem chi tiết container của BL-2026-001' }), { key: 'Enter' });
    expect(onOpenDispatchDetail).toHaveBeenCalledTimes(2);
  });

  it('rows stay inert when the parent does not wire navigation (existing consumers)', () => {
    render(<MasterPlanGrid items={[item()]} onAllocate={vi.fn()} />);
    const row = document.querySelector('.master-plan-grid__row') as HTMLTableRowElement;
    expect(row.tabIndex).toBe(-1);
    expect(row.className).not.toContain('master-plan-grid__row--detail-link');
    fireEvent.click(screen.getByText('Công ty ABC'));
    // No handler wired — nothing to call; the grid must not throw.
  });
});
