/**
 * FB-092 — "Gán xe nhóm" dialog: lot order list, billing-BKS auto-copy, the
 * FB-090/161026232309 vehicle-source rule (truck-tonnage classes are 100% xe
 * ngoài and their plate list only carries that nhà xe's fleet; container
 * classes accept the SilverSea fleet OR a nhà xe), the persisted-source
 * redisplay, and the assign call's payload (161026232319 manual cước trả).
 */
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const assignMock = vi.fn();
const fleetMock = vi.fn();
vi.mock('../../../api/dispatchPlanningClient', () => ({
  assignLclCostGroup: (input: unknown) => assignMock(input),
  listDispatchFleetResources: (resource: string, filters: unknown) => fleetMock(resource, filters),
}));
const toastMock = vi.fn();
vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));
const truckClasses = [
  { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
  { id: 12, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8, deletedAt: null },
];
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
  useTrucksAndDrivers: () => ({
    data: { trucks: [{ id: 1, licensePlate: '31B-777.99' }], drivers: [] },
    isLoading: false,
  }),
}));
// The house carrier list (DispatchAllocationPopover's own hook): OWN + every
// active isCarrier customer. Mutable so one case can pin the empty-catalog
// notice.
const carrierOptions = [
  { key: 'OWN', label: 'Đội xe nội bộ SilverSea', carrierType: 'OWN', externalCarrierId: null, isActive: true },
  { key: 'EXTERNAL:41', label: 'Nhà xe Hải Vân', carrierType: 'EXTERNAL', externalCarrierId: 41, isActive: true },
  { key: 'EXTERNAL:42', label: 'Nhà xe Bình Minh', carrierType: 'EXTERNAL', externalCarrierId: 42, isActive: true },
];
let carrierCatalog = { options: carrierOptions, empty: false };
vi.mock('../master-plan/useCarrierAllocationOptions', () => ({
  useCarrierAllocationOptions: () => ({
    ...carrierCatalog, loading: false, error: false, reload: vi.fn(),
  }),
}));

import { AssignTruckGroupDialog, lclGroupRowFromDetail } from './AssignTruckGroupDialog';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const row = (shipmentId: number, bill: string): DispatchDetailPlanRow => ({
  fulfillmentId: shipmentId,
  version: 1,
  shipmentId,
  shipmentVersion: 1,
  shipmentCode: null,
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty Lẻ', factoryName: null, deliveryPoint: null, routeName: null },
  docs: { billNumber: bill, tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '900.00' },
  lcl: { packageCount: 3, packageType: 'KIỆN', cargoVolumeCbm: '2.000', group: null },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  plannedEndAt: null,
  classification: 'SINGLE' as const,
  lotFullyPlated: false,
} as DispatchDetailPlanRow);

function renderDialog(rows: DispatchDetailPlanRow[]) {
  return render(
    <AssignTruckGroupDialog rows={rows.map(lclGroupRowFromDetail)} onClose={vi.fn()} onAssigned={vi.fn()} />,
  );
}

async function openFieldOptions(label: RegExp, text = '') {
  const combo = screen.getByRole('combobox', { name: label });
  fireEvent.focusIn(combo);
  // RAC opens a closed combobox on ArrowDown; a bare click only re-fires the
  // press contract (the first field of the dialog is open-on-focus already).
  fireEvent.keyDown(combo, { key: 'ArrowDown' });
  fireEvent.click(combo);
  if (text) fireEvent.change(combo, { target: { value: text } });
  return screen.findAllByRole('option');
}

function setField(label: RegExp, value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
}

async function pickVehicleClass(name: string) {
  const options = await openFieldOptions(/Loại xe tính cước trả ĐV/, name);
  const option = options.find((item) => item.textContent?.includes(name));
  expect(option, `vehicle class option ${name}`).toBeTruthy();
  fireEvent.click(option!);
}

async function pickCarrier(name: string) {
  const options = await openFieldOptions(/^Nhà xe/, name);
  const option = options.find((item) => item.textContent?.includes(name));
  expect(option, `carrier option ${name}`).toBeTruthy();
  fireEvent.click(option!);
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Gán nhóm xe' }));
}

describe('FB-092 — AssignTruckGroupDialog', () => {
  beforeEach(() => {
    assignMock.mockReset();
    toastMock.mockReset();
    fleetMock.mockReset();
    carrierCatalog = { options: carrierOptions, empty: false };
    fleetMock.mockImplementation(async (_resource: string, filters: { carrierId?: number }) => ({
      items: filters.carrierId === 41
        ? [{ id: 501, carrierId: 41, licensePlate: '29H-111.11', isActive: true }]
        : [{ id: 502, carrierId: 42, licensePlate: '43H-999.99', isActive: true }],
      total: 1,
      limit: 50,
      nextCursor: null,
    }));
  });

  it('lists the selected lots in operator order and stays closed without rows', () => {
    const { rerender } = renderDialog([]);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    rerender(<AssignTruckGroupDialog rows={[row(31, 'BL-1'), row(32, 'BL-2')].map(lclGroupRowFromDetail)} onClose={vi.fn()} onAssigned={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Lô 1 · BL-1');
    expect(items[1]!.textContent).toContain('Lô 2 · BL-2');
  });

  it('xe tải: bắt buộc chọn Nhà xe (xe ngoài), danh sách BKS chỉ có biển của nhà xe (161026232309)', async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');

    // No carrier ⇒ the form refuses (the field is required).
    setField(/BKS thực/, '29H-111.11');
    submit();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('100% xe ngoài');
    });
    expect(assignMock).not.toHaveBeenCalled();

    // The SilverSea internal fleet is not even offered on a truck class.
    const carriers = await openFieldOptions(/^Nhà xe/, 'xe');
    const labels = carriers.map((item) => item.textContent ?? '');
    expect(labels.some((label) => label.includes('Đội xe nội bộ SilverSea'))).toBe(false);
    const haiVan = carriers.find((item) => item.textContent?.includes('Nhà xe Hải Vân'));
    expect(haiVan).toBeTruthy();
    fireEvent.click(haiVan!);

    // Picking the nhà xe carries its own fleet into the plate list.
    await waitFor(() => expect(fleetMock).toHaveBeenCalledWith('EXTERNAL_VEHICLE', { carrierId: 41, limit: 50 }));
    const plates = await openFieldOptions(/BKS thực/);
    const plateLabels = plates.map((item) => item.textContent ?? '');
    expect(plateLabels).toEqual(['29H-111.11']);
    expect(plateLabels.some((label) => label.includes('31B-777.99'))).toBe(false);

    fireEvent.click(plates[0]!);
    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock.mock.calls[0]![0]).toMatchObject({
      shipmentIds: [31, 32],
      vehicleSizeClassId: 7,
      actualTruckNo: '29H-111.11',
      carrierType: 'EXTERNAL',
      carrierId: 41,
    });
  });

  it('xe tải: từ chối BKS xe nội bộ kể cả khi đã chọn nhà xe (161026232309)', async () => {
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    await pickCarrier('Nhà xe Hải Vân');
    setField(/BKS thực/, '31B-777.99');
    submit();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('100% xe ngoài');
    });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("cont: cho phép chọn Đội xe nội bộ SilverSea, danh sách BKS là xe nội bộ (161026232309)", async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Container 20 feet');

    const carriers = await openFieldOptions(/^Nhà xe/, 'xe');
    expect(carriers.map((item) => item.textContent ?? '').some((label) => label.includes('Đội xe nội bộ SilverSea'))).toBe(true);

    await pickCarrier('Đội xe nội bộ SilverSea');
    const plates = await openFieldOptions(/BKS thực/);
    expect(plates.map((item) => item.textContent)).toEqual(['31B-777.99']);
    fireEvent.click(plates[0]!);
    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    const payload = assignMock.mock.calls[0]![0];
    expect(payload).toMatchObject({
      shipmentIds: [31, 32],
      vehicleSizeClassId: 12,
      actualTruckNo: '31B-777.99',
      carrierType: 'OWN',
    });
    expect(payload).not.toHaveProperty('carrierId');
  });

  it('auto-copies the billing BKS from the actual one (FB092-03)', async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    await pickCarrier('Nhà xe Hải Vân');
    setField(/BKS thực/, '29H-111.11');
    const billing = screen.getByRole('combobox', { name: /BKS báo khách/ }) as HTMLInputElement;
    await waitFor(() => expect(billing.value).toBe('29H-111.11'));
    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    // Billing equals actual ⇒ the server-side default applies; no explicit
    // billingTruckNo rides the payload.
    expect(assignMock.mock.calls[0]![0]).not.toHaveProperty('billingTruckNo');
  });

  it('cho phép sửa BKS báo khách cho từng lô trong nhóm (SPEC 18/10/2026 §2.3)', async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    await pickCarrier('Nhà xe Hải Vân');
    setField(/BKS thực/, '29H-111.11');

    // Group default stays the actual plate; only Lô 2 gets its own ảo plate.
    fireEvent.change(screen.getByRole('combobox', { name: /Lô 2 — BL-2/ }), {
      target: { value: '29H-999.99' },
    });

    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock.mock.calls[0]![0]).toMatchObject({
      shipmentIds: [31, 32],
      billingTruckNos: [{ shipmentId: 32, billingTruckNo: '29H-999.99' }],
    });
    // The group field was untouched ⇒ no group-level default is sent.
    expect(assignMock.mock.calls[0]![0]).not.toHaveProperty('billingTruckNo');
  });

  it('gửi cước trả ĐV nhập tay khi có, bỏ trống thì để server tự tra (161026232319)', async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    await pickCarrier('Nhà xe Hải Vân');
    setField(/BKS thực/, '29H-111.11');

    const freight = screen.getByLabelText(/Cước trả ĐV Lô 1/) as HTMLInputElement;
    fireEvent.change(freight, { target: { value: '1250000' } });
    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock.mock.calls[0]![0]).toMatchObject({ freightCost: 1_250_000 });

    // Blank ⇒ the property is absent: the server traces the price board.
    assignMock.mockClear();
    fireEvent.change(freight, { target: { value: '' } });
    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock.mock.calls[0]![0]).not.toHaveProperty('freightCost');
  });

  it('danh mục chưa có Nhà xe (Xe ngoài): hiện nhắc quản trị (161026232309)', async () => {
    carrierCatalog = { options: [carrierOptions[0]!], empty: true };
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    expect(screen.getByText(/chưa có Nhà xe \(Xe ngoài\)/)).toBeTruthy();
  });

  it('mở lại lô đã vào nhóm: hiện lại loại xe, nhà xe đã lưu và BKS (161026232309)', async () => {
    const grouped = row(31, 'BL-1');
    grouped.lcl = {
      packageCount: 3,
      packageType: 'KIỆN',
      cargoVolumeCbm: '2.000',
      group: {
        groupId: 'grp-1',
        order: 1,
        memberCount: 2,
        actualTruckNo: '29H-111.11',
        billingTruckNo: '29H-999.99',
        vehicleClassCode: '3.5T',
        vehicleClassName: 'Xe 3.5 tấn',
      },
    };
    grouped.dispatch = {
      ...grouped.dispatch,
      carrierType: 'EXTERNAL',
      carrierName: 'Nhà xe Hải Vân',
      externalCarrierId: 41,
      assignedPlate: '29H-111.11',
    };

    renderDialog([grouped, row(32, 'BL-2')]);

    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: /^Nhà xe/ }) as HTMLInputElement).value)
        .toContain('Nhà xe Hải Vân');
    });
    expect((screen.getByRole('combobox', { name: /Loại xe tính cước trả ĐV/ }) as HTMLInputElement).value)
      .toContain('Xe 3.5 tấn');
    expect((screen.getByRole('combobox', { name: /BKS thực/ }) as HTMLInputElement).value)
      .toBe('29H-111.11');
    expect((screen.getByRole('combobox', { name: /BKS báo khách/ }) as HTMLInputElement).value)
      .toBe('29H-999.99');
  });

  it('giữ lựa chọn Loại xe + Nhà xe qua một lần "Hủy" rồi mở lại (card _171026133000)', async () => {
    // The popup unmounts on close, so every internal pick dies with it — the
    // draft has to live one level up. This harness mirrors what
    // DispatchDetailPlanPage does with groupDraft.
    function Harness() {
      const [open, setOpen] = useState(false);
      const [draft, setDraft] = useState({ vehicleClassId: '', carrierKey: '' });
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>mở nhóm</button>
          {open && (
            <AssignTruckGroupDialog
              rows={[row(31, 'BL-1'), row(32, 'BL-2')].map(lclGroupRowFromDetail)}
              initialVehicleClassId={draft.vehicleClassId}
              initialCarrierKey={draft.carrierKey}
              onDraftChange={(next) => setDraft((cur) => (
                cur.vehicleClassId === next.vehicleClassId && cur.carrierKey === next.carrierKey
                  ? cur
                  : next
              ))}
              onClose={() => setOpen(false)}
              onAssigned={vi.fn()}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const classField = () => screen.getByRole('combobox', { name: /Loại xe tính cước trả ĐV/ }) as HTMLInputElement;
    const carrierField = () => screen.getByRole('combobox', { name: /^Nhà xe/ }) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'mở nhóm' }));
    await pickVehicleClass('Container 20 feet');
    await pickCarrier('Nhà xe Hải Vân');
    expect(classField().value).toContain('Container 20 feet');
    expect(carrierField().value).toContain('Nhà xe Hải Vân');

    // "Hủy" without assigning: the popup goes away entirely.
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('combobox', { name: /Loại xe tính cước trả ĐV/ })).toBeNull();

    // Reopen: both picks came back instead of resetting to the placeholders.
    fireEvent.click(screen.getByRole('button', { name: 'mở nhóm' }));
    expect(classField().value).toContain('Container 20 feet');
    expect(carrierField().value).toContain('Nhà xe Hải Vân');
  });

  // FB-066 — the "BKS thực" picker carries the "+ Thêm nhanh" quick-add
  // affordance once a vehicle source is chosen (own fleet or a nhà xe), so a
  // dispatcher registers a brand-new plate without leaving the Gán xe nhóm
  // flow (r25 guide step 3, lclspec). It stays hidden with no source picked.
  it('FB-066: "BKS thực" shows + Thêm nhanh once a nhà xe (external) is chosen', async () => {
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');

    // No vehicle source yet ⇒ no quick-add affordance.
    expect(screen.queryByRole('button', { name: /Thêm nhanh/ })).toBeNull();

    await pickCarrier('Nhà xe Hải Vân');
    expect(screen.getByRole('button', { name: /Thêm nhanh/ })).toBeTruthy();
  });

  it('FB-066: own-fleet source also offers the quick-add (internal tractor path)', async () => {
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Container 20 feet');
    await pickCarrier('Đội xe nội bộ SilverSea');
    expect(screen.getByRole('button', { name: /Thêm nhanh/ })).toBeTruthy();
  });
});

// ─── REQ-19 depth audit (2026-10-21) — tải trọng fit advisory ────────────────
//
// The consolidated group's Σkg vs the picked class, as the shared assessor
// computes it (the same law the BE stamps on the assign result + audit).
// Advisory only: the OVER line is loud but never blocks the submit.
describe('REQ-19 — AssignTruckGroupDialog cargo-fit advisory', () => {
  const rowWith = (shipmentId: number, bill: string, cargoWeightKg: string | null, cargoVolumeCbm: string | null) => {
    const base = row(shipmentId, bill);
    return {
      ...base,
      container: { ...base.container, cargoWeightKg },
      lcl: { ...base.lcl!, cargoVolumeCbm },
    } as DispatchDetailPlanRow;
  };

  it('xe tải: Σkg ≤ tải trọng → "vừa tải" với tổng kg/CBM của nhóm', async () => {
    renderDialog([rowWith(31, 'BL-1', '1500', '3.2'), rowWith(32, 'BL-2', '1500', '4.8')]);
    await pickVehicleClass('Xe 3.5 tấn');
    const fit = screen.getByRole('status');
    expect(fit.textContent).toContain('Tổng 2 lô');
    expect(fit.textContent).toContain('3.000 kg');
    expect(fit.textContent).toContain('8 CBM');
    expect(fit.textContent).toContain('vừa tải (3.500 kg)');
    expect(fit.className).not.toContain('assign-truck-group__fit--over');
  });

  it('xe tải: Σkg > tải trọng → dòng VƯỢT TẢI TRỌNG (danger), vẫn không chặn gán', async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([rowWith(31, 'BL-1', '2000', '3.2'), rowWith(32, 'BL-2', '2000', '4.8')]);
    await pickVehicleClass('Xe 3.5 tấn');
    const fit = screen.getByRole('status');
    expect(fit.textContent).toContain('VƯỢT TẢI TRỌNG Xe 3.5 tấn (3.500 kg)');
    expect(fit.className).toContain('assign-truck-group__fit--over');

    // Advisory, not a gate: a full valid form still submits.
    await pickCarrier('Nhà xe Hải Vân');
    setField(/BKS thực/, '29H-111.11');
    submit();
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
  });

  it('loại cont 20/40: fit theo kg không phải đơn vị — nhắc đối chiếu CBM, không bịa dung tích', async () => {
    renderDialog([rowWith(31, 'BL-1', '1500', '3.2'), rowWith(32, 'BL-2', '2000', '6.0')]);
    await pickVehicleClass('Container 20 feet');
    const fit = screen.getByRole('status');
    expect(fit.textContent).toContain('loại cont CONT20 tính giá theo vỏ cont');
    expect(fit.textContent).toContain('9,2 CBM');
    expect(fit.textContent).not.toContain('VƯỢT');
  });

  it('chưa có kg của lô nào → nhắc nhập trọng lượng, không phán FITS/OVER', async () => {
    renderDialog([rowWith(31, 'BL-1', null, '3.2'), rowWith(32, 'BL-2', null, '4.8')]);
    await pickVehicleClass('Xe 3.5 tấn');
    const fit = screen.getByRole('status');
    expect(fit.textContent).toContain('Chưa có kg của lô nào');
    expect(fit.textContent).toContain('3.5T');
  });
});
