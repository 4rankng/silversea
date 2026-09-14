import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Info, CheckCircle2, Lock, Unlock, Wallet } from 'lucide-react';
import { formatCurrency } from '../lib/format';
import { Panel } from '../components/UI';
import { SummaryRail } from '../design-system';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyIllustration } from '../components/shared';
import {
  CalCell,
  DriverPayoutModal,
  MobileDayList,
  PostCloseAdjustmentList,
  PostCloseAdjustmentModal,
  SalarySummaryCard,
} from '../features/salary-attendance/salary-attendance-components';
import { DOW_LABELS, STATUS_CONFIG } from '../features/salary-attendance/salary-attendance-constants';
import './SalaryAttendancePage.css';
import { useSalaryAttendancePage } from '../features/salary-attendance/useSalaryAttendancePage';
import { BaseSalaryEditModal } from '../features/salary-attendance/base-salary-edit-modal';

export default function SalaryAttendancePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const {
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
  } = useSalaryAttendancePage(searchTerm);
  const [showBaseSalaryEdit, setShowBaseSalaryEdit] = useState(false);

  return (
    <div ref={rootRef} className="salary-page">
      <Breadcrumbs
        className="salary-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Lương & Chấm công' },
        ]}
      />
      {/* ── Period actions + summary rail ── */}
      <section className="hero">
        <div className="hero-top fade-up-2">
          <div className="hero-title-block">
            <h1 className="sr-only">Lương &amp; Chấm công</h1>
            <div className="hero-sub">Tháng {month} · {year} · {aggregates.total} lái xe</div>
          </div>
          <div className="hero-actions">
            {canPostPayout && (
              <button
                className="btn btn--primary btn--sm"
                onClick={() => setPayoutOpen(true)}
              >
                <Wallet size={14} className="salary-attendance__icon-spacer" />
                Ghi thanh toán
              </button>
            )}
            <button className="btn btn--secondary btn--icon" onClick={goPrev} aria-label="Tháng trước"><ChevronLeft size={15} /></button>
            <span className="hero-month-label">Tháng {month}</span>
            <button className="btn btn--secondary btn--icon" onClick={goNext} aria-label="Tháng sau"><ChevronRight size={15} /></button>
          </div>
        </div>
        <SummaryRail
          ariaLabel="Tóm tắt kỳ lương"
          items={[
            { label: 'Tổng quỹ lương', value: formatCurrency(aggregates.totalNet) },
            { label: 'Tổng lái xe', value: aggregates.total },
            { label: 'Đã xác nhận', value: `${aggregates.confirmed}/${aggregates.total}` },
            { label: 'Ngày đi chuyến', value: aggregates.totalTripDays },
            { label: 'Ngày chờ việc', value: aggregates.totalStandbyDays },
          ]}
        />
      </section>

      {/* ── Driver selector grid ── */}
      <div className="driver-select-row">
        <div className="driver-select-row__search">
          <div className="input-icon salary-attendance__search-input">
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
          <div className="salary-attendance__driver-loading">
            <Loader2 size={20} className="spin salary-attendance__driver-loading-icon" />
            <span className="salary-attendance__driver-loading-text">Đang tải danh sách lái xe…</span>
          </div>
        ) : (
          <div className="driver-select-row__list">
            {filteredDrivers.map((d) => {
              const isSelected = d.id === selectedDriverId;
              const net = d.salary?.netSalary ?? 0;
              const salaryLabel = d.salary
                ? `, lương thực nhận ${net >= 0 ? '' : 'âm '}${formatCurrency(Math.abs(net))}`
                : '';
              return (
                <button
                  type="button"
                  key={d.id}
                  onClick={() => setSelectedDriverId(d.id)}
                  className={`driver-select-card ${isSelected ? 'is-active' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={`Xem bảng công của ${d.name}${salaryLabel}`}
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
                </button>
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
                <p className="salary-attendance__empty-panel-text">Chọn lái xe ở trên để xem lịch chấm công</p>
              </div>
            </Panel>
          ) : (
            <div className="salary-calendar-area">
              <Panel flush>
                <div className="calendar-container">
                  {isUpdating && (
                    <Loader2 size={14} className="spin salary-attendance__calendar-updating-loader" />
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
                    <div className="salary-attendance__loading-center">
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
                          <Lock size={13} className="salary-attendance__legend-icon" />
                          <span>
                            Kỳ lương đã khóa — không thể chỉnh sửa ngày công
                          </span>
                        </>
                      ) : (
                        <>
                          <Info size={13} className="salary-attendance__legend-icon" />
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
              <div className="salary-attendance__loading-center salary-attendance__loading-center--ink">
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
              <div className="salary-attendance__sidebar-content">
                <div className="salary-attendance__period-header">
                  <div>
                    <div className="salary-attendance__period-label">
                      Kỳ lương toàn kỳ
                    </div>
                    <div className="salary-attendance__period-key">{periodKey}</div>
                  </div>
                  <span className={`salary-summary-dark__status salary-attendance__period-status ${lifecycle?.status === 'CLOSED' ? 'is-confirmed' : ''}`}>
                    {lifecycle?.status === 'CLOSED' ? 'Đã chốt' : lifecycle?.status === 'REOPENED' ? 'Mở lại' : 'Đang mở'}
                  </span>
                </div>

                {periodOverviewLoading ? (
                  <div className="salary-attendance__period-loading">
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
                      <div className="salary-attendance__info-text">
                        {lifecycle.reopenBlockers.join(' · ')}
                      </div>
                    ) : (
                      <div className="salary-attendance__info-text">
                        Có thể mở lại vì chưa phát hành, chưa thanh toán và chưa hạch toán chính thức.
                      </div>
                    )}

                    <div className="salary-attendance__actions-grid">
                      {lifecycle?.status === 'OPEN' && (
                        <button
                          className="btn btn--primary btn--sm"
                          disabled={closePeriodMutation.isPending}
                          onClick={() => {
                            closePeriodMutation.mutate(undefined, {
                              onSuccess: () => {
                                toast({
                                  kind: 'success',
                                  message: 'Đã chốt kỳ lương.',
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
                          {closePeriodMutation.isPending ? 'Đang xử lý…' : 'Chốt kỳ lương'}
                        </button>
                      )}
                      {lifecycle?.status === 'CLOSED'
                        && !lifecycle.payslipIssuedAt && (
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
                                    message: 'Đã phát hành phiếu lương.',
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
                          {issuePeriodMutation.isPending ? 'Đang xử lý…' : 'Phát hành phiếu lương'}
                        </button>
                      )}
                      {lifecycle?.status === 'CLOSED'
                        && lifecycle.payslipIssuedAt
                        && !lifecycle.officialPostedAt && (
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
                                    message: 'Đã đánh dấu hạch toán chính thức kỳ lương.',
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
                          {postPeriodMutation.isPending ? 'Đang xử lý…' : 'Hạch toán chính thức'}
                        </button>
                      )}
                      {lifecycle?.status === 'CLOSED' && lifecycle.canReopen && canReopenCompanyPeriod && (
                        <>
                          <div className="salary-attendance__form-group">
                            <label htmlFor="salary-period-reopen-reason" className="salary-attendance__form-label">
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
                              className={`salary-attendance__reopen-textarea ${reopenReasonError ? 'salary-attendance__reopen-textarea--error' : ''}`}
                            />
                            {reopenReasonError && (
                              <div role="alert" className="salary-attendance__error-text">
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
                                      message: 'Đã mở lại kỳ lương.',
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
                            {reopenPeriodMutation.isPending ? 'Đang xử lý…' : 'Mở lại kỳ'}
                          </button>
                        </>
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
                  </>
                )}
              </div>
            </Panel>

            {/* 3. Salary Summary Card (on the Right) */}
            <div className="salary-summary-area">
              {salaryLoading ? (
                <div className="salary-summary-dark salary-attendance__salary-loading">
                  <Loader2 size={24} className="spin salary-attendance__salary-loading-spinner" />
                </div>
              ) : salary ? (
                <>
	                  <SalarySummaryCard salary={salary} onEditBaseSalary={() => setShowBaseSalaryEdit(true)} driverName={drivers.find((d) => d.id === selectedDriverId)?.name} />
	                    <BaseSalaryEditModal
                    isOpen={showBaseSalaryEdit}
                    onClose={() => setShowBaseSalaryEdit(false)}
                    driverId={selectedDriverId ?? 0}
                    driverName={drivers.find((d) => d.id === selectedDriverId)?.name ?? ''}
                    currentBaseSalary={salary.baseSalary}
                    year={year}
                    month={month}
                  />
                    {/* Confirm button & status badge */}
	                    <div className="salary-attendance__confirm-section">
	                      {isConfirmed ? (
	                        <>
                          <div className="salary-confirm-status">
                            <CheckCircle2 size={16} />
                            <span>Đã xác nhận</span>
                            {salary.confirmedAt && (
                              <span className="salary-attendance__confirmed-date">
                                {new Date(salary.confirmedAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                              </span>
                            )}
	                          </div>
	                          {canPostPayout && (
	                            <>
	                              <label className="input-group salary-attendance__reopen-label">
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
	                                <div className="salary-attendance__reopen-error">
	                                  {reopenReasonError}
	                                </div>
	                              )}
	                              {(
	                                <button
	                                  className="btn btn--secondary btn--sm salary-attendance__btn-full salary-attendance__btn-full--mt8"
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
	                                        toast({ kind: 'success', message: 'Đã mở lại bảng công và lương.' });
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
	                                  Mở lại bảng công
	                                </button>
	                              )}
	                            </>
	                          )}
	                        </>
	                      ) : (
	                        <>
	                          {(
	                            <button
	                              className="btn btn--primary btn--sm salary-attendance__btn-full"
	                              disabled={confirmMutation.isPending}
	                              onClick={() => {
	                                confirmMutation.mutate(undefined, {
	                                  onSuccess: () => {
	                                    toast({ kind: 'success', message: 'Đã xác nhận bảng công và lương.' });
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
	                              Xác nhận
	                            </button>
	                          )}
	                        </>
	                      )}
	                    </div>
	                </>
              ) : (
                <div className="salary-summary-dark salary-attendance__salary-error">
                  Không thể tải dữ liệu lương
                </div>
              )}
            </div>

            {/* Confirmed lock notice */}
	            {workdayEditLocked && (
	              <div className="salary-attendance__lock-notice">
	                <Lock size={14} className="salary-attendance__lock-notice-icon" />
	                <span>
	                  Kỳ lương đã khóa — không thể chỉnh sửa ngày công
	                </span>
	              </div>
	            )}

            <Panel className="salary-attendance__adjustment-panel">
              <div className="salary-attendance__sidebar-content">
                <div className="salary-attendance__adjustment-header">
                  <div>
                    <div className="salary-attendance__adjustment-title">Điều chỉnh liên kỳ</div>
                    <div className="salary-attendance__adjustment-subtitle">
                      Lịch sử được liên kết giữa kỳ nguồn và kỳ đích cho lái xe đang chọn.
                    </div>
                  </div>
                </div>
                <PostCloseAdjustmentList
                  items={periodAdjustments}
                />
              </div>
            </Panel>

            {/* Mobile back button — sticky bottom */}
            <div className="mobile-back-bar">
              <button
                className="btn btn--secondary salary-attendance__btn-full"
                onClick={handleBack}
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
