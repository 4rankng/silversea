import { useState, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { qk } from '../../api/keys';
import { getExternalTripDisplayTotals } from '../trips/tripHelpers';
import {
  useTripDetail,
  useTripAdjustments,
  useFuelConfig,
} from '../../hooks/useQueries';
import { useCatalogs } from '../../hooks/useCatalogs';
import { TripStatus, Role } from '@tingting/shared';
import { useConfirm } from '../../components/UI';

import type { TripDetailPageData, TripDerivedData, TripPermissions, TripUIState } from './types';

export function resolveExpectedFuelLiters(trip: {
  fuelMode?: string | null;
  fuelLitersOverride?: string | number | null;
  fuelSupplementLiters?: string | number | null;
  fuelFixedAllowanceApplied?: string | number | null;
  fuelSupplementNormApplied?: string | number | null;
  legs?: Array<{ calculatedLiters?: string | number | null }> | null;
}): number {
  const manualSupplement = Number(trip.fuelSupplementLiters || 0);
  if (trip.fuelMode === 'FLAT_RATE') {
    return Number(trip.fuelLitersOverride || 0) + manualSupplement;
  }
  const fixedAllowance = Number(trip.fuelFixedAllowanceApplied || 0);
  if (fixedAllowance > 0) return fixedAllowance + manualSupplement;
  const configuredSupplement = Number(trip.fuelSupplementNormApplied || 0);
  return (trip.legs?.reduce((sum, leg) => sum + Number(leg.calculatedLiters || 0), 0) ?? 0)
    + configuredSupplement
    + manualSupplement;
}

/**
 * useTripDetailPage — all business logic for the Trip Detail page.
 * Returns typed data, permissions, derived values, and action handlers.
 * No JSX — pure logic hook.
 */
export function useTripDetailPage(id: string | undefined): TripDetailPageData {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();

  /* ── Data fetching ──────────────────────────────────────────────────── */
  const {
    data: trip,
    isLoading: loading,
    error: queryError,
    refetch: refetchTrip,
  } = useTripDetail(id);

  const error = queryError ? 'Không thể tải thông tin lệnh vận chuyển.' : '';
  const { data: adjustments = [] } = useTripAdjustments(trip?.id ?? 0);
  const { data: fuelConfig } = useFuelConfig();
  const { data: catalogData } = useCatalogs();

  /* ── UI state ───────────────────────────────────────────────────────── */
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustRef, setAdjustRef] = useState('');
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const adjustInFlight = useRef(false);

  // No cancel action is wired in this hook yet; keep the slot in the return
  // shape as a stable `false` so consumers don't need to change.
  const cancelLoading = false;

  const ui: TripUIState = {
    actionLoading,
    actionError,
    showAdjust,
    adjustAmount,
    adjustNote,
    adjustRef,
    adjustSubmitting,
    adjustError,
  };

  /* ── Derived data ───────────────────────────────────────────────────── */
  const derived: TripDerivedData = useMemo(() => {
    if (!trip) {
      return {
        revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
        fuelCost: 0, roadAllowance: 0, tollCost: 0, tollsDiscount: 0, driverSalary: 0, serviceCost: 0,
        twoPointDeliveryBonus: 0, vehicleShiftAllowance: 0,
        totalKm: 0, fuelLiters: 0, computedLiters: 0, ttbq: 0,
        fuelVarianceLiters: 0, fuelVarianceOver: false,
        externalCarrierName: '—', externalMargin: null,
      };
    }

    const isExternal = trip.carrierType === 'EXTERNAL';
    const revenueRaw = Number(trip.revenue || 0);
    const externalTotals = isExternal ? getExternalTripDisplayTotals(trip) : null;
    const externalMargin = externalTotals?.externalMargin ?? null;
    const revenue = revenueRaw;
    const totalCost = externalTotals?.totalCost ?? Number(trip.totalCost || 0);
    const grossProfit = externalTotals?.grossProfit ?? Number(trip.grossProfit || 0);
    const marginRevenue = externalTotals?.recordedRevenue ?? revenue;
    const marginPct = marginRevenue > 0 ? ((grossProfit / marginRevenue) * 100).toFixed(1) : null;
    const fuelCost = Number(trip.totalFuelCost || 0);
    const roadAllowance = Number(trip.totalRoadAllowance || 0);
    const tollCost = Number(trip.tollCost || 0);
    const tollsDiscount = Number(trip.tollsDiscount || 0);
    const driverSalary = Number(trip.driverSalary || 0);
    const serviceCost = 0;
    const twoPointDeliveryBonus = Number(trip.twoPointDeliveryBonus || 0);
    const vehicleShiftAllowance = Number(trip.vehicleShiftAllowance || 0);
    const totalKm = trip.legs?.reduce((s, l) => s + Number(l.km), 0) ?? 0;
    const fuelLiters = Number(trip.fuelLiters) || 0;
    const computedLiters = resolveExpectedFuelLiters(trip);
    const ttbq = totalKm > 0 && fuelLiters > 0 ? (fuelLiters / totalKm) * 100 : 0;
    const fuelVarianceLiters = fuelLiters - computedLiters;
    const fuelVarianceOver = fuelVarianceLiters > 0;

    // The carrier catalog is `externalCarriers`; `customers` deliberately holds
    // no nhà xe, so resolving the name from it silently lost every external
    // carrier and fell back to "không còn trong danh mục".
    const externalCarrierName = trip.externalCarrierName ?? (trip.externalCarrierId
      ? (catalogData?.externalCarriers?.find(c => c.id === trip.externalCarrierId)?.name ?? 'Đơn vị vận chuyển không còn trong danh mục')
      : '—');

    return {
      revenue, totalCost, grossProfit, marginPct,
      fuelCost, roadAllowance, tollCost, tollsDiscount, driverSalary, serviceCost,
      twoPointDeliveryBonus, vehicleShiftAllowance,
      totalKm, fuelLiters, computedLiters, ttbq,
      fuelVarianceLiters, fuelVarianceOver,
      externalCarrierName, externalMargin,
    };
  }, [trip, catalogData]);

  const fuelPriceConfig = fuelConfig?.unitPrice ? Number(fuelConfig.unitPrice) : null;

  /* ── Permissions ────────────────────────────────────────────────────── */
  const permissions: TripPermissions = useMemo(() => {
    const isManagerOrAdmin = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
    const isAccountant = user?.role === Role.ACCOUNTANT;
    const s = trip?.status;
    // Lifecycle / structural edits (route, customer, truck, driver, status
    // transitions) stay with manager/admin only — see trip.service.ts comments
    // and docs/flows/01-TRIP_LIFECYCLE.md §1.3.
    //
    // Financial-figures edits on IN_TRANSIT + COMPLETED are ACCOUNTANT's job
    // (CONTEXT.md Phase 3 + Phase 4: "Accountant finalizes these numbers and
    // moves it to Hoàn thành"). The backend has always allowed it (RBAC
    // `trips:write` for ACCOUNTANT + `updateTripFigures` only blocks
    // COMPLETED/CANCELED for structural fields; financial figures stay
    // editable). The fix below closes the frontend gap surfaced by the bug
    // report "những chuyến ghi hoàn thành này kế toán là không nhập được số
    // liệu" — accountants previously had no entry point to the edit form on
    // completed trips, so road money / ticket / fuel fields looked uneditable.
    return {
      isManagerOrAdmin,
      canEdit: (s === TripStatus.CREATED || s === TripStatus.COMPLETED) && isManagerOrAdmin,
      canEditActuals: (s === TripStatus.IN_TRANSIT || s === TripStatus.COMPLETED)
        && (isManagerOrAdmin || isAccountant),
      // O2C: COMPLETED is terminal. Cancellation of a completed trip goes
      // through the governed reopen/cancel flow (canAdjust), not a direct cancel.
      canCancel: s !== TripStatus.COMPLETED && s !== TripStatus.CANCELED && isManagerOrAdmin,
      canDispatch: s === TripStatus.CREATED && isManagerOrAdmin,
      // SIL-694 (id 806): ACCOUNTANT completes too — CONTEXT.md Phase 3/4
      // names accounting as the role that finalizes the trip's numbers and
      // moves it to Hoàn thành, and the backend TRIP_FINANCIAL_CLOSE policy
      // now applies the accountant's close in-request. Without the button
      // the accountant could never reach the end of the close flow.
      canComplete: s === TripStatus.IN_TRANSIT && (isManagerOrAdmin || isAccountant),
      // SIL-694 — the POD-gốc mark rides the backend's ACCOUNTANT/CUS
      // allowlist (routes/trips/pod.ts) and only exists while the gate is
      // still open (podRecoveredAt null); ADMIN/MANAGER closers see the
      // readiness reason, not a button the server would 403.
      canMarkPodRecovered: (user?.role === Role.ACCOUNTANT || user?.role === Role.CUS)
        && s === TripStatus.IN_TRANSIT
        && trip?.podRecoveredAt == null,
      // Adjustment/governed reopen available on a completed trip (manager/admin).
      canAdjust: s === TripStatus.COMPLETED && isManagerOrAdmin,
      canChangeDate: s !== TripStatus.CANCELED && isManagerOrAdmin,
      needsPhotos: !trip?.photoUrls || trip.photoUrls.length === 0,
      readOnly: s === 'CANCELED',
    };
  }, [user, trip]);

  /* ── Action handlers ────────────────────────────────────────────────── */
  const handleAction = async (_action: string, method: () => Promise<unknown>) => {
    setActionLoading(true);
    setActionError('');
    try {
      const result = await method();
      // Financial edits apply in the backend request — no approval queue
      // exists, so the cache refetch alone reports the saved state.
      void result;
      await refetchTrip();
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError('Có lỗi xảy ra. Vui lòng thử lại.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangeDepartureDate = async (newDate: string) => {
    if (!trip) return;
    const confirmed = await confirm(
      `Thay đổi ngày khởi hành thành ${newDate}?`
    );
    if (!confirmed) return;
    setActionLoading(true);
    setActionError('');
    try {
      await api.patch(`/trips/${trip.id}/departure-date`, { departureDate: newDate });
      await refetchTrip();
    } catch (err: unknown) {
      setActionError((err as Error).message || 'Lỗi khi thay đổi ngày khởi hành.');
    } finally {
      setActionLoading(false);
    }
  };

  const openAdjust = () => {
    setAdjustAmount('');
    setAdjustNote('');
    setAdjustRef('');
    setAdjustError('');
    setShowAdjust(true);
  };

  // SIL-694 — mark the paper POD (chứng từ mộc đỏ) recovered so the governed
  // close can pass its completion gate. Optimistic-locked with the loaded
  // trip's version; the modal stays open and refetches so the readiness row
  // flips before the accountant submits the close.
  const handleMarkPodRecovered = async () => {
    if (!trip || trip.podRecoveredAt != null) return;
    const expectedVersion = trip.version;
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion)) {
      setActionError('Chưa tải được phiên bản chuyến đi. Tải lại dữ liệu rồi thử lại.');
      return;
    }
    await handleAction('mark-pod-recovered', () => api.post(`/trips/${trip.id}/pod-recovered`, { expectedVersion }));
  };

  const handleAdjustSubmit = async () => {
    if (adjustInFlight.current || !id || !adjustNote.trim() || !adjustRef.trim() || adjustAmount.trim() === '') return;
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(amount) || amount === 0) {
      setAdjustError('Nhập số tiền điều chỉnh nguyên đồng, khác 0.');
      return;
    }
    // Publish with the loaded trip's current version — the backend schema
    // requires it (undefined coerces to NaN and leaks a raw zod error) and
    // the 409 conflict guard keys off it.
    const expectedVersion = trip?.version;
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion)) {
      setAdjustError('Chưa tải được phiên bản chuyến đi. Tải lại dữ liệu rồi thử lại.');
      return;
    }
    adjustInFlight.current = true;
    setAdjustSubmitting(true);
    setAdjustError('');
    // One idempotency key per attempt: an in-flight retry replays safely,
    // while a corrected resubmit after a failure is a NEW logical
    // submission — it must never replay the failed payload.
    const idempotencyKey = crypto.randomUUID();
    try {
      await api.post(`/trips/${id}/adjustment`, {
        amount,
        note: adjustNote.trim(),
        signedAgreementRef: adjustRef.trim(),
        expectedVersion,
      }, { headers: { 'Idempotency-Key': idempotencyKey } });
      await queryClient.invalidateQueries({ queryKey: qk.trips.adjustmentsAll });
      await refetchTrip();
      setAdjustAmount('');
      setAdjustNote('');
      setAdjustRef('');
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        // Stale version: refresh the state, keep the drafted inputs, and ask
        // for review before retrying — never a blind resubmit.
        setAdjustError('Dữ liệu chuyến đi đã thay đổi — đã tải lại bản mới; kiểm tra lại thông tin rồi phát hành lại.');
        await refetchTrip();
      } else {
        setAdjustError((e as Error).message || 'Lỗi khi tạo điều chỉnh');
      }
    } finally {
      adjustInFlight.current = false;
      setAdjustSubmitting(false);
    }
  };

  return {
    trip,
    loading,
    error,
    refetchTrip,
    derived,
    permissions,
    ui,
    fuelPriceConfig,
    adjustments,
    confirm,
    confirmDialog,
    handleAction,
    handleChangeDepartureDate,
    openAdjust,
    handleMarkPodRecovered,
    handleAdjustSubmit,
    cancelLoading,
    carrierCustomers: catalogData?.externalCarriers?.map(c => ({ id: c.id, label: c.name })) ?? [],
    setShowAdjust,
    setAdjustAmount,
    setAdjustNote,
    setAdjustRef,
  };
}
