import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { FuelMode, TripStatus, type TripDetail } from '@tingting/shared';
import { ToastProvider } from '../components/shared/Toast';
import { useTripFormState } from './useTripFormState';
import { useTripFormDispatch } from './useTripFormDispatch';
import type { TripOptions } from './useTripOptions';

const trip: TripDetail = {
  id: 1, customerId: 0, customerReference: null, truckId: 0, driverId: 0,
  routeId: 0, trailerId: null, trailerType: null, cargoTypeId: 0, containerCount: 1,
  status: TripStatus.CREATED, departureDate: '2026-10-01', plannedStartAt: null,
  plannedEndAt: null, canonicalOrigin: null, canonicalDestination: null, cargoWeightKg: null,
  vehicleCapacityKg: null, fuelMode: FuelMode.AUTO, fuelLitersOverride: null,
  fuelSupplementLiters: null, fuelSupplementReason: null, fuelPriceApplied: null,
  fuelActualUnitPrice: null, fuelSupplierId: null, tollsDiscount: '0', tollsAddition: '0',
  tollsStations: 0, hasReturnCargo: false, driverSalary: null, fuelLiters: null,
  totalFuelCost: null, fuelSurchargeAmount: null, fuelSurchargeSnapshot: null,
  fuelSurchargeSnapshotDirty: false, totalRoadAllowance: null, roadAllowanceOverride: null,
  totalCost: null, revenue: null, revenueEmptyReturn: null, revenueCombine: null,
  customerCommission: null, tripWageDays: null, twoPointDeliveryBonus: '0',
  vehicleShiftAllowance: '0', grossProfit: null, tollCost: null, revenueOriginal: null,
  revenueOverriddenBy: null, revenueOverriddenAt: null, photoUrls: ['blob:existing-one'],
  notes: null, tripCode: null, version: 1, createdBy: null, roadAllowanceBaseApplied: null,
  fuelLoadedNormApplied: null, fuelEmptyNormApplied: null, fuelFixedAllowanceApplied: null,
  fuelSupplementNormApplied: null, tollPerStationApplied: null, returnCargoBonusApplied: null,
  vatRate: '0.08', carrierType: 'OWN', externalCarrierId: null, externalFreightCost: null,
  externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null,
  completedAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  deletedAt: null, legs: [], accountingLock: null,
};
const options: TripOptions = {
  customers: [], carrierCustomers: [], routes: [], trucks: [], trailerTypes: [],
  drivers: [], trailers: [], cargoTypes: [], containerTypes: [], pricingTables: [], loading: false,
};

describe('QA-AUDIT-UI-25 existing photo state ownership', () => {
  it('hydrates the displayed upload owner after loading and replaces photos when navigating between trips', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
    );
    const { result, rerender, unmount } = renderHook(({ existingTrip }: { existingTrip: TripDetail | undefined }) => {
      const state = useTripFormState({ isEditMode: true, existingTrip });
      return useTripFormDispatch({ state, options, isEditMode: true, existingTrip });
    }, { wrapper, initialProps: { existingTrip: undefined as TripDetail | undefined } });
    expect(result.current.photoUrls).toEqual([]);
    rerender({ existingTrip: trip });
    await waitFor(() => expect(result.current.photoUrls).toEqual(['blob:existing-one']));
    rerender({ existingTrip: { ...trip, id: 2, photoUrls: ['blob:existing-two'] } });
    await waitFor(() => expect(result.current.photoUrls).toEqual(['blob:existing-two']));
    rerender({ existingTrip: { ...trip, id: 3, photoUrls: [] } });
    await waitFor(() => expect(result.current.photoUrls).toEqual([]));
    unmount(); client.clear();
  });
});
