import type { TripDetail, TripStatus } from '@tingting/shared';
import type { FuelMode } from '@tingting/shared';

import type { TripOptions } from './useTripOptions';
import type { RouteOption } from './useTripOptions';
import type { FormLeg } from './useTripFormLegs';
import type { CompletionStatus } from './useTripFormState';
import type { ContainerFormRow } from './useTripFormState';
import { useTripFormState } from './useTripFormState';
import { useTripFormDispatch } from './useTripFormDispatch';
import type { OcrSignal } from './useTripFormDispatch';
import type { UploadingState, ContainerPhotoUploadResult } from './useTripFormPhotos';

export type { FuelMode } from '@tingting/shared';
export type { FormLeg } from './useTripFormLegs';
export type { CompletionStatus } from './useTripFormState';

export interface UseTripFormParams {
  options: TripOptions;
  mode?: 'create' | 'edit';
  existingTrip?: TripDetail;
  governanceReason?: string;
  onCreditLimitBlocked?: (details: { message: string; customerId: number; proposedAmount: number }) => void;
}

export interface UseTripFormReturn {
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

  legs: FormLeg[];
  addLeg: () => void;
  removeLeg: (idx: number) => void;
  updateLeg: (idx: number, field: keyof FormLeg, value: string) => void;

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

  notes: string;
  setNotes: (v: string) => void;
  contactName: string;
  setContactName: (v: string) => void;
  contactPhone: string;
  setContactPhone: (v: string) => void;
  instructionsNotes: string;
  setInstructionsNotes: (v: string) => void;
  photoUrls: string[];
  uploadPhotos: (files: FileList, tripId?: number, type?: 'CONTAINER' | 'SEAL' | 'OTHER') => Promise<void>;
  removePhoto: (idx: number) => void;
  uploadContainerPhoto: (file: File, tripId: number | undefined, rowKey: string, type: 'CONTAINER' | 'SEAL', containerId?: number) => Promise<ContainerPhotoUploadResult>;
  revokeRowPhotos: (rowKey: string) => void;
  revokeContainerPhoto: (rowKey: string, type: 'CONTAINER' | 'SEAL', objectUrl: string) => void;

  // Container instances — edited via ContainerInstancesCard, saved by the
  // unified "Lưu cập nhật" submit alongside the trip figures.
  containerRows: ContainerFormRow[];
  setContainerRows: (rows: ContainerFormRow[] | ((prev: ContainerFormRow[]) => ContainerFormRow[])) => void;

  suggestedPrice: number | null;
  estimatedFuelCost: number;
  estimatedTollCost: number;
  estimatedProfit: number;
  completionStatus: CompletionStatus;
  completedSections: number;
  requiredFieldsFilled: number;
  totalRequiredFields: number;
  legsValid: boolean;

  submitting: boolean;
  uploading: UploadingState;
  ocrResult: OcrSignal | null;
  error: string;
  setError: (v: string) => void;
  handleSubmit: (e?: React.FormEvent, options?: { creditApprovalRequestId?: number | null }) => Promise<number | undefined>;

  tripId?: number;
  tripStatus?: TripStatus;
  version?: string;
  roadAllowanceBaseApplied?: number;
  tollPerStationApplied?: number;
  returnCargoBonusApplied?: number;
  twoPointDeliveryDefault?: number;
  vehicleShiftDefault?: number;
  isEditMode: boolean;
  selectedRouteData: RouteOption | null;
  driverBaseSalary: number;
  resetForm?: () => void;
}

function isParamsObject(arg: TripOptions | UseTripFormParams): arg is UseTripFormParams {
  return 'options' in arg;
}

export function useTripForm(arg: TripOptions | UseTripFormParams): UseTripFormReturn {
  const params = isParamsObject(arg) ? arg : { options: arg, mode: 'create' as const };
  const { options, mode = 'create', existingTrip, governanceReason, onCreditLimitBlocked } = params;
  const isEditMode = mode === 'edit';

  const s = useTripFormState({ isEditMode, existingTrip });
  const d = useTripFormDispatch({
    state: s,
    options,
    isEditMode,
    existingTrip,
    governanceReason,
    onCreditLimitBlocked,
  });

  return {
    customerId: s.customerId, setCustomerId: s.setCustomerId,
    routeId: s.routeId, setRouteId: s.setRouteId,
    truckId: s.truckId, setTruckId: s.setTruckId,
    trailerType: s.trailerType, setTrailerType: s.setTrailerType,
    driverId: s.driverId, setDriverId: s.setDriverId,
    cargoTypeId: s.cargoTypeId, setCargoTypeId: s.setCargoTypeId,
    departureDate: s.departureDate, setDepartureDate: s.setDepartureDate,
    customerReference: s.customerReference, setCustomerReference: s.setCustomerReference,
    completedAt: s.completedAt, setCompletedAt: s.setCompletedAt,
    containerCount: s.containerCount, setContainerCount: s.setContainerCount,
    plannedContainerTypeId: s.plannedContainerTypeId, setPlannedContainerTypeId: s.setPlannedContainerTypeId,
    carrierType: s.carrierType, setCarrierType: s.setCarrierType,
    vatRate: s.vatRate, setVatRate: s.setVatRate,
    externalCarrierId: s.externalCarrierId, setExternalCarrierId: s.setExternalCarrierId,
    externalFreightCost: s.externalFreightCost, setExternalFreightCost: s.setExternalFreightCost,
    externalPlateNumber: s.externalPlateNumber, setExternalPlateNumber: s.setExternalPlateNumber,
    externalDriverName: s.externalDriverName, setExternalDriverName: s.setExternalDriverName,
    externalDriverPhone: s.externalDriverPhone, setExternalDriverPhone: s.setExternalDriverPhone,
    legs: d.legs, addLeg: d.addLeg, removeLeg: d.removeLeg, updateLeg: d.updateLeg,
    fuelMode: s.fuelMode, setFuelMode: s.setFuelMode,
    fuelLitersOverride: s.fuelLitersOverride, setFuelLitersOverride: s.setFuelLitersOverride,
    fuelSupplementLiters: s.fuelSupplementLiters, setFuelSupplementLiters: s.setFuelSupplementLiters,
    fuelSupplementReason: s.fuelSupplementReason, setFuelSupplementReason: s.setFuelSupplementReason,
    tollsDiscount: s.tollsDiscount, setTollsDiscount: s.setTollsDiscount,
    tollsAddition: s.tollsAddition, setTollsAddition: s.setTollsAddition,
    tollsStations: s.tollsStations, setTollsStations: s.setTollsStations,
    hasReturnCargo: s.hasReturnCargo, setHasReturnCargo: s.setHasReturnCargo,
    driverSalary: s.driverSalary, setDriverSalary: s.setDriverSalary,
    twoPointDeliveryBonus: s.twoPointDeliveryBonus, setTwoPointDeliveryBonus: s.setTwoPointDeliveryBonus,
    vehicleShiftAllowance: s.vehicleShiftAllowance, setVehicleShiftAllowance: s.setVehicleShiftAllowance,
    roadAllowanceOverride: s.roadAllowanceOverride, setRoadAllowanceOverride: s.setRoadAllowanceOverride,
    fuelActualUnitPrice: s.fuelActualUnitPrice, setFuelActualUnitPrice: s.setFuelActualUnitPrice,
    fuelSupplierId: s.fuelSupplierId, setFuelSupplierId: s.setFuelSupplierId,
    customerCommission: s.customerCommission, setCustomerCommission: s.setCustomerCommission,
    tripWageDays: s.tripWageDays, setTripWageDays: s.setTripWageDays,
    revenue: s.revenue, setRevenue: s.setRevenue,
    revenueEmptyReturn: s.revenueEmptyReturn, setRevenueEmptyReturn: s.setRevenueEmptyReturn,
    revenueCombine: s.revenueCombine, setRevenueCombine: s.setRevenueCombine,
    notes: s.notes, setNotes: s.setNotes,
    contactName: s.contactName, setContactName: s.setContactName,
    contactPhone: s.contactPhone, setContactPhone: s.setContactPhone,
    instructionsNotes: s.instructionsNotes, setInstructionsNotes: s.setInstructionsNotes,
    photoUrls: d.photoUrls, uploadPhotos: d.uploadPhotos, removePhoto: d.removePhoto,
    uploadContainerPhoto: d.uploadContainerPhoto, revokeRowPhotos: d.revokeRowPhotos,
    revokeContainerPhoto: d.revokeContainerPhoto,
    containerRows: s.containerRows, setContainerRows: s.setContainerRows,
    suggestedPrice: d.suggestedPrice,
    estimatedFuelCost: d.estimatedFuelCost,
    estimatedTollCost: d.estimatedTollCost,
    estimatedProfit: d.estimatedProfit,
    completionStatus: d.completionStatus,
    completedSections: d.completedSections,
    requiredFieldsFilled: d.requiredFieldsFilled,
    totalRequiredFields: d.totalRequiredFields,
    legsValid: d.legsValid,
    submitting: s.submitting, uploading: d.uploading, ocrResult: d.ocrResult, error: s.error, setError: s.setError, handleSubmit: d.handleSubmit,
    tripId: isEditMode ? existingTrip?.id : undefined,
    tripStatus: isEditMode ? existingTrip?.status : undefined,
    version: isEditMode && existingTrip ? String(existingTrip.version) : undefined,
    roadAllowanceBaseApplied: d.roadAllowanceBaseApplied,
    tollPerStationApplied: d.tollPerStationApplied,
    returnCargoBonusApplied: d.returnCargoBonusApplied,
    twoPointDeliveryDefault: d.twoPointDeliveryDefault,
    vehicleShiftDefault: d.vehicleShiftDefault,
    isEditMode,
    selectedRouteData: d.selectedRouteData,
    driverBaseSalary: d.driverBaseSalary,
    resetForm: s.resetForm,
  };
}
