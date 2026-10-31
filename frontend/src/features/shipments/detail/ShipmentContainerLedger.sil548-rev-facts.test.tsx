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
 * editor fields disable — SIL-621: with NO guidance text); a failed save
 * surfaces the inline role=alert error and keeps the editor open. QA id 615
 * re-confirm: a PENDING lot's stored Ảo plate prints on the cell face (pill)
 * — the save persisted all along but the cell never showed it, so it read as
 * lost.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipmentCusContainerFlatRowSchema, type ShipmentCusContainerFlatRow } from '@tingting/shared';

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

// The fixture parses through the SHARED wire schema — the "UI thật" pin for
// QA id 615 round 3 («sửa test pin theo UI thật»): a strict-schema drop of
// `costGroupId` / `revFreightManual`, or a stale fixture key, breaks these
// tests at parse time exactly like a stale producer breaks the real page.
const lotRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}): ShipmentCusContainerFlatRow =>
  shipmentCusContainerFlatRowSchema.parse({
  id: -71,
  shipmentId: 71,
  shipmentVersion: 3,
  ordinal: 1,
  customerId: 1,
  isAdHoc: false,
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
  tripId: null,
  tripStatus: null,
  tripDepartureDate: null,
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  revGroupId: null,
  costGroupId: null,
  revFreightManual: null,
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
    customerId: access(),
    factoryName: access(),
    routeId: access(),
    deliveryLocation: access(),
    blNumber: access(),
    bookingRef: access(),
    declarationNumber: access(),
    tradeDirection: access(),
    shippingLineName: access(),
    packageCount: access(),
    packageType: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    customsCutoffAt: access(),
    closingAt: access(),
    plannedReturnAt: access(),
    customerNotes: access(),
    operationalNotes: access(),
  },
  informationStatus: 'COMPLETE',
  missingFields: [],
  shipmentScheduleEditable: false,
  shipmentNotesEditable: false,
  carrierEditable: false,
  plateEditable: false,
  liftSiteEditable: false,
  dropoffSiteEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: true,
  ...overrides,
  });

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
  // The wire contract: the response ECHOES the saved facts (freightManual =
  // the manual override just written, null = auto-trace; vehicleClassCode =
  // the class after the save) — the same-session reopen-prefill law stores
  // exactly this (QA id 615 round 3).
  setClass.mockImplementation(async (input: { vehicleSizeClassId?: number; freightRevenue?: number }) => ({
    shipmentId: 71, reference: 'R42CUS-LCL1',
    vehicleSizeClassId: input.vehicleSizeClassId ?? 7,
    vehicleClassCode: input.vehicleSizeClassId === 9 ? '5T' : '3.5T',
    freightAuto: '3150000',
    freightManual: input.freightRevenue != null ? String(input.freightRevenue) : null,
    channel: 'TRIP', reason: null,
  }));
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

  it('QA 615 round 3 — reopen CÙNG SESSION sau save hiện đúng class + giá đã lưu (không cần reload)', async () => {
    // The stale row still carries the PRE-save truth — exactly QA's repro
    // (saved Xe 5T + 1.600.000 over an old class).
    ledgerView([lotRow({ revVehicleClassCode: '3.5T' })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));
    await pickClass('5', /Xe 5 tấn/);
    fireEvent.change(screen.getByLabelText(/Giá cước thu khách/), { target: { value: '1600000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cước thu khách' }));
    await screen.findByRole('button', { name: 'Sửa cước thu khách cho lô R42CUS-LCL1' });

    // REOPEN in the same session — before the fix this showed the PRE-save
    // class and a blank price (three times in QA's run).
    fireEvent.click(revTrigger('R42CUS-LCL1'));
    expect((screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' }) as HTMLInputElement).value).toBe('Xe 5 tấn');
    // The NumberField renders the saved VND formatted — QA must SEE the
    // saved 1.600.000, never the blank placeholder again.
    expect((screen.getByLabelText(/Giá cước thu khách/) as HTMLInputElement).value).toBe('1.600.000');
  });

  it('QA 615 round 3 — sau reload: wire revFreightManual prefill đúng giá nhập tay + class; save vẫn khóa khi chưa sửa', () => {
    ledgerView([lotRow({ revVehicleClassCode: '5T', revFreightManual: 1600000 })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));

    expect((screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' }) as HTMLInputElement).value).toBe('Xe 5 tấn');
    expect((screen.getByLabelText(/Giá cước thu khách/) as HTMLInputElement).value).toBe('1.600.000');
    // Prefill is NOT an edit — the save stays disarmed (no double-send).
    expect((screen.getByRole('button', { name: 'Lưu cước thu khách' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lô auto-trace (revFreightManual null) → ô giá mở lại TRỐNG đúng placeholder «Bỏ trống = tự tra»', () => {
    ledgerView([lotRow({ revVehicleClassCode: '5T', revFreightManual: null })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));

    const price = screen.getByLabelText(/Giá cước thu khách/) as HTMLInputElement;
    expect(price.value).toBe('');
    expect(price.placeholder).toBe('Bỏ trống = tự tra bảng giá');
  });

  it('xoá giá đã lưu + Lưu = «Bỏ trống = tự tra»: gửi lại class hiện tại để BE tra lại bảng giá', async () => {
    ledgerView([lotRow({ revVehicleClassCode: '5T', revFreightManual: 1600000 })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));
    fireEvent.change(screen.getByLabelText(/Giá cước thu khách/), { target: { value: '' } });

    const save = screen.getByRole('button', { name: 'Lưu cước thu khách' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await screen.findByRole('button', { name: 'Sửa cước thu khách cho lô R42CUS-LCL1' });
    expect(setClass).toHaveBeenCalledWith({ shipmentId: 71, vehicleSizeClassId: 9 });
    expect(setClass.mock.calls[0][0]).not.toHaveProperty('freightRevenue');
  });

  it('lô đã trong nhóm ghép THU (revGroupId) → editor mở nhưng khóa hoàn toàn, KHÔNG còn text hướng dẫn (SIL-621)', () => {
    ledgerView([lotRow({ revGroupId: 'rev-group-9', revVehicleClassCode: '5T' })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));

    // SIL-621 (owner 30/10): the tách-nhóm guidance text is gone — the lock
    // asserts through the disabled state alone.
    expect(screen.queryByText(/tách nhóm \(Hủy ghép\)/)).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Giá cước thu khách/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Lưu cước thu khách' }) as HTMLButtonElement).disabled).toBe(true);
    expect(setClass).not.toHaveBeenCalled();
  });

  it('QA 615 round 3 (K1K42452354 «Ghép (2/2)») — lô đã ghép chiều COST (costGroupId) cũng KHÓA editor, không còn text (SIL-621)', () => {
    // The QA lot's «Ghép (2/2)» was invisible to the old lock (revGroupId
    // only) — the wire now carries costGroupId and the lock reads it too.
    // SIL-621: the long «Lô đã thuộc nhóm gộp xe…» guidance text is gone;
    // the fields still disable.
    ledgerView([lotRow({ costGroupId: 'cost-group-2', revVehicleClassCode: '5T' })]);
    fireEvent.click(revTrigger('R42CUS-LCL1'));

    expect(screen.queryByText(/Lô đã thuộc nhóm gộp xe/)).toBeNull();
    expect(screen.queryByText(/tách nhóm \(Hủy ghép\)/)).toBeNull();
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

  it('lô CHƯA phân xe vẫn có "Nhập BKS báo khách" — editor mở với hint fallback BKS thực', async () => {
    // Nothing allocated (no carrier, no plate, no BKS thực) → the pending
    // branch renders BOTH entry actions.
    ledgerView([lotRow({ actualTruckNo: null })]);
    const vehicleCell = screen.getByText('R42CUS-LCL1').closest('tr')!.querySelector('td[data-label="Phân xe"]')!;
    expect(within(vehicleCell as HTMLElement).getByRole('button', { name: 'Nhập BKS thực cho lô R42CUS-LCL1' })).toBeTruthy();
    fireEvent.click(within(vehicleCell as HTMLElement).getByRole('button', { name: 'Nhập BKS báo khách cho lô R42CUS-LCL1' }));

    const combo = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement;
    expect(combo.placeholder).toBe('Chọn hoặc nhập BKS');
    // SIL-631: the editor card floats out of the cell (body portal) — the
    // fallback hint is scoped to that card (not the cell), beside the combobox.
    const editorCard = combo.closest('.shipment-container-ledger__inline-editor') as HTMLElement;
    expect(editorCard).toBeTruthy();
    expect(within(editorCard).getByText(/không đặt = Debit Note in BKS thực/)).toBeTruthy();

    fireEvent.change(combo, { target: { value: '15C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));
    expect(updateTruck).toHaveBeenCalledWith({ shipmentId: 71, billingTruckNo: '15C-999.99' });

    // QA id 615 re-confirm: the save DID persist but the pending cell never
    // printed the stored Ảo — before or after reload it looked untouched, so
    // the save read as "không lưu được". The pill must appear immediately
    // (override law, no refetch wait) and the bare entry action step aside.
    expect(await within(vehicleCell as HTMLElement).findByRole('button', { name: 'BKS Báo khách (Ảo): 15C-999.99' })).toBeTruthy();
    expect(within(vehicleCell as HTMLElement).queryByRole('button', { name: 'Nhập BKS báo khách cho lô R42CUS-LCL1' })).toBeNull();
  });

  it('lô chưa phân xe ĐÃ lưu BKS báo khách → reload vẫn in pill Ảo trên cell, click mở lại đúng giá trị (QA id 615)', () => {
    // The wire row comes back with the persisted plate (POST /lcl/truck 200
    // verified live) — the cell face must show it without any editor detour.
    ledgerView([lotRow({ billingTruckNo: '30A-123.45' })]);
    const vehicleCell = screen.getByText('R42CUS-LCL1').closest('tr')!.querySelector('td[data-label="Phân xe"]')!;
    const pill = within(vehicleCell as HTMLElement).getByRole('button', { name: 'BKS Báo khách (Ảo): 30A-123.45' }) as HTMLButtonElement;
    expect(pill.title).toBe('Sửa BKS báo khách');
    expect(within(vehicleCell as HTMLElement).queryByRole('button', { name: 'Nhập BKS báo khách cho lô R42CUS-LCL1' })).toBeNull();

    // Click-to-edit reopens the same Ảo editor, seeded with the stored plate.
    fireEvent.click(pill);
    expect((screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement).value).toBe('30A-123.45');
  });

  it('lô có BKS thực → Ảo editor ghost đúng BKS thực (fallback sẽ in)', () => {
    ledgerView([lotRow({ actualTruckNo: '15C-111.11' })]);
    const vehicleCell = screen.getByText('R42CUS-LCL1').closest('tr')!.querySelector('td[data-label="Phân xe"]')!;
    fireEvent.click(within(vehicleCell as HTMLElement).getByRole('button', { name: 'Sửa BKS báo khách cho lô R42CUS-LCL1' }));
    expect((screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement).placeholder).toBe('15C-111.11');
  });
});
