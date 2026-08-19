import { useCallback, useEffect, useMemo, useState } from 'react';
import { removeDiacritics } from '../../lib/format';
import {
  useSalaryList,
  useDriverSalary,
  useDriverWorkDays,
  useUpdateWorkDays,
  useConfirmSalary,
  useUnconfirmSalary,
  useSalaryConfirmationGovernanceActions,
  useCheckConfirmSalary,
  useApproveConfirmSalary,
  useCheckUnconfirmSalary,
  useApproveUnconfirmSalary,
  useSalaryPeriodGovernanceActions,
  useSalaryPeriodOverview,
  useCheckCloseSalaryPeriod,
  useApproveCloseSalaryPeriod,
  useCloseSalaryPeriod,
  useCheckReopenSalaryPeriod,
  useApproveReopenSalaryPeriod,
  useReopenSalaryPeriod,
  useIssueSalaryPeriod,
  useCheckIssueSalaryPeriod,
  useApproveIssueSalaryPeriod,
  usePostSalaryPeriod,
  useCheckPostSalaryPeriod,
  useApprovePostSalaryPeriod,
  useRequestPostCloseAdjustment,
  useCheckPostCloseAdjustment,
  useApprovePostCloseAdjustment,
} from '../../hooks/useSalaryQueries';
import { useAuth } from '../../hooks/useAuth';
import type {
  WorkDayRecord,
  SalaryPeriodAdjustmentItem,
  SalaryConfirmationGovernanceAction,
  SalaryPeriodGovernanceAction,
} from '../../api/salaryClient';
import { useMonth } from '../../hooks/useMonth';
import { useToast } from '../../components/shared/Toast';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useSalaryPeriod } from '../../hooks/useCatalogQueries';

type SalaryPeriodFinalizationOperation = 'ISSUE_PAYSLIPS' | 'POST_OFFICIAL';

function salaryPeriodFinalizationOperation(
  item: SalaryPeriodGovernanceAction,
): SalaryPeriodFinalizationOperation | null {
  const after = item.afterSnapshot;
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const operation = (after as { operation?: unknown }).operation;
  return operation === 'ISSUE_PAYSLIPS' || operation === 'POST_OFFICIAL'
    ? operation
    : null;
}

/**
 * useSalaryAttendancePage — all data and action logic for the Salary & Attendance page.
 * Returns queries, derived memos, governance handlers, and modal state.
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
  const { data: salaryConfirmationActions = [] } = useSalaryConfirmationGovernanceActions(selectedDriverId, year, month);
  const { data: periodOverview, isLoading: periodOverviewLoading } = useSalaryPeriodOverview(periodKey, selectedDriverId);
  const { data: periodGovernanceActions = [] } = useSalaryPeriodGovernanceActions(periodKey);
  const checkConfirmMutation = useCheckConfirmSalary(selectedDriverId ?? 0, year, month);
  const approveConfirmMutation = useApproveConfirmSalary(selectedDriverId ?? 0, year, month);
  const checkUnconfirmMutation = useCheckUnconfirmSalary(selectedDriverId ?? 0, year, month);
  const approveUnconfirmMutation = useApproveUnconfirmSalary(selectedDriverId ?? 0, year, month);
  const closePeriodMutation = useCloseSalaryPeriod(periodKey, year, month);
  const checkClosePeriodMutation = useCheckCloseSalaryPeriod(periodKey, year, month);
  const approveClosePeriodMutation = useApproveCloseSalaryPeriod(periodKey, year, month);
  const reopenPeriodMutation = useReopenSalaryPeriod(periodKey, selectedDriverId, year, month);
  const checkReopenPeriodMutation = useCheckReopenSalaryPeriod(periodKey, year, month);
  const approveReopenPeriodMutation = useApproveReopenSalaryPeriod(periodKey, year, month);
  const issuePeriodMutation = useIssueSalaryPeriod(periodKey, selectedDriverId);
  const checkIssuePeriodMutation = useCheckIssueSalaryPeriod(periodKey, selectedDriverId);
  const approveIssuePeriodMutation = useApproveIssueSalaryPeriod(periodKey, selectedDriverId);
  const postPeriodMutation = usePostSalaryPeriod(periodKey, selectedDriverId);
  const checkPostPeriodMutation = useCheckPostSalaryPeriod(periodKey, selectedDriverId);
  const approvePostPeriodMutation = useApprovePostSalaryPeriod(periodKey, selectedDriverId);
  const requestAdjustmentMutation = useRequestPostCloseAdjustment(periodKey, selectedDriverId, year, month);
  const checkAdjustmentMutation = useCheckPostCloseAdjustment(periodKey, selectedDriverId);
  const approveAdjustmentMutation = useApprovePostCloseAdjustment(periodKey, selectedDriverId, year, month);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenReasonError, setReopenReasonError] = useState<string | null>(null);

  const isConfirmed = salary?.confirmationStatus === 'CONFIRMED';
  const lifecycle = periodOverview?.lifecycle;
  const periodAdjustments = periodOverview?.adjustments ?? [];
  const activePeriodGovernanceActions = useMemo(
    () => periodGovernanceActions.filter((item) =>
      ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'].includes(item.status)),
    [periodGovernanceActions],
  );
  const activeSalaryConfirmationActions = useMemo(
    () => salaryConfirmationActions.filter((item) =>
      ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'].includes(item.status)),
    [salaryConfirmationActions],
  );
  const pendingSalaryConfirmationActions = useMemo(
    () => salaryConfirmationActions.filter((item) =>
      ['PENDING_CHECK', 'PENDING_APPROVAL'].includes(item.status)),
    [salaryConfirmationActions],
  );
  const confirmGovernanceActions = useMemo(
    () => activeSalaryConfirmationActions.filter((item) => item.actionKind === 'SALARY_CONFIRMATION'),
    [activeSalaryConfirmationActions],
  );
  const reopenSalaryGovernanceActions = useMemo(
    () => activeSalaryConfirmationActions.filter((item) => item.actionKind === 'SALARY_REOPEN'),
    [activeSalaryConfirmationActions],
  );
  const closeGovernanceActions = useMemo(
    () => activePeriodGovernanceActions.filter((item) =>
      item.actionKind === 'SALARY_PERIOD_CLOSE'
      && salaryPeriodFinalizationOperation(item) == null),
    [activePeriodGovernanceActions],
  );
  const issueGovernanceActions = useMemo(
    () => activePeriodGovernanceActions.filter((item) =>
      salaryPeriodFinalizationOperation(item) === 'ISSUE_PAYSLIPS'),
    [activePeriodGovernanceActions],
  );
  const postGovernanceActions = useMemo(
    () => activePeriodGovernanceActions.filter((item) =>
      salaryPeriodFinalizationOperation(item) === 'POST_OFFICIAL'),
    [activePeriodGovernanceActions],
  );
  const reopenGovernanceActions = useMemo(
    () => activePeriodGovernanceActions.filter((item) => item.actionKind === 'SALARY_PERIOD_REOPEN'),
    [activePeriodGovernanceActions],
  );

  const drivers = useMemo(() => salaryList?.items ?? [], [salaryList?.items]);
  const workdayEditLocked = isConfirmed
    || lifecycle?.status === 'CLOSED'
    || pendingSalaryConfirmationActions.some((item) => item.actionKind === 'SALARY_CONFIRMATION');

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

  const canCheckAdjustment = useCallback((item: SalaryPeriodAdjustmentItem) => {
    if (!user) return false;
    if (item.status !== 'PENDING_CHECK') return false;
    if (!canPostPayout) return false;
    return item.makerId !== user.userId;
  }, [canPostPayout, user]);

  const canApproveAdjustment = useCallback((item: SalaryPeriodAdjustmentItem) => {
    if (!user) return false;
    if (item.status !== 'PENDING_APPROVAL') return false;
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') return false;
    return item.makerId !== user.userId && item.checkerId !== user.userId;
  }, [user]);

  const handleCheckGovernanceAction = useCallback((item: SalaryPeriodGovernanceAction) => {
    const operation = salaryPeriodFinalizationOperation(item);
    const mutation = operation === 'ISSUE_PAYSLIPS'
      ? checkIssuePeriodMutation
      : operation === 'POST_OFFICIAL'
        ? checkPostPeriodMutation
        : item.actionKind === 'SALARY_PERIOD_CLOSE'
          ? checkClosePeriodMutation
          : checkReopenPeriodMutation;
    mutation.mutate(
      { actionId: item.id, expectedVersion: item.version },
      {
        onSuccess: () => {
          toast({
            kind: 'success',
            message: operation === 'ISSUE_PAYSLIPS'
              ? 'Đã chuyển yêu cầu phát hành phiếu lương sang bước phê duyệt.'
              : operation === 'POST_OFFICIAL'
                ? 'Đã chuyển yêu cầu hạch toán chính thức sang bước phê duyệt.'
                : item.actionKind === 'SALARY_PERIOD_CLOSE'
                  ? 'Đã chuyển yêu cầu chốt kỳ sang bước phê duyệt.'
                  : 'Đã chuyển yêu cầu mở lại sang bước phê duyệt.',
          });
        },
        onError: (err: unknown) => {
          toast({
            kind: 'error',
            message: (err as Error)?.message || 'Không thể kiểm tra yêu cầu kỳ lương.',
          });
        },
      },
    );
  }, [
    checkClosePeriodMutation,
    checkIssuePeriodMutation,
    checkPostPeriodMutation,
    checkReopenPeriodMutation,
    toast,
  ]);

  const handleApproveGovernanceAction = useCallback((item: SalaryPeriodGovernanceAction) => {
    const operation = salaryPeriodFinalizationOperation(item);
    const mutation = operation === 'ISSUE_PAYSLIPS'
      ? approveIssuePeriodMutation
      : operation === 'POST_OFFICIAL'
        ? approvePostPeriodMutation
        : item.actionKind === 'SALARY_PERIOD_CLOSE'
          ? approveClosePeriodMutation
          : approveReopenPeriodMutation;
    mutation.mutate(
      { actionId: item.id, expectedVersion: item.version },
      {
        onSuccess: () => {
          toast({
            kind: 'success',
            message: operation === 'ISSUE_PAYSLIPS'
              ? 'Đã phê duyệt phát hành phiếu lương.'
              : operation === 'POST_OFFICIAL'
                ? 'Đã phê duyệt hạch toán chính thức kỳ lương.'
                : item.actionKind === 'SALARY_PERIOD_CLOSE'
                  ? 'Đã phê duyệt chốt kỳ lương.'
                  : 'Đã phê duyệt mở lại kỳ lương.',
          });
        },
        onError: (err: unknown) => {
          toast({
            kind: 'error',
            message: (err as Error)?.message || 'Không thể phê duyệt yêu cầu kỳ lương.',
          });
        },
      },
    );
  }, [
    approveClosePeriodMutation,
    approveIssuePeriodMutation,
    approvePostPeriodMutation,
    approveReopenPeriodMutation,
    toast,
  ]);

  const handleCheckSalaryConfirmationAction = useCallback((item: SalaryConfirmationGovernanceAction) => {
    const mutation = item.actionKind === 'SALARY_CONFIRMATION'
      ? checkConfirmMutation
      : checkUnconfirmMutation;
    mutation.mutate(
      { actionId: item.id, expectedVersion: item.version },
      {
        onSuccess: () => {
          toast({
            kind: 'success',
            message: item.actionKind === 'SALARY_CONFIRMATION'
              ? 'Đã chuyển yêu cầu xác nhận sang bước phê duyệt.'
              : 'Đã chuyển yêu cầu mở lại sang bước phê duyệt.',
          });
        },
        onError: (err: unknown) => {
          toast({
            kind: 'error',
            message: (err as Error)?.message || 'Không thể kiểm tra yêu cầu bảng công và lương.',
          });
        },
      },
    );
  }, [checkConfirmMutation, checkUnconfirmMutation, toast]);

  const handleApproveSalaryConfirmationAction = useCallback((item: SalaryConfirmationGovernanceAction) => {
    const mutation = item.actionKind === 'SALARY_CONFIRMATION'
      ? approveConfirmMutation
      : approveUnconfirmMutation;
    mutation.mutate(
      { actionId: item.id, expectedVersion: item.version },
      {
        onSuccess: () => {
          toast({
            kind: 'success',
            message: item.actionKind === 'SALARY_CONFIRMATION'
              ? 'Đã phê duyệt xác nhận bảng công và lương.'
              : 'Đã phê duyệt mở lại bảng công và lương.',
          });
        },
        onError: (err: unknown) => {
          toast({
            kind: 'error',
            message: (err as Error)?.message || 'Không thể phê duyệt yêu cầu bảng công và lương.',
          });
        },
      },
    );
  }, [approveConfirmMutation, approveUnconfirmMutation, toast]);

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
    activePeriodGovernanceActions, activeSalaryConfirmationActions,
    pendingSalaryConfirmationActions, confirmGovernanceActions, reopenSalaryGovernanceActions,
    closeGovernanceActions, issueGovernanceActions, postGovernanceActions, reopenGovernanceActions,
    drivers, filteredDrivers, aggregates, workdayEditLocked, isConfirmed,
    adjustmentModalOpen, setAdjustmentModalOpen,
    payoutOpen, setPayoutOpen,
    reopenReason, setReopenReason, reopenReasonError, setReopenReasonError,
    canCheckAdjustment, canApproveAdjustment,
    handleCheckGovernanceAction, handleApproveGovernanceAction,
    handleCheckSalaryConfirmationAction, handleApproveSalaryConfirmationAction,
    workDayMap, handleCellClick, parseLocalDate, dates, calCells,
    closePeriodMutation, issuePeriodMutation, postPeriodMutation, reopenPeriodMutation,
    checkClosePeriodMutation, checkIssuePeriodMutation, checkPostPeriodMutation, checkReopenPeriodMutation,
    approveClosePeriodMutation, approveIssuePeriodMutation, approvePostPeriodMutation, approveReopenPeriodMutation,
    confirmMutation, unconfirmMutation,
    checkConfirmMutation, checkUnconfirmMutation, approveConfirmMutation, approveUnconfirmMutation,
    requestAdjustmentMutation, checkAdjustmentMutation, approveAdjustmentMutation,
  };
}
