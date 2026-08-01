import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  fleet: vi.fn(),
  inbox: vi.fn(),
  resolve: vi.fn(),
  issue: vi.fn(),
}));

vi.mock('../api/dispatchPlanningClient', () => ({
  listDispatchQueue: mocks.queue,
  getDispatchFleet: mocks.fleet,
  listDispatchHandoffs: mocks.inbox,
  resolveDispatchHandoff: mocks.resolve,
  issueDispatchOrder: mocks.issue,
}));

import DispatchPage from './DispatchPage';
import type { DispatchHandoffItem, DispatchQueueItem } from '../api/dispatchPlanningClient';

type TaskOverrides = Partial<Omit<DispatchQueueItem, 'customer' | 'route' | 'operationalSite' | 'pickupWarehouse' | 'shipment' | 'unitSummary' | 'dispatch'>> & {
  customer?: Partial<DispatchQueueItem['customer']>;
  route?: Partial<DispatchQueueItem['route']>;
  operationalSite?: Partial<DispatchQueueItem['operationalSite']>;
  pickupWarehouse?: Partial<DispatchQueueItem['pickupWarehouse']>;
  shipment?: Partial<DispatchQueueItem['shipment']>;
  unitSummary?: Partial<DispatchQueueItem['unitSummary']>;
  dispatch?: DispatchQueueItem['dispatch'] | Partial<NonNullable<DispatchQueueItem['dispatch']>> | null;
};

type HandoffOverrides = Partial<Omit<DispatchHandoffItem, 'customer' | 'route' | 'operationalSite' | 'pickupWarehouse' | 'shipment' | 'summary'>> & {
  customer?: Partial<DispatchHandoffItem['customer']>;
  route?: Partial<DispatchHandoffItem['route']>;
  operationalSite?: Partial<DispatchHandoffItem['operationalSite']>;
  pickupWarehouse?: DispatchHandoffItem['pickupWarehouse'] extends infer T ? T | Partial<NonNullable<T>> | null : never;
  shipment?: Partial<DispatchHandoffItem['shipment']>;
  summary?: Partial<DispatchHandoffItem['summary']>;
};

function makeTask(overrides: TaskOverrides = {}): DispatchQueueItem {
  const base = makeBaseTask();
  return {
    ...base,
    ...overrides,
    customer: { ...base.customer, ...overrides.customer },
    route: { ...base.route, ...overrides.route },
    operationalSite: { ...base.operationalSite, ...overrides.operationalSite },
    pickupWarehouse: { ...base.pickupWarehouse, ...overrides.pickupWarehouse },
    shipment: { ...base.shipment, ...overrides.shipment },
    unitSummary: { ...base.unitSummary, ...overrides.unitSummary },
    dispatch: overrides.dispatch === null
      ? null
      : { ...base.dispatch!, ...(overrides.dispatch ?? {}) },
  };
}

function makeBaseTask(): DispatchQueueItem {
  return {
    fulfillmentId: 10,
    shipmentId: 20,
    handoffId: 30,
    handoffVersion: 2,
    fulfillmentVersion: 1,
    shipmentVersion: 3,
    taskStatus: 'READY' as const,
    urgency: 'URGENT' as const,
    cargoMode: 'FCL' as const,
    fulfillmentType: 'FCL_CONTAINER' as const,
    tripId: null,
    customer: { id: 1, name: 'Long Minh' },
    route: { id: 2, name: 'Cát Lái — Sóng Thần', distanceKm: 35, serviceDurationMinutes: null },
    operationalSite: {
      id: 3,
      name: 'Nhà máy Long Minh',
      address: 'Bình Dương',
      googleMapsUrl: 'https://maps.google.com/site',
      strictRules: 'Gọi điện trước khi vào',
    },
    pickupWarehouse: { id: null, name: null, address: null, googleMapsUrl: null, strictRules: null },
    shipment: {
      code: 'SHP-20',
      bookingRef: 'BK-20',
      blNumber: null,
      declarationNumbers: ['TK-1'],
      closingAt: '2026-08-01T09:00:00.000Z',
      plannedReturnAt: null,
      customsCutoffAt: null,
      operationalNotes: 'Ưu tiên chuyến này',
    },
    unitSummary: {
      label: 'MSCU6639870',
      containerNumber: 'MSCU6639870',
      containerTypeLabel: '40HC',
      shippingLineName: 'MSC',
      pickupPortName: 'Cát Lái',
      dropoffPortName: 'Sóng Thần',
      packageType: null,
      packageCount: null,
      cargoWeightKg: '12000',
      cargoVolumeCbm: null,
    },
    dispatch: {
      tripId: 100,
      tripVersion: 1,
      tripCode: 'TRIP-100',
      tripStatus: 'CREATED',
      plannedStartAt: null,
      plannedEndAt: null,
      carrierType: null,
      truckId: null,
      truckPlate: null,
      trailerId: null,
      trailerPlate: null,
      driverId: null,
      driverName: null,
      externalCarrierId: null,
      externalCarrierName: null,
      externalPlateNumber: null,
      externalDriverName: null,
      externalDriverPhone: null,
    },
  };
}

function makeHandoff(overrides: HandoffOverrides = {}): DispatchHandoffItem {
  const base = makeBaseHandoff();
  return {
    ...base,
    ...overrides,
    customer: { ...base.customer, ...overrides.customer },
    route: { ...base.route, ...overrides.route },
    operationalSite: { ...base.operationalSite, ...overrides.operationalSite },
    pickupWarehouse: overrides.pickupWarehouse === null
      ? null
      : { ...base.pickupWarehouse!, ...(overrides.pickupWarehouse ?? {}) },
    shipment: { ...base.shipment, ...overrides.shipment },
    summary: { ...base.summary, ...overrides.summary },
  };
}

function makeBaseHandoff(): DispatchHandoffItem {
  return {
    handoffId: 40,
    version: 1,
    status: 'UNSEEN' as const,
    shipmentId: 50,
    shipmentVersion: 1,
    urgency: 'NORMAL' as const,
    vehicleNeededBy: null,
    operationalNote: null,
    dispatchedAt: '2026-08-01T00:00:00Z',
    customer: { id: 1, name: 'Long Minh' },
    route: { id: 2, name: 'Cát Lái', distanceKm: 12, serviceDurationMinutes: 60 },
    operationalSite: { id: 3 },
    pickupWarehouse: { id: 5, name: 'Kho A', address: 'Bình Dương', googleMapsUrl: null, strictRules: null },
    shipment: {
      code: 'SHP-50',
      bookingRef: 'BK-50',
      blNumber: null,
      cargoMode: 'FCL' as const,
      declarationNumbers: [],
      closingAt: null,
      plannedReturnAt: null,
      customsCutoffAt: null,
      operationalNotes: null,
    },
    summary: { containerNumbers: ['A', 'B'], lclLabel: null },
  };
}

function makeFleet() {
  return {
    trucks: [{
      id: 60,
      licensePlate: '51D-12345',
      status: 'ACTIVE',
      trailerType: '40FT',
      currentTrailerId: 70,
      currentTrailerPlate: '51R-12345',
      capacityKg: '30000',
      assignedDriverId: 80,
      assignedDriverName: 'Nguyễn Văn A',
    }],
    drivers: [{
      id: 80,
      name: 'Nguyễn Văn A',
      phone: '0901',
      status: 'ACTIVE',
      assignedTruckId: 60,
      assignedTruckPlate: '51D-12345',
      userId: 90,
    }],
    externalCarriers: [{ id: 81, name: 'Nhà xe A' }],
    page: { limit: 100, totalTrucks: 1, totalDrivers: 1, totalExternalCarriers: 1 },
  };
}

function selectFor(label: string): HTMLSelectElement {
  const select = screen.getByText(label, { selector: 'label' }).parentElement?.querySelector('select');
  if (!select) throw new Error(`missing ${label}`);
  return select;
}

function choose(label: string, value: string) {
  const select = selectFor(label);
  fireEvent.change(select, { target: { value } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('DispatchPage fulfillment workbench', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.queue.mockResolvedValue({
      items: [makeTask()],
      page: { limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0 },
    });
    mocks.inbox.mockResolvedValue({
      items: [makeHandoff()],
      page: { limit: 50, nextCursor: null, total: 1, unseenCount: 1, seenCount: 0 },
    });
    mocks.fleet.mockResolvedValue(makeFleet());
    mocks.resolve.mockResolvedValue({ handoff: { id: 40, status: 'ACCEPTED', version: 2 }, fulfillments: [] });
    mocks.issue.mockResolvedValue({
      fulfillmentId: 10,
      version: 2,
      trip: { id: 100, tripCode: 'TRIP-100', status: 'CREATED' },
      notification: { deliveredInApp: true, pushAttempted: true },
      replayed: false,
    });
  });

  it('renders bounded panes, accepts handoff, and keeps the fleet visible', async () => {
    render(<DispatchPage />);
    expect((await screen.findAllByText('MSCU6639870')).length).toBeGreaterThan(0);
    expect(screen.getByText('2/50 đang tải · 2 tổng')).toBeTruthy();
    expect(screen.getAllByText('51D-12345').length).toBeGreaterThan(0);
    expect(screen.getByText('Gọi điện trước khi vào')).toBeTruthy();
    expect(screen.queryByText(/Vị trí thời gian thực/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 40 }), 'ACCEPTED'));
  });

  it('auto-derives planned end time from route duration and submits without explicit confirmation', async () => {
    mocks.inbox.mockResolvedValue({
      items: [],
      page: { limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0 },
    });
    mocks.queue.mockResolvedValue({
      items: [makeTask({
        route: { id: 2, name: 'Cát Lái — Sóng Thần', distanceKm: 35, serviceDurationMinutes: 240 },
        dispatch: null,
      })],
      page: { limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0 },
    });

    render(<DispatchPage />);
    expect((await screen.findAllByText('MSCU6639870')).length).toBeGreaterThan(0);
    await waitFor(() => expect(selectFor('Biển số xe').querySelector('option[value="60"]')).toBeTruthy());

    choose('Biển số xe', '60');
    expect(selectFor('Lái xe').value).toBe('');
    choose('Lái xe', '80');
    expect(selectFor('Lái xe').value).toBe('80');
    fireEvent.change(screen.getByLabelText('Ngày giờ chạy'), { target: { value: '2026-08-01T08:00' } });

    await waitFor(() => expect((screen.getByLabelText('Kết thúc dự kiến') as HTMLInputElement).value).toBe('2026-08-01T12:00'));
    expect(screen.queryByLabelText(/Tôi xác nhận giờ kết thúc/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Phát hành lệnh điều xe/ }));
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(1));
    expect(mocks.issue.mock.calls[0][1]).toMatchObject({
      carrierType: 'OWN',
      truckId: 60,
      driverId: 80,
      trailerId: 70,
      endTimeConfirmed: false,
      plannedEndAt: '2026-08-01T12:00:00+07:00',
    });
  });

  it('loads only 50 tasks per page, includes dispatched tasks, and paginates with queue cursors', async () => {
    const pageOneItems = Array.from({ length: 50 }, (_, index) => makeTask({
      fulfillmentId: 1_000 + index,
      taskStatus: index === 49 ? 'DISPATCHED' : 'READY',
      unitSummary: { label: `TASK-${index + 1}` },
      dispatch: index === 49 ? {
        tripId: 2_000 + index,
        tripVersion: 1,
        tripCode: 'TRIP-500',
        tripStatus: 'CREATED',
        plannedStartAt: '2026-08-01T08:00:00.000Z',
        plannedEndAt: '2026-08-01T10:00:00.000Z',
        carrierType: 'OWN',
        truckId: 60,
        truckPlate: '51D-12345',
        trailerId: 70,
        trailerPlate: '51R-12345',
        driverId: 80,
        driverName: 'Nguyễn Văn A',
        externalCarrierId: null,
        externalCarrierName: null,
        externalPlateNumber: null,
        externalDriverName: null,
        externalDriverPhone: null,
      } : null,
    }));
    mocks.inbox.mockResolvedValue({
      items: [],
      page: { limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0 },
    });
    mocks.queue
      .mockResolvedValueOnce({
        items: pageOneItems,
        page: { limit: 50, nextCursor: 'queue-page-2', total: 51, readyCount: 50, dispatchedCount: 1 },
      })
      .mockResolvedValueOnce({
        items: [makeTask({ fulfillmentId: 9_999, unitSummary: { label: 'TASK-51' }, dispatch: null })],
        page: { limit: 50, nextCursor: null, total: 51, readyCount: 50, dispatchedCount: 1 },
      });

    render(<DispatchPage />);
    expect((await screen.findAllByText('TASK-1')).length).toBeGreaterThan(0);
    expect(screen.getByText('50/50 đang tải · 51 tổng')).toBeTruthy();
    expect(screen.getByText('Đã phát hành')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect((await screen.findAllByText('TASK-51')).length).toBeGreaterThan(0);
    expect(screen.queryByText('TASK-1')).toBeNull();

    expect(mocks.queue.mock.calls[0][0]).toMatchObject({ status: ['READY', 'DISPATCHED'], cursor: null });
    expect(mocks.queue.mock.calls[1][0]).toMatchObject({ status: ['READY', 'DISPATCHED'], cursor: 'queue-page-2' });
  });

  it('ignores stale responses when a newer search request finishes first', async () => {
    const slowInbox = deferred<{ items: ReturnType<typeof makeHandoff>[]; page: { limit: number; nextCursor: string | null; total: number; unseenCount: number; seenCount: number } }>();
    mocks.inbox.mockImplementation(({ q }: { q?: string }) => {
      if (q === 'fresh') {
        return Promise.resolve({
          items: [],
          page: { limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0 },
        });
      }
      return slowInbox.promise;
    });
    mocks.queue.mockImplementation(({ q }: { q?: string }) => Promise.resolve({
      items: [makeTask({
        fulfillmentId: q === 'fresh' ? 222 : 111,
        unitSummary: { label: q === 'fresh' ? 'FRESH-TASK' : 'STALE-TASK' },
        customer: { id: 1, name: q === 'fresh' ? 'Khách mới' : 'Khách cũ' },
        dispatch: null,
      })],
      page: { limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0 },
    }));
    mocks.fleet.mockResolvedValue(makeFleet());

    render(<DispatchPage />);
    fireEvent.change(screen.getByPlaceholderText('Khách hàng, booking, container…'), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));

    expect((await screen.findAllByText('FRESH-TASK')).length).toBeGreaterThan(0);

    await act(async () => {
      slowInbox.resolve({
        items: [],
        page: { limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0 },
      });
      await slowInbox.promise;
    });

    await waitFor(() => {
      expect(screen.getAllByText('FRESH-TASK').length).toBeGreaterThan(0);
      expect(screen.queryByText('STALE-TASK')).toBeNull();
    });
  });
});
