import { useCallback, useEffect, useMemo, useState } from 'react';
import { removeDiacritics } from '../../lib/format';
import {
  useSalaryList,
  useDriverSalary,
  useDriverWorkDays,
  useUpdateWorkDays,
  useConfirmSalary,
  useUnconfirmSalary,
  useSalaryPeriodOverview,
  useCloseSalaryPeriod,
  useReopenSalaryPeriod,
  useIssueSalaryPeriod,
  usePostSalaryPeriod,
  useRequestPostCloseAdjustment,
} from '../../hooks/useSalaryQueries';
import { useAuth } from '../../hooks/useAuth';
import type {
  WorkDayRecord,
} from '../../api/salaryClient';
import { useMonth } from '../../hooks/useMonth';
import { useToast } from '../../components/shared/Toast';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useSalaryPeriod } from '../../hooks/useCatalogQueries';

/**
 * useSalaryAttendancePage — all data and action logic for the Salary & Attendance page.
 * Returns queries, derived memos, and modal state.
 * No JSX — pure logic hook.
 */
export function useSalaryAttendancePage(searchTerm: string) {
  const { month, year, goPrev, goNext } = useMonth();
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);

  const { data: salaryList, isLoading: listLoading } = useSalaryList(year, month);
  const { rootRef } = usePageAnimations({ ready: !listLoading });

  const handleBack = () => setSelectedDriverId(null);
  useBackShortcut(handleBack);
  const { data: workDayData, isLoading: wdLoading } = useDriverWorkDays(selectedDriverId, year, month);
  const { data: salary, isLoading: salaryLoading } = useDriverSalary(selectedDriverId, year, month);
  const updateMutation = useUpdateWorkDays(selectedDriverId ?? 0, year, month);
  const confirmMutation = useConfirmSalary(selectedDriverId ?? 0, year, month);
  const unconfirmMutation = useUnconfirmSalary(selectedDriverId ?? 0, year, month);
  const { toast } = useToast();

  /* ── Driver payout modal (B1) — MANAGER/ACCOUNTANT only ── */
  const { user } = useAuth();
  const canPostPayout =
    user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ACCOUNTANT';
  const canReopenCompanyPeriod = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const periodKey = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [month, year]);
  const { data: periodOverview, isLoading: periodOverviewLoading } = useSalaryPeriodOverview(periodKey, selectedDriverId);
  const closePeriodMutation = useCloseSalaryPeriod(periodKey, year, month);
  const reopenPeriodMutation = useReopenSalaryPeriod(periodKey, selectedDriverId, year, month);
  const issuePeriodMutation = useIssueSalaryPeriod(periodKey, selectedDriverId);
  const postPeriodMutation = usePostSalaryPeriod(periodKey, selectedDriverId);
  const requestAdjustmentMutation = useRequestPostCloseAdjustment(periodKey, selectedDriverId, year, month);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenReasonError, setReopenReasonError] = useState<string | null>(null);

  const isConfirmed = salary?.confirmationStatus === 'CONFIRMED';
  const lifecycle = periodOverview?.lifecycle;
  const periodAdjustments = periodOverview?.adjustments ?? [];
  const drivers = useMemo(() => salaryList?.items ?? [], [salaryList?.items]);
  const workdayEditLocked = isConfirmed || lifecycle?.status === 'CLOSED';

  // Cross-driver aggregates for hero metrics
  const aggregates = useMemo(() => {
    const total = drivers.length;
    const confirmed = drivers.filter(d => d.salary?.confirmationStatus === 'CONFIRMED').length;
    const totalNet = drivers.reduce((s, d) => s + (d.salary?.netSalary ?? 0), 0);
    const totalTripDays = drivers.reduce((s, d) => s + (d.salary?.tripDays ?? 0), 0);
    const totalStandbyDays = drivers.reduce((s, d) => s + (d.salary?.standbyDays ?? 0), 0);
    return { total, confirmed, totalNet, totalTripDays, totalStandbyDays };
  }, [drivers]);
  const { data: salaryPeriod } = useSalaryPeriod(month, year);

  // Auto-select the first driver once the list loads
  useEffect(() => {
    if (!listLoading && drivers.length > 0 && selectedDriverId === null) {
      setSelectedDriverId(drivers[0].id);
    }
  }, [listLoading, drivers, selectedDriverId]);

  useEffect(() => {
    setReopenReason('');
    setReopenReasonError(null);
  }, [periodKey]);

  // Search filter
  const filteredDrivers = useMemo(() => {
    if (!searchTerm.trim()) return drivers;
    const term = removeDiacritics(searchTerm.trim()).toLowerCase();
    return drivers.filter(d => removeDiacritics(d.name).toLowerCase().includes(term));
  }, [drivers, searchTerm]);

  // Build work day map from API data + pending local changes
  const workDayMap = useMemo(() => {
    const map = new Map<string, WorkDayRecord>();
    (workDayData?.workDays ?? []).forEach(w => map.set(w.date, w));
    return map;
  }, [workDayData?.workDays]);

  // Cycle status: STANDBY -> PERSONAL_LEAVE -> WEEKLY_OFF -> STANDBY
  const cycleStatus = (dateStr: string, current: WorkDayRecord | undefined): 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | 'WEEKLY_OFF' | null => {
    const [cy, cm, cd] = dateStr.split('-').map(Number);
    const isSunday = new Date(cy, cm - 1, cd).getDay() === 0;
    const currentStatus = current?.status ?? (isSunday ? 'WEEKLY_OFF' : 'STANDBY');

    if (currentStatus === 'TRIP_DAY') {
      return 'TRIP_DAY';
    }

    if (isSunday) {
      // Sunday: WEEKLY_OFF (default) -> STANDBY -> PERSONAL_LEAVE -> WEEKLY_OFF (default)
      if (currentStatus === 'WEEKLY_OFF') return 'STANDBY';
      if (currentStatus === 'STANDBY') return 'PERSONAL_LEAVE';
      return null; // Revert to Sunday default (WEEKLY_OFF)
    } else {
      // Weekday: STANDBY (default) -> PERSONAL_LEAVE -> WEEKLY_OFF -> STANDBY (default)
      if (currentStatus === 'STANDBY') return 'PERSONAL_LEAVE';
      if (currentStatus === 'PERSONAL_LEAVE') return 'WEEKLY_OFF';
      return null; // Revert to weekday default (STANDBY)
    }
  };

  const handleCellClick = useCallback(async (dateStr: string, current: WorkDayRecord | undefined) => {
    if (!selectedDriverId || workdayEditLocked) return;
    const newStatus = cycleStatus(dateStr, current);
    if (newStatus === 'TRIP_DAY') return;

    const items = [{ date: dateStr, status: newStatus, note: null }];
    try {
      await updateMutation.mutateAsync(items);
    } catch {
      // Error is surfaced via mutation.error state; suppress unhandled rejection
    }
  }, [selectedDriverId, updateMutation, workdayEditLocked]);

  // Parse a YYYY-MM-DD string using local timezone (avoids UTC midnight parsing issue)
  const parseLocalDate = useCallback((s: string): Date => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, []);

  // Helper to get all dates between start and end date strings inclusive
  const getDatesInRange = useCallback((startStr: string, endStr: string): string[] => {
    const datesArr: string[] = [];
    const curr = parseLocalDate(startStr);
    const end = parseLocalDate(endStr);

    while (curr <= end) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      datesArr.push(`${y}-${m}-${d}`);
      curr.setDate(curr.getDate() + 1);
    }
    return datesArr;
  }, [parseLocalDate]);

  const dates = useMemo(() => {
    const startStr = salaryPeriod?.start || `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endStr = salaryPeriod?.end || `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return getDatesInRange(startStr, endStr);
  }, [salaryPeriod, year, month, getDatesInRange]);

  const firstDow = useMemo(() => {
    if (dates.length === 0) return 0;
    return parseLocalDate(dates[0]).getDay(); // 0 = Sunday
  }, [dates, parseLocalDate]);

  const calCells: (string | null)[] = useMemo(() => {
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null); // leading blanks
    for (const dStr of dates) cells.push(dStr);
    // Pad to complete last row
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [dates, firstDow]);

  const isUpdating = updateMutation.isPending;

  return {
    month, year, goPrev, goNext,
    selectedDriverId, setSelectedDriverId,
    rootRef, handleBack,
    listLoading, salary, salaryLoading, wdLoading, isUpdating,
    toast, canPostPayout, canReopenCompanyPeriod,
    periodKey, lifecycle, periodOverviewLoading, periodAdjustments,
    drivers, filteredDrivers, aggregates, workdayEditLocked, isConfirmed,
    adjustmentModalOpen, setAdjustmentModalOpen,
    payoutOpen, setPayoutOpen,
    reopenReason, setReopenReason, reopenReasonError, setReopenReasonError,
    workDayMap, handleCellClick, parseLocalDate, dates, calCells,
    closePeriodMutation, issuePeriodMutation, postPeriodMutation, reopenPeriodMutation,
    confirmMutation, unconfirmMutation,
    requestAdjustmentMutation,
  };
}
