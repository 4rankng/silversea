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

const trailersMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCatalogQueries', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useTrailers: trailersMock,
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
  // SIL-1148 default: the trailer catalog is unloaded — the snapshot law owns
  // the pre-save verdict, so every pre-existing pin behaves exactly as before.
  trailersMock.mockReset().mockReturnValue({ data: undefined, isLoading: true });
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

// SIL-1148 (KB Ch.3 §3.6 K3.52 + Ch.4 K4.59) — the pre-save confirm keys on
// the rig's DECLARED 'Tải trọng tối đa' (trailers.max_payload_tons), not the
// issue-time inferred snapshot: a rig whose declaration is empty must show
// the missing-capacity 'Vẫn lưu?' even when the snapshot bucket reads a
// number (QA r40b — 2×20DC 5t on 15H-104.03 saved with no warning at all).
describe('PairTripsDialog — SIL-1148 declared-rating pre-save confirm', () => {
  const trailerRow = (id: number, maxPayloadTons: number | null) => ({
    id, licensePlate: `70C-${id}`, type: '20FT', maxPayloadTons,
    maxAxleLoadFrontTons: null, maxAxleLoadRearTons: null, inspectionDeadline: null, note: null,
  });

  /** 2×20DC 5t each (the R4CHK1B-FCL01 pattern) whose trips snapshot the
   *  20FT mooc bucket (18000) — the declared rating decides the dialog. */
  function renderFiveTonPair() {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900, cargoWeightKg: '5000.00', vehicleCapacityKg: '18000.00', trailerId: 71 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(
      tripDetail({ id: 901, version: 7, cargoWeightKg: '5000.00', vehicleCapacityKg: '18000.00', trailerId: 71 }),
    );
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KEP', warnings: [] } as never);
    return render(
      <PairTripsDialog
        row={row(900)}
        candidates={[row(901)]}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
  }

  it('undeclared trailer rating (maxPayloadTons null) → confirm names the total before any save', async () => {
    trailersMock.mockReturnValue({ data: [trailerRow(71, null)], isLoading: false });
    renderFiveTonPair();

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(confirmDialog).toHaveAccessibleDescription(
      `${PAIR_CAPACITY_MISSING_MESSAGE} (Tổng trọng 2 cont: 10.000 kg) Vẫn lưu?`,
    );
    expect(tripClient.createPair).not.toHaveBeenCalled();

    // 'Xác nhận' saves EXACTLY the old payload — the declared fact is a
    // mirror only, never a wire field.
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(tripClient.createPair).mock.calls[0][0].firstTrip;
    expect(payload).not.toHaveProperty('declaredCapacityKg');
    expect(payload.vehicleCapacityKg).toBe(18000);
  }, 20_000);

  it('declared overload (2×5t > declared 8t) → confirm shows the total vs declared rating', async () => {
    trailersMock.mockReturnValue({ data: [trailerRow(71, 8)], isLoading: false });
    renderFiveTonPair();

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(confirmDialog).toHaveAccessibleDescription(
      `${KEP_WEIGHT_WARNING_MESSAGE} (Tổng trọng 2 cont: 10.000 kg — Tải trọng khai báo của xe: 8.000 kg) Vẫn lưu?`,
    );
    expect(tripClient.createPair).not.toHaveBeenCalled();
  }, 20_000);

  it('declared rating covers the total → straight save, no nag (10t on a declared 20t rig)', async () => {
    trailersMock.mockReturnValue({ data: [trailerRow(71, 20)], isLoading: false });
    renderFiveTonPair();

    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Xác nhận thao tác' })).toBeNull();
  }, 20_000);

  // The confirmed advisory names the computable total after the plain const
  // (SIL-1148), while the backend echoes the BARE message — the post-save
  // banner must still treat them as the same warning (moved, not repeated).
  it('a resolved-catalog confirm absorbs its plain server twin post-save (no repeat)', async () => {
    trailersMock.mockReturnValue({ data: [trailerRow(71, 8)], isLoading: false });
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900, cargoWeightKg: '5000.00', vehicleCapacityKg: '18000.00', trailerId: 71 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(
      tripDetail({ id: 901, version: 7, cargoWeightKg: '5000.00', vehicleCapacityKg: '18000.00', trailerId: 71 }),
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
    // The dispatcher saw the TOTAL-naming advisory, not the bare const.
    expect(confirmDialog).toHaveAccessibleDescription(/Tổng trọng 2 cont: 10\.000 kg/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    const statuses = await screen.findAllByRole('status');
    expect(statuses.map((el) => el.textContent)).toEqual(['Có phát sinh phí chờ.']);
    expect(onClose).not.toHaveBeenCalled();
  }, 20_000);
});

// SIL-1047 (KB §8.1.2 K8.3) — the Ghép chuyến partner list itself obeys the
// size law: a 40ft order is never suggested as a Kẹp partner for a 20ft
// order, and Kết hợp drops proven size mismatches — the server's hard block
// ("Không đủ điều kiện kẹp hàng: hai lệnh phải dùng cùng một biển số xe"
 // answered the QA repro instead of the 40ft rule) stays a backstop, never
// the first answer. Same-size 40+40 Kết hợp stays legal and listed.
describe('PairTripsDialog — SIL-1047 partner size law', () => {
  const sized = (tripId: number, containerNumber: string, code: string): DispatchDetailPlanRow => row(tripId, {
    docs: { billNumber: `BL-${tripId}`, tradeDirection: 'EXPORT', declarationNumbers: [] },
    container: { containerNumber, containerTypeLabel: code, cargoWeightKg: '11000.00' },
    pricing: { customerId: 5, routeId: 6, containerTypeCode: code },
  });
  const base20 = sized(900, 'MSKU9999139', '20DC');
  const partner20 = sized(901, 'MSKU9999140', '20DC');
  const partner40 = sized(902, 'MSKU9999150', '40DC');

  function renderFor(base: DispatchDetailPlanRow, candidates: DispatchDetailPlanRow[]) {
    const baseTripId = base.dispatch.tripId ?? undefined;
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: baseTripId }), isLoading: false });
    return render(
      <PairTripsDialog
        row={base}
        candidates={candidates}
        onClose={vi.fn()}
        onPaired={vi.fn()}
      />,
    );
  }

  async function openPartnerList(expectedPartner: RegExp) {
    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    // Wait on the EXPECTED partner so the assertion proves the listbox is
    // open (a bare 'option' query matches both selects' collections).
    await screen.findByRole('option', { name: expectedPartner });
  }

  it('a provable 40ft order never appears in the partner list of a 20ft base (default Kết hợp)', async () => {
    renderFor(base20, [partner20, partner40]);
    await openPartnerList(/MSKU9999140/);
    expect(screen.queryByRole('option', { name: /MSKU9999150/ })).toBeNull();
  });

  it('switching to Kẹp keeps the 40ft order out and the 20ft sibling suggested', async () => {
    renderFor(base20, [partner20, partner40]);
    fireEvent.click(screen.getByRole('button', { name: /Kết hợp — tái dùng vỏ/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Kẹp — 2 cont 20' chạy cùng lúc/ }));
    await openPartnerList(/MSKU9999140/);
    expect(screen.queryByRole('option', { name: /MSKU9999150/ })).toBeNull();
  });

  it('same-size 40+40 Kết hợp stays suggested — the law is same-size, not 20-only', async () => {
    const base40 = sized(900, 'MSKU9999165', '40DC');
    renderFor(base40, [partner40, partner20]);
    await openPartnerList(/MSKU9999150/);
    expect(screen.queryByRole('option', { name: /MSKU9999140/ })).toBeNull();
  });
});
