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

  it('retries the same payload under the SAME key after a mid-chain failure — the server replays, no duplicate', async () => {
    postMock.mockResolvedValue({ id: 88 });
    putMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({});
    const result = renderSubmitHook();

    const first = await act(async () => result.current());
    expect(first).toBeUndefined();

    const second = await act(async () => result.current());
    expect(second).toBe(88);
    expect(postMock).toHaveBeenCalledTimes(2);
    const key1 = postMock.mock.calls[0]![2].headers['Idempotency-Key'];
    const key2 = postMock.mock.calls[1]![2].headers['Idempotency-Key'];
    expect(key2).toBe(key1);
  });

  it('regenerates the key once when an edited retry 409s on key/payload mismatch', async () => {
    postMock
      .mockRejectedValueOnce(new ApiError(409, undefined, 'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.'))
      .mockResolvedValueOnce({ id: 99 });
    const result = renderSubmitHook();

    const outcome = await act(async () => result.current());

    expect(outcome).toBe(99);
    expect(postMock).toHaveBeenCalledTimes(2);
    const key1 = postMock.mock.calls[0]![2].headers['Idempotency-Key'];
    const key2 = postMock.mock.calls[1]![2].headers['Idempotency-Key'];
    expect(key2).not.toBe(key1);
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
