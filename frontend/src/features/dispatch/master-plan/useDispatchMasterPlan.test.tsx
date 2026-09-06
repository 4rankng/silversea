import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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

import { listShipments } from '../../../api/shipmentClient';
import { listZoneTruckPresence } from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';

const listShipmentsMock = vi.mocked(listShipments);
const listZoneTruckPresenceMock = vi.mocked(listZoneTruckPresence);
const getDispatchZonesMock = vi.mocked(configClient.getDispatchZones);

describe('useDispatchMasterPlan zone truck presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listShipmentsMock.mockResolvedValue({
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

  it('requests the full operational status set so dispatched and completed lots stay visible', async () => {
    renderHook(() => useDispatchMasterPlan());

    await waitFor(() => expect(listShipmentsMock).toHaveBeenCalled());
    expect(listShipmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: [
          ShipmentStatus.READY_FOR_DISPATCH,
          ShipmentStatus.DISPATCHED,
          ShipmentStatus.IN_TRANSIT,
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
