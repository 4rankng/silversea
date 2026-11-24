import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

import { PairTripsDialog } from './PairTripsDialog';
import { KEP_WEIGHT_WARNING_MESSAGE, PAIR_CAPACITY_MISSING_MESSAGE } from './pairWeightWarning';

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
    // SIL-969: 2×11t must NOT trip the pre-save weight confirm on the default
    // fixture — the trigger cases below carry explicit weight/capacity facts.
    vehicleCapacityKg: '24000.00',
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
    // The full submit flow (React Aria select + Modal + waitFor) lands just
    // past vitest's 5s default on a loaded machine.
  }, 20_000);

  it('surfaces the server rejection message instead of closing', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901 }));
    vi.mocked(tripClient.createPair).mockRejectedValue(
      new Error('Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft'),
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft/);
    expect(onPaired).not.toHaveBeenCalled();
  });

  // Card 211026152138 — a rig with no declared capacity must not dead-end the
  // pair client-side: the draft rides vehicleCapacityKg: null and the save
  // succeeds. SIL-969 (KB K3.52) — the advisory moved BEFORE that save: a soft
  // 'Vẫn lưu?' confirm the dispatcher can still decline. Confirming saves; the
  // confirmed advisory is moved, not repeated, after the save.
  it('submits a null-capacity trip with vehicleCapacityKg: null instead of blocking', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900, vehicleCapacityKg: null }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(
      tripDetail({ id: 901, version: 7, plannedStartAt: '2026-09-08T13:00:00.000Z', plannedEndAt: '2026-09-08T17:00:00.000Z', canonicalOrigin: 'Kho Bình Dương', canonicalDestination: 'Cảng Cát Lái', vehicleCapacityKg: null }),
    );
    vi.mocked(tripClient.createPair).mockResolvedValue({
      id: 55, status: 'ACTIVE', pairKind: 'KEP',
      warnings: [PAIR_CAPACITY_MISSING_MESSAGE],
    } as never);

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

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    // The 'Vẫn lưu?' confirm lands BEFORE the save — nothing is stored yet.
    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(confirmDialog).toHaveAccessibleDescription(`${PAIR_CAPACITY_MISSING_MESSAGE} Vẫn lưu?`);
    expect(tripClient.createPair).not.toHaveBeenCalled();

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(tripClient.createPair).mock.calls[0][0];
    expect(payload.firstTrip.vehicleCapacityKg).toBeNull();
    expect(payload.secondTrip.vehicleCapacityKg).toBeNull();
    expect(onPaired).toHaveBeenCalled();
    // Confirmed pre-save ⇒ moved, not repeated post-save ⇒ dialog closes.
    expect(screen.queryByRole('status')).toBeNull();
    expect(onClose).toHaveBeenCalled();
  }, 20_000);

  it('declining the pre-save weight confirm keeps the pair unsaved (proven overload)', async () => {
    // 2×18.5t = 37t on a 20t rig proves overload (K3.52 trigger 1).
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900, cargoWeightKg: '18500.00', vehicleCapacityKg: '20000.00' }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(
      tripDetail({ id: 901, version: 7, cargoWeightKg: '18500.00', vehicleCapacityKg: '20000.00' }),
    );

    const onClose = vi.fn();
    render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={onClose}
        onPaired={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(confirmDialog).toHaveAccessibleDescription(`${KEP_WEIGHT_WARNING_MESSAGE} Vẫn lưu?`);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Hủy' }));

    expect(tripClient.createPair).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The pair dialog stays open and re-arms its submit for another attempt.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Ghép chuyến$/ })).toBeTruthy());
  }, 20_000);

  it('declining the pre-save capacity-missing confirm keeps the pair unsaved', async () => {
    // The SIL-969 repro: a rig with capacityKg null — "Hủy" must not save.
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900, vehicleCapacityKg: null }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901, version: 7, vehicleCapacityKg: null }));

    const onClose = vi.fn();
    render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={onClose}
        onPaired={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(confirmDialog).toHaveAccessibleDescription(`${PAIR_CAPACITY_MISSING_MESSAGE} Vẫn lưu?`);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Hủy' }));

    expect(tripClient.createPair).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  }, 20_000);

  it('a warning confirmed before the save is moved, not repeated, after it', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900, cargoWeightKg: '18500.00', vehicleCapacityKg: '20000.00' }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(
      tripDetail({ id: 901, version: 7, cargoWeightKg: '18500.00', vehicleCapacityKg: '20000.00' }),
    );
    vi.mocked(tripClient.createPair).mockResolvedValue({
      id: 55, status: 'ACTIVE', pairKind: 'KEP',
      warnings: [KEP_WEIGHT_WARNING_MESSAGE, 'Có phát sinh phí chờ.'],
    } as never);

    const onClose = vi.fn();
    render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={onClose}
        onPaired={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(tripClient.createPair).not.toHaveBeenCalled();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    // Only the advisory the dispatcher has NOT seen before survives post-save.
    const statuses = await screen.findAllByRole('status');
    expect(statuses.map((el) => el.textContent)).toEqual(['Có phát sinh phí chờ.']);
    expect(onClose).not.toHaveBeenCalled();
  }, 20_000);

  it('pairs straight through when the total stays within capacity — no confirm dialog', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901, version: 7 }));
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: [] } as never);

    const onClose = vi.fn();
    render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={onClose}
        onPaired={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Xác nhận thao tác' })).toBeNull();
    expect(onClose).toHaveBeenCalled();
  }, 20_000);
});
