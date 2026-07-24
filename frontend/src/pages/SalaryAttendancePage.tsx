import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Info, CheckCircle2, Lock, Unlock, Wallet } from 'lucide-react';
import { formatCurrency, removeDiacritics } from '../lib/format';
import { Money } from '../components/shared/Money';
import { Panel, ConfirmDialog } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useSalaryList, useDriverSalary, useDriverWorkDays, useUpdateWorkDays, useConfirmSalary, useUnconfirmSalary } from '../hooks/useSalaryQueries';
import { useAuth } from '../hooks/useAuth';
import type { WorkDayRecord } from '../api/salaryClient';
import { useMonth } from '../hooks/useMonth';
import { useToast } from '../components/shared/Toast';
import { EmptyIllustration } from '../components/shared';
import { CalCell, DOW_LABELS, DriverPayoutModal, MobileDayList, SalarySummaryCard, STATUS_CONFIG } from './salary-attendance-components';
import './SalaryAttendancePage.css';
import { useSalaryPeriod } from '../hooks/useCatalogQueries';

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
  const [unlockOpen, setUnlockOpen] = useState(false);
  const { toast } = useToast();

  /* ── Driver payout modal (B1) — MANAGER/ACCOUNTANT only ── */
  const { user } = useAuth();
  const canPostPayout =
    user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ACCOUNTANT';
  const [payoutOpen, setPayoutOpen] = useState(false);

  const isConfirmed = salary?.confirmationStatus === 'CONFIRMED';

  const drivers = useMemo(() => salaryList?.items ?? [], [salaryList?.items]);

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
    if (!selectedDriverId || isConfirmed) return;
    const newStatus = cycleStatus(dateStr, current);
    if (newStatus === 'TRIP_DAY') return;

    const items = [{ date: dateStr, status: newStatus, note: null }];
    try {
      await updateMutation.mutateAsync(items);
    } catch {
      // Error is surfaced via mutation.error state; suppress unhandled rejection
    }
  }, [selectedDriverId, updateMutation, isConfirmed]);

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
                            isLocked={isConfirmed}
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
                      {isConfirmed ? (
                        <>
                          <Lock size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
                          <span>Kỳ lương đã xác nhận — lịch chấm công đã khóa</span>
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
                isConfirmed={isConfirmed}
                onCycle={handleCellClick}
                parseLocalDate={parseLocalDate}
              />
            )}
          </div>
        )}

        {/* ── Right Column: Sidebar (Driver info + Summary Card) ── */}
        {selectedDriverId && (
          <aside className="salary-page-layout__sidebar">
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
                            <button
                              className="btn btn--secondary btn--sm"
                              style={{ width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                              disabled={unconfirmMutation.isPending}
                              onClick={() => setUnlockOpen(true)}
                            >
                              {unconfirmMutation.isPending ? (
                                <Loader2 size={14} className="spin" />
                              ) : (
                                <Unlock size={14} />
                              )}
                              Mở khóa để chỉnh sửa
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          className="btn btn--primary btn--sm"
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          disabled={confirmMutation.isPending}
                          onClick={() => {
                            confirmMutation.mutate(undefined, {
                              onError: (err: unknown) => {
                                toast({
                                  kind: 'error',
                                  message: (err as Error)?.message || 'Không thể xác nhận kỳ lương. Vui lòng thử lại.',
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
                          Xác nhận kỳ lương
                        </button>
                      )}
                    </div>
                </>
              ) : (
                <div className="salary-summary-dark" style={{ textAlign: 'center', padding: 24, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                  Không thể tải dữ liệu lương
                </div>
              )}
            </div>

            {/* Confirmed lock notice */}
            {isConfirmed && (
              <div style={{
                marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                borderRadius: 8, background: 'var(--surface-2)', fontSize: 12, color: 'var(--ink-3)',
              }}>
                <Lock size={14} style={{ flexShrink: 0 }} />
                <span>Kỳ lương đã khóa — không thể chỉnh sửa ngày công</span>
              </div>
            )}

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
      <ConfirmDialog
        isOpen={unlockOpen}
        variant="warning"
        message="Mở khóa kỳ lương để chỉnh sửa ngày công? Sau khi chỉnh xong bạn cần xác nhận lại."
        confirmLabel={unconfirmMutation.isPending ? 'Đang mở…' : 'Mở khóa'}
        cancelLabel="Hủy"
        onConfirm={() => {
          unconfirmMutation.mutate(undefined, {
            onSuccess: () => {
              toast({ kind: 'success', message: 'Đã mở khóa kỳ lương. Bạn có thể chỉnh sửa ngày công.' });
              setUnlockOpen(false);
            },
            onError: (err: unknown) => {
              toast({ kind: 'error', message: (err as Error)?.message || 'Không thể mở khóa kỳ lương.' });
            },
          });
        }}
        onCancel={() => setUnlockOpen(false)}
      />
    </div>
  );
}
