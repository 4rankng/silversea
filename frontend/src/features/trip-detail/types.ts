import type { ReactNode } from 'react';
import type { TripDetail } from '@tingting/shared';

/** Derived financial & operational data computed from a TripDetail. */
export interface TripDerivedData {
  revenue: number;
  totalCost: number;
  grossProfit: number;
  marginPct: string | null;
  fuelCost: number;
  roadAllowance: number;
  tollCost: number;
  tollsDiscount: number;
  driverSalary: number;
  serviceCost: number;
  twoPointDeliveryBonus: number;
  vehicleShiftAllowance: number;
  totalKm: number;
  fuelLiters: number;
  computedLiters: number;
  ttbq: number;
  fuelVarianceLiters: number;
  fuelVarianceOver: boolean;
  externalCarrierName: string;
  externalMargin: number | null;
}

/** Role-based permission flags for trip actions. */
export interface TripPermissions {
  isManagerOrAdmin: boolean;
  /**
   * Manager/admin may edit any trip field on CREATED + COMPLETED trips
   * (structural changes such as route, customer, truck, driver). The trip
   * edit form is shared, so this also implicitly covers actuals.
   */
  canEdit: boolean;
  /**
   * Manager/admin AND accountant may edit the financial-figures side of a
   * trip on IN_TRANSIT + COMPLETED. Backend contract:
   * `PUT /api/trips/:id/actuals` is open to any role with `trips:write`
   * and is blocked only when the trip is COMPLETED (terminal) or CANCELED.
   */
  canEditActuals: boolean;
  canCancel: boolean;
  canDispatch: boolean;
  canComplete: boolean;
  /** SIL-694 — the POD-gốc mark is the backend's ACCOUNTANT/CUS act
   *  (POST /trips/:id/pod-recovered allowlist); other closer roles read the
   *  readiness state and the reason instead of a dead button. */
  canMarkPodRecovered: boolean;
  canAdjust: boolean;
  canChangeDate: boolean;
  needsPhotos: boolean;
  readOnly: boolean;
}

/** UI state for modals and action feedback. */
export interface TripUIState {
  actionLoading: boolean;
  actionError: string;
  showAdjust: boolean;
  adjustAmount: string;
  adjustNote: string;
  adjustRef: string;
  adjustSubmitting: boolean;
  adjustError: string;
}

/** All data returned by the useTripDetailPage hook. */
export interface TripDetailPageData {
  trip: TripDetail | undefined;
  loading: boolean;
  error: string;
  refetchTrip: () => void;
  derived: TripDerivedData;
  permissions: TripPermissions;
  ui: TripUIState;
  fuelPriceConfig: number | null;
  carrierCustomers: { id: number; label: string }[];
  adjustments: unknown[];
  /** React Confirm dialog instance & trigger */
  confirm: (message: string, options?: { variant?: 'danger' | 'primary' | 'warning'; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
  confirmDialog: ReactNode;
  /** Action handlers — call from UI components. */
  handleAction: (action: string, method: () => Promise<unknown>) => Promise<void>;
  handleChangeDepartureDate: (newDate: string) => Promise<void>;
  openAdjust: () => void;
  /** SIL-694 — marks the paper POD recovered (Kế toán/CUS), then refetches. */
  handleMarkPodRecovered: () => Promise<void>;
  handleAdjustSubmit: () => Promise<void>;
  setShowAdjust: (v: boolean) => void;
  setAdjustAmount: (v: string) => void;
  setAdjustNote: (v: string) => void;
  setAdjustRef: (v: string) => void;
  cancelLoading: boolean;
}
