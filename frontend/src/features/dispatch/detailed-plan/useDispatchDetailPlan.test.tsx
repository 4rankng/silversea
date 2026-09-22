import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PaginatedResponse } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { useDispatchDetailPlan } from './useDispatchDetailPlan';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchDetailPlanRows: vi.fn(),
    listDispatchDeliveryPointFacets: vi.fn(),
    listDispatchPickupPortFacets: vi.fn(),
    listDispatchDropoffPortFacets: vi.fn(),
    listZoneTruckPresence: vi.fn(),
    assignDispatchDetailPlate: vi.fn(),
    assignDispatchDetailCarrier: vi.fn(),
    updateDispatchDetailEstimates: vi.fn(),
    updateDispatchDetailPlan: vi.fn(),
  };
});

const { monthState } = vi.hoisted(() => ({ monthState: { month: 9, year: 2026 } }));

vi.mock('../../../hooks/useMonth', () => ({
  useMonth: () => monthState,
}));

vi.mock('../../../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/configClient')>();
  return {
    ...actual,
    configClient: {
      ...actual.configClient,
      getDispatchZones: vi.fn(),
    },
  };
});

import {
  assignDispatchDetailCarrier,
  assignDispatchDetailPlate,
  listDispatchDetailPlanRows,
  listZoneTruckPresence,
  updateDispatchDetailEstimates,
  updateDispatchDetailPlan,
} from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';

const page = (items: DispatchDetailPlanRow[], total = items.length): PaginatedResponse<DispatchDetailPlanRow> => ({
  items,
  total,
  page: 1,
  pageSize: 50,
});

const listDispatchDetailPlanRowsMock = vi.mocked(listDispatchDetailPlanRows);
const listZoneTruckPresenceMock = vi.mocked(listZoneTruckPresence);
const getDispatchZonesMock = vi.mocked(configClient.getDispatchZones);
const assignDispatchDetailPlateMock = vi.mocked(assignDispatchDetailPlate);
const assignDispatchDetailCarrierMock = vi.mocked(assignDispatchDetailCarrier);
const updateDispatchDetailEstimatesMock = vi.mocked(updateDispatchDetailEstimates);
const updateDispatchDetailPlanMock = vi.mocked(updateDispatchDetailPlan);

const assignmentResult = (assignedPlate: string | null) => ({
  fulfillmentId: 101,
  version: 4,
  lotFullyPlated: false,
  driverNotified: false,
  assignedPlate,
  assignedDriverId: null,
  assignedDriverName: null,
  driverHint: null,
});

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương' },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: 'Giao giờ hành chính', customerNote: 'Gặp anh Hùng' },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

describe('useDispatchDetailPlan plate assignment vs assignment-status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([row(), row({ fulfillmentId: 102 })]));
    getDispatchZonesMock.mockResolvedValue({
      items: [
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
      ],
    });
    listZoneTruckPresenceMock.mockResolvedValue({
      date: '2026-08-20',
      zone: 'LACH_HUYEN',
      zoneLabel: 'Lạch Huyện',
      items: [],
    });
  });

  it('loads unfiltered by date by default (/dispatch parity)', async () => {
    renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenCalled());
    expect(listDispatchDetailPlanRowsMock).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      limit: 50,
    }));
    // No transport-date filter is sent until the dispatcher picks a day.
    const call = listDispatchDetailPlanRowsMock.mock.calls[0][0];
    expect(call).not.toHaveProperty('date');
  });

  it('forwards the selected run-time range as HH:MM query values', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateFilters({ hourFrom: '07:30', hourTo: '09:45' }));

    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      hourFrom: '07:30',
      hourTo: '09:45',
    })));
  });

  it('drops a row from the UNASSIGNED view once a plate is assigned to it', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(2);

    // Simulate the dispatcher choosing "Chưa gán Biển số" in the filter bar.
    act(() => {
      result.current.updateFilters({ assignmentStatus: 'UNASSIGNED' });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    assignDispatchDetailPlateMock.mockResolvedValue(assignmentResult('15C-167.31'));

    await act(async () => {
      await result.current.assignPlate(result.current.items[0], { truckId: 7 });
    });

    // The plated row no longer satisfies the filter and must leave the list.
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([102]);
  });

  it('keeps the row in place when no assignment-status filter is active', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(result.current.loading).toBe(false));

    assignDispatchDetailPlateMock.mockResolvedValue(assignmentResult('15C-184.62'));

    await act(async () => {
      await result.current.assignPlate(result.current.items[0], { truckId: 8 });
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].dispatch.assignedPlate).toBe('15C-184.62');
  });

  it('drops a row from the ASSIGNED view when its plate is cleared', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateFilters({ assignmentStatus: 'ASSIGNED' });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    assignDispatchDetailPlateMock.mockResolvedValue(assignmentResult(null));

    await act(async () => {
      await result.current.assignPlate(result.current.items[0], { clear: true });
    });

    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([102]);
  });

  it('clears vehicle state when changing carrier and removes the row from the assigned view', async () => {
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([row({
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-123.45' },
    })]));
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.updateFilters({ assignmentStatus: 'ASSIGNED' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    assignDispatchDetailCarrierMock.mockResolvedValue({
      fulfillmentId: 101, version: 4, carrierType: 'EXTERNAL', externalCarrierId: 77,
      carrierName: 'Nhà xe Việt', externalCarrierVehicleId: null, assignedPlate: null, lotFullyPlated: false,
    });

    await act(async () => {
      await result.current.assignCarrier(result.current.items[0], { carrierType: 'EXTERNAL', externalCarrierId: 77 });
    });

    expect(assignDispatchDetailCarrierMock).toHaveBeenCalledWith(101, { expectedVersion: 3, carrierType: 'EXTERNAL', externalCarrierId: 77 });
    expect(result.current.items).toEqual([]);
  });

  it('persists fee estimates and updates only the edited fulfillment row', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    updateDispatchDetailEstimatesMock.mockResolvedValue({
      fulfillmentId: 101,
      version: 4,
      plannedRevenue: '2500000',
      plannedCarrierCost: '1900000',
    });

    await act(async () => {
      await result.current.updateEstimates(result.current.items[0], {
        plannedRevenue: 2_500_000,
        plannedCarrierCost: 1_900_000,
      });
    });

    expect(updateDispatchDetailEstimatesMock).toHaveBeenCalledWith(101, {
      expectedVersion: 3,
      plannedRevenue: 2_500_000,
      plannedCarrierCost: 1_900_000,
    });
    expect(result.current.items[0]).toMatchObject({
      version: 4,
      estimates: { plannedRevenue: '2500000', plannedCarrierCost: '1900000' },
    });
    expect(result.current.items[1]).toMatchObject({ version: 3, estimates: { plannedRevenue: null, plannedCarrierCost: null } });
  });

  it('replaces rows when moving between offset pages', async () => {
    listDispatchDetailPlanRowsMock
      .mockResolvedValueOnce(page([row({ fulfillmentId: 101 })], 51))
      .mockResolvedValueOnce(page([row({ fulfillmentId: 51 })], 51))
      .mockResolvedValueOnce(page([row({ fulfillmentId: 101 })], 51));

    const { result } = renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.total).toBe(51);

    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(result.current.totalPages).toBe(2);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 }));
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([51]);

    act(() => result.current.setPage(1));
    await waitFor(() => expect(result.current.page).toBe(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 50 }));
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([101]);
  });

  it('forwards the zone filter to the rows query and the presence fetch', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateFilters({ zone: 'HAI_PHONG' }));

    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      zone: 'HAI_PHONG',
    })));
    await waitFor(() => expect(listZoneTruckPresenceMock).toHaveBeenLastCalledWith(expect.objectContaining({
      zone: 'HAI_PHONG',
    })));
  });

  it('loads zone presence from the taxonomy and follows the viewing date', async () => {
    listZoneTruckPresenceMock.mockResolvedValue({
      date: '2026-08-21',
      zone: 'LACH_HUYEN',
      zoneLabel: 'Lạch Huyện',
      items: [{
        truckId: 7,
        plateNumber: '51C-123.45',
        evidence: [{ reason: 'D-1_DROP', date: '2026-08-20', containerNumber: 'MSCU1234567', portName: 'TC - HICT' }],
      }],
    });

    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // No zone filter set → presence follows the first active zone.
    await waitFor(() => expect(listZoneTruckPresenceMock).toHaveBeenCalledWith({ zone: 'LACH_HUYEN', date: undefined }));
    expect(result.current.presence?.zoneLabel).toBe('Lạch Huyện');
    expect(result.current.presence?.items[0]?.plateNumber).toBe('51C-123.45');

    // Presence refetches when the viewing date changes.
    act(() => result.current.updateFilters({ date: '2026-08-21' }));
    await waitFor(() => expect(listZoneTruckPresenceMock).toHaveBeenLastCalledWith({ zone: 'LACH_HUYEN', date: '2026-08-21' }));
  });
});

vi.mock('../../../api/shipmentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/shipmentClient')>();
  return {
    ...actual,
    dispatchShipment: vi.fn(),
  };
});

import { dispatchShipment } from '../../../api/shipmentClient';

const dispatchShipmentMock = vi.mocked(dispatchShipment);

describe('useDispatchDetailPlan issueOrder (phát lệnh)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([row()], 1));
    getDispatchZonesMock.mockResolvedValue({ items: [] });
    listZoneTruckPresenceMock.mockResolvedValue({ date: '2026-08-20', zone: 'LACH_HUYEN', zoneLabel: 'Lạch Huyện', items: [] });
  });

  it('flips the row to DISPATCHED with the new trip on a successful issue', async () => {
    dispatchShipmentMock.mockResolvedValue({
      fulfillmentId: 101,
      version: 4,
      trip: {
        id: 55, version: 2, tripCode: 'TRP-202608-1', status: 'CREATED',
        plannedStartAt: '2026-08-30T01:00:00.000Z', plannedEndAt: '2026-08-30T05:00:00.000Z',
        carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8,
        externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null,
      },
      notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
      replayed: false,
    });
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.issueOrder(result.current.items[0], {
        plannedStartAt: '2026-08-30T01:00:00.000Z',
        plannedEndAt: '2026-08-30T05:00:00.000Z',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: 154,
        driverId: 8,
      });
    });

    // The call carries the row's identity contract: shipment path param +
    // fulfillmentId + expectedVersion injected from the row's version.
    expect(dispatchShipmentMock).toHaveBeenCalledWith(11, expect.objectContaining({
      fulfillmentId: 101,
      expectedVersion: 3,
      truckId: 154,
      driverId: 8,
      carrierType: 'OWN',
    }));
    const item = result.current.items.find((r) => r.fulfillmentId === 101)!;
    expect(item.taskStatus).toBe('DISPATCHED');
    expect(item.dispatch.tripId).toBe(55);
    expect(item.dispatch.tripStatus).toBe('CREATED');
    expect(item.version).toBe(4);
    expect(result.current.assignmentError).toBeNull();
  });

  it('surfaces a reload banner and keeps the row unchanged on a 409', async () => {
    dispatchShipmentMock.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.issueOrder(result.current.items[0], {
        plannedStartAt: '2026-08-30T01:00:00.000Z',
        plannedEndAt: '2026-08-30T05:00:00.000Z',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: 154,
        driverId: 8,
      })).rejects.toBeTruthy();
    });

    const item = result.current.items.find((r) => r.fulfillmentId === 101)!;
    expect(item.taskStatus).toBe('READY');
    expect(item.dispatch.tripId).toBeUndefined();
    expect(result.current.assignmentError).toContain('tải lại');
  });
});

describe('useDispatchDetailPlan plan-save error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDispatchDetailPlanRowsMock.mockReset().mockResolvedValue(page([row()], 1));
    getDispatchZonesMock.mockResolvedValue({ items: [] });
    listZoneTruckPresenceMock.mockResolvedValue({ date: '2026-08-20', zone: 'LACH_HUYEN', zoneLabel: 'Lạch Huyện', items: [] });
  });

  it.each(['success', 'failure'])('ignores a pre-save refresh %s after an unfiltered atomic save (DSP-FU-006)', async (outcome) => {
    const previous = row();
    const updated = row({
      version: 4, shipmentVersion: 6, classification: 'SINGLE', isCombined: false,
      dispatch: { ...previous.dispatch, assignedPlate: '15C-167.31', assignedDriverName: 'Nguyễn Văn A' },
      notes: { ...previous.notes, vehicleNote: 'Kiểm tra seal' },
      lotFullyPlated: true,
    });
    const previousPage = { ...page([previous], 51), page: 2 };
    const updatedPage = { ...page([updated], 52), page: 2 };
    listDispatchDetailPlanRowsMock.mockResolvedValue(previousPage);
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveOld!: (value: typeof previousPage) => void;
    let rejectOld!: (error: Error) => void;
    listDispatchDetailPlanRowsMock.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveOld = resolve; rejectOld = reject;
    }));
    act(() => result.current.refresh());
    let resolveFresh!: (value: typeof updatedPage) => void;
    listDispatchDetailPlanRowsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));
    updateDispatchDetailPlanMock.mockResolvedValue({
      fulfillmentId: 101, fulfillmentVersion: 4, shipmentId: 11, shipmentVersion: 6,
      classification: 'SINGLE', isCombined: false, operationalNotes: 'Kiểm tra seal',
      dispatch: { ...updated.dispatch, carrierType: 'OWN' }, estimates: updated.estimates, lotFullyPlated: true,
      driverNotified: false, driverHint: null, replayed: false,
    });

    await act(async () => {
      await result.current.savePlan(previous, { carrierType: 'OWN', truckId: 7, plannedRevenue: null, plannedCarrierCost: null });
    });
    expect(result.current.items).toEqual([updated]);
    await act(async () => {
      if (outcome === 'success') resolveOld(previousPage);
      else rejectOld(new Error('stale refresh failed'));
    });
    expect(result.current.items).toEqual([updated]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.page).toBe(2);
    expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    await act(async () => resolveFresh(updatedPage));
    expect(result.current.items).toEqual([updated]);
    expect(result.current.total).toBe(52);
    expect(result.current.page).toBe(2);
  });

  it.each([
    { filter: 'UNASSIGNED' as const, before: null, after: '15C-167.31' },
    { filter: 'ASSIGNED' as const, before: '15C-167.31', after: null },
  ])('removes the atomically saved row when it no longer matches $filter and refreshes counts (DSP-FU-003)', async ({ filter, before, after }) => {
    const plannedRow = row({ dispatch: { ...row().dispatch, assignedPlate: before } });
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([plannedRow], 1));
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.updateFilters({ assignmentStatus: filter }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([], 0));
    updateDispatchDetailPlanMock.mockResolvedValue({
      fulfillmentId: 101, fulfillmentVersion: 4, shipmentId: 11, shipmentVersion: 6,
      classification: 'SINGLE', isCombined: false, operationalNotes: null,
      dispatch: { ...plannedRow.dispatch, carrierType: 'OWN', assignedPlate: after, assignedDriverName: after ? 'Nguyễn Văn A' : null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: after != null, driverNotified: false, driverHint: null, replayed: false,
    });
    const countBeforeSave = listDispatchDetailPlanRowsMock.mock.calls.length;
    await act(async () => {
      await result.current.savePlan(plannedRow, {
        carrierType: 'OWN', plannedRevenue: null, plannedCarrierCost: null,
        ...(after ? { truckId: 7 } : { clearVehicle: true }),
      });
    });
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(listDispatchDetailPlanRowsMock.mock.calls.length).toBeGreaterThan(countBeforeSave));
    expect(result.current.total).toBe(0);
  });

  it('keeps the updated plate and driver visible without an assignment filter (DSP-FU-003)', async () => {
    const plannedRow = row();
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    updateDispatchDetailPlanMock.mockResolvedValue({
      fulfillmentId: 101, fulfillmentVersion: 4, shipmentId: 11, shipmentVersion: 6,
      classification: 'SINGLE', isCombined: false, operationalNotes: 'Kiểm tra seal',
      dispatch: { ...plannedRow.dispatch, carrierType: 'OWN', assignedPlate: '15C-167.31', assignedDriverName: 'Nguyễn Văn A' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: true, driverNotified: false, driverHint: null, replayed: false,
    });
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([row({
      version: 4, shipmentVersion: 6,
      dispatch: { ...plannedRow.dispatch, assignedPlate: '15C-167.31', assignedDriverName: 'Nguyễn Văn A' },
      notes: { ...plannedRow.notes, vehicleNote: 'Kiểm tra seal' },
      lotFullyPlated: true,
    })], 1));
    await act(async () => {
      await result.current.savePlan(plannedRow, { carrierType: 'OWN', truckId: 7, plannedRevenue: null, plannedCarrierCost: null });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      version: 4, shipmentVersion: 6,
      dispatch: { assignedPlate: '15C-167.31', assignedDriverName: 'Nguyễn Văn A' },
      notes: { vehicleNote: 'Kiểm tra seal' },
    });
    expect(result.current.total).toBe(1);
  });

  it('surfaces the backend 409 message instead of a blanket reload banner', async () => {
    updateDispatchDetailPlanMock.mockRejectedValue(
      Object.assign(new Error('Lô hàng đã kết thúc, không thể lưu kế hoạch.'), { status: 409 }),
    );
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.savePlan(result.current.items[0], {
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        operationalNotes: 'Trả về; Di động',
      })).rejects.toBeTruthy();
    });

    expect(result.current.assignmentError).toBe('Lô hàng đã kết thúc, không thể lưu kế hoạch.');
  });

  it('falls back to the reload banner when a 409 carries no message', async () => {
    updateDispatchDetailPlanMock.mockRejectedValue(Object.assign(new Error(''), { status: 409 }));
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.savePlan(result.current.items[0], {
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        operationalNotes: 'Trả về; Di động',
      })).rejects.toBeTruthy();
    });

    expect(result.current.assignmentError).toBe('Dữ liệu đã thay đổi. Vui lòng tải lại.');
  });

  it('keeps the generic save-failure banner for non-409 failures', async () => {
    updateDispatchDetailPlanMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.savePlan(result.current.items[0], {
        carrierType: 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        classification: 'SINGLE',
        operationalNotes: 'Trả về; Di động',
      })).rejects.toBeTruthy();
    });

    expect(result.current.assignmentError).toBe('Không thể lưu kế hoạch. Vui lòng thử lại.');
  });
});

describe('useDispatchDetailPlan background refresh vs loading skeleton', () => {
  // The grid swaps to a skeleton while `loading` is true. A background
  // refresh (30s auto-refresh tick / manual refresh) must not flip it:
  // the skeleton unmounts the whole table including an open row editor,
  // silently discarding drafted changes (2026-09-09 dialog self-close).
  const deferredRow = () => ({
    ...row(),
    container: { containerNumber: 'MSCU9999999', containerTypeLabel: '40HC', cargoWeightKg: '1000.00' },
  });

  function deferredResponse() {
    let resolve!: (value: ReturnType<typeof page>) => void;
    const promise = new Promise<ReturnType<typeof page>>((res) => { resolve = res; });
    return { promise, resolve };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([row()], 1));
    getDispatchZonesMock.mockResolvedValue({ items: [] });
    listZoneTruckPresenceMock.mockResolvedValue({ date: '2026-08-20', zone: 'LACH_HUYEN', zoneLabel: 'Lạch Huyện', items: [] });
  });

  it('keeps loading false during a background refresh so the table stays mounted', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pending = deferredResponse();
    listDispatchDetailPlanRowsMock.mockImplementationOnce(() => pending.promise);

    act(() => { result.current.refresh(); });
    // Fetch in flight, same view → no skeleton flip: the editor dialog and
    // its draft survive the background tick.
    expect(result.current.loading).toBe(false);
    await act(async () => {
      pending.resolve(page([deferredRow()], 1));
    });
    await waitFor(() => expect(result.current.items[0]?.container.containerNumber).toBe('MSCU9999999'));
    expect(result.current.loading).toBe(false);
  });

  it('still flips loading true on a real view change (filter edit)', async () => {
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pending = deferredResponse();
    listDispatchDetailPlanRowsMock.mockImplementationOnce(() => pending.promise);

    act(() => { result.current.updateFilters({ date: '2026-09-09' }); });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      pending.resolve(page([deferredRow()], 1));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('surfaces a visible error when a branch row carries no container id', async () => {
    // 2026-09-12 closing-row repro: the branch serializer dropped
    // shipmentContainerId and the editor click no-op'd invisibly.
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const branchRow = {
      ...row(),
      fulfillmentId: null,
      shipmentContainerId: undefined,
    } as unknown as DispatchDetailPlanRow;

    await act(async () => {
      const outcome = await result.current.ensureFulfillment(branchRow);
      expect(outcome).toBeNull();
    });
    expect(result.current.assignmentError).toContain('không thể tạo tác vụ');
  });
});

// QA-001 (appointment minutes): run-time sorting orders by the full runAt
// timestamp — minutes decide within the same hour (the hour-int sort could
// not distinguish 20:30 from 20:45) — and rows with no time source sort
// last, matching the ?? 99 behaviour it replaces.
describe('useDispatchDetailPlan run-time sorting (QA-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDispatchZonesMock.mockResolvedValue({ items: [] });
    listZoneTruckPresenceMock.mockResolvedValue({
      date: '2026-09-11',
      zone: 'LACH_HUYEN',
      zoneLabel: 'Lạch Huyện',
      items: [],
    });
  });

  it('orders same-hour rows by minutes from runAt and keeps time-less rows last', async () => {
    // Deliberately same-hour: 20:45 first, then a no-time row, then 20:30 —
    // the hour-int sort would leave this order untouched (all "hour 20").
    const late = row({ fulfillmentId: 201, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:45:00.000Z', runHour: 20 } });
    const noTime = row({ fulfillmentId: 203, time: { deliveryDate: '2026-09-11', runHour: null } });
    const early = row({ fulfillmentId: 202, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:30:00.000Z', runHour: 20 } });
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([late, noTime, early]));

    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSort('runHour'));
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([202, 201, 203]);
  });

  it('second toggle flips to descending while time-less rows stay last', async () => {
    // Staging repro (QA-001 AC4): the second header click showed no visible
    // change — the old two-state toggle silently reverted to the server's
    // cargo-priority order. The flip must reverse the timed rows and keep the
    // unknown-time rows anchored at the bottom.
    const late = row({ fulfillmentId: 201, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:45:00.000Z', runHour: 20 } });
    const early = row({ fulfillmentId: 202, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:30:00.000Z', runHour: 20 } });
    const noTime = row({ fulfillmentId: 203, time: { deliveryDate: '2026-09-11', runHour: null } });
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([early, late, noTime]));

    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSort('runHour'));
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([202, 201, 203]);

    act(() => result.current.toggleSort('runHour'));
    expect(result.current.sortDirection).toBe('desc');
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([201, 202, 203]);
  });

  it('third toggle returns to the unsorted server order', async () => {
    const late = row({ fulfillmentId: 201, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:45:00.000Z', runHour: 20 } });
    const early = row({ fulfillmentId: 202, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:30:00.000Z', runHour: 20 } });
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([late, early]));

    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSort('runHour'));
    act(() => result.current.toggleSort('runHour'));
    act(() => result.current.toggleSort('runHour'));
    expect(result.current.sortKey).toBeNull();
    // Back to the server's row order (cargo priority), not a residual sort.
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([201, 202]);
  });

  it('switching columns restarts the cycle at ascending', async () => {
    const a = row({ fulfillmentId: 201, customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: 'Kho Bình Dương' }, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:45:00.000Z', runHour: 20 } });
    const b = row({ fulfillmentId: 202, customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: 'Kho An Phú' }, time: { deliveryDate: '2026-09-11', runAt: '2026-09-11T13:30:00.000Z', runHour: 20 } });
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([a, b]));

    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Take the time column to descending, then pick the other column: the new
    // column must start ascending, not inherit the descending direction.
    act(() => result.current.toggleSort('runHour'));
    act(() => result.current.toggleSort('runHour'));
    expect(result.current.sortDirection).toBe('desc');
    act(() => result.current.toggleSort('deliveryPoint'));
    expect(result.current.sortKey).toBe('deliveryPoint');
    expect(result.current.sortDirection).toBe('asc');
    // Ascending delivery-point order: An Phú before Bình Dương (vi collation).
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([202, 201]);
  });
});

describe('card 20260922_32 — topbar month scope actually filters', () => {
  it('initial mount seeds the inclusive month range into the query', async () => {
    monthState.month = 9; monthState.year = 2026;
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenCalled());
    const call = listDispatchDetailPlanRowsMock.mock.calls.at(-1)![0]!;
    expect(call.dateFrom).toBe('2026-09-01');
    expect(call.dateTo).toBe('2026-09-30');
    expect(call.date).toBeUndefined();
  });

  it('switching the topbar month rewrites the range and re-queries', async () => {
    monthState.month = 9; monthState.year = 2026;
    const { result, rerender } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenCalled());
    const callsBefore = listDispatchDetailPlanRowsMock.mock.calls.length;
    monthState.month = 8;
    rerender();
    await waitFor(() => expect(listDispatchDetailPlanRowsMock.mock.calls.length).toBeGreaterThan(callsBefore));
    const call = listDispatchDetailPlanRowsMock.mock.calls.at(-1)![0]!;
    expect(call.dateFrom).toBe('2026-08-01');
    expect(call.dateTo).toBe('2026-08-31');
  });

  it('the screen presets overwrite the month range (last writer wins)', async () => {
    monthState.month = 9; monthState.year = 2026;
    const { result } = renderHook(() => useDispatchDetailPlan());
    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenCalled());
    act(() => result.current.updateFilters({ date: '2026-09-22', dateFrom: '', dateTo: '' }));
    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenCalled());
    const call = listDispatchDetailPlanRowsMock.mock.calls.at(-1)![0]!;
    expect(call.date).toBe('2026-09-22');
    expect(call.dateFrom).toBeUndefined();
    expect(call.dateTo).toBeUndefined();
  });
});
