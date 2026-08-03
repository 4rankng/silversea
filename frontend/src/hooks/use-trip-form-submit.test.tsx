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
  ApiError: class extends Error {
    status: number;

    constructor(message: string, status = 500) {
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

import { useTripFormSubmit } from './use-trip-form-submit';

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
