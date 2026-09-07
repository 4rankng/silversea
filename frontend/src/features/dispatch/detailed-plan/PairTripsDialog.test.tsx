import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

import { PairTripsDialog } from './PairTripsDialog';

vi.mock('../../../api/tripClient', () => ({
  tripClient: {
    getTrip: vi.fn(),
    createPair: vi.fn(),
  },
}));

const useTripDetailMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useTripQueries', () => ({
  useTripDetail: useTripDetailMock,
}));

import { tripClient } from '../../../api/tripClient';

function tripDetail(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 900,
    version: 4,
    plannedStartAt: '2026-09-08T08:00:00.000Z',
    plannedEndAt: '2026-09-08T12:00:00.000Z',
    canonicalOrigin: 'Cảng Cát Lái',
    canonicalDestination: 'Kho Bình Dương',
    cargoWeightKg: '11000.00',
    vehicleCapacityKg: '18000.00',
    ...overrides,
  } as unknown as TripDetail;
}

const row = (tripId: number, overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'DISPATCHED',
  time: { deliveryDate: '2026-09-08', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho', routeName: 'LH — Biên Hòa' },
  docs: { billNumber: 'BL-1', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'TGHU1111111', containerTypeLabel: "20'GP", cargoWeightKg: '11000.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51D-123', tripId, tripStatus: 'CREATED', pairKind: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

beforeEach(() => {
  vi.mocked(tripClient.createPair).mockReset();
  vi.mocked(tripClient.getTrip).mockReset();
});

describe('PairTripsDialog', () => {
  it('submits the pair with stored-authority drafts, earlier start as leg 1, and the chosen kind', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(
      tripDetail({ id: 901, version: 7, plannedStartAt: '2026-09-08T13:00:00.000Z', plannedEndAt: '2026-09-08T17:00:00.000Z', canonicalOrigin: 'Kho Bình Dương', canonicalDestination: 'Cảng Cát Lái' }),
    );
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: [] } as never);

    const onPaired = vi.fn();
    const onClose = vi.fn();
    render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={onClose}
        onPaired={onPaired}
      />,
    );

    // Default kind is Kết hợp; pick the partner and submit.
    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(tripClient.createPair).mock.calls[0][0];
    // Base trip starts earlier ⇒ leg 1; partner fetched detail becomes leg 2.
    expect(payload.firstTripId).toBe(900);
    expect(payload.secondTripId).toBe(901);
    expect(payload.pairKind).toBe('KET_HOP');
    expect(payload.firstTrip.canonicalOrigin).toBe('Cảng Cát Lái');
    expect(payload.secondTrip.expectedVersion).toBe(7);
    expect(onPaired).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces the server rejection message instead of closing', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901 }));
    vi.mocked(tripClient.createPair).mockRejectedValue(
      new Error('Không đủ điều kiện kẹp hàng: kẹp hàng yêu cầu 2 container 20ft trên cùng 1 mooc.'),
    );

    const onPaired = vi.fn();
    render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={vi.fn()}
        onPaired={onPaired}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Không đủ điều kiện kẹp hàng/);
    expect(onPaired).not.toHaveBeenCalled();
  });
});
