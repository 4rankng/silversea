import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import { useDispatchMasterPlan } from './useDispatchMasterPlan';

vi.mock('../../../api/shipmentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/shipmentClient')>();
  return {
    ...actual,
    listShipments: vi.fn(),
  };
});

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listZoneTruckPresence: vi.fn(),
  };
});

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

import { listShipments, type ShipmentListItem } from '../../../api/shipmentClient';
import { listZoneTruckPresence } from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';

const listShipmentsMock = vi.mocked(listShipments);
const listZoneTruckPresenceMock = vi.mocked(listZoneTruckPresence);
const getDispatchZonesMock = vi.mocked(configClient.getDispatchZones);

describe('useDispatchMasterPlan zone truck presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listShipmentsMock.mockReset().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    getDispatchZonesMock.mockResolvedValue({
      items: [
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
      ],
    });
    listZoneTruckPresenceMock.mockResolvedValue({
      date: '2026-08-24',
      zone: 'LACH_HUYEN',
      zoneLabel: 'Lạch Huyện',
      items: [],
    });
  });

  afterEach(() => vi.useRealTimers());

  it.each(['success', 'failure'])('ignores a pre-save refresh %s after replacing a saved row (DSP-FU-006)', async (outcome) => {
    const previous = { id: 11, version: 3, operationalNotes: 'Ghi chú cũ' } as ShipmentListItem;
    const updated = { ...previous, version: 4, operationalNotes: 'Kiểm tra seal' };
    const previousPage = { items: [previous], total: 21, page: 2, limit: 20 };
    const updatedPage = { ...previousPage, items: [updated], total: 22 };
    listShipmentsMock.mockResolvedValue(previousPage);
    const { result } = renderHook(() => useDispatchMasterPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveOld!: (value: typeof previousPage) => void;
    let rejectOld!: (error: Error) => void;
    listShipmentsMock.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveOld = resolve; rejectOld = reject;
    }));
    act(() => result.current.refetch());
    let resolveFresh!: (value: typeof updatedPage) => void;
    listShipmentsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));

    act(() => result.current.replaceItem(updated));
    expect(result.current.items).toEqual([updated]);
    await act(async () => {
      if (outcome === 'success') resolveOld(previousPage);
      else rejectOld(new Error('stale refresh failed'));
    });
    expect(result.current.items).toEqual([updated]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.page).toBe(2);
    expect(listShipmentsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    await act(async () => resolveFresh(updatedPage));
    expect(result.current.items).toEqual([updated]);
    expect(result.current.total).toBe(22);
    expect(result.current.page).toBe(2);
  });

  it('keeps the master grid mounted during refresh and shows loading for changed filters (DSP-FU-001)', async () => {
    const { result } = renderHook(() => useDispatchMasterPlan());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolveRefresh!: (value: Awaited<ReturnType<typeof listShipments>>) => void;
    listShipmentsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));

    act(() => result.current.refetch());
    expect(result.current.loading).toBe(false);
    await act(async () => resolveRefresh({ items: [], total: 0, page: 1, limit: 20 }));

    listShipmentsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    act(() => result.current.updateFilters({ tradeDirection: 'IMPORT' }));
    expect(result.current.loading).toBe(true);
    await act(async () => resolveRefresh({ items: [], total: 0, page: 1, limit: 20 }));
    expect(result.current.loading).toBe(false);
  });

  it('requests presence for the Vietnam day around machine-local midnight (DSP-FU-002)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T17:30:00.000Z'));
    const timezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      renderHook(() => useDispatchMasterPlan());
      await act(async () => { await Promise.resolve(); });
      expect(listZoneTruckPresenceMock).toHaveBeenCalledWith({ zone: 'LACH_HUYEN', date: '2026-09-16' });
    } finally {
      if (timezone === undefined) delete process.env.TZ;
      else process.env.TZ = timezone;
    }
  });

  it('requests the full operational status set so dispatched and completed lots stay visible', async () => {
    renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(listShipmentsMock).toHaveBeenCalled());
    expect(listShipmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: [
          ShipmentStatus.READY_FOR_DISPATCH,
          ShipmentStatus.DISPATCHED,
          ShipmentStatus.IN_TRANSIT,
          ShipmentStatus.COMPLETED,
        ],
      }),
    );
  });

  it('fetches zone presence from the first active zone for today', async () => {
    renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(listZoneTruckPresenceMock).toHaveBeenCalled());
    expect(listZoneTruckPresenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ zone: 'LACH_HUYEN' }),
    );
    // The date param should be today's date (YYYY-MM-DD).
    const call = listZoneTruckPresenceMock.mock.calls[0][0];
    expect(call.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns presence data with zone label and items', async () => {
    listZoneTruckPresenceMock.mockResolvedValue({
      date: '2026-08-24',
      zone: 'LACH_HUYEN',
      zoneLabel: 'Lạch Huyện',
      items: [{
        truckId: 7,
        plateNumber: '51C-123.45',
        evidence: [{ reason: 'D-1_DROP', date: '2026-08-23', containerNumber: 'MSCU1234567', portName: 'TC - HICT' }],
      }],
    });

    const { result } = renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(result.current.presence?.items).toHaveLength(1));
    expect(result.current.presence?.zoneLabel).toBe('Lạch Huyện');
    expect(result.current.presence?.items[0]?.plateNumber).toBe('51C-123.45');
  });

  it('sets presence to null when no zones are available', async () => {
    getDispatchZonesMock.mockResolvedValue({ items: [] });

    const { result } = renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(getDispatchZonesMock).toHaveBeenCalled());
    expect(result.current.presence).toBeNull();
  });

  it('pins the presence query to Lạch Huyện even when taxonomy order changes', async () => {
    getDispatchZonesMock.mockResolvedValue({
      items: [
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 5 },
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 20 },
      ],
    });

    renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(listZoneTruckPresenceMock).toHaveBeenCalled());
    expect(listZoneTruckPresenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ zone: 'LACH_HUYEN' }),
    );
  });

  it('silently sets presence to null on fetch failure', async () => {
    listZoneTruckPresenceMock.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(listZoneTruckPresenceMock).toHaveBeenCalled());
    expect(result.current.presence).toBeNull();
  });
});
