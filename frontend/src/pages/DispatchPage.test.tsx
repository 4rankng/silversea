import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), fleet: vi.fn(), inbox: vi.fn(), resolve: vi.fn(), issue: vi.fn() }));
vi.mock('../api/dispatchPlanningClient', () => ({
  listDispatchQueue: mocks.queue, getDispatchFleet: mocks.fleet, listDispatchHandoffs: mocks.inbox,
  resolveDispatchHandoff: mocks.resolve, issueDispatchOrder: mocks.issue,
}));

import DispatchPage from './DispatchPage';

const task = {
  fulfillmentId: 10, shipmentId: 20, handoffId: 30, handoffVersion: 2, fulfillmentVersion: 1, shipmentVersion: 3,
  taskStatus: 'READY' as const, urgency: 'URGENT' as const, cargoMode: 'FCL' as const, fulfillmentType: 'FCL_CONTAINER' as const, tripId: null,
  customer: { id: 1, name: 'Long Minh' }, route: { id: 2, name: 'Cát Lái — Sóng Thần', distanceKm: 35, serviceDurationMinutes: null },
  operationalSite: { id: 3, name: 'Nhà máy Long Minh', address: 'Bình Dương', googleMapsUrl: 'https://maps.google.com/site', strictRules: 'Gọi điện trước khi vào' },
  pickupWarehouse: { id: null, name: null, address: null, googleMapsUrl: null, strictRules: null },
  shipment: { code: 'SHP-20', bookingRef: 'BK-20', blNumber: null, declarationNumbers: ['TK-1'], closingAt: '2026-08-01T09:00:00.000Z', plannedReturnAt: null, customsCutoffAt: null, operationalNotes: 'Ưu tiên chuyến này' },
  unitSummary: { label: 'MSCU6639870', containerNumber: 'MSCU6639870', containerTypeLabel: '40HC', shippingLineName: 'MSC', pickupPortName: 'Cát Lái', dropoffPortName: 'Sóng Thần', packageType: null, packageCount: null, cargoWeightKg: '12000', cargoVolumeCbm: null },
  dispatch: { plannedStartAt: null, plannedEndAt: null, carrierType: null, truckId: null, truckPlate: null, trailerId: null, trailerPlate: null, driverId: null, driverName: null, externalCarrierId: null, externalCarrierName: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
};

const handoff = { handoffId: 40, version: 1, status: 'UNSEEN' as const, shipmentId: 50, shipmentVersion: 1, urgency: 'NORMAL' as const, vehicleNeededBy: null, operationalNote: null, dispatchedAt: '2026-08-01T00:00:00Z', customer: { id: 1, name: 'Long Minh' }, route: { id: 2, name: 'Cát Lái' }, operationalSite: { id: 3, name: 'Nhà máy', strictRules: null }, shipment: { code: 'SHP-50', bookingRef: 'BK-50', blNumber: null, cargoMode: 'FCL' as const, containerCount: 2 }, summary: { containerNumbers: ['A', 'B'], lclLabel: null } };

function choose(label: string, value: string) {
  const select = screen.getByText(label, { selector: 'label' }).parentElement?.querySelector('select');
  if (!select) throw new Error(`missing ${label}`);
  fireEvent.change(select, { target: { value } });
}

describe('DispatchPage fulfillment workbench', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.queue.mockResolvedValue({ items: [task], page: { limit: 50, nextCursor: null, total: 1, readyCount: 1, dispatchedCount: 0 } });
    mocks.inbox.mockResolvedValue({ items: [handoff], page: { total: 1, unseenCount: 1, seenCount: 0 } });
    mocks.fleet.mockResolvedValue({ trucks: [{ id: 60, licensePlate: '51D-12345', status: 'ACTIVE', trailerType: '40FT', currentTrailerId: 70, currentTrailerPlate: '51R-12345', capacityKg: '30000', assignedDriverId: 80, assignedDriverName: 'Nguyễn Văn A' }], drivers: [{ id: 80, name: 'Nguyễn Văn A', phone: '0901', status: 'ACTIVE', assignedTruckId: 60, assignedTruckPlate: '51D-12345', userId: 90 }], externalCarriers: [], page: { limit: 100, totalTrucks: 1, totalDrivers: 1, totalExternalCarriers: 0 } });
    mocks.resolve.mockResolvedValue({ handoff: { id: 40, status: 'ACCEPTED', version: 2 }, fulfillments: [] });
    mocks.issue.mockResolvedValue({ fulfillmentId: 10, version: 2, trip: { id: 100, tripCode: 'TRIP-100', status: 'CREATED' }, notification: { deliveredInApp: true, pushAttempted: true }, replayed: false });
  });

  it('renders bounded task/fleet/detail panes with no live GPS map and accepts a handoff', async () => {
    render(<DispatchPage />);
    expect((await screen.findAllByText('MSCU6639870')).length).toBe(2);
    expect(screen.getByText('2/50 đang tải')).toBeTruthy();
    expect(screen.getAllByText('51D-12345').length).toBeGreaterThan(0);
    expect(screen.getByText('Gọi điện trước khi vào')).toBeTruthy();
    expect(screen.queryByText(/Vị trí thời gian thực/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận' }));
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith(handoff, 'ACCEPTED'));
  });

  it('requires explicit truck, driver, interval and confirmation before issue', async () => {
    render(<DispatchPage />);
    await screen.findAllByText('MSCU6639870');
    choose('Biển số xe', '60');
    choose('Lái xe', '80');
    fireEvent.change(screen.getByLabelText('Ngày giờ chạy'), { target: { value: '2026-08-01T08:00' } });
    fireEvent.change(screen.getByLabelText('Kết thúc dự kiến'), { target: { value: '2026-08-01T12:00' } });
    fireEvent.click(screen.getByLabelText(/Tôi xác nhận giờ kết thúc/));
    fireEvent.click(screen.getByRole('button', { name: /Phát hành lệnh điều xe/ }));
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(1));
    expect(mocks.issue.mock.calls[0][1]).toMatchObject({ carrierType: 'OWN', truckId: 60, driverId: 80, trailerId: 70, endTimeConfirmed: true });
    expect(await screen.findByText(/Đã phát hành lệnh TRIP-100/)).toBeTruthy();
  });
});
