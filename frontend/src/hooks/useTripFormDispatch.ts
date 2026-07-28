/**
 * useTripFormDispatch — derived values, effects, and submit logic for the trip form.
 *
 * Extracted from useTripForm.ts during M3 decomposition (T3.1.3).
 * Receives state from useTripFormState, computes derived values (fuel cost,
 * toll cost, profit, completion), orchestrates effects (route auto-fill,
 * pricing, driver salary), and exposes the submit handler.
 */
import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { FuelMode, LoadingType, FUEL_PRICE_PER_LITER_FALLBACK, FUEL_LOADED_NORM_FALLBACK, FUEL_EMPTY_NORM_FALLBACK, computeTripDriverSalary } from '@tingting/shared';
import type { PricingTable, TripDetail, TripLeg, PaginatedResponse } from '@tingting/shared';
import { tripClient } from '../api/tripClient';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';

import type { TripOptions, RouteOption } from './useTripOptions';
import { useTripFormLegs } from './useTripFormLegs';
import type { FormLeg } from './useTripFormLegs';
import { useTripFormPhotos } from './useTripFormPhotos';
import type { OcrResultHandler, UploadingState, ContainerPhotoUploadResult } from './useTripFormPhotos';
import type { UseTripFormStateReturn, CompletionStatus } from './useTripFormState';
import {
  createFallbackLegsFromRouteName,
  resolveContainerCount,
} from './tripFormDispatchUtils';
import { usePersistedContainerType } from './usePersistedContainerType';
import { moneyInputToNumber } from '../lib/moneyInput';
import { useTripFormSubmit } from './use-trip-form-submit';

const FUEL_PRICE_PER_LITER = FUEL_PRICE_PER_LITER_FALLBACK;
const LOADED_RATE = FUEL_LOADED_NORM_FALLBACK;
const EMPTY_RATE = FUEL_EMPTY_NORM_FALLBACK;

function moneyOrZero(value: string): number {
  return moneyInputToNumber(value) ?? 0;
}

/** OCR recognition result broadcast to container-aware components (e.g. the
 *  container instances card) via the trip-form context. `nonce` lets consumers
 *  detect a fresh result even when the values are identical. */
export interface OcrSignal {
  containerNumbers: string[];
  sealNumber: string | null;
  type: 'CONTAINER' | 'SEAL';
  nonce: number;
}

export interface UseTripFormDispatchParams {
  state: UseTripFormStateReturn;
  options: TripOptions;
  isEditMode: boolean;
  existingTrip: TripDetail | undefined;
  governanceReason?: string;
  onCreditLimitBlocked?: (details: { message: string; customerId: number; proposedAmount: number }) => void;
}

export interface UseTripFormDispatchReturn {
  legs: FormLeg[];
  addLeg: () => void;
  removeLeg: (idx: number) => void;
  updateLeg: (idx: number, field: keyof FormLeg, value: string) => void;
  photoUrls: string[];
  uploadPhotos: (files: FileList, tripId?: number, type?: 'CONTAINER' | 'SEAL' | 'OTHER') => Promise<void>;
  removePhoto: (idx: number) => void;
  uploadContainerPhoto: (file: File, tripId: number | undefined, rowKey: string, type: 'CONTAINER' | 'SEAL', containerId?: number) => Promise<ContainerPhotoUploadResult>;
  revokeRowPhotos: (rowKey: string) => void;
  revokeContainerPhoto: (rowKey: string, type: 'CONTAINER' | 'SEAL', objectUrl: string) => void;
  suggestedPrice: number | null;
  estimatedFuelCost: number;
  estimatedTollCost: number;
  estimatedProfit: number;
  completionStatus: CompletionStatus;
  completedSections: number;
  requiredFieldsFilled: number;
  totalRequiredFields: number;
  uploading: UploadingState;
  ocrResult: OcrSignal | null;
  handleSubmit: (e?: React.FormEvent, options?: { creditApprovalRequestId?: number | null }) => Promise<number | undefined>;
  selectedRouteData: RouteOption | null;
  driverBaseSalary: number;
  roadAllowanceBaseApplied?: number;
  tollPerStationApplied?: number;
  returnCargoBonusApplied?: number;
  twoPointDeliveryDefault?: number;
  vehicleShiftDefault?: number;
}

export function useTripFormDispatch(params: UseTripFormDispatchParams): UseTripFormDispatchReturn {
  const { state: s, options, isEditMode, existingTrip, governanceReason, onCreditLimitBlocked } = params;
  const lastPopulatedTripId = useRef<number | undefined>(undefined);

  usePersistedContainerType({
    tripId: existingTrip?.id,
    enabled: isEditMode,
    plannedContainerTypeId: s.plannedContainerTypeId,
    setPlannedContainerTypeId: s.setPlannedContainerTypeId,
    refreshNonce: s.resetToggle,
  });

  // Broadcast OCR results to container-aware components via context.
  const [ocrResult, setOcrResult] = useState<OcrSignal | null>(null);
  const onOcrResult = useCallback<OcrResultHandler>((containerNumbers, sealNumber, type) => {
    setOcrResult({ containerNumbers, sealNumber, type, nonce: Math.random() });
  }, []);

  const { data: roadConfig } = useQuery({
    queryKey: qk.catalogs.roadConfig,
    queryFn: () => configClient.getRoadConfig(),
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    // Only derive revenue from splits when at least one split is populated.
    // When both are blank, leave the seeded stored value intact so an untouched
    // form neither displays nor serializes a misleading 0. The persisted value
    // is resolved server-side from whatever splits are actually sent
    // (undefined = not-provided; feedback202606 A3 §9).
    if (!s.revenueEmptyReturn.trim() && !s.revenueCombine.trim()) return;
    const emptyReturn = moneyOrZero(s.revenueEmptyReturn);
    const combine = moneyOrZero(s.revenueCombine);
    s.setRevenue(String(emptyReturn + combine));
    // 's' object omitted: individual s.* fields listed are the correct granularity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.revenueEmptyReturn, s.revenueCombine]);

  const { legs, setLegs, addLeg, removeLeg, updateLeg } = useTripFormLegs(options.routes, s.routeId, isEditMode);
  const { photoUrls, uploading, uploadPhotos, removePhoto, flushPendingPhotos,
    uploadContainerPhoto, flushPendingContainerPhotos, revokeRowPhotos, revokeContainerPhoto } = useTripFormPhotos(s.setError, onOcrResult);

  useEffect(() => {
    if (!isEditMode || !existingTrip) return;
    // resetForm() (called on the 409 silent-retry path) bumps s.resetToggle.
    // Clear the populate-guard so the form re-syncs from the freshly-refetched
    // trip data — without this the same trip id would short-circuit the
    // re-population and leave the fields blank after a 409 reset.
    if (s.resetToggle) lastPopulatedTripId.current = undefined;
    if (existingTrip.id === lastPopulatedTripId.current) return;

    // Main info fields — useState initializers run once before the query
    // resolves, so any field read at mount time ends up empty when
    // existingTrip arrives after first render. Mirror every main-info setter
    // here so the form repopulates correctly on mount, on 409 refetch, and on
    // navigating between two edit trips. Same pattern as the instructions
    // sync below.
    s.setDepartureDate(existingTrip.departureDate || '');
    s.setCustomerId(existingTrip.customerId != null ? String(existingTrip.customerId) : '');
    s.setTruckId(existingTrip.truckId != null ? String(existingTrip.truckId) : '');
    s.setTrailerType(existingTrip.trailerType ?? '');
    s.setDriverId(existingTrip.driverId != null ? String(existingTrip.driverId) : '');
    s.setCargoTypeId(existingTrip.cargoTypeId != null ? String(existingTrip.cargoTypeId) : '');
    s.setCustomerReference(existingTrip.customerReference ?? '');
    s.setContainerCount(existingTrip.containerCount != null ? String(existingTrip.containerCount) : '1');
    s.setCompletedAt(existingTrip.completedAt ? existingTrip.completedAt.slice(0, 10) : '');

    s.setRouteId(String(existingTrip.routeId));
    s.setFuelMode(existingTrip.fuelMode);
    s.setFuelLitersOverride(existingTrip.fuelLitersOverride ? String(existingTrip.fuelLitersOverride) : '');
    s.setFuelSupplementLiters(existingTrip.fuelSupplementLiters ? String(existingTrip.fuelSupplementLiters) : '');
    s.setFuelSupplementReason(existingTrip.fuelSupplementReason || '');
    s.setTollsDiscount(existingTrip.tollsDiscount ? String(existingTrip.tollsDiscount) : '');
    s.setTollsAddition(existingTrip.tollsAddition ? String(existingTrip.tollsAddition) : '');
    s.setTollsStations(existingTrip.tollsStations != null ? String(existingTrip.tollsStations) : '');
    s.setHasReturnCargo(!!existingTrip.hasReturnCargo);
    s.setDriverSalary(existingTrip.driverSalary ? String(existingTrip.driverSalary) : '');
    s.setTwoPointDeliveryBonus(existingTrip.twoPointDeliveryBonus && Number(existingTrip.twoPointDeliveryBonus) > 0 ? String(existingTrip.twoPointDeliveryBonus) : '');
    s.setVehicleShiftAllowance(existingTrip.vehicleShiftAllowance && Number(existingTrip.vehicleShiftAllowance) > 0 ? String(existingTrip.vehicleShiftAllowance) : '');
    if (existingTrip.revenueEmptyReturn) {
      s.setRevenueEmptyReturn(String(existingTrip.revenueEmptyReturn));
    } else if (existingTrip.revenue && (!existingTrip.revenueCombine || Number(existingTrip.revenueCombine) === 0)) {
      s.setRevenueEmptyReturn(String(existingTrip.revenue));
    } else {
      s.setRevenueEmptyReturn('');
    }
    s.setRevenueCombine(existingTrip.revenueCombine ? String(existingTrip.revenueCombine) : '');
    s.setCustomerCommission(existingTrip.customerCommission ? String(existingTrip.customerCommission) : '0');
    s.setTripWageDays(existingTrip.tripWageDays ? String(existingTrip.tripWageDays) : '');
    s.setNotes(existingTrip.notes || '');
    // Instructions (N2 / B1.3) arrive on the same detail payload as the rest of
    // the trip. Set them here — NOT just in useState — so the fields repopulate
    // when existingTrip resolves after mount (useState initializers run once,
    // before the query returns) and when navigating between two edit trips or
    // retrying after a 409 refetch. Without this the inputs stay blank and the
    // next save would overwrite the stored row with nulls.
    const inst = existingTrip.instructions;
    s.setContactName(inst?.contactName ?? '');
    s.setContactPhone(inst?.contactPhone ?? '');
    s.setInstructionsNotes(inst?.notes ?? '');
    s.setFuelActualUnitPrice(existingTrip.fuelActualUnitPrice != null ? String(existingTrip.fuelActualUnitPrice) : '');
    s.setFuelSupplierId(existingTrip.fuelSupplierId ?? null);
    s.setPhotoUrls(existingTrip.photoUrls || []);

    s.setCarrierType(existingTrip.carrierType ?? 'OWN');
    s.setVatRate(existingTrip.vatRate != null ? Number(existingTrip.vatRate) : 0.08);
    s.setExternalCarrierId(existingTrip.externalCarrierId ?? null);
    s.setExternalFreightCost(existingTrip.externalFreightCost ? String(existingTrip.externalFreightCost) : '');
    s.setExternalPlateNumber(existingTrip.externalPlateNumber ?? '');
    s.setExternalDriverName(existingTrip.externalDriverName ?? '');
    s.setExternalDriverPhone(existingTrip.externalDriverPhone ?? '');

    if (existingTrip.legs && existingTrip.legs.length > 0) {
      setLegs(existingTrip.legs.map((leg: TripLeg) => ({
        id: String(leg.id || Math.random()),
        sequence: leg.sequence,
        origin: leg.origin,
        destination: leg.destination,
        km: String(leg.km),
        loadingType: leg.loadingType as LoadingType,
      })));
    } else {
      setLegs(createFallbackLegsFromRouteName(existingTrip.route?.name));
    }

    lastPopulatedTripId.current = existingTrip.id;
    // 's' and 'setLegs' omitted: this effect populates form fields once when
    // existingTrip changes (guarded by lastPopulatedTripId ref); setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, existingTrip, s.resetToggle]);

  useEffect(() => {
    if (s.truckId && options?.trucks && options?.trailers) {
      const selectedTruck = options.trucks.find(t => t.id === Number(s.truckId));
      if (selectedTruck?.currentTrailerId) {
        const trailer = options.trailers.find(t => t.id === selectedTruck.currentTrailerId);
        if (trailer) {
          s.setTrailerType(trailer.type === '20FT' ? '20FT' : '40FT');
        }
      }
    }
    // 's' omitted: individual s.* fields listed are the correct granularity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.truckId, options?.trucks, options?.trailers]);

  const pricingQuery = useQuery({
    queryKey: qk.trips.suggestedPrice(Number(s.customerId) || 0, Number(s.routeId) || 0, s.departureDate),
    queryFn: async () => {
      if (isEditMode && existingTrip?.customerId && existingTrip?.routeId) {
        const ptRes = await api.get<PaginatedResponse<PricingTable>>('/pricing-tables');
        const match = (ptRes.items || []).find(
          (pt: PricingTable) => pt.customerId === existingTrip.customerId && pt.routeId === existingTrip.routeId
        );
        if (match) return { price: Number(match.price) };
      }
      const res = await tripClient.getPricing(
        Number(s.customerId),
        Number(s.routeId),
        s.departureDate || undefined,
      );
      return res;
    },
    enabled: !!s.customerId && !!s.routeId,
    staleTime: 5 * 60 * 1000,
  });

  const suggestedPrice = pricingQuery.data?.price ?? null;

  useEffect(() => {
    if (pricingQuery.data !== undefined && !isEditMode) {
      const count = resolveContainerCount(s.containerCount);
      {
        const prev = s.revenueEmptyReturn;
        if (!prev || prev === "0") s.setRevenueEmptyReturn(String(pricingQuery.data!.price * count));
        else if (Number(prev) === pricingQuery.data!.price) s.setRevenueEmptyReturn(String(pricingQuery.data!.price * count));
      }
      s.setRevenueCombine("0");
    }
    // 's' omitted: individual s.* fields listed are the correct granularity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingQuery.data, s.containerCount, isEditMode]);

  const selectedRouteData = useMemo((): RouteOption | null => {
    if (s.routeId) {
      const found = options.routes.find(r => r.id === Number(s.routeId));
      if (found) return found;
    }
    if (isEditMode && existingTrip?.route) {
      return {
        id: existingTrip.route.id,
        label: existingTrip.route.name,
        name: existingTrip.route.name,
        distanceKm: existingTrip.route.distanceKm ?? undefined,
        isMountain: existingTrip.route.isMountain,
        fixedFuelAllowance: existingTrip.route.fixedFuelAllowance,
        tollsStations: existingTrip.route.tollsStations ?? undefined,
        driverSalary: existingTrip.route.driverSalary ?? undefined,
      };
    }
    return null;
  }, [s.routeId, options.routes, isEditMode, existingTrip]);

  useEffect(() => {
    if (!selectedRouteData) return;
    if (isEditMode && existingTrip && existingTrip.routeId === selectedRouteData.id) {
      return;
    }
    if (selectedRouteData.tollsStations != null) {
      s.setTollsStations(String(selectedRouteData.tollsStations));
    }
    if (selectedRouteData.fixedFuelAllowance != null) {
      s.setFuelLitersOverride(String(selectedRouteData.fixedFuelAllowance));
    }
    const hasConfiguredDriverSalary = (options.drivers.find(
      (driver) => driver.id === Number(s.driverId),
    )?.baseSalary ?? 0) > 0;
    if (!hasConfiguredDriverSalary) {
      if (selectedRouteData.driverSalary != null) {
        s.setDriverSalary(String(selectedRouteData.driverSalary));
      } else if (roadConfig?.defaultDriverSalary && Number(roadConfig.defaultDriverSalary) > 0) {
        s.setDriverSalary(String(roadConfig.defaultDriverSalary));
      }
    }
    if (roadConfig?.twoPointDeliveryBonus && Number(roadConfig.twoPointDeliveryBonus) > 0) {
      s.setTwoPointDeliveryBonus(String(roadConfig.twoPointDeliveryBonus));
    }
    if (roadConfig?.vehicleShiftDefault && Number(roadConfig.vehicleShiftDefault) > 0) {
      s.setVehicleShiftAllowance(String(roadConfig.vehicleShiftDefault));
    }
    // 's' and roadConfig fields omitted: this effect applies road-config defaults
    // only when the route changes; adding roadConfig deps would re-fire and
    // overwrite user edits on every config refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteData, isEditMode, existingTrip]);

  const driverBaseSalary = useMemo(
    () => options.drivers.find((driver) => driver.id === Number(s.driverId))?.baseSalary ?? 0,
    [options.drivers, s.driverId],
  );

  useEffect(() => {
    if (isEditMode) return;
    if (!s.driverId || !s.departureDate) return;
    if (driverBaseSalary <= 0) return;

    const startDate = new Date(s.departureDate);
    const days = s.completedAt
      ? Math.max(1, Math.ceil((new Date(s.completedAt).getTime() - startDate.getTime()) / (86400000)) + 1)
      : 1;

    s.setTripWageDays(s.tripWageDays || String(days));

    s.setDriverSalary(String(computeTripDriverSalary(driverBaseSalary, days)));
    // 's' omitted: individual s.* fields listed are the correct granularity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.driverId, s.departureDate, s.completedAt, driverBaseSalary, isEditMode]);

  const estimatedFuelCost = useMemo(() => {
    if (s.fuelMode === FuelMode.FLAT_RATE) {
      const liters = Number(s.fuelLitersOverride) || 0;
      return liters * FUEL_PRICE_PER_LITER;
    }
    const fixedRouteAllowance = Number(selectedRouteData?.fixedFuelAllowance || 0);
    if (fixedRouteAllowance > 0) {
      return fixedRouteAllowance * FUEL_PRICE_PER_LITER;
    }
    return legs.reduce((acc, leg) => {
      const km = Number(leg.km) || 0;
      const rate = leg.loadingType === LoadingType.HANG ? LOADED_RATE : EMPTY_RATE;
      return acc + (km / 100) * rate * FUEL_PRICE_PER_LITER;
    }, 0);
  }, [s.fuelMode, s.fuelLitersOverride, selectedRouteData, legs]);

  const estimatedTollCost = useMemo(() => {
    const base = isEditMode && existingTrip?.roadAllowanceBaseApplied ? Number(existingTrip.roadAllowanceBaseApplied) : 0;
    const discount = moneyOrZero(s.tollsDiscount);
    const addition = moneyOrZero(s.tollsAddition);
    const stations = Number(s.tollsStations) || 0;

    const perStation = isEditMode && existingTrip?.tollPerStationApplied
      ? Number(existingTrip.tollPerStationApplied)
      : (roadConfig ? Number(roadConfig.tollPerStation) : 55000);

    const returnBonus = s.hasReturnCargo
      ? (isEditMode && existingTrip?.returnCargoBonusApplied
          ? Number(existingTrip.returnCargoBonusApplied)
          : (roadConfig ? Number(roadConfig.returnCargoBonus) : 300000))
      : 0;

    const tongTienDiDuong = addition > 0
      ? addition
      : (base - (stations * perStation) + returnBonus);

    return Math.max(0, tongTienDiDuong - discount);
  }, [isEditMode, existingTrip, roadConfig, s.tollsDiscount, s.tollsAddition, s.tollsStations, s.hasReturnCargo]);

  const estimatedProfit = useMemo(
    () =>
      (Number(s.revenue) || 0) -
      estimatedFuelCost -
      estimatedTollCost -
      moneyOrZero(s.driverSalary) -
      moneyOrZero(s.twoPointDeliveryBonus) -
      moneyOrZero(s.vehicleShiftAllowance),
    [s.revenue, estimatedFuelCost, estimatedTollCost, s.driverSalary, s.twoPointDeliveryBonus, s.vehicleShiftAllowance],
  );

  const requiredFieldsFilled = useMemo(() => {
    let count = 0;
    if (s.customerId) count++;
    if (s.routeId) count++;
    if (s.carrierType === 'EXTERNAL') {
      if (s.externalFreightCost && s.externalFreightCost.trim()) count++;
      if (s.externalDriverName && s.externalDriverName.trim()) count++;
      if (s.externalDriverPhone && s.externalDriverPhone.trim()) count++;
    } else {
      if (s.truckId) count++;
      if (s.trailerType) count++;
      if (s.driverId) count++;
    }
    if (s.cargoTypeId) count++;
    if (s.plannedContainerTypeId || s.containerRows.some(r => r.containerTypeId)) count++;
    if (s.departureDate) count++;
    return count;
  }, [
    s.customerId, s.routeId, s.carrierType, s.truckId, s.trailerType, s.driverId,
    s.cargoTypeId, s.plannedContainerTypeId, s.containerRows, s.departureDate,
    s.externalFreightCost, s.externalDriverName, s.externalDriverPhone
  ]);

  const completionStatus = useMemo((): CompletionStatus => {
    let fuelRevenue = 0;
    if (s.fuelMode) fuelRevenue++;
    if (s.fuelSupplementLiters) fuelRevenue++;
    if (s.fuelSupplementReason) fuelRevenue++;
    if (s.tollsAddition) fuelRevenue++;
    if (s.tollsDiscount) fuelRevenue++;
    if (s.tollsStations) fuelRevenue++;
    if (s.driverSalary) fuelRevenue++;
    if (s.revenue) fuelRevenue++;

    let images = 0;
    if (s.notes.trim()) images++;
    if (photoUrls.length > 0) images++;

    return {
      mainInfo: requiredFieldsFilled + (s.customerReference.trim() ? 1 : 0),
      journey: legs.length,
      fuelRevenue,
      images,
    };
  }, [
    requiredFieldsFilled,
    s.customerReference,
    legs.length,
    s.fuelMode,
    s.fuelSupplementLiters,
    s.fuelSupplementReason,
    s.tollsAddition,
    s.tollsDiscount,
    s.tollsStations,
    s.driverSalary,
    s.revenue,
    s.notes,
    photoUrls,
  ]);

  const totalRequiredFields = 8;

  const completedSections = useMemo(() => {
    let count = 0;
    if (completionStatus.mainInfo >= totalRequiredFields) count++;
    if (completionStatus.journey >= 1) count++;
    if (completionStatus.fuelRevenue >= 2) count++;
    if (completionStatus.images >= 1) count++;
    return count;
  }, [completionStatus]);

  const hasOptionalData = useMemo(
    () =>
      legs.some((l) => l.km.trim() !== "") ||
      (s.fuelMode === FuelMode.FLAT_RATE && s.fuelLitersOverride.trim() !== "") ||
      s.fuelSupplementLiters.trim() !== "" ||
      s.fuelSupplementReason.trim() !== "" ||
      s.tollsDiscount.trim() !== "" ||
      s.tollsAddition.trim() !== "" ||
      s.tollsStations.trim() !== "" ||
      s.hasReturnCargo ||
      s.driverSalary.trim() !== "" ||
      s.revenue.trim() !== "" ||
      s.notes.trim() !== "" ||
      photoUrls.length > 0,
    [
      legs, s.fuelMode, s.fuelLitersOverride, s.fuelSupplementLiters,
      s.fuelSupplementReason, s.tollsDiscount, s.tollsAddition, s.tollsStations,
      s.hasReturnCargo, s.driverSalary, s.revenue, s.notes, photoUrls,
    ],
  );

  const estimatedDispatchRevenue = useMemo(() => {
    const explicitRevenue = moneyInputToNumber(s.revenue);
    if (explicitRevenue != null && explicitRevenue > 0) return explicitRevenue;
    if (suggestedPrice != null && suggestedPrice > 0) {
      return suggestedPrice * resolveContainerCount(s.containerCount);
    }
    return 0;
  }, [s.revenue, suggestedPrice, s.containerCount]);

  const handleSubmit = useTripFormSubmit({
    state: s,
    isEditMode,
    existingTrip,
    legs,
    requiredFieldsFilled,
    hasOptionalData,
    photoUrls,
    flushPendingPhotos,
    flushPendingContainerPhotos,
    governanceReason,
    onCreditLimitBlocked: onCreditLimitBlocked
      ? ({ message, customerId }) =>
          onCreditLimitBlocked({
            message,
            customerId,
            proposedAmount: estimatedDispatchRevenue,
          })
      : undefined,
  });

  return {
    legs, addLeg, removeLeg, updateLeg,
    photoUrls, uploading, uploadPhotos, removePhoto,
    uploadContainerPhoto, revokeRowPhotos, revokeContainerPhoto,
    ocrResult,
    suggestedPrice,
    estimatedFuelCost,
    estimatedTollCost,
    estimatedProfit,
    completionStatus,
    completedSections,
    requiredFieldsFilled,
    totalRequiredFields,
    handleSubmit,
    selectedRouteData,
    driverBaseSalary,
    roadAllowanceBaseApplied: isEditMode && existingTrip?.roadAllowanceBaseApplied ? Number(existingTrip.roadAllowanceBaseApplied) : undefined,
    tollPerStationApplied: isEditMode && existingTrip?.tollPerStationApplied
      ? Number(existingTrip.tollPerStationApplied)
      : roadConfig ? Number(roadConfig.tollPerStation) : undefined,
    returnCargoBonusApplied: isEditMode && existingTrip?.returnCargoBonusApplied
      ? Number(existingTrip.returnCargoBonusApplied)
      : roadConfig ? Number(roadConfig.returnCargoBonus) : undefined,
    twoPointDeliveryDefault: roadConfig?.twoPointDeliveryBonus ? Number(roadConfig.twoPointDeliveryBonus) : undefined,
    vehicleShiftDefault: roadConfig?.vehicleShiftDefault ? Number(roadConfig.vehicleShiftDefault) : undefined,
  };
}
