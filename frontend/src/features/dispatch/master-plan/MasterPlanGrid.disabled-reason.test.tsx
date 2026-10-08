/**
 * Card 081026093510 sweep — /dispatch action buttons that disabled silently
 * must explain themselves through the same aria-described + aria-disabled
 * pattern (see components/shared/DisabledActionTip.tsx). The note editor's
 * "Hủy" used to freeze with no word while a save was in flight.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  expectedDeliveryDate: '2026-08-20',
  operationalNotes: 'Ghi chú cũ',
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [],
  ...overrides,
} as ShipmentListItem);

describe('MasterPlanGrid disabled reasons (card 081026093510 sweep)', () => {
  it('the note cancel explains its busy disable while a save is in flight', async () => {
    let resolveSave: () => void = () => {};
    const onUpdateNotes = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    render(<MasterPlanGrid items={[item()]} onAllocate={vi.fn()} onUpdateNotes={onUpdateNotes} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa ghi chú điều phối' }));
    const notesArea = screen.getByLabelText('Ghi chú điều phối');
    fireEvent.change(notesArea, { target: { value: 'Bản nháp mới' } });
    fireEvent.keyDown(notesArea, { key: 'Enter', ctrlKey: true });

    const cancel = screen.getByRole('button', { name: 'Hủy' });
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(cancel).not.toBeDisabled();
    const reasonId = cancel.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)?.textContent).toBe('Đang lưu ghi chú — chưa hủy được.');
    fireEvent.click(cancel);
    // The guard keeps the editor (and the draft) mounted mid-save.
    expect(screen.getByLabelText('Ghi chú điều phối')).toBeTruthy();

    await act(async () => { resolveSave(); });
  });

  it('an idle note cancel carries no reason and cancels', () => {
    render(<MasterPlanGrid items={[item()]} onAllocate={vi.fn()} onUpdateNotes={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa ghi chú điều phối' }));
    const cancel = screen.getByRole('button', { name: 'Hủy' });
    expect(cancel).not.toHaveAttribute('aria-disabled');
    expect(cancel).not.toHaveAttribute('aria-describedby');
    fireEvent.click(cancel);
    expect(screen.queryByLabelText('Ghi chú điều phối')).toBeNull();
  });
});
