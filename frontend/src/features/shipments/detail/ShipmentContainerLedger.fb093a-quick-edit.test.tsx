/**
 * FB-093a — the BKS báo khách (Ảo) quick edit ARIA/role contract on the CUS
 * "Chi tiết lô hàng" workboard (lclspec §6.1: dòng 2 của PHÂN XE click để sửa
 * nhanh — combobox chọn hoặc gõ text tự do).
 *
 * Distinct from the card-161026232339 suite (business display rules): this
 * file pins the ACCESSIBILITY surface QA R25 re-verified — the second line
 * must be a real pressable control (role button) whose click opens a
 * role=combobox editor with a Lưu/Hủy pair, and the save flows through
 * updateLclTruck. If the trigger ever regresses to static text the board
 * reads fine but nothing is editable — exactly the bug class this locks out.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { ShipmentContainerLedger } from './ShipmentContainerLedger';

const { updateLclTruckMock } = vi.hoisted(() => ({ updateLclTruckMock: vi.fn(async () => ({ updatedShipmentIds: [] })) }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  updateLclTruck: updateLclTruckMock,
}));

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const row = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: 1,
  shipmentId: 1,
  shipmentVersion: 1,
  ordinal: 1,
  customerId: 1,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV149607019409',
  declarationNumber: null,
  shippingLineName: null,
  isCombined: false,
  classification: 'LCL',
  direction: 'IMPORT',
  containerNumber: null,
  containerTypeLabel: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: 'Nhà xe Hùng',
  carrierType: null,
  plateNumber: null,
  actualTruckNo: '15C-111.11',
  billingTruckNo: '15C-999.99',
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: null,
  dropoffSite: null,
  transportDate: '2026-09-10',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null },
  fieldAccess: {
    operationalSiteId: access(),
    containerNumber: access(),
    containerTypeId: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    routeId: access(),
    liftSiteId: access(),
    dropoffSiteId: access(),
  },
  shipmentFieldAccess: {
    factoryName: access(),
    routeId: access(),
    deliveryLocation: access(),
    blNumber: access(),
    bookingRef: access(),
    tradeDirection: access(),
    shippingLineName: access(),
  },
  informationStatus: 'COMPLETE',
  missingFields: [],
  shipmentScheduleEditable: false,
  shipmentNotesEditable: false,
  carrierEditable: false,
  plateEditable: false,
  liftSiteEditable: false,
  dropoffEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: true,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

function ledgerView(rows: ShipmentCusContainerFlatRow[]) {
  return render(
    <MemoryRouter>
      <ShipmentContainerLedger
        rows={rows}
        totalContainers={rows.length}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={null}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />
    </MemoryRouter>,
  );
}

describe('FB-093a — BKS báo khách (Ảo) click-to-edit ARIA contract', () => {
  it('lô hàng lẻ, Ảo ≠ BKS thực: dòng 2 là role=button có tên tiếp cận và title "Sửa BKS ảo"', () => {
    ledgerView([row()]);
    const trigger = screen.getByRole('button', { name: 'BKS ảo: 15C-999.99' });
    expect(trigger.getAttribute('title')).toBe('Sửa BKS ảo');
    // The thực line above it stays static text, not a control.
    expect(screen.getByText('Nhà xe Hùng - BKS Thực: 15C-111.11').closest('button')).toBeNull();
  });

  it('click dòng 2 mở editor: role=combobox "BKS ảo" + cặp Lưu/Hủy', async () => {
    ledgerView([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'BKS ảo: 15C-999.99' }));

    const combo = screen.getByRole('combobox', { name: 'BKS ảo' });
    expect(combo.tagName).toBe('INPUT');
    expect((combo as HTMLInputElement).value).toBe('15C-999.99');
    expect(screen.getByRole('button', { name: 'Lưu BKS ảo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hủy/ })).toBeTruthy();
  });

  it('gõ text tự do rồi Lưu → đúng một updateLclTruck({shipmentId, billingTruckNo})', async () => {
    updateLclTruckMock.mockClear();
    ledgerView([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'BKS ảo: 15C-999.99' }));

    const combo = screen.getByRole('combobox', { name: 'BKS ảo' });
    combo.focus();
    fireEvent.change(combo, { target: { value: '29H-777.77' } });
    // The suggestion popover isolates the footer from the a11y tree; a real
    // user closes it with an outside press — Escape models that here.
    fireEvent.keyDown(combo, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS ảo' }));

    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 1, billingTruckNo: '29H-777.77' });
  });

  it('chưa có BKS ảo: dòng 2 vẫn là role=button (aria-label đặt tên theo lô) và click mở được editor', async () => {
    ledgerView([row({ billingTruckNo: null })]);
    const trigger = screen.getByRole('button', { name: 'Sửa BKS ảo cho lô EGLV149607019409' });
    fireEvent.click(trigger);
    expect(screen.getByRole('combobox', { name: 'BKS ảo' })).toBeTruthy();
  });

  it('container row với xe ảo khác xe thực: cùng một role=button và cùng một luồng lưu', async () => {
    updateLclTruckMock.mockClear();
    ledgerView([row({ isLotLevel: false, classification: 'DOUBLE', containerNumber: 'MSKU1234567', containerTypeLabel: "20'DC" })]);
    fireEvent.click(screen.getByRole('button', { name: 'BKS ảo: 15C-999.99' }));

    const combo = screen.getByRole('combobox', { name: 'BKS ảo' });
    fireEvent.change(combo, { target: { value: '29H-555.55' } });
    fireEvent.keyDown(combo, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS ảo' }));
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 1, billingTruckNo: '29H-555.55' }));
  });
});
