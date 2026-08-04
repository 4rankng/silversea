import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  fleet: vi.fn(),
  fleetResource: vi.fn(),
  inbox: vi.fn(),
  resolve: vi.fn(),
  issue: vi.fn(),
}));

vi.mock('../api/dispatchPlanningClient', () => ({
  listDispatchQueue: mocks.queue,
  getDispatchFleet: mocks.fleet,
  listDispatchFleetResources: mocks.fleetResource,
  listDispatchHandoffs: mocks.inbox,
  resolveDispatchHandoff: mocks.resolve,
  issueDispatchOrder: mocks.issue,
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'DISPATCHER' } }),
}));

import DispatchPage from './DispatchPage';
import type { DispatchHandoffItem, DispatchQueueItem } from '../api/dispatchPlanningClient';

const dispatchPageCss = readFileSync(resolve(process.cwd(), 'src/pages/DispatchPage.css'), 'utf8');

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
    plannedCarrier: {
      carrierType: 'OWN',
      externalCarrierId: null,
      carrierName: 'Đội xe nội bộ SilverSea',
      vehicleId: null,
      vehiclePlate: null,
    },
    accountingLock: null,
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
    trucks: {
      items: [{
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
      total: 1,
      limit: 100,
      nextCursor: null,
    },
    drivers: {
      items: [{
        id: 80,
        name: 'Nguyễn Văn A',
        phone: '0901',
        status: 'ACTIVE',
        assignedTruckId: 60,
        assignedTruckPlate: '51D-12345',
        userId: 90,
      }],
      total: 1,
      limit: 100,
      nextCursor: null,
    },
    externalCarriers: {
      items: [{ id: 81, name: 'Nhà xe A' }],
      total: 1,
      limit: 100,
      nextCursor: null,
    },
  };
}

function fieldTriggerFor(label: string): HTMLButtonElement {
  const trigger = screen.getByText(label, { selector: 'label' }).parentElement?.querySelector('button');
  if (!trigger) throw new Error(`missing ${label}`);
  return trigger;
}

async function choose(label: string, optionName: string) {
  fireEvent.click(fieldTriggerFor(label));
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
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
      limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0,
    });
    mocks.inbox.mockResolvedValue({
      items: [makeHandoff()],
      limit: 50, nextCursor: null, total: 1, unseenCount: 1, seenCount: 0,
    });
    mocks.fleet.mockResolvedValue(makeFleet());
    mocks.fleetResource.mockResolvedValue({ items: [], total: 0, limit: 25, nextCursor: null });
    mocks.resolve.mockResolvedValue({ handoff: { id: 40, status: 'ACCEPTED', version: 2 }, fulfillments: [] });
    mocks.issue.mockResolvedValue({
      fulfillmentId: 10,
      version: 2,
      trip: { id: 100, tripCode: 'TRIP-100', status: 'CREATED' },
      notification: { deliveredInApp: true, pushAttempted: true },
      replayed: false,
    });
  });

  it('switches the bounded workbench to full-width tabs before its panes become cramped', () => {
    expect(dispatchPageCss).toMatch(
      /\.dispatch-workbench\s*\{[^}]*container:\s*dispatch-workbench\s*\/\s*inline-size;/,
    );
    expect(dispatchPageCss).toMatch(
      /@container dispatch-workbench \(max-width: 1199px\)[\s\S]*?\.dispatch-mobile-tabs\s*\{[^}]*display:\s*grid;[\s\S]*?\.dispatch-workbench__grid\s*\{[^}]*display:\s*block;/,
    );
    expect(dispatchPageCss).toMatch(
      /\.dispatch-mobile-tabs button\[aria-selected='true'\]\s*\{[^}]*border-bottom-color:\s*var\(--brand\);[^}]*background:\s*transparent;/,
    );
    expect(dispatchPageCss).toMatch(
      /@container dispatch-workbench \(min-width: 960px\) and \(max-width: 1199px\)[\s\S]*?\.dispatch-pane--detail \.dispatch-detail\s*\{[^}]*grid-template-columns:\s*minmax\(300px, \.8fr\) minmax\(520px, 1\.2fr\);/,
    );
  });

  it('renders bounded panes, accepts handoff, and keeps the fleet visible', async () => {
    render(<DispatchPage />);
    expect((await screen.findAllByText('MSCU6639870')).length).toBeGreaterThan(0);
    expect(screen.getByText('2 tác vụ đang chờ')).toBeTruthy();
    expect(screen.getAllByText('51D-12345').length).toBeGreaterThan(0);
    expect(screen.getByText('Thông tin tác vụ')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Phương tiện và lịch chạy' })).toBeTruthy();
    expect(screen.getByText('Gọi điện trước khi vào')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Google Maps/i })).toBeNull();
    expect(screen.queryByText(/Vị trí thời gian thực/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 40 }), 'ACCEPTED'));
  });

  it('renders the authoritative fleet total instead of the response limit or loaded row count', async () => {
    const fleet = makeFleet();
    mocks.fleet.mockResolvedValue({
      ...fleet,
      trucks: {
        ...fleet.trucks,
        items: [
          ...fleet.trucks.items,
          {
            ...fleet.trucks.items[0],
            id: 61,
            licensePlate: '51D-54321',
            status: 'MAINTENANCE',
          },
        ],
        total: 137,
      },
    });

    render(<DispatchPage />);

    expect(await screen.findByRole('tab', { name: 'Đội xe (137)' })).toBeTruthy();
    expect(screen.getByText('2/137 đã tải · 1 sẵn sàng')).toBeTruthy();
    expect(screen.queryByText('51D-54321')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Đội xe (100)' })).toBeNull();
  });

  it('keeps resources beyond the first 100 available for assignment', async () => {
    const fleet = makeFleet();
    const trucks = Array.from({ length: 100 }, (_, index) => ({
      ...fleet.trucks.items[0],
      id: 1_000 + index,
      licensePlate: `51D-${String(index).padStart(5, '0')}`,
      currentTrailerId: null,
      currentTrailerPlate: null,
    }));
    const initialFleet = {
      ...fleet,
      trucks: { items: trucks, total: 101, limit: 100, nextCursor: 'truck-page-2' },
    };
    const remoteTruck = {
      ...fleet.trucks.items[0],
      id: 9_999,
      licensePlate: '99Z-REACHABLE',
      currentTrailerId: null,
      currentTrailerPlate: null,
    };
    mocks.fleet.mockResolvedValueOnce(initialFleet);
    mocks.fleetResource.mockResolvedValueOnce({
      items: [remoteTruck],
      total: 1,
      limit: 25,
      nextCursor: null,
    });

    render(<DispatchPage />);
    await screen.findByRole('tab', { name: 'Đội xe (101)' });
    fireEvent.click(fieldTriggerFor('Biển số xe'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm biển số xe' }), {
      target: { value: '99Z-REACHABLE' },
    });

    expect(await screen.findByRole('option', { name: '99Z-REACHABLE' }, { timeout: 1_000 })).toBeTruthy();
    expect(mocks.fleetResource).toHaveBeenCalledWith('TRUCK', { q: '99Z-REACHABLE', limit: 25 });
    fireEvent.click(screen.getByRole('option', { name: '99Z-REACHABLE' }));
    expect(fieldTriggerFor('Biển số xe').textContent).toContain('99Z-REACHABLE');
  });

  it('traverses the fleet cursor instead of treating the first page limit as the fleet size', async () => {
    const fleet = makeFleet();
    mocks.fleet.mockResolvedValueOnce({
      ...fleet,
      trucks: { ...fleet.trucks, total: 2, nextCursor: 'truck-page-2' },
    });
    mocks.fleetResource.mockResolvedValueOnce({
      items: [{ ...fleet.trucks.items[0], id: 61, licensePlate: '51D-67890' }],
      total: 2,
      limit: 100,
      nextCursor: null,
    });

    render(<DispatchPage />);
    expect(await screen.findByText('1/2 đã tải · 1 sẵn sàng')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải thêm xe' }));

    expect(await screen.findByText('51D-67890')).toBeTruthy();
    expect(screen.getByText('2/2 đã tải · 2 sẵn sàng')).toBeTruthy();
    expect(mocks.fleetResource).toHaveBeenCalledWith('TRUCK', {
      cursor: 'truck-page-2',
      limit: 100,
      q: undefined,
    });
    expect(screen.queryByRole('button', { name: 'Tải thêm xe' })).toBeNull();
  });

  it('uses independent server searches for drivers and inherited external vehicles', async () => {
    const ownRender = render(<DispatchPage />);
    await screen.findByRole('tab', { name: 'Đội xe (1)' });

    fireEvent.click(fieldTriggerFor('Lái xe'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm tên lái xe' }), {
      target: { value: 'Tài xế ngoài trang' },
    });
    await waitFor(() => expect(mocks.fleetResource).toHaveBeenCalledWith('DRIVER', {
      q: 'Tài xế ngoài trang',
      limit: 25,
    }));

    ownRender.unmount();
    mocks.fleetResource.mockReset();
    mocks.queue.mockResolvedValue({
      items: [makeTask({
        plannedCarrier: {
          carrierType: 'EXTERNAL',
          externalCarrierId: 81,
          carrierName: 'Nhà xe A',
          vehicleId: null,
          vehiclePlate: null,
        },
        dispatch: null,
      })],
      limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0,
    });
    mocks.fleetResource
      .mockResolvedValueOnce({
        items: [{ id: 910, carrierId: 81, licensePlate: '51H-99887', isActive: true }],
        total: 1,
        limit: 25,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [{ id: 912, carrierId: 81, licensePlate: '51H-77665', isActive: true }],
        total: 2,
        limit: 25,
        nextCursor: null,
      });

    render(<DispatchPage />);
    await screen.findByRole('tab', { name: 'Đội xe (1)' });

    expect(screen.getAllByText('Nhà xe đã gán').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Nhà xe A').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Hình thức nhà xe')).toBeNull();
    expect(screen.queryByText('Nhà xe đối tác')).toBeNull();

    fireEvent.click(fieldTriggerFor('Xe của nhà xe'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm biển số xe của nhà xe' }), {
      target: { value: 'Đối tác ngoài trang' },
    });
    await waitFor(() => expect(mocks.fleetResource).toHaveBeenCalledWith('EXTERNAL_VEHICLE', {
      carrierId: 81,
      q: 'Đối tác ngoài trang',
      limit: 25,
    }));
  });

  it('blocks issue when the task has not been assigned a carrier yet', async () => {
    mocks.queue.mockResolvedValue({
      items: [makeTask({ plannedCarrier: null, dispatch: null })],
      limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0,
    });

    render(<DispatchPage />);

    expect(await screen.findByText(/chưa được CUS gán nhà xe/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Phát hành lệnh điều xe/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('auto-derives planned end time from route duration and submits without explicit confirmation', async () => {
    mocks.inbox.mockResolvedValue({
      items: [],
      limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0,
    });
    mocks.queue.mockResolvedValue({
      items: [makeTask({
        route: { id: 2, name: 'Cát Lái — Sóng Thần', distanceKm: 35, serviceDurationMinutes: 240 },
        dispatch: null,
      })],
      limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0,
    });

    render(<DispatchPage />);
    expect((await screen.findAllByText('MSCU6639870')).length).toBeGreaterThan(0);
    await waitFor(() => expect(fieldTriggerFor('Biển số xe')).toBeTruthy());

    await choose('Biển số xe', '51D-12345');
    expect(fieldTriggerFor('Lái xe').textContent).toContain('— Chọn lái xe —');
    await choose('Lái xe', 'Nguyễn Văn A');
    expect(fieldTriggerFor('Lái xe').textContent).toContain('Nguyễn Văn A');
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
      limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0,
    });
    mocks.queue
      .mockResolvedValueOnce({
        items: pageOneItems,
        limit: 50, nextCursor: 'queue-page-2', total: 51, readyCount: 50, dispatchedCount: 1,
      })
      .mockResolvedValueOnce({
        items: [makeTask({ fulfillmentId: 9_999, unitSummary: { label: 'TASK-51' }, dispatch: null })],
        limit: 50, nextCursor: null, total: 51, readyCount: 50, dispatchedCount: 1,
      });

    render(<DispatchPage />);
    expect((await screen.findAllByText('TASK-1')).length).toBeGreaterThan(0);
    expect(screen.getByText('Hiển thị 50 / 50 mỗi trang · 51 tổng')).toBeTruthy();
    expect(screen.getByText('Đã phát hành')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect((await screen.findAllByText('TASK-51')).length).toBeGreaterThan(0);
    expect(screen.queryByText('TASK-1')).toBeNull();

    expect(mocks.queue.mock.calls[0][0]).toMatchObject({ status: ['READY', 'DISPATCHED'], cursor: null });
    expect(mocks.queue.mock.calls[1][0]).toMatchObject({ status: ['READY', 'DISPATCHED'], cursor: 'queue-page-2' });
  });

  it('ignores stale responses when a newer search request finishes first', async () => {
    const slowInbox = deferred<{ items: ReturnType<typeof makeHandoff>[]; limit: number; nextCursor: string | null; total: number; unseenCount: number; seenCount: number }>();
    mocks.inbox.mockImplementation(({ q }: { q?: string }) => {
      if (q === 'fresh') {
        return Promise.resolve({
          items: [],
          limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0,
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
      limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0,
    }));
    mocks.fleet.mockResolvedValue(makeFleet());

    render(<DispatchPage />);
    fireEvent.change(screen.getByPlaceholderText('Khách hàng, booking, container…'), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));

    expect((await screen.findAllByText('FRESH-TASK')).length).toBeGreaterThan(0);

    await act(async () => {
      slowInbox.resolve({
        items: [],
        limit: 50, nextCursor: null, total: 0, unseenCount: 0, seenCount: 0,
      });
      await slowInbox.promise;
    });

    await waitFor(() => {
      expect(screen.getAllByText('FRESH-TASK').length).toBeGreaterThan(0);
      expect(screen.queryByText('STALE-TASK')).toBeNull();
    });
  });
});
