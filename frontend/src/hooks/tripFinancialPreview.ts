import {
  computeTripTotals,
  FUEL_PRICE_PER_LITER_FALLBACK,
  FUEL_LOADED_NORM_FALLBACK,
  FUEL_EMPTY_NORM_FALLBACK,
  FuelMode,
  LoadingType,
} from '@tingting/shared';
import type { ComputeTripTotalsInput, ComputeTripTotalsOutput } from '@tingting/shared';
import type { FuelConfig, RoadAllowance, RoadConfig, TripDetail } from '@tingting/shared';
import type { RouteOption } from './useTripOptions';
import type { FormLeg } from './useTripFormLegs';
import type { UseTripFormStateReturn } from './useTripFormState';

/**
 * tripFinancialPreview — the trip form's live money preview.
 *
 * Split from `useTripFormDispatch` (which used to hand-roll three separate
 * memos): the fuel/toll/profit math now runs through the ONE shared engine
 * (`computeTripTotals`), so the form's preview, the dispatcher's calculation,
 * and the accountant's P&L can never drift. This module only RESOLVES the
 * configuration sources (fuel config, road config, road-allowance catalog,
 * edit-mode snapshots) and MAPS the form state onto the engine input.
 *
 * Field precedence per line:
 *   - fuel price / norms: fuel-config table → shared fallback constants;
 *   - fixed route allowance (`mountainFixedAllowance`, legacy field name):
 *     the selected route's configured allowance, both route classifications;
 *   - toll per station / return-cargo bonus: edit-mode applied snapshot
 *     (frozen at submit) → road-config table → historic fallbacks;
 *   - road-allowance base: edit-mode applied snapshot → the catalog row for
 *     (route, trailer type) → 0.
 */

/** Historic defaults kept from the pre-config era; the engine documents the
 *  same numbers, so they live in exactly one place per side. */
const TOLL_PER_STATION_FALLBACK = 55_000;
const RETURN_CARGO_BONUS_FALLBACK = 300_000;

export interface TripPreviewSettings {
  fuelUnitPrice: number;
  fuelLoadedNorm: number;
  fuelEmptyNorm: number;
  fuelPerTripSupplement: number;
  /** The selected route's configured fixed fuel allowance; null = per-leg norms. */
  mountainFixedAllowance: number | null;
  /** Retained for engine-input compatibility; allowances are not mountain-only. */
  isMountainRoute: boolean;
  roadAllowanceBase: number;
  tollPerStation: number;
  returnCargoBonus: number;
}

function positiveNumber(value: string | number | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveTripPreviewSettings(
  existingTrip: TripDetail | undefined,
  fuelConfig: FuelConfig | undefined,
  roadConfig: RoadConfig | undefined,
  selectedRouteData: RouteOption | null,
  trailerType: string,
  roadAllowances: RoadAllowance[],
): TripPreviewSettings {
  const fixedAllowance = positiveNumber(selectedRouteData?.fixedFuelAllowance);
  const catalogAllowance = roadAllowances.find(
    (row) => row.routeId === selectedRouteData?.id && String(row.trailerType) === String(trailerType),
  );

  return {
    fuelUnitPrice: positiveNumber(fuelConfig?.unitPrice) ?? FUEL_PRICE_PER_LITER_FALLBACK,
    fuelLoadedNorm: positiveNumber(fuelConfig?.loadedNorm) ?? FUEL_LOADED_NORM_FALLBACK,
    fuelEmptyNorm: positiveNumber(fuelConfig?.emptyNorm) ?? FUEL_EMPTY_NORM_FALLBACK,
    fuelPerTripSupplement: Number(fuelConfig?.supplement) || 0,
    mountainFixedAllowance: fixedAllowance,
    isMountainRoute: Boolean(selectedRouteData?.isMountain),
    roadAllowanceBase: existingTrip?.roadAllowanceBaseApplied
      ? Number(existingTrip.roadAllowanceBaseApplied)
      : Number(catalogAllowance?.baseAmount) || 0,
    tollPerStation: (existingTrip?.tollPerStationApplied && Number(existingTrip.tollPerStationApplied))
      || positiveNumber(roadConfig?.tollPerStation)
      || TOLL_PER_STATION_FALLBACK,
    returnCargoBonus: (existingTrip?.returnCargoBonusApplied && Number(existingTrip.returnCargoBonusApplied))
      || positiveNumber(roadConfig?.returnCargoBonus)
      || RETURN_CARGO_BONUS_FALLBACK,
  };
}

/** Maps the live form state onto the shared engine input and runs it. Pure —
 *  the caller memoizes on (state, legs, settings). */
export function computeTripFormPreview(
  s: UseTripFormStateReturn,
  legs: FormLeg[],
  settings: TripPreviewSettings,
): ComputeTripTotalsOutput {
  const input: ComputeTripTotalsInput = {
    legs: legs.map((leg) => ({
      sequence: leg.sequence,
      km: Number(leg.km) || 0,
      loadingType: leg.loadingType === LoadingType.HANG ? 'HANG' : 'VO',
    })),
    fuelMode: s.fuelMode === FuelMode.FLAT_RATE ? 'FLAT_RATE' : 'AUTO',
    fuelLitersOverride: Number(s.fuelLitersOverride) || null,
    fuelSupplementLiters: Number(s.fuelSupplementLiters) || 0,
    fuelLoadedNorm: settings.fuelLoadedNorm,
    fuelEmptyNorm: settings.fuelEmptyNorm,
    fuelPerTripSupplement: settings.fuelPerTripSupplement,
    fuelUnitPrice: settings.fuelUnitPrice,
    isMountainRoute: settings.isMountainRoute,
    mountainFixedAllowance: settings.mountainFixedAllowance,
    roadAllowanceBase: settings.roadAllowanceBase,
    tollsDiscount: Number(s.tollsDiscount) || 0,
    tollsAddition: Number(s.tollsAddition) || 0,
    tollsStations: Number(s.tollsStations) || 0,
    tollPerStation: settings.tollPerStation,
    hasReturnCargo: s.hasReturnCargo,
    returnCargoBonus: settings.returnCargoBonus,
    revenue: Number(s.revenue) || 0,
    driverSalary: Number(s.driverSalary) || 0,
    twoPointDeliveryBonus: Number(s.twoPointDeliveryBonus) || 0,
    vehicleShiftAllowance: Number(s.vehicleShiftAllowance) || 0,
    roadAllowanceOverride: s.roadAllowanceOverride != null && s.roadAllowanceOverride !== ''
      ? (Number(s.roadAllowanceOverride) || null)
      : null,
    vatRate: s.vatRate,
    carrierType: s.carrierType,
    externalFreightCost: Number(s.externalFreightCost) || 0,
    customerCommission: Number(s.customerCommission) || 0,
  };
  return computeTripTotals(input);
}
