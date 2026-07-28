import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Info, CheckCircle2, Lock, Unlock, Wallet } from 'lucide-react';
import { formatCurrency, removeDiacritics } from '../lib/format';
import { Money } from '../components/shared/Money';
import { Panel } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
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
} from '../hooks/useSalaryQueries';
import { useAuth } from '../hooks/useAuth';
import type {
  WorkDayRecord,
  SalaryPeriodAdjustmentItem,
  SalaryConfirmationGovernanceAction,
  SalaryPeriodGovernanceAction,
} from '../api/salaryClient';
import { useMonth } from '../hooks/useMonth';
import { useToast } from '../components/shared/Toast';
import { EmptyIllustration } from '../components/shared';
import {
  CalCell,
  DOW_LABELS,
  DriverPayoutModal,
  MobileDayList,
  PostCloseAdjustmentList,
  PostCloseAdjustmentModal,
  SalaryConfirmationGovernanceList,
  SalaryPeriodGovernanceList,
  SalarySummaryCard,
  STATUS_CONFIG,
} from './salary-attendance-components';
import './SalaryAttendancePage.css';
import { useSalaryPeriod } from '../hooks/useCatalogQueries';

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

export default function SalaryAttendancePage() {
  const { month, year, goPrev, goNext } = useMonth();
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <div ref={rootRef} className="salary-page">
      <Breadcrumbs
        className="salary-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Lương & Chấm công' },
        ]}
      />
      {/* ── Hero section with bento metrics ── */}
      <section className="hero">
        <div className="hero-top fade-up-2">
          <div className="hero-title-block">
            <div className="hero-eyebrow">Kỳ lương</div>
            <h1 className="hero-h1" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/assets/icons/16-payroll-luong-tien-luong.png" alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
              Lương & Chấm công
            </h1>
            <div className="hero-sub">Tháng {month} · {year} · {aggregates.total} lái xe</div>
          </div>
          <div className="hero-actions">
            {canPostPayout && (
              <button
                className="btn btn--primary btn--sm"
                onClick={() => setPayoutOpen(true)}
              >
                <Wallet size={14} style={{ marginRight: 6 }} />
                Ghi thanh toán
              </button>
            )}
            <button className="btn btn--secondary btn--icon" onClick={goPrev} aria-label="Tháng trước"><ChevronLeft size={15} /></button>
            <span className="hero-month-label">Tháng {month}</span>
            <button className="btn btn--secondary btn--icon" onClick={goNext} aria-label="Tháng sau"><ChevronRight size={15} /></button>
          </div>
        </div>
        <div className="metrics fade-up-3">
          <div className="metric featured">
            <div className="metric-label">Tổng quỹ lương</div>
            <div className="metric-value"><Money value={aggregates.totalNet} /></div>
            <div className="metric-delta delta-flat">Lương thực nhận · tất cả lái xe</div>
            <div className="utilization-bar"><div className="utilization-fill" style={{ width: `${aggregates.total > 0 ? (aggregates.confirmed / aggregates.total) * 100 : 0}%` }} /></div>
            <div className="metric-delta delta-up"><CheckCircle2 size={10} strokeWidth={2.5} /> {aggregates.confirmed}/{aggregates.total} đã xác nhận</div>
          </div>
          <div className="metric">
            <div className="metric-label">Tổng lái xe</div>
            <div className="metric-value d-mono">{aggregates.total}</div>
            <div className="metric-delta delta-flat">— trong kỳ</div>
          </div>
          <div className="metric">
            <div className="metric-label">Đã xác nhận</div>
            <div className="metric-value d-mono">{aggregates.confirmed}<span className="metric-value-unit">/{aggregates.total}</span></div>
            <div className="metric-delta delta-up"><CheckCircle2 size={10} strokeWidth={2.5} /> kỳ lương</div>
          </div>
          <div className="metric">
            <div className="metric-label">Ngày đi chuyến</div>
            <div className="metric-value d-mono">{aggregates.totalTripDays}</div>
            <div className="metric-delta delta-flat">— tổng cả đội</div>
          </div>
          <div className="metric">
            <div className="metric-label">Ngày chờ việc</div>
            <div className="metric-value d-mono">{aggregates.totalStandbyDays}</div>
            <div className="metric-delta delta-flat">— tổng cả đội</div>
          </div>
        </div>
      </section>

      {/* ── Driver selector grid ── */}
      <div className="driver-select-row">
        <div className="driver-select-row__search">
          <div className="input-icon" style={{ width: '100%', maxWidth: 340 }}>
            <Search size={14} />
            <input
              type="text"
              name="salaryDriverSearch"
              className="input"
              aria-label="Tìm lái xe trong bảng lương"
              placeholder="Tìm lái xe..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        {listLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px' }}>
            <Loader2 size={20} className="spin" style={{ color: 'var(--fg-3)', marginRight: 8 }} />
            <span style={{ fontSize: 13, color: 'var(--fg-3)' }}>Đang tải danh sách lái xe…</span>
          </div>
        ) : (
          <div className="driver-select-row__list">
            {filteredDrivers.map((d) => {
              const isSelected = d.id === selectedDriverId;
              const net = d.salary?.netSalary ?? 0;
              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedDriverId(d.id)}
                  className={`driver-select-card ${isSelected ? 'is-active' : ''}`}
                >
                  {isSelected && <span className="driver-select-card__dot" />}
                  <div className="driver-select-card__name">{d.name}</div>
                  {d.salary && (
                    <div
                      className="driver-select-card__salary"
                      style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {net >= 0 ? '' : '-'}{formatCurrency(Math.abs(net))}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredDrivers.length === 0 && (
              <div className="salary-empty-inline">
                <EmptyIllustration name="empty-salary" />
                <span>Không tìm thấy lái xe</span>
              </div>
            )}
          </div>
        )}
      </div>


      <div className={`salary-page-layout ${selectedDriverId ? 'has-selected' : ''}`}>
        {/* ── Left Column: Calendar ── */}
        <div className="salary-page-layout__main">
          {/* Calendar Card (middle/bottom) */}
          {!selectedDriverId ? (
            <Panel>
              <div className="salary-empty-panel">
                <EmptyIllustration name="empty-salary" />
                <p style={{ margin: 0, fontSize: 14 }}>Chọn lái xe ở trên để xem lịch chấm công</p>
              </div>
            </Panel>
          ) : (
            <div className="salary-calendar-area">
              <Panel flush>
                <div className="calendar-container" style={{ position: 'relative' }}>
                  {isUpdating && (
                    <Loader2 size={14} className="spin" style={{ position: 'absolute', top: 14, right: 14, color: 'var(--accent)', zIndex: 1 }} />
                  )}
                  {/* Day-of-week headers */}
                  <div className="calendar-dow-header">
                    {DOW_LABELS.map(dow => (
                      <div key={dow} className={`calendar-dow-cell ${dow === 'CN' ? 'is-sunday' : ''}`}>
                        {dow}
                      </div>
                    ))}
                  </div>

                  {/* Calendar cells */}
                  {wdLoading ? (
                    <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>
                      <Loader2 size={20} className="spin" />
                    </div>
                  ) : (
                    <div className="calendar-grid">
                      {calCells.map((dateStr, idx) => {
                        if (dateStr === null) {
                          return <div key={`blank-${idx}`} className="cal-cell is-empty" />;
                        }
                        const [cy, cm, cd] = dateStr.split('-').map(Number);
                        const dateObj = new Date(cy, cm - 1, cd);
                        const day = dateObj.getDate();
                        const cellMonth = dateObj.getMonth() + 1;
                        const isSun = dateObj.getDay() === 0;

                        const showMonthLabel = day === 1 || dateStr === dates[0];
                        const dayLabel = showMonthLabel ? `${day}/${cellMonth}` : `${day}`;

                        return (
                          <CalCell
                            key={dateStr}
                            dateStr={dateStr}
                            day={day}
                            isSunday={isSun}
                            dayLabel={dayLabel}
                            workDay={workDayMap.get(dateStr)}
                            isUpdating={isUpdating}
                            isLocked={workdayEditLocked}
                            onCycle={handleCellClick}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Legend */}
                  <div className="calendar-legend-bar">
                    <div className="calendar-legend-items">
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <div key={key} className="calendar-legend-item">
                          <cfg.icon size={12} strokeWidth={2} />
                          <span>{cfg.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="calendar-legend-instruction">
                      {workdayEditLocked ? (
                        <>
                          <Lock size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
                          <span>
                            {pendingSalaryConfirmationActions.some((item) => item.actionKind === 'SALARY_CONFIRMATION')
                              ? 'Đã gửi snapshot xác nhận — lịch chấm công tạm khóa chờ xử lý'
                              : 'Kỳ lương đã xác nhận — lịch chấm công đã khóa'}
                          </span>
                        </>
                      ) : (
                        <>
                          <Info size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
                          <span>Bấm vào ngày để chuyển trạng thái: Chờ việc ⇄ Nghỉ riêng ⇄ Nghỉ tuần</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          )}
        </div>

        {/* ── Mobile Day List (hidden on desktop, shown on mobile via CSS) ── */}
        {selectedDriverId && (
          <div className="mobile-day-list-wrapper">
            {wdLoading ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                <Loader2 size={20} className="spin" />
              </div>
            ) : (
              <MobileDayList
                dates={dates}
                workDayMap={workDayMap}
                isUpdating={isUpdating}
                isConfirmed={workdayEditLocked}
                onCycle={handleCellClick}
                parseLocalDate={parseLocalDate}
              />
            )}
          </div>
        )}

        {/* ── Right Column: Sidebar (Driver info + Summary Card) ── */}
        {selectedDriverId && (
          <aside className="salary-page-layout__sidebar">
            <Panel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Kỳ lương toàn kỳ
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{periodKey}</div>
                  </div>
                  <span className={`salary-summary-dark__status ${lifecycle?.status === 'CLOSED' ? 'is-confirmed' : ''}`} style={{ color: 'var(--fg-1)', background: 'var(--surface-2)' }}>
                    {lifecycle?.status === 'CLOSED' ? 'Đã chốt' : lifecycle?.status === 'REOPENED' ? 'Mở lại' : 'Đang mở'}
                  </span>
                </div>

                {periodOverviewLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-3)' }}>
                    <Loader2 size={16} className="spin" />
                    <span>Đang tải trạng thái hậu chốt…</span>
                  </div>
                ) : (
                  <>
                    {lifecycle?.payslipIssuedAt && (
                      <div className="payslip-callout">
                        <CheckCircle2 size={16} className="payslip-callout-icon" />
                        <div className="payslip-callout-text">
                          <strong>Đã phát hành phiếu lương</strong>
                          <div>{new Date(lifecycle.payslipIssuedAt).toLocaleString('vi-VN')}</div>
                        </div>
                      </div>
                    )}
                    {lifecycle?.officialPostedAt && (
                      <div className="payslip-callout">
                        <Lock size={16} className="payslip-callout-icon" />
                        <div className="payslip-callout-text">
                          <strong>Đã hạch toán chính thức</strong>
                          <div>{new Date(lifecycle.officialPostedAt).toLocaleString('vi-VN')}</div>
                        </div>
                      </div>
                    )}
                    {lifecycle?.reopenBlockers.length ? (
                      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                        {lifecycle.reopenBlockers.join(' · ')}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                        Có thể mở lại vì chưa phát hành, chưa thanh toán và chưa hạch toán chính thức.
                      </div>
                    )}

                    <div style={{ display: 'grid', gap: 8 }}>
                      {lifecycle?.status === 'OPEN' && closeGovernanceActions.length === 0 && (
                        <button
                          className="btn btn--primary btn--sm"
                          disabled={closePeriodMutation.isPending}
                          onClick={() => {
                            closePeriodMutation.mutate(undefined, {
                              onSuccess: () => {
                                toast({
                                  kind: 'success',
                                  message: 'Đã tạo yêu cầu chốt kỳ lương. Cần người kiểm tra và người phê duyệt khác tiếp tục xử lý.',
                                });
                              },
                              onError: (err: unknown) => {
                                toast({
                                  kind: 'error',
                                  message: (err as Error)?.message || 'Không thể chốt toàn kỳ lương.',
                                });
                              },
                            });
                          }}
                        >
                          {closePeriodMutation.isPending ? 'Đang gửi yêu cầu…' : 'Gửi yêu cầu chốt kỳ'}
                        </button>
                      )}
                      {lifecycle?.status === 'OPEN' && closeGovernanceActions.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                          Đang có yêu cầu chốt kỳ chờ xử lý bên dưới. Không thể tạo thêm yêu cầu mới cho cùng kỳ.
                        </div>
                      )}
                      {lifecycle?.status === 'CLOSED'
                        && !lifecycle.payslipIssuedAt
                        && issueGovernanceActions.length === 0 && (
                        <button
                          className="btn btn--primary btn--sm"
                          disabled={issuePeriodMutation.isPending || lifecycle.version == null}
                          onClick={() => {
                            if (lifecycle.version == null) return;
                            issuePeriodMutation.mutate(
                              { expectedVersion: lifecycle.version },
                              {
                                onSuccess: () => {
                                  toast({
                                    kind: 'success',
                                    message: 'Đã gửi yêu cầu phát hành phiếu lương. Kỳ lương chưa thay đổi cho đến khi người kiểm tra và người phê duyệt khác hoàn tất.',
                                  });
                                },
                                onError: (err: unknown) => {
                                  toast({
                                    kind: 'error',
                                    message: (err as Error)?.message || 'Không thể phát hành phiếu lương.',
                                  });
                                },
                              },
                            );
                          }}
                        >
                          {issuePeriodMutation.isPending ? 'Đang gửi yêu cầu…' : 'Gửi yêu cầu phát hành phiếu lương'}
                        </button>
                      )}
                      {lifecycle?.status === 'CLOSED'
                        && !lifecycle.payslipIssuedAt
                        && issueGovernanceActions.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                          Yêu cầu phát hành phiếu lương đang chờ kiểm tra hoặc phê duyệt. Chưa có phiếu lương nào được phát hành.
                        </div>
                      )}
                      {lifecycle?.status === 'CLOSED'
                        && lifecycle.payslipIssuedAt
                        && !lifecycle.officialPostedAt
                        && postGovernanceActions.length === 0 && (
                        <button
                          className="btn btn--secondary btn--sm"
                          disabled={postPeriodMutation.isPending || lifecycle.version == null}
                          onClick={() => {
                            if (lifecycle.version == null) return;
                            postPeriodMutation.mutate(
                              { expectedVersion: lifecycle.version },
                              {
                                onSuccess: () => {
                                  toast({
                                    kind: 'success',
                                    message: 'Đã gửi yêu cầu hạch toán chính thức. Kỳ lương chưa được đánh dấu chính thức cho đến khi hoàn tất kiểm tra và phê duyệt.',
                                  });
                                },
                                onError: (err: unknown) => {
                                  toast({
                                    kind: 'error',
                                    message: (err as Error)?.message || 'Không thể đánh dấu hạch toán chính thức.',
                                  });
                                },
                              },
                            );
                          }}
                        >
                          {postPeriodMutation.isPending ? 'Đang gửi yêu cầu…' : 'Gửi yêu cầu hạch toán chính thức'}
                        </button>
                      )}
                      {lifecycle?.status === 'CLOSED'
                        && lifecycle.payslipIssuedAt
                        && !lifecycle.officialPostedAt
                        && postGovernanceActions.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                          Yêu cầu hạch toán chính thức đang chờ kiểm tra hoặc phê duyệt. Kỳ lương chưa được đánh dấu chính thức.
                        </div>
                      )}
                      {lifecycle?.status === 'CLOSED' && lifecycle.canReopen && canReopenCompanyPeriod && reopenGovernanceActions.length === 0 && (
                        <>
                          <div style={{ display: 'grid', gap: 6 }}>
                            <label htmlFor="salary-period-reopen-reason" style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>
                              Lý do mở lại kỳ
                            </label>
                            <textarea
                              id="salary-period-reopen-reason"
                              rows={3}
                              value={reopenReason}
                              onChange={(event) => {
                                setReopenReason(event.target.value);
                                if (reopenReasonError && event.target.value.trim()) {
                                  setReopenReasonError(null);
                                }
                              }}
                              placeholder="Nêu rõ vì sao cần mở lại kỳ đã chốt"
                              style={{
                                width: '100%',
                                minHeight: 88,
                                resize: 'vertical',
                                borderRadius: 12,
                                border: `1px solid ${reopenReasonError ? 'var(--danger)' : 'var(--border)'}`,
                                background: 'var(--surface-1)',
                                color: 'var(--fg-1)',
                                padding: '10px 12px',
                              }}
                            />
                            {reopenReasonError && (
                              <div role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>
                                {reopenReasonError}
                              </div>
                            )}
                          </div>
                          <button
                            className="btn btn--secondary btn--sm"
                            disabled={reopenPeriodMutation.isPending || lifecycle.version == null}
                            onClick={() => {
                              if (lifecycle.version == null) return;
                              const normalizedReopenReason = reopenReason.trim();
                              if (!normalizedReopenReason) {
                                setReopenReasonError('Cần nhập lý do mở lại kỳ lương trước khi gửi yêu cầu.');
                                return;
                              }
                              reopenPeriodMutation.mutate(
                                {
                                  expectedVersion: lifecycle.version,
                                  reason: normalizedReopenReason,
                                },
                                {
                                  onSuccess: () => {
                                    setReopenReason('');
                                    setReopenReasonError(null);
                                    toast({
                                      kind: 'success',
                                      message: 'Đã tạo yêu cầu mở lại kỳ lương. Cần người kiểm tra và người phê duyệt khác tiếp tục xử lý.',
                                    });
                                  },
                                  onError: (err: unknown) => {
                                    toast({
                                      kind: 'error',
                                      message: (err as Error)?.message || 'Không thể mở lại kỳ lương.',
                                    });
                                  },
                                },
                              );
                            }}
                          >
                            {reopenPeriodMutation.isPending ? 'Đang gửi yêu cầu…' : 'Gửi yêu cầu mở lại kỳ'}
                          </button>
                        </>
                      )}
                      {lifecycle?.status === 'CLOSED' && reopenGovernanceActions.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                          Đang có yêu cầu mở lại kỳ chờ xử lý bên dưới. Không thể tạo thêm yêu cầu mới cho cùng kỳ.
                        </div>
                      )}
                      {lifecycle?.status === 'CLOSED' && selectedDriverId && (
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => setAdjustmentModalOpen(true)}
                        >
                          Tạo khoản điều chỉnh
                        </button>
                      )}
                    </div>
                    <SalaryPeriodGovernanceList
                      items={activePeriodGovernanceActions}
                      checkingActionId={
                        checkClosePeriodMutation.variables?.actionId
                        ?? checkIssuePeriodMutation.variables?.actionId
                        ?? checkPostPeriodMutation.variables?.actionId
                        ?? checkReopenPeriodMutation.variables?.actionId
                        ?? null
                      }
                      approvingActionId={
                        approveClosePeriodMutation.variables?.actionId
                        ?? approveIssuePeriodMutation.variables?.actionId
                        ?? approvePostPeriodMutation.variables?.actionId
                        ?? approveReopenPeriodMutation.variables?.actionId
                        ?? null
                      }
                      onCheck={handleCheckGovernanceAction}
                      onApprove={handleApproveGovernanceAction}
                    />
                  </>
                )}
              </div>
            </Panel>

            {/* 3. Salary Summary Card (on the Right) */}
            <div className="salary-summary-area">
              {salaryLoading ? (
                <div className="salary-summary-dark" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
                  <Loader2 size={24} className="spin" style={{ color: '#fff' }} />
                </div>
              ) : salary ? (
                <>
	                  <SalarySummaryCard salary={salary} />
	                    {/* Confirm button & status badge */}
	                    <div style={{ marginTop: 12 }}>
	                      {isConfirmed ? (
	                        <>
                          <div className="salary-confirm-status">
                            <CheckCircle2 size={16} />
                            <span>Đã xác nhận</span>
                            {salary.confirmedAt && (
                              <span style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.7, marginLeft: 'auto' }}>
                                {new Date(salary.confirmedAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                              </span>
                            )}
	                          </div>
	                          {canPostPayout && (
	                            <>
	                              <label className="input-group" style={{ marginTop: 10 }}>
	                                <span>Lý do mở lại bảng công và lương</span>
	                                <textarea
	                                  className="input"
	                                  rows={3}
	                                  value={reopenReason}
	                                  onChange={(event) => {
	                                    setReopenReason(event.target.value);
	                                    if (reopenReasonError) {
	                                      setReopenReasonError(null);
	                                    }
	                                  }}
	                                  placeholder="Ví dụ: cần cập nhật ngày công sau đối soát cuối kỳ"
	                                />
	                              </label>
	                              {reopenReasonError && (
	                                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>
	                                  {reopenReasonError}
	                                </div>
	                              )}
	                              {reopenSalaryGovernanceActions.length > 0 ? (
	                                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-3)' }}>
	                                  Đang có yêu cầu mở lại bảng công và lương chờ xử lý bên dưới.
	                                </div>
	                              ) : (
	                                <button
	                                  className="btn btn--secondary btn--sm"
	                                  style={{ width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
	                                  disabled={unconfirmMutation.isPending}
	                                  onClick={() => {
	                                    const normalizedReason = reopenReason.trim();
	                                    if (!normalizedReason) {
	                                      setReopenReasonError('Cần nhập lý do mở lại bảng công và lương trước khi gửi yêu cầu.');
	                                      return;
	                                    }
	                                    unconfirmMutation.mutate(normalizedReason, {
	                                      onSuccess: () => {
	                                        setReopenReasonError(null);
	                                        toast({ kind: 'success', message: 'Đã gửi yêu cầu mở lại bảng công và lương.' });
	                                      },
	                                      onError: (err: unknown) => {
	                                        toast({ kind: 'error', message: (err as Error)?.message || 'Không thể gửi yêu cầu mở lại bảng công và lương.' });
	                                      },
	                                    });
	                                  }}
	                                >
	                                  {unconfirmMutation.isPending ? (
	                                    <Loader2 size={14} className="spin" />
	                                  ) : (
	                                    <Unlock size={14} />
	                                  )}
	                                  Gửi yêu cầu mở lại
	                                </button>
	                              )}
	                            </>
	                          )}
	                        </>
	                      ) : (
	                        <>
	                          {confirmGovernanceActions.length > 0 ? (
	                            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
	                              Đang có yêu cầu xác nhận bảng công và lương chờ xử lý bên dưới.
	                            </div>
	                          ) : (
	                            <button
	                              className="btn btn--primary btn--sm"
	                              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
	                              disabled={confirmMutation.isPending}
	                              onClick={() => {
	                                confirmMutation.mutate(undefined, {
	                                  onSuccess: () => {
	                                    toast({ kind: 'success', message: 'Đã gửi yêu cầu xác nhận bảng công và lương.' });
	                                  },
	                                  onError: (err: unknown) => {
	                                    toast({
	                                      kind: 'error',
	                                      message: (err as Error)?.message || 'Không thể gửi yêu cầu xác nhận bảng công và lương.',
	                                    });
	                                  },
	                                });
	                              }}
	                            >
	                              {confirmMutation.isPending ? (
	                                <Loader2 size={14} className="spin" />
	                              ) : (
	                                <CheckCircle2 size={14} />
	                              )}
	                              Gửi yêu cầu xác nhận
	                            </button>
	                          )}
	                        </>
	                      )}
	                    </div>
	                    <SalaryConfirmationGovernanceList
	                      items={activeSalaryConfirmationActions}
	                      checkingActionId={
	                        checkConfirmMutation.variables?.actionId
	                        ?? checkUnconfirmMutation.variables?.actionId
	                        ?? null
	                      }
	                      approvingActionId={
	                        approveConfirmMutation.variables?.actionId
	                        ?? approveUnconfirmMutation.variables?.actionId
	                        ?? null
	                      }
	                      onCheck={handleCheckSalaryConfirmationAction}
	                      onApprove={handleApproveSalaryConfirmationAction}
	                    />
	                </>
              ) : (
                <div className="salary-summary-dark" style={{ textAlign: 'center', padding: 24, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                  Không thể tải dữ liệu lương
                </div>
              )}
            </div>

            {/* Confirmed lock notice */}
	            {workdayEditLocked && (
	              <div style={{
	                marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
	                borderRadius: 8, background: 'var(--surface-2)', fontSize: 12, color: 'var(--ink-3)',
	              }}>
	                <Lock size={14} style={{ flexShrink: 0 }} />
	                <span>
	                  {pendingSalaryConfirmationActions.some((item) => item.actionKind === 'SALARY_CONFIRMATION')
	                    ? 'Đã gửi snapshot xác nhận — không thể chỉnh sửa ngày công cho đến khi yêu cầu được xử lý'
	                    : 'Kỳ lương đã khóa — không thể chỉnh sửa ngày công'}
	                </span>
	              </div>
	            )}

            <Panel style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>Điều chỉnh liên kỳ</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                      Lịch sử được liên kết giữa kỳ nguồn và kỳ đích cho lái xe đang chọn.
                    </div>
                  </div>
                </div>
                <PostCloseAdjustmentList
                  items={periodAdjustments}
                  canCheck={canCheckAdjustment}
                  canApprove={canApproveAdjustment}
                  checkingActionId={checkAdjustmentMutation.isPending ? checkAdjustmentMutation.variables?.actionId ?? null : null}
                  approvingActionId={approveAdjustmentMutation.isPending ? approveAdjustmentMutation.variables?.actionId ?? null : null}
                  onCheck={(item) => {
                    checkAdjustmentMutation.mutate({
                      actionId: item.actionId,
                      expectedVersion: item.version,
                    }, {
                      onError: (err: unknown) => {
                        toast({
                          kind: 'error',
                          message: (err as Error)?.message || 'Không thể kiểm tra điều chỉnh hậu chốt.',
                        });
                      },
                    });
                  }}
                  onApprove={(item) => {
                    approveAdjustmentMutation.mutate({
                      actionId: item.actionId,
                      expectedVersion: item.version,
                    }, {
                      onError: (err: unknown) => {
                        toast({
                          kind: 'error',
                          message: (err as Error)?.message || 'Không thể phê duyệt điều chỉnh hậu chốt.',
                        });
                      },
                    });
                  }}
                />
              </div>
            </Panel>

            {/* Mobile back button — sticky bottom */}
            <div className="mobile-back-bar">
              <button
                className="btn btn--secondary"
                onClick={handleBack}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <ChevronLeft size={16} /> Quay lại danh sách
              </button>
            </div>
          </aside>
        )}
      </div>
      {canPostPayout && (
        <DriverPayoutModal
          isOpen={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          initialDriverId={selectedDriverId}
          drivers={drivers.map(d => ({ id: d.id, name: d.name }))}
        />
      )}
	      <PostCloseAdjustmentModal
        isOpen={adjustmentModalOpen}
        onClose={() => setAdjustmentModalOpen(false)}
        sourcePeriod={periodKey}
        submitting={requestAdjustmentMutation.isPending}
        onSubmit={async ({ targetPeriod, amount, reason }) => {
          if (!selectedDriverId || lifecycle?.version == null) return;
          requestAdjustmentMutation.mutate(
            {
              driverId: selectedDriverId,
              targetPeriod,
              amount,
              reason,
              expectedVersion: lifecycle.version,
            },
            {
              onSuccess: () => {
                toast({ kind: 'success', message: 'Đã tạo yêu cầu điều chỉnh hậu chốt.' });
                setAdjustmentModalOpen(false);
              },
              onError: (err: unknown) => {
                toast({
                  kind: 'error',
                  message: (err as Error)?.message || 'Không thể tạo điều chỉnh hậu chốt.',
                });
              },
            },
          );
        }}
      />
    </div>
  );
}
