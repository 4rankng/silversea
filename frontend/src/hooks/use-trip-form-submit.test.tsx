import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { FuelMode, LoadingType, TripStatus } from '@tingting/shared';
import type { TripDetail } from '@tingting/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormLeg } from './useTripFormLegs';
import type { ContainerFormRow, UseTripFormStateReturn } from './useTripFormState';

const { postMock, putMock, toastMock, upsertTripInstructionsMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  putMock: vi.fn(),
  toastMock: vi.fn(),
  upsertTripInstructionsMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    post: postMock,
    put: putMock,
  },
  // Mirrors the real constructor (status, raw, message) so tests construct
  // failures exactly like the api client parses them.
  ApiError: class extends Error {
    status: number;

    constructor(status: number, raw: unknown, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../api/tripClient', () => ({
  tripClient: {
    upsertTripInstructions: upsertTripInstructionsMock,
  },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { ApiError } from '../lib/api';
import { findInvalidLeg, useTripFormSubmit } from './use-trip-form-submit';
import { TripEditConflictError } from './tripSubmitReconcile';
import { qk } from '../api/keys';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

function makeState(overrides: Partial<UseTripFormStateReturn> = {}): UseTripFormStateReturn {
  return {
    customerId: '11',
    setCustomerId: vi.fn(),
    routeId: '22',
    setRouteId: vi.fn(),
    truckId: '33',
    setTruckId: vi.fn(),
    trailerType: '40FT',
    setTrailerType: vi.fn(),
    driverId: '44',
    setDriverId: vi.fn(),
    cargoTypeId: '55',
    setCargoTypeId: vi.fn(),
    departureDate: '2026-08-03',
    setDepartureDate: vi.fn(),
    completedAt: '',
    setCompletedAt: vi.fn(),
    customerReference: '',
    setCustomerReference: vi.fn(),
    containerCount: '1',
    setContainerCount: vi.fn(),
    plannedContainerTypeId: '4',
    setPlannedContainerTypeId: vi.fn(),
    carrierType: 'OWN',
    setCarrierType: vi.fn(),
    vatRate: 0.1,
    setVatRate: vi.fn(),
    externalCarrierId: null,
    setExternalCarrierId: vi.fn(),
    externalFreightCost: '',
    setExternalFreightCost: vi.fn(),
    externalPlateNumber: '',
    setExternalPlateNumber: vi.fn(),
    externalDriverName: '',
    setExternalDriverName: vi.fn(),
    externalDriverPhone: '',
    setExternalDriverPhone: vi.fn(),
    fuelMode: FuelMode.AUTO,
    setFuelMode: vi.fn(),
    fuelLitersOverride: '',
    setFuelLitersOverride: vi.fn(),
    fuelSupplementLiters: '',
    setFuelSupplementLiters: vi.fn(),
    fuelSupplementReason: '',
    setFuelSupplementReason: vi.fn(),
    tollsDiscount: '',
    setTollsDiscount: vi.fn(),
    tollsAddition: '',
    setTollsAddition: vi.fn(),
    tollsStations: '',
    setTollsStations: vi.fn(),
    hasReturnCargo: false,
    setHasReturnCargo: vi.fn(),
    driverSalary: '',
    setDriverSalary: vi.fn(),
    twoPointDeliveryBonus: '',
    setTwoPointDeliveryBonus: vi.fn(),
    vehicleShiftAllowance: '',
    setVehicleShiftAllowance: vi.fn(),
    roadAllowanceOverride: '',
    setRoadAllowanceOverride: vi.fn(),
    fuelActualUnitPrice: '',
    setFuelActualUnitPrice: vi.fn(),
    fuelSupplierId: null,
    setFuelSupplierId: vi.fn(),
    customerCommission: '0',
    setCustomerCommission: vi.fn(),
    tripWageDays: '',
    setTripWageDays: vi.fn(),
    revenue: '',
    setRevenue: vi.fn(),
    revenueEmptyReturn: '',
    setRevenueEmptyReturn: vi.fn(),
    revenueCombine: '',
    setRevenueCombine: vi.fn(),
    notes: '',
    setNotes: vi.fn(),
    contactName: '',
    setContactName: vi.fn(),
    contactPhone: '',
    setContactPhone: vi.fn(),
    instructionsNotes: '',
    setInstructionsNotes: vi.fn(),
    photoUrls: [],
    setPhotoUrls: vi.fn(),
    containerRows: [],
    setContainerRows: vi.fn(),
    submitting: false,
    setSubmitting: vi.fn(),
    error: '',
    setError: vi.fn(),
    resetForm: vi.fn(),
    resetToggle: 0,
    ...overrides,
  };
}

function makeExistingTrip(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 6,
    version: 3,
    status: TripStatus.CREATED,
    ...overrides,
  } as TripDetail;
}

const validLegs: FormLeg[] = [{
  id: 'leg-1',
  sequence: 1,
  origin: 'Cảng Hải Phòng',
  destination: 'Kho Bắc Ninh',
  km: '120',
  loadingType: LoadingType.HANG,
}];

describe('useTripFormSubmit cargo type validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockImplementation(async (url: string) => {
      if (url === '/trips/6/pre-departure') return {};
      if (url === '/trips/6/containers') return { items: [] as ContainerFormRow[] };
      throw new Error(`Unexpected PUT ${url}`);
    });
    postMock.mockResolvedValue({ id: 99 });
    upsertTripInstructionsMock.mockResolvedValue(undefined);
  });

  it('allows edit-mode submit when a shipment-driven trip has no cargo type', async () => {
    const state = makeState({ cargoTypeId: '' });
    const { result } = renderHook(
      () => useTripFormSubmit({
        state,
        isEditMode: true,
        existingTrip: makeExistingTrip(),
        legs: validLegs,
        requiredFieldsFilled: 7,
        hasOptionalData: false,
        photoUrls: [],
        flushPendingPhotos: vi.fn(),
        flushPendingContainerPhotos: vi.fn().mockResolvedValue(new Map<string, string>()),
      }),
      { wrapper: createWrapper() },
    );

    let tripId: number | undefined;
    await act(async () => {
      tripId = await result.current();
    });

    expect(tripId).toBe(6);
    expect(putMock).toHaveBeenNthCalledWith(1, '/trips/6/pre-departure', expect.objectContaining({
      customerId: 11,
      routeId: 22,
      truckId: 33,
      driverId: 44,
      trailerType: '40FT',
    }));
    expect(putMock.mock.calls[0]?.[1]).not.toHaveProperty('cargoTypeId');
    expect(upsertTripInstructionsMock).toHaveBeenCalledWith(6, {
      contactName: null,
      contactPhone: null,
      notes: null,
    });
    expect(state.setError).toHaveBeenCalledWith('');
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'Loại hàng là bắt buộc.',
    }));
  });

  it('still blocks create-mode submit when cargo type is missing', async () => {
    const state = makeState({ cargoTypeId: '' });
    const { result } = renderHook(
      () => useTripFormSubmit({
        state,
        isEditMode: false,
        existingTrip: undefined,
        legs: validLegs,
        requiredFieldsFilled: 7,
        hasOptionalData: false,
        photoUrls: [],
        flushPendingPhotos: vi.fn(),
        flushPendingContainerPhotos: vi.fn().mockResolvedValue(new Map<string, string>()),
      }),
      { wrapper: createWrapper() },
    );

    let tripId: number | undefined;
    await act(async () => {
      tripId = await result.current();
    });

    expect(tripId).toBeUndefined();
    expect(state.setError).toHaveBeenLastCalledWith('Loại hàng là bắt buộc.');
    expect(postMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Loại hàng là bắt buộc.',
    });
  });
});

// Trip-create atomicity (QA-030): the old flow POSTed the base trip before
// validating generated legs — an invalid leg stranded a "Mới tạo" trip and
// the corrected retry duplicated it. Validation now runs BEFORE any network
// call; the create POST carries a form-session idempotency key (same
// payload retried = same trip server-side); a key/payload conflict after an
// edited retry regenerates the key once instead of stranding the user.
describe('useTripFormSubmit create atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderSubmitHook(args: Partial<Parameters<typeof useTripFormSubmit>[0]> = {}) {
    const { result } = renderHook(
      () => useTripFormSubmit({
      state: makeState(),
      isEditMode: false,
      existingTrip: undefined,
      legs: validLegs,
      requiredFieldsFilled: 99,
      hasOptionalData: true,
      photoUrls: [],
      flushPendingPhotos: vi.fn(async () => []),
      flushPendingContainerPhotos: vi.fn(async () => new Map()),
        ...args,
      }),
      { wrapper: createWrapper() },
    );
    return result;
  }

  it('rejects invalid legs BEFORE creating anything — no POST, no stranded trip', async () => {
    const setError = vi.fn();
    const result = renderSubmitHook({
      state: makeState({ setError }),
      legs: [{ ...validLegs[0]!, origin: '', destination: 'Kho Bắc Ninh', km: '120' }],
    });

    const outcome = await act(async () => result.current());

    expect(outcome).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('Leg 1 is invalid (Both origin and destination are required; Distance must be a non-negative number).');
  });

  it('rejects a fuel supplement without a reason before creating', async () => {
    const setError = vi.fn();
    const result = renderSubmitHook({
      state: makeState({ fuelSupplementLiters: '10', fuelSupplementReason: '', setError }),
    });

    const outcome = await act(async () => result.current());

    expect(outcome).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('Please enter a reason for fuel supplement.');
  });

  it('creates once with an idempotency key and forwards the legs to pre-departure', async () => {
    postMock.mockResolvedValue({ id: 77 });
    putMock.mockResolvedValue({});
    const result = renderSubmitHook();

    const outcome = await act(async () => result.current());

    expect(outcome).toBe(77);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]![0]).toBe('/trips');
    expect(typeof postMock.mock.calls[0]![2].headers['Idempotency-Key']).toBe('string');
    expect(putMock).toHaveBeenCalledWith('/trips/77/pre-departure', expect.objectContaining({
      legs: [expect.objectContaining({ origin: 'Cảng Hải Phòng', destination: 'Kho Bắc Ninh', km: 120 })],
    }));
  });

  it('continues the existing trip after a mid-chain failure without another create', async () => {
    postMock.mockResolvedValue({ id: 88 });
    putMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({});
    const result = renderSubmitHook();

    const first = await act(async () => result.current());
    expect(first).toBeUndefined();

    const second = await act(async () => result.current());
    expect(second).toBe(88);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenLastCalledWith('/trips/88/containers', { containers: [] });
  });

  it('does not bypass an uncertain create by minting a fresh idempotency key', async () => {
    postMock.mockRejectedValueOnce(new ApiError(409, undefined, 'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.'));
    const result = renderSubmitHook();
    const outcome = await act(async () => result.current());
    expect(outcome).toBeUndefined();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a created trip open when photos fail and reuses its ID on retry', async () => {
    postMock.mockResolvedValue({ id: 91 });
    putMock.mockResolvedValue({ items: [] });
    const flush = vi.fn().mockRejectedValueOnce(new Error('Còn 1 ảnh chưa tải lên.')).mockResolvedValue([]);
    const state = makeState();
    const result = renderSubmitHook({ state, flushPendingPhotos: flush });
    expect(await act(async () => result.current())).toBeUndefined();
    expect(state.setError).toHaveBeenLastCalledWith(expect.stringContaining('Đã tạo chuyến #91'));
    expect(await act(async () => result.current())).toBe(91);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('allows an unrelated correction on a trip without optional legs', async () => {
    putMock.mockResolvedValue({ items: [] });
    upsertTripInstructionsMock.mockResolvedValue(undefined);
    const result = renderSubmitHook({ isEditMode: true, existingTrip: makeExistingTrip(), legs: [], state: makeState({ notes: 'Updated note' }) });
    expect(await act(async () => result.current())).toBe(6);
    expect(putMock).toHaveBeenCalledWith('/trips/6/pre-departure', expect.objectContaining({ legs: [], notes: 'Updated note' }));
  });

  it('surfaces other 409s without a key retry', async () => {
    postMock.mockRejectedValueOnce(new ApiError(409, undefined, 'Version conflict'));
    const result = renderSubmitHook();

    const outcome = await act(async () => result.current());

    expect(outcome).toBeUndefined();
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe('findInvalidLeg (shared submit/readiness rule)', () => {
  it('flags partially-filled legs; passes complete and fully-empty ones', () => {
    expect(findInvalidLeg(validLegs)).toBeNull();
    expect(findInvalidLeg([{ ...validLegs[0]!, destination: '' }])?.sequence).toBe(1);
    expect(findInvalidLeg([{ ...validLegs[0]!, origin: '', destination: '', km: '' }])).toBeNull();
    expect(findInvalidLeg([{ ...validLegs[0]!, km: '-5' }])?.sequence).toBe(1);
    expect(findInvalidLeg([{ ...validLegs[0]!, km: 'abc' }])?.sequence).toBe(1);
  });
});

describe('KSHIP-004: actual edit retry requests', () => {
  beforeEach(() => { vi.clearAllMocks(); upsertTripInstructionsMock.mockResolvedValue(undefined); });
  function renderEdit(original: TripDetail, fresh: TripDetail, state = makeState({ revenueEmptyReturn: '1000000', notes: 'My note' })) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(qk.trips.detail(original.id), fresh);
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    const hook = renderHook(({ trip }: { trip: TripDetail }) => useTripFormSubmit({
      state, existingTrip: trip, isEditMode: true, legs: [], requiredFieldsFilled: 99, hasOptionalData: true,
      photoUrls: [], flushPendingPhotos: vi.fn(async () => []), flushPendingContainerPhotos: vi.fn(async () => new Map()),
    }), { initialProps: { trip: original }, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    return { ...hook, refetch };
  }
  it('preserves B revenue while sending A notes, even after the detail cache refreshes', async () => {
    const original = makeExistingTrip({ revenueEmptyReturn: '1000000', notes: 'Original', legs: [] });
    const fresh = makeExistingTrip({ version: 4, revenueEmptyReturn: '2000000', notes: 'Original', legs: [] });
    const { result, rerender } = renderEdit(original, fresh);
    rerender({ trip: fresh });
    putMock.mockRejectedValueOnce(new ApiError(409, null, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.')).mockResolvedValue(fresh);
    expect(await act(async () => result.current())).toBe(6);
    expect(putMock.mock.calls[0][1]).toMatchObject({ version: 3, revenueEmptyReturn: 1000000, notes: 'My note' });
    expect(putMock.mock.calls[1][1]).toMatchObject({ version: 4, revenueEmptyReturn: '2000000', notes: 'My note' });
  });
  it('keeps overlapping drafts until the user explicitly chooses a reviewed value', async () => {
    const original = makeExistingTrip({ revenueEmptyReturn: '1000000', notes: 'Original', legs: [] });
    const fresh = makeExistingTrip({ version: 4, revenueEmptyReturn: '2000000', notes: 'Their note', legs: [] });
    const { result } = renderEdit(original, fresh);
    putMock.mockRejectedValueOnce(new ApiError(409, null, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.')).mockResolvedValue(fresh);
    await act(async () => { await expect(result.current()).rejects.toBeInstanceOf(TripEditConflictError); });
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(await act(async () => result.current(undefined, { conflictResolution: { version: 4, choices: { notes: 'local' } } }))).toBe(6);
    expect(putMock.mock.calls[1][1]).toMatchObject({ version: 4, revenueEmptyReturn: '2000000', notes: 'My note' });
  });
  it('does not retry or reload an unrelated business409', async () => {
    const original = makeExistingTrip({ revenueEmptyReturn: '1000000', notes: 'Original', legs: [] });
    const { result, refetch } = renderEdit(original, { ...original, version: 4 });
    putMock.mockRejectedValue(new ApiError(409, null, 'Chuyến đã gắn lô hàng; hãy đổi khách hàng từ lô hàng nguồn.'));
    await act(async () => { await expect(result.current()).rejects.toBeInstanceOf(ApiError); });
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
  });
});
