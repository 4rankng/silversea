/**
 * useTripFormState — state container for the trip form.
 *
 * Extracted from useTripForm.ts during M3 decomposition (T3.1.3).
 * Owns all useState declarations, resetForm, and the edit-mode
 * population effect. The parent useTripForm composes this hook
 * with sub-hooks (legs, photos), derived values, and submit logic.
 */
import { useState, useCallback, useRef } from 'react';
import { FuelMode } from '@tingting/shared';
import { businessDateISO } from '../lib/format';
import type { TripDetail } from '@tingting/shared';

// ─── Types ────────────────────────────────────────────────────────────────

export interface CompletionStatus {
  mainInfo: number;
  journey: number;
  fuelRevenue: number;
  images: number;
}

/** A seal sub-row within a container. Existing seals keep their server `id`;
 *  new seals get a client-only `_key`. `sealType` is free-form (datalist
 *  suggestions, not an enum) — drivers write whatever label fits. */
export interface SealFormRow {
  id?: number;
  _key: string;
  sealNumber: string;
  sealType: string;
  notes: string;
}

/** A container row being edited in the trip form. Existing rows keep their
 *  server `id`; new rows get a client-only `_key`. Owned by the form state so
 *  the unified "Lưu cập nhật" submit can persist containers alongside the
 *  trip figures (the per-card save button was removed).
 *
 *  Phase 3: each row carries a `seals[]` sub-list (customs seal, carrier
 *  seal, …) and per-type photo galleries (`photoKeys`). The legacy
 *  `sealNumber` scalar is kept for back-compat but is now DERIVED from
 *  `seals[0]?.sealNumber` — it is kept in sync by every mutation that touches
 *  `seals`. New edits go through the seal sub-list, never the scalar. */
export interface ContainerFormRow {
  id?: number;
  _key: string;
  containerTypeId: number | '';
  containerNumber: string;
  /** @deprecated Derived from `seals[0]?.sealNumber ?? ''`. Kept in sync by
   *  every mutation that touches `seals`. Source of truth is `seals[]`. */
  sealNumber: string;
  cargoWeightKg: string;
  notes: string;
  seals: SealFormRow[];
  /** Server-persisted photo keys per type (bare storage keys from the
   *  containers API) PLUS in-flight `blob:` previews for create-mode / unsaved
   *  rows. `photoSrc()` renders both. A `blob:` prefix marks a photo as
   *  pending flush ("chưa lưu"). */
  photoKeys: { cont: string[]; seal: string[] };
}

export interface TripFormStateParams {
  isEditMode: boolean;
  existingTrip: TripDetail | undefined;
}

export interface UseTripFormStateReturn {
  // Main info
  customerId: string;
  setCustomerId: (v: string) => void;
  routeId: string;
  setRouteId: (v: string) => void;
  truckId: string;
  setTruckId: (v: string) => void;
  trailerType: string;
  setTrailerType: (v: string) => void;
  driverId: string;
  setDriverId: (v: string) => void;
  cargoTypeId: string;
  setCargoTypeId: (v: string) => void;
  departureDate: string;
  setDepartureDate: (v: string) => void;
  completedAt: string;
  setCompletedAt: (v: string) => void;
  customerReference: string;
  setCustomerReference: (v: string) => void;
  containerCount: string;
  setContainerCount: (v: string) => void;
  plannedContainerTypeId: string;
  setPlannedContainerTypeId: (v: string) => void;

  // Carrier
  carrierType: 'OWN' | 'EXTERNAL';
  setCarrierType: (v: 'OWN' | 'EXTERNAL') => void;
  vatRate: number;
  setVatRate: (v: number) => void;
  externalCarrierId: number | null;
  setExternalCarrierId: (v: number | null) => void;
  externalFreightCost: string;
  setExternalFreightCost: (v: string) => void;
  externalPlateNumber: string;
  setExternalPlateNumber: (v: string) => void;
  externalDriverName: string;
  setExternalDriverName: (v: string) => void;
  externalDriverPhone: string;
  setExternalDriverPhone: (v: string) => void;

  // Fuel & tolls
  fuelMode: FuelMode;
  setFuelMode: (v: FuelMode) => void;
  fuelLitersOverride: string;
  setFuelLitersOverride: (v: string) => void;
  fuelSupplementLiters: string;
  setFuelSupplementLiters: (v: string) => void;
  fuelSupplementReason: string;
  setFuelSupplementReason: (v: string) => void;
  tollsDiscount: string;
  setTollsDiscount: (v: string) => void;
  tollsAddition: string;
  setTollsAddition: (v: string) => void;
  tollsStations: string;
  setTollsStations: (v: string) => void;
  hasReturnCargo: boolean;
  setHasReturnCargo: (v: boolean) => void;
  driverSalary: string;
  setDriverSalary: (v: string) => void;
  twoPointDeliveryBonus: string;
  setTwoPointDeliveryBonus: (v: string) => void;
  vehicleShiftAllowance: string;
  setVehicleShiftAllowance: (v: string) => void;
  roadAllowanceOverride: string;
  setRoadAllowanceOverride: (v: string) => void;
  fuelActualUnitPrice: string;
  setFuelActualUnitPrice: (v: string) => void;
  fuelSupplierId: number | null;
  setFuelSupplierId: (v: number | null) => void;
  customerCommission: string;
  setCustomerCommission: (v: string) => void;
  tripWageDays: string;
  setTripWageDays: (v: string) => void;
  revenue: string;
  setRevenue: (v: string) => void;
  revenueEmptyReturn: string;
  setRevenueEmptyReturn: (v: string | ((prev: string) => string)) => void;
  revenueCombine: string;
  setRevenueCombine: (v: string) => void;

  // Notes & photos (state only; upload logic stays in useTripFormPhotos)
  notes: string;
  setNotes: (v: string) => void;
  /** Manager-authored contact + guidance (N2 / B1.3). Persisted by the unified
   *  "Lưu cập nhật" submit via PUT /api/trips/:id/instructions — the
   *  TripInstructionsCard no longer owns its own save button. */
  contactName: string;
  setContactName: (v: string) => void;
  contactPhone: string;
  setContactPhone: (v: string) => void;
  instructionsNotes: string;
  setInstructionsNotes: (v: string) => void;
  photoUrls: string[];
  setPhotoUrls: (urls: string[] | ((prev: string[]) => string[])) => void;

  // Container instances (mirrored from ContainerInstancesCard so the unified
  // "Lưu cập nhật" submit persists them with the trip figures).
  containerRows: ContainerFormRow[];
  setContainerRows: (rows: ContainerFormRow[] | ((prev: ContainerFormRow[]) => ContainerFormRow[])) => void;

  // Submission state
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  error: string;
  setError: (v: string) => void;

  // Reset
  resetForm: () => void;
  resetToggle: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useTripFormState(params: TripFormStateParams): UseTripFormStateReturn {
  const { isEditMode, existingTrip } = params;

  const lastTripId = useRef<number | null>(null);
  const [resetToggle, setResetToggle] = useState(0);
  const resetForm = useCallback(() => {
    lastTripId.current = null;
    setResetToggle((prev) => prev + 1);
  }, []);

  // ── Main info ──
  const [customerId, setCustomerId] = useState(isEditMode && existingTrip ? String(existingTrip.customerId) : "");
  const [routeId, setRouteId] = useState(isEditMode && existingTrip ? String(existingTrip.routeId) : "");
  const [truckId, setTruckId] = useState(isEditMode && existingTrip ? String(existingTrip.truckId) : "");
  const [trailerType, setTrailerType] = useState(isEditMode && existingTrip?.trailerType ? existingTrip.trailerType : "");
  const [driverId, setDriverId] = useState(isEditMode && existingTrip ? String(existingTrip.driverId) : "");
  const [cargoTypeId, setCargoTypeId] = useState(isEditMode && existingTrip ? String(existingTrip.cargoTypeId) : "");
  const [departureDate, setDepartureDate] = useState(isEditMode && existingTrip ? existingTrip.departureDate : "");
  // VN business calendar date, never the UTC slice of the wire instant — a
  // 20:30Z completion is already the next calendar day in Vietnam.
  const [completedAt, setCompletedAt] = useState(isEditMode && existingTrip?.completedAt ? businessDateISO(new Date(existingTrip.completedAt)) : "");
  const [customerReference, setCustomerReference] = useState(isEditMode && existingTrip?.customerReference ? existingTrip.customerReference : "");
  const [containerCount, setContainerCount] = useState(isEditMode && existingTrip?.containerCount ? String(existingTrip.containerCount) : "1");
  const [plannedContainerTypeId, setPlannedContainerTypeId] = useState("");

  // ── Carrier ──
  const [carrierType, setCarrierType] = useState<'OWN' | 'EXTERNAL'>(
    isEditMode && existingTrip ? existingTrip.carrierType : 'OWN'
  );
  const [vatRate, setVatRate] = useState<number>(
    isEditMode && existingTrip ? Number(existingTrip.vatRate) : 0.08
  );
  const [externalCarrierId, setExternalCarrierId] = useState<number | null>(
    isEditMode && existingTrip ? existingTrip.externalCarrierId : null
  );
  const [externalFreightCost, setExternalFreightCost] = useState(
    isEditMode && existingTrip?.externalFreightCost ? String(existingTrip.externalFreightCost) : ""
  );
  const [externalPlateNumber, setExternalPlateNumber] = useState(
    isEditMode && existingTrip?.externalPlateNumber ? existingTrip.externalPlateNumber : ""
  );
  const [externalDriverName, setExternalDriverName] = useState(
    isEditMode && existingTrip?.externalDriverName ? existingTrip.externalDriverName : ""
  );
  const [externalDriverPhone, setExternalDriverPhone] = useState(
    isEditMode && existingTrip?.externalDriverPhone ? existingTrip.externalDriverPhone : ""
  );

  // ── Fuel & tolls ──
  const [fuelSupplierId, setFuelSupplierId] = useState<number | null>(
    isEditMode && existingTrip ? existingTrip.fuelSupplierId : null
  );
  const [fuelMode, setFuelMode] = useState<FuelMode>(isEditMode && existingTrip ? existingTrip.fuelMode : FuelMode.AUTO);
  const [fuelLitersOverride, setFuelLitersOverride] = useState(isEditMode && existingTrip?.fuelLitersOverride ? String(existingTrip.fuelLitersOverride) : "");
  const [fuelSupplementLiters, setFuelSupplementLiters] = useState(isEditMode && existingTrip?.fuelSupplementLiters ? String(existingTrip.fuelSupplementLiters) : "");
  const [fuelSupplementReason, setFuelSupplementReason] = useState(isEditMode && existingTrip?.fuelSupplementReason ? existingTrip.fuelSupplementReason : "");
  const [tollsDiscount, setTollsDiscount] = useState(isEditMode && existingTrip?.tollsDiscount ? String(existingTrip.tollsDiscount) : "");
  const [tollsAddition, setTollsAddition] = useState(isEditMode && existingTrip?.tollsAddition ? String(existingTrip.tollsAddition) : "");
  const [tollsStations, setTollsStations] = useState(isEditMode && existingTrip?.tollsStations != null ? String(existingTrip.tollsStations) : "");
  const [hasReturnCargo, setHasReturnCargo] = useState(isEditMode && existingTrip ? !!existingTrip.hasReturnCargo : false);
  const [driverSalary, setDriverSalary] = useState(isEditMode && existingTrip?.driverSalary ? String(existingTrip.driverSalary) : "");
  const [twoPointDeliveryBonus, setTwoPointDeliveryBonus] = useState(isEditMode && existingTrip?.twoPointDeliveryBonus && Number(existingTrip.twoPointDeliveryBonus) > 0 ? String(existingTrip.twoPointDeliveryBonus) : "");
  const [vehicleShiftAllowance, setVehicleShiftAllowance] = useState(isEditMode && existingTrip?.vehicleShiftAllowance && Number(existingTrip.vehicleShiftAllowance) > 0 ? String(existingTrip.vehicleShiftAllowance) : "");
  const [roadAllowanceOverride, setRoadAllowanceOverride] = useState(
    isEditMode && existingTrip?.roadAllowanceOverride != null ? String(existingTrip.roadAllowanceOverride) : ""
  );
  const [fuelActualUnitPrice, setFuelActualUnitPrice] = useState(
    isEditMode && existingTrip && existingTrip.fuelActualUnitPrice != null
      ? String(existingTrip.fuelActualUnitPrice) : ""
  );
  const [revenueEmptyReturn, setRevenueEmptyReturnInner] = useState(() => {
    if (isEditMode && existingTrip) {
      if (existingTrip.revenueEmptyReturn) return String(existingTrip.revenueEmptyReturn);
      if (existingTrip.revenue && (!existingTrip.revenueCombine || Number(existingTrip.revenueCombine) === 0)) {
        return String(existingTrip.revenue);
      }
    }
    return "";
  });
  // Default "" (not "0"): an untouched combine must serialize as `undefined`
  // (resolveRevenue: not-provided) so saving preserves stored revenue. "0" is a
  // truthy string that would serialize as an explicit-zero split and zero out
  // stored revenue on save (feedback202606 A3 §9).
  const [revenueCombine, setRevenueCombine] = useState(() => {
    if (isEditMode && existingTrip) {
      return existingTrip.revenueCombine ? String(existingTrip.revenueCombine) : "";
    }
    return "";
  });
  const [customerCommission, setCustomerCommission] = useState(isEditMode && existingTrip?.customerCommission ? String(existingTrip.customerCommission) : "0");
  const [tripWageDays, setTripWageDays] = useState(isEditMode && existingTrip?.tripWageDays ? String(existingTrip.tripWageDays) : "");
  // Seed from stored revenue so the derived field shows the persisted value
  // before the derivation effect runs, and survives when both splits are blank
  // (the derivation effect is guarded not to overwrite a blank-split state).
  const [revenue, setRevenue] = useState(
    isEditMode && existingTrip?.revenue ? String(existingTrip.revenue) : ""
  );

  // ── Notes ──
  const [notes, setNotes] = useState(isEditMode && existingTrip?.notes ? existingTrip.notes : "");

  // ── Instructions (N2 / B1.3) — contact + guidance persisted via the
  //    separate `trip_instructions` row, written by the unified submit. ──
  const existingInstructions = isEditMode && existingTrip ? existingTrip.instructions : null;
  const [contactName, setContactName] = useState(existingInstructions?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(existingInstructions?.contactPhone ?? "");
  const [instructionsNotes, setInstructionsNotes] = useState(existingInstructions?.notes ?? "");

  // ── Photos (state only; upload logic in useTripFormPhotos) ──
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  // ── Container instances (editor lives in ContainerInstancesCard; this state
  //    is the single source the unified submit reads from) ──
  const [containerRows, setContainerRows] = useState<ContainerFormRow[]>([]);

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ── Wrapper: setRevenueEmptyReturn accepts string | updater ──
  const setRevenueEmptyReturn = useCallback((v: string | ((prev: string) => string)) => {
    if (typeof v === 'function') {
      setRevenueEmptyReturnInner((prev) => (v as (prev: string) => string)(prev));
    } else {
      setRevenueEmptyReturnInner(v);
    }
  }, []);

  return {
    customerId, setCustomerId,
    routeId, setRouteId,
    truckId, setTruckId,
    trailerType, setTrailerType,
    driverId, setDriverId,
    cargoTypeId, setCargoTypeId,
    departureDate, setDepartureDate,
    customerReference, setCustomerReference,
    completedAt, setCompletedAt,
    containerCount, setContainerCount,
    plannedContainerTypeId, setPlannedContainerTypeId,
    carrierType, setCarrierType,
    vatRate, setVatRate,
    externalCarrierId, setExternalCarrierId,
    externalFreightCost, setExternalFreightCost,
    externalPlateNumber, setExternalPlateNumber,
    externalDriverName, setExternalDriverName,
    externalDriverPhone, setExternalDriverPhone,
    fuelMode, setFuelMode,
    fuelLitersOverride, setFuelLitersOverride,
    fuelSupplementLiters, setFuelSupplementLiters,
    fuelSupplementReason, setFuelSupplementReason,
    tollsDiscount, setTollsDiscount,
    tollsAddition, setTollsAddition,
    tollsStations, setTollsStations,
    hasReturnCargo, setHasReturnCargo,
    driverSalary, setDriverSalary,
    twoPointDeliveryBonus, setTwoPointDeliveryBonus,
    vehicleShiftAllowance, setVehicleShiftAllowance,
    roadAllowanceOverride, setRoadAllowanceOverride,
    fuelActualUnitPrice, setFuelActualUnitPrice,
    fuelSupplierId, setFuelSupplierId,
    customerCommission, setCustomerCommission,
    tripWageDays, setTripWageDays,
    revenue, setRevenue,
    revenueEmptyReturn, setRevenueEmptyReturn,
    revenueCombine, setRevenueCombine,
    notes, setNotes,
    contactName, setContactName,
    contactPhone, setContactPhone,
    instructionsNotes, setInstructionsNotes,
    photoUrls, setPhotoUrls,
    containerRows, setContainerRows,
    submitting, setSubmitting,
    error, setError,
    resetForm,
    resetToggle,
  };
}
