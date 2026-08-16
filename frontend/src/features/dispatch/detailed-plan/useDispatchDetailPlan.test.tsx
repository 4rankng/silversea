import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CursorPaginatedResponse } from '@tingting/shared';
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
    assignDispatchDetailPlate: vi.fn(),
  };
});

import {
  assignDispatchDetailPlate,
  listDispatchDetailPlanRows,
} from '../../../api/dispatchPlanningClient';
import { businessDateISO } from '../../../lib/format';

const page = (items: DispatchDetailPlanRow[]): CursorPaginatedResponse<DispatchDetailPlanRow> => ({
  items,
  total: items.length,
  limit: 50,
  nextCursor: null,
});

const listDispatchDetailPlanRowsMock = vi.mocked(listDispatchDetailPlanRows);
const assignDispatchDetailPlateMock = vi.mocked(assignDispatchDetailPlate);

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
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

describe('useDispatchDetailPlan plate assignment vs assignment-status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDispatchDetailPlanRowsMock.mockResolvedValue(page([row(), row({ fulfillmentId: 102 })]));
  });

  it('loads the current Vietnam business date by default', async () => {
    renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(listDispatchDetailPlanRowsMock).toHaveBeenCalled());
    expect(listDispatchDetailPlanRowsMock).toHaveBeenCalledWith(expect.objectContaining({
      cursor: null,
      limit: 50,
      date: businessDateISO(),
    }));
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

  it('replaces rows when moving between cursor-backed pages', async () => {
    listDispatchDetailPlanRowsMock
      .mockResolvedValueOnce({
        ...page([row({ fulfillmentId: 101 })]),
        total: 51,
        nextCursor: 'cursor-page-2',
      })
      .mockResolvedValueOnce({
        ...page([row({ fulfillmentId: 51 })]),
        total: 51,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        ...page([row({ fulfillmentId: 101 })]),
        total: 51,
        nextCursor: 'cursor-page-2',
      });

    const { result } = renderHook(() => useDispatchDetailPlan());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(2);

    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(result.current.totalPages).toBe(2);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-page-2', limit: 50 }));
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([51]);

    act(() => result.current.setPage(1));
    await waitFor(() => expect(result.current.page).toBe(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listDispatchDetailPlanRowsMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null, limit: 50 }));
    expect(result.current.items.map((item) => item.fulfillmentId)).toEqual([101]);
  });
});
