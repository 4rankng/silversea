// SIL-939 (KB §9.2 K9.9, FB-090) — hộp thoại "Sửa điều phối" từng lô trên
// /dispatch-detail phải CHẶN đội xe nội bộ cho hàng lẻ đi xe tải (class tấn
// = 100% xe ngoài, cùng luật SIL-545 đã chặn ở "Gán xe nhóm"): không ofrecen
// 'SilverSea — xe nội bộ' trong danh sách, dòng OWN cũ bị reset kèm cảnh
// báo, lưu chỉ đi được với Nhà xe ngoài. Hàng lẻ ghép CONT 20'/40' giữ nguyên
// cả hai nguồn xe.
// Round 3 (staging c1150c99): the gate keyed on the COST-group class code —
// an ungrouped LCL lot (QA lot R4B-A14-EMPTY2, cost_group_id NULL) carries
// its class on the rev side only, so every layer silently skipped the law.
// The gate now reads the row's effective sourcingVehicleClassCode
// (cost first, else rev); the rev-only shape is pinned below.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchFleetResources: vi.fn(),
    createCarrierFleetVehicle: vi.fn(),
    createInternalTruck: vi.fn(),
    updateLclTruck: vi.fn(),
  };
});

const getTrailersMock = vi.fn();
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: (...args: Array<unknown>) => getTrailersMock(...args) },
}));

// The sourcing gate reads isContainer off the shared catalog — fixture CARRIES it.
const { sizeClassesFixture } = vi.hoisted(() => ({
  sizeClassesFixture: [
    { id: 1, code: '5T', name: 'Xe 5 tấn', isContainer: false },
    { id: 2, code: '10T', name: 'Xe 10 tấn', isContainer: false },
    { id: 3, code: 'CONT20', name: 'Container 20 feet', isContainer: true },
  ],
}));
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: sizeClassesFixture }),
}));

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';
import { detailRowKey } from './DispatchPlanCellValues';

vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(async (label: string) => ({ id: 99, label })), isCreating: false }),
}));

const listResourcesMock = vi.mocked(listDispatchFleetResources);
vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: () => ({ data: undefined }),
  useCarrierPricePreview: () => ({ data: undefined }),
}));
getTrailersMock.mockResolvedValue([]);

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 401,
  version: 3,
  shipmentId: 55,
  shipmentVersion: 5,
  shipmentCode: 'R4B-A14-EMPTY2',
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-11-25', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: 'Kho CFS', routeName: null },
  docs: { billNumber: 'BL-LCL-1', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: null },
  lcl: {
    packageCount: 10,
    packageType: 'Pallet',
    cargoVolumeCbm: '5.5',
    sourcingVehicleClassCode: '5T',
    group: { groupId: 'g1', order: 1, memberCount: 3, actualTruckNo: null, billingTruckNo: null, vehicleClassCode: '5T', vehicleClassName: 'Xe 5 tấn' },
  },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE' as DispatchDetailPlanRow['classification'],
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  plannedEndAt: null,
  ...overrides,
} as DispatchDetailPlanRow);

function mockFleetResources() {
  listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return { items: [{ id: 9, name: 'Nhà xe Hải Vân', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
    }
    if (resource === 'EXTERNAL_VEHICLE') {
      return { items: [{ id: 77, carrierId: 9, licensePlate: '29H-888.66', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
    }
    return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50, suggestedItems: [] };
  }) as never);
}

type IssueOrderBody = Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>;

function renderCell(
  item: DispatchDetailPlanRow,
  handlers: { onAtomicSave?: (row: DispatchDetailPlanRow, body: Record<string, unknown>) => Promise<AtomicPlanSaveResult> } = {},
) {
  const defaultAtomicSave = vi.fn().mockResolvedValue({
    fulfillmentVersion: 4,
    shipmentVersion: 6,
    classification: 'SINGLE',
    isCombined: false,
    operationalNotes: null,
    dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Hải Vân', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: null },
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
    lotFullyPlated: false,
  });
  const key = detailRowKey(item);
  const element = (open: boolean, nonce: number) => (
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={(handlers.onAtomicSave as never) ?? (defaultAtomicSave as never)}
      onCancelDispatch={vi.fn()}
      onCompleteExternalTrip={vi.fn() as never}
      onIssueOrder={vi.fn() as never as (row: DispatchDetailPlanRow, body: IssueOrderBody) => Promise<DispatchShipmentResponse>}
      onEnsureFulfillment={undefined}
      onChangeGroupTruck={undefined}
      openRequest={open ? { key, nonce } : null}
      onOpenRequestConsumed={vi.fn()}
    />
  );
  const view = render(element(true, 1));
  return view;
}

async function openDialog() {
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

async function openCarrierOptions() {
  const trigger = [...screen.getAllByRole('button')].find((button) => button.textContent?.includes('Chọn'));
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger!);
  return screen.findAllByRole('option');
}

describe('SIL-939 — Sửa điều phối chặn đội xe nội bộ trên hàng lẻ xe tải (100% xe ngoài)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTrailersMock.mockResolvedValue([]);
    mockFleetResources();
  });

  it('dòng LCL class 5T: danh sách Nhà xe KHÔNG có SilverSea — xe nội bộ, hiện hint luật', async () => {
    renderCell(row());
    await openDialog();

    expect(screen.getByTestId('lcl-truck-external-only-hint').textContent).toContain('100% xe ngoài');
    const options = await openCarrierOptions();
    const labels = options.map((item) => item.textContent ?? '');
    expect(labels.some((label) => label.includes('SilverSea — xe nội bộ'))).toBe(false);
    expect(labels.some((label) => label.includes('Nhà xe Hải Vân'))).toBe(true);
  });

  it('hàng chưa phân xe (carrier-less) external-only: Xe / biển số KHÔNG nạp đội xe nội bộ', async () => {
    // QA round 2 (df7b2a73 repro): opening 'Xe / biển số' on an unassigned
    // LCL-truck row listed the internal fleet (47 vehicles, all selectable).
    // The sourcing gate must keep the TRUCK resource unrequested — and the
    // picker empty of internal plates — until an external carrier is picked.
    listResourcesMock.mockImplementation((async (resource: string) => {
      if (resource === 'EXTERNAL_CARRIER') {
        return { items: [{ id: 9, name: 'Nhà xe Hải Vân', isActive: true }], nextCursor: null, total: 1, limit: 50 };
      }
      if (resource === 'TRUCK') {
        return {
          items: [{ id: 5, licensePlate: '15E-016.26', status: 'ACTIVE', trailerType: null, currentTrailerId: null, currentTrailerPlate: null, capacityKg: null, assignedDriverId: 1, assignedDriverName: 'Nguyễn Duy Tuấn', carrierId: null, carrierName: null }],
          nextCursor: null,
          total: 1,
          limit: 50,
          suggestedItems: [],
        };
      }
      return { items: [], nextCursor: null, total: 0, limit: 50, suggestedItems: [] };
    }) as never);

    renderCell(row());
    await openDialog();
    await waitFor(() => expect(listResourcesMock.mock.calls.some(([resource]) => resource === 'EXTERNAL_CARRIER')).toBe(true));

    expect(listResourcesMock.mock.calls.some(([resource]) => resource === 'TRUCK')).toBe(false);

    const vehicleTrigger = [...screen.getAllByRole('button')].find((button) => button.textContent?.includes('Chọn biển số xe'));
    expect(vehicleTrigger).toBeTruthy();
    fireEvent.click(vehicleTrigger!);
    const popover = await screen.findByRole('dialog', { name: /Chọn biển số xe/ });
    expect(within(popover).queryByText('15E-016.26')).toBeNull();
    expect(listResourcesMock.mock.calls.some(([resource]) => resource === 'TRUCK')).toBe(false);
  });

  it('dòng OWN cũ (dữ liệu trước luật): mở dialog bị reset kèm cảnh báo, không giữ xe nội bộ', async () => {
    renderCell(row({
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15E-016.26' },
    }));
    await openDialog();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('đã bỏ lựa chọn Đội xe nội bộ');
    // The carrier combobox sits back on the external-only placeholder — no OWN value held.
    const trigger = [...screen.getAllByRole('button')].find((button) => button.textContent?.includes('Chọn Nhà xe (xe ngoài)'));
    expect(trigger).toBeTruthy();
    expect(screen.queryByText('SilverSea — xe nội bộ')).toBeNull();
  });

  it('chọn Nhà xe ngoài + Lưu thay đổi → onAtomicSave nhận carrierType EXTERNAL', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Hải Vân', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(row(), { onAtomicSave });
    await openDialog();

    const options = await openCarrierOptions();
    fireEvent.click(options.find((item) => item.textContent?.includes('Nhà xe Hải Vân'))!);
    expect(screen.getByText('Nhà xe Hải Vân')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.carrierType).toBe('EXTERNAL');
    expect(body.externalCarrierId).toBe(9);
  });

  it('hàng lẻ ghép CONT20 (class container): vẫn chọn được SilverSea — xe nội bộ, không hint', async () => {
    renderCell(row({
      lcl: {
        packageCount: 10,
        packageType: 'Pallet',
        cargoVolumeCbm: '5.5',
        sourcingVehicleClassCode: 'CONT20',
        group: { groupId: 'g2', order: 1, memberCount: 2, actualTruckNo: null, billingTruckNo: null, vehicleClassCode: 'CONT20', vehicleClassName: 'Container 20 feet' },
      },
    }));
    await openDialog();

    expect(screen.queryByTestId('lcl-truck-external-only-hint')).toBeNull();
    const options = await openCarrierOptions();
    expect(options.map((item) => item.textContent ?? '').some((label) => label.includes('SilverSea — xe nội bộ'))).toBe(true);
  });

  it('lô LCL CHƯA ghép nhóm (QA repro R4B-A14-EMPTY2, class chỉ ở rev side): vẫn chặn đội xe nội bộ', async () => {
    // QA round 3 (staging c1150c99): the ungrouped lot's class lives on
    // rev_vehicle_class_id only — lcl.group is null. The gate must judge
    // through the row's sourcingVehicleClassCode all the same.
    renderCell(row({
      lcl: {
        packageCount: 10,
        packageType: 'Pallet',
        cargoVolumeCbm: '5.5',
        sourcingVehicleClassCode: '5T',
        group: null,
      },
    }));
    await openDialog();

    expect(screen.getByTestId('lcl-truck-external-only-hint').textContent).toContain('100% xe ngoài');
    const options = await openCarrierOptions();
    const labels = options.map((item) => item.textContent ?? '');
    expect(labels.some((label) => label.includes('SilverSea — xe nội bộ'))).toBe(false);
    expect(labels.some((label) => label.includes('Nhà xe Hải Vân'))).toBe(true);
  });

  it('lô LCL không có class nào (cost lẫn rev): không phán xét — giữ hành vi cũ', async () => {
    renderCell(row({
      lcl: {
        packageCount: 10,
        packageType: 'Pallet',
        cargoVolumeCbm: '5.5',
        sourcingVehicleClassCode: null,
        group: null,
      },
    }));
    await openDialog();

    expect(screen.queryByTestId('lcl-truck-external-only-hint')).toBeNull();
    const options = await openCarrierOptions();
    expect(options[0]?.textContent).toContain('SilverSea — xe nội bộ');
  });

  it('lô OWN cũ chưa ghép nhóm (class rev side): mở dialog vẫn reset kèm cảnh báo', async () => {
    renderCell(row({
      dispatch: { carrierType: 'OWN', carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      lcl: {
        packageCount: 10,
        packageType: 'Pallet',
        cargoVolumeCbm: '5.5',
        sourcingVehicleClassCode: '5T',
        group: null,
      },
    }));
    await openDialog();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('đã bỏ lựa chọn Đội xe nội bộ');
    expect(screen.queryByText('SilverSea — xe nội bộ')).toBeNull();
  });

  it('dòng FCL: không hint, OWN vẫn là lựa chọn đầu (không hồi quy luật cũ)', async () => {
    renderCell(row({
      cargoMode: 'FCL',
      fulfillmentType: 'FCL_CONTAINER',
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '21500.00' },
      lcl: null,
      dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }));
    await openDialog();

    expect(screen.queryByTestId('lcl-truck-external-only-hint')).toBeNull();
    const options = await openCarrierOptions();
    expect(options[0]?.textContent).toContain('SilverSea — xe nội bộ');
  });
});
