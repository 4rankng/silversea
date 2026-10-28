/**
 * SIL-548 (id 615, spec 23/10 §4.1) — per-lot CƯỚC THU KHÁCH output fields on
 * the /shipments-detail lot row: the THÔNG SỐ CONTAINER cell gains the
 * "Sửa cước thu khách" in-cell editor (Loại xe thu khách + Giá cước nhập tay,
 * the SAME `/shipments/lcl/rev-class` endpoint the settlement strip's
 * DebitLotLclFacts uses), and the PHÂN XE cell offers "Nhập BKS báo khách"
 * even while the lot is UNALLOCATED — with the ghost placeholder + fallback
 * hint («không đặt = Debit Note in BKS thực»).
 *
 * Boundary pins: a lot inside a CUS rev group keeps the GROUP's outputs (the
 * editor fields disable with the tách-nhóm hint); a failed save surfaces the
 * inline role=alert error and keeps the editor open.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';

const { setClass, updateTruck } = vi.hoisted(() => ({ setClass: vi.fn(), updateTruck: vi.fn() }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  setLclLotRevClass: setClass,
  updateLclTruck: updateTruck,
  listDispatchFleetResources: vi.fn(async () => ({ items: [] })),
}));
// The editor body fetches the catalog itself (mounted only while open) —
// the stub keeps the test off react-query, exactly like DebitLotLclFacts.test.
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({
    data: [
      { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
      { id: 9, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 3, deletedAt: null },
      { id: 21, code: 'CONT20', name: "Cont 20'", isContainer: true, sortOrder: 6, deletedAt: null },
    ],
    isLoading: false,
  }),
}));

import { ShipmentContainerLedger } from './ShipmentContainerLedger';

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const lotRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: -71,
  shipmentId: 71,
  shipmentVersion: 3,
  ordinal: 1,
  customerId: 1,
  customerName: 'LOG COM',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'R42CUS-LCL1',
  declarationNumber: null,
  shippingLineName: null,
  isCombined: false,
  classification: 'LCL',
  direction: 'IMPORT',
  containerNumber: null,
  containerTypeLabel: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: null,
  carrierType: null,
  plateNumber: null,
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  revGroupId: null,
  liftSite: null,
  dropoffSite: null,
  transportDate: '2026-10-26',
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
        today="2026-10-26"
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

const specCell = (bill: string) => screen.getByText(bill).closest('tr')!.querySelector('td[data-label="Thông số container"]')!;
const revTrigger = (bill: string) => within(specCell(bill) as HTMLElement).getByRole('button', { name: `Sửa cước thu khách cho lô ${bill}` });

async function pickClass(typed: string, optionName: RegExp) {
  const combo = screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' });
  fireEvent.focusIn(combo);
  fireEvent.click(combo);
  fireEvent.change(combo, { target: { value: typed } });
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

beforeEach(() => {
  setClass.mockReset();
  updateTruck.mockReset();
  setClass.mockResolvedValue({
    shipmentId: 71, reference: 'R42CUS-LCL1', vehicleSizeClassId: 7, vehicleClassCode: '3.5T',
    freightAuto: '3150000', channel: 'TRIP', reason: null,
  });
});

describe('SIL-548 — per-lot cước thu khách trên dòng lô Chi tiết lô hàng (§4.1)', () => {
  it('lô chưa có class → nhãn "Chưa chọn loại xe tính cước" + trigger Sửa cước thu khách', () => {
    ledgerView([lotRow()]);
    expect(within(specCell('R42CUS-LCL1') as HTMLElement).getByText('Chưa chọn loại xe tính cước')).toBeTruthy();
    expect(revTrigger('R42CUS-LCL1')).toBeTruthy();
  });

  it('editor §4.1: Loại xe thu khách + Giá cước; save gọi /lcl/rev-class đúng 2 trường; dòng hiện "Thu: Xe 3.5T"', async () => {
    ledgerView([lotRow()]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));

    expect(screen.getByLabelText(/Giá cước thu khách/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Lưu cước thu khách' });
    // Nothing entered yet → the save is disarmed (no accidental no-op send).
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await pickClass('3.5', /Xe 3\.5 tấn/);
    fireEvent.change(screen.getByLabelText(/Giá cước thu khách/), { target: { value: '2800000' } });
    fireEvent.click(save);

    await screen.findByRole('button', { name: 'Sửa cước thu khách cho lô R42CUS-LCL1' });
    expect(setClass).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 71,
      vehicleSizeClassId: 7,
      freightRevenue: 2800000,
    }));
    // The override-aware spec line reflects the save without a refetch.
    expect(within(specCell('R42CUS-LCL1') as HTMLElement).getByText('Lô hàng lẻ | Thu: Xe 3.5T')).toBeTruthy();
    expect(within(specCell('R42CUS-LCL1') as HTMLElement).queryByText('Chưa chọn loại xe tính cước')).toBeNull();
  });

  it('giá nhập tay một mình cũng lưu được (không đổi loại xe → không gửi vehicleSizeClassId); mở lại đúng class đã lưu', async () => {
    ledgerView([lotRow({ revVehicleClassCode: '3.5T' })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));
    // Reopens on the stored class (the combobox shows the option label).
    expect((screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' }) as HTMLInputElement).value).toBe('Xe 3.5 tấn');

    fireEvent.change(screen.getByLabelText(/Giá cước thu khách/), { target: { value: '3000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cước thu khách' }));

    await screen.findByRole('button', { name: 'Sửa cước thu khách cho lô R42CUS-LCL1' });
    expect(setClass).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 71, freightRevenue: 3000000 }));
    expect(setClass.mock.calls[0][0]).not.toHaveProperty('vehicleSizeClassId');
  });

  it('lô đã trong nhóm ghép (revGroupId) → editor mở nhưng khóa hoàn toàn kèm hướng dẫn tách nhóm', () => {
    ledgerView([lotRow({ revGroupId: 'rev-group-9', revVehicleClassCode: '5T' })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));

    expect(screen.getByText(/tách nhóm \(Hủy ghép\) trước khi chọn loại xe riêng/)).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Giá cước thu khách/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Lưu cước thu khách' }) as HTMLButtonElement).disabled).toBe(true);
    expect(setClass).not.toHaveBeenCalled();
  });

  it('save lỗi (BE 400) → lỗi inline role=alert, editor KHÔNG đóng', async () => {
    setClass.mockRejectedValueOnce(new Error('Lô đã thuộc nhóm ghép cước thu'));
    ledgerView([lotRow()]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));
    await pickClass('5', /Xe 5 tấn/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cước thu khách' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lô đã thuộc nhóm ghép cước thu');
    expect(screen.getByLabelText(/Giá cước thu khách/)).toBeTruthy();
  });

  it('lô CHƯA phân xe vẫn có "Nhập BKS báo khách" — editor mở với hint fallback BKS thực', () => {
    // Nothing allocated (no carrier, no plate, no BKS thực) → the pending
    // branch renders BOTH entry actions.
    ledgerView([lotRow({ actualTruckNo: null })]);
    const vehicleCell = screen.getByText('R42CUS-LCL1').closest('tr')!.querySelector('td[data-label="Phân xe"]')!;
    expect(within(vehicleCell as HTMLElement).getByRole('button', { name: 'Nhập BKS thực cho lô R42CUS-LCL1' })).toBeTruthy();
    fireEvent.click(within(vehicleCell as HTMLElement).getByRole('button', { name: 'Nhập BKS báo khách cho lô R42CUS-LCL1' }));

    const combo = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement;
    expect(combo.placeholder).toBe('Chọn hoặc nhập BKS');
    expect(within(vehicleCell as HTMLElement).getByText(/không đặt = Debit Note in BKS thực/)).toBeTruthy();

    fireEvent.change(combo, { target: { value: '15C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));
    expect(updateTruck).toHaveBeenCalledWith({ shipmentId: 71, billingTruckNo: '15C-999.99' });
  });

  it('lô có BKS thực → Ảo editor ghost đúng BKS thực (fallback sẽ in)', () => {
    ledgerView([lotRow({ actualTruckNo: '15C-111.11' })]);
    const vehicleCell = screen.getByText('R42CUS-LCL1').closest('tr')!.querySelector('td[data-label="Phân xe"]')!;
    fireEvent.click(within(vehicleCell as HTMLElement).getByRole('button', { name: 'Sửa BKS báo khách cho lô R42CUS-LCL1' }));
    expect((screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement).placeholder).toBe('15C-111.11');
  });
});
