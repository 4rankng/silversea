import { applyCommittedLegacyFuelFreeze, computeTripTotals, type CommittedLegacyFuelInput, type ComputeTripTotalsInput, TripStatus, type TripDetail, type FuelConfig, type RoadConfig, type RoadAllowance } from '@tingting/shared';
import type { UseTripFormStateReturn } from './useTripFormState';
import type { FormLeg } from './useTripFormLegs';
import type { RouteOption } from './useTripOptions';

export type TripFinancialForm = Pick<UseTripFormStateReturn,
  'carrierType' | 'externalFreightCost' | 'vatRate' | 'revenue' | 'customerCommission'
  | 'fuelMode' | 'fuelLitersOverride' | 'fuelSupplementLiters' | 'fuelActualUnitPrice'
  | 'tollsDiscount' | 'tollsAddition' | 'tollsStations' | 'hasReturnCargo'
  | 'driverSalary' | 'twoPointDeliveryBonus' | 'vehicleShiftAllowance' | 'roadAllowanceOverride'>;

export type TripPreviewSettings = Pick<ComputeTripTotalsInput,
  'fuelLoadedNorm' | 'fuelEmptyNorm' | 'fuelPerTripSupplement' | 'fuelUnitPrice'
  | 'mountainFixedAllowance' | 'isMountainRoute' | 'roadAllowanceBase' | 'tollPerStation'
  | 'returnCargoBonus' | 'tollDeduction' | 'reconciledTollCost' | 'reconciledExtraCost'> & { legacyFuel?: CommittedLegacyFuelInput };

/** Preview and both form cards share the server's canonical financial rule. */
export function computeTripFormPreview(form: TripFinancialForm, legs: Pick<FormLeg, 'sequence' | 'km' | 'loadingType'>[], settings: TripPreviewSettings) {
  const totals = computeTripTotals({
    ...settings,
    legs: legs.map(leg => ({ sequence: leg.sequence, km: Number(leg.km) || 0, loadingType: leg.loadingType })),
    carrierType: form.carrierType, externalFreightCost: Number(form.externalFreightCost) || 0,
    vatRate: form.vatRate, revenue: Number(form.revenue) || 0,
    customerCommission: Number(form.customerCommission) || 0,
    fuelMode: form.fuelMode,
    fuelLitersOverride: form.fuelLitersOverride === '' ? null : Number(form.fuelLitersOverride),
    fuelSupplementLiters: Number(form.fuelSupplementLiters) || 0,
    fuelActualUnitPrice: form.fuelActualUnitPrice === '' ? null : Number(form.fuelActualUnitPrice),
    tollsDiscount: Number(form.tollsDiscount) || 0, tollsAddition: Number(form.tollsAddition) || 0,
    tollsStations: Number(form.tollsStations) || 0, hasReturnCargo: form.hasReturnCargo,
    driverSalary: Number(form.driverSalary) || 0, twoPointDeliveryBonus: Number(form.twoPointDeliveryBonus) || 0,
    vehicleShiftAllowance: Number(form.vehicleShiftAllowance) || 0,
    roadAllowanceOverride: form.roadAllowanceOverride === '' ? null : Number(form.roadAllowanceOverride),
  });
  return settings.legacyFuel && form.carrierType === 'OWN'
    ? { ...totals, ...applyCommittedLegacyFuelFreeze(settings.legacyFuel, totals) }
    : totals;
}

/** Resolve the same snapshot and legacy fallback boundaries as updateTripFigures. */
export function resolveTripPreviewSettings(trip: TripDetail | undefined, fuel: FuelConfig | undefined,
  road: RoadConfig | undefined, route: RouteOption | null, trailerType: string, allowances: RoadAllowance[]): TripPreviewSettings {
  const committed = trip?.status === TripStatus.IN_TRANSIT || trip?.status === TripStatus.COMPLETED;
  const emptyFuelSnapshot = trip != null && Number(trip.fuelPriceApplied ?? 0) === 0
    && Number(trip.fuelLoadedNormApplied ?? 0) === 0 && Number(trip.fuelEmptyNormApplied ?? 0) === 0;
  const liveFuel = trip == null || (emptyFuelSnapshot && !committed);
  const liveRoad = trip == null || (Number(trip.tollPerStationApplied ?? 0) === 0 && Number(trip.returnCargoBonusApplied ?? 0) === 0);
  const routeChanged = trip != null && trip.routeId !== route?.id;
  const allowanceChanged = routeChanged || (trip != null && trip.trailerType !== trailerType);
  const storedBase = Number(trip?.roadAllowanceBaseApplied ?? 0);
  const catalogBase = allowances.find(row => row.routeId === route?.id && row.trailerType === trailerType && !row.deletedAt)?.baseAmount;
  return {
    fuelLoadedNorm: Number(liveFuel ? fuel?.loadedNorm ?? 43 : trip?.fuelLoadedNormApplied ?? 0),
    fuelEmptyNorm: Number(liveFuel ? fuel?.emptyNorm ?? 25 : trip?.fuelEmptyNormApplied ?? 0),
    fuelPerTripSupplement: Number(liveFuel ? fuel?.supplement ?? 3 : trip?.fuelSupplementNormApplied ?? 0),
    fuelUnitPrice: Number(liveFuel ? fuel?.unitPrice ?? 25000 : trip?.fuelPriceApplied ?? 0),
    isMountainRoute: route?.isMountain ?? false,
    mountainFixedAllowance: Number(trip && !routeChanged ? trip.fuelFixedAllowanceApplied ?? 0 : route?.fixedFuelAllowance ?? 0) || null,
    roadAllowanceBase: allowanceChanged || storedBase === 0 ? Number(catalogBase ?? 0) : storedBase,
    tollPerStation: Number(liveRoad ? road?.tollPerStation ?? 0 : trip?.tollPerStationApplied ?? 0),
    returnCargoBonus: Number(liveRoad ? road?.returnCargoBonus ?? 0 : trip?.returnCargoBonusApplied ?? 0),
    tollDeduction: Number(trip?.tollDeduction ?? 0),
    reconciledTollCost: trip?.reconciledTollCost == null ? null : Number(trip.reconciledTollCost),
    reconciledExtraCost: Number(trip?.reconciledExtraCost ?? 0),
    legacyFuel: trip ? {
      status: trip.status, fuelPriceApplied: Number(trip.fuelPriceApplied ?? 0),
      fuelLoadedNormApplied: Number(trip.fuelLoadedNormApplied ?? 0), fuelEmptyNormApplied: Number(trip.fuelEmptyNormApplied ?? 0),
      storedFuelCost: Number(trip.totalFuelCost ?? 0), storedFuelLiters: Number(trip.fuelLiters ?? 0),
    } : undefined,
  };
}
