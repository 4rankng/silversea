import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Truck, Coffee, XCircle, Moon, DollarSign, Info, Edit } from 'lucide-react';
import { Money } from '../components/shared/Money';
import { Modal } from '../components/UI';
import { usePostDriverPayout } from '../hooks/useFinancialQueries';
import type { WorkDayRecord, AttendanceSalary } from '../api/salaryClient';
import { useToast } from '../components/shared/Toast';
import './SalaryAttendancePage.css';

export const DOW_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];


export const STATUS_CONFIG = {
  TRIP_DAY:      { label: 'Đi chuyến',    bg: 'var(--accent-soft)', color: 'var(--accent)', icon: Truck, emoji: '🚛' },
  STANDBY:       { label: 'Chờ việc',     bg: 'var(--warning-soft)', color: 'var(--warning-text)', icon: Coffee, emoji: '⏳' },
  PERSONAL_LEAVE:{ label: 'Nghỉ riêng',   bg: 'var(--danger-soft)',  color: 'var(--danger)',  icon: XCircle, emoji: '🏖' },
  WEEKLY_OFF:    { label: 'Nghỉ tuần',    bg: 'var(--bg-3)',         color: 'var(--fg-3)',    icon: Moon,    emoji: '💤' },
};


// ── Calendar Cell ─────────────────────────────────────────────────────────────
export interface CalCellProps {
  dateStr: string;
  day: number;
  isSunday: boolean;
  dayLabel: string;
  workDay: WorkDayRecord | undefined;
  isUpdating: boolean;
  isLocked: boolean;
  onCycle: (date: string, current: WorkDayRecord | undefined) => void;
}

export function CalCell({ dateStr, day: _day, isSunday, dayLabel, workDay, isUpdating, isLocked, onCycle }: CalCellProps) {
  const status = workDay?.status ?? (isSunday ? 'WEEKLY_OFF' : 'STANDBY');
  const cfg = status ? STATUS_CONFIG[status] : null;
  const isClickable = !isUpdating && !isLocked && status !== 'TRIP_DAY';

  return (
    <div
      title={workDay?.trip ? `${workDay.trip.tripCode || ''} – ${workDay.trip.routeName || ''}` : cfg?.label || ''}
      onClick={() => isClickable && onCycle(dateStr, workDay)}
      className={`cal-cell ${isClickable ? 'is-clickable' : ''} ${status ? `status-${status.toLowerCase()}` : ''}`}
    >
      <span className="cal-cell-day-num">
        {dayLabel}
      </span>
      {cfg && cfg.icon && (
        <div className="cal-cell-status-container">
          <span className="cal-cell-icon-wrap">
            <cfg.icon size={16} strokeWidth={2} />
          </span>
          {status === 'TRIP_DAY' && workDay?.trip?.tripCode && (
            <span className="cal-cell-trip-code" title={workDay.trip.routeName || undefined}>
              {workDay.trip.tripCode}
            </span>
          )}
        </div>
      )}
      {workDay?.note && (
        <div className="cal-cell-note-dot" />
      )}
    </div>
  );
}

// ── Salary Summary Card ───────────────────────────────────────────────────────
export function SalarySummaryCard({ salary }: { salary: AttendanceSalary }) {
  return (
    <div className="salary-summary-dark">
      <div className="salary-summary-dark__topline">
        <h3 className="salary-summary-dark__label">Tổng kết lương tháng</h3>
        <span className={`salary-summary-dark__status ${salary.confirmationStatus === 'CONFIRMED' ? 'is-confirmed' : ''}`}>
          {salary.confirmationStatus === 'CONFIRMED' ? 'Đã chốt' : 'Bản nháp'}
        </span>
      </div>
      <div className="salary-summary-dark__big mono">
        <Money value={salary.netSalary} />
      </div>
      <div className="salary-summary-dark__mini">Lương thực nhận sau các khoản điều chỉnh</div>

      <div className="salary-summary-dark__rows">
        <div className="salary-summary-dark__row">
          <span className="salary-summary-dark__row-lbl">
            <DollarSign size={12} /> Lương cứng
          </span>
          <span className="salary-summary-dark__row-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Money value={salary.baseSalary} />
            <Link to="/users" className="salary-edit-link" title="Sửa lương cứng">
              <Edit size={10} />
            </Link>
          </span>
        </div>

        <div className="salary-summary-dark__row">
          <span className="salary-summary-dark__row-lbl">
            <Info size={12} /> Điều chỉnh công
          </span>
          <span className={`salary-summary-dark__row-val ${salary.adjustment > 0 ? 'salary-summary-dark__row-val--pos' : salary.adjustment < 0 ? 'salary-summary-dark__row-val--neg' : ''}`}>
            <Money value={Math.abs(salary.adjustment)} sign={salary.adjustment > 0 ? '+' : salary.adjustment < 0 ? '-' : ''} />
          </span>
        </div>

        <div className="salary-summary-dark__row">
          <span className="salary-summary-dark__row-lbl">
            <XCircle size={12} /> Phạt kỷ luật
          </span>
          <span className={`salary-summary-dark__row-val ${salary.totalPenalties > 0 ? 'salary-summary-dark__row-val--neg' : ''}`}>
            <Money value={salary.totalPenalties} sign={salary.totalPenalties > 0 ? '-' : ''} />
          </span>
        </div>

        <div className="salary-summary-dark__row salary-summary-dark__row--total">
          <span className="salary-summary-dark__row-lbl">Lương thực nhận</span>
          <span className="salary-summary-dark__row-val"><Money value={salary.netSalary} /></span>
        </div>

        <div className="salary-summary-dark__section">
          Phân bổ chi phí (Nội bộ)
        </div>

        <div className="salary-summary-dark__row salary-summary-dark__row--muted">
          <span className="salary-summary-dark__row-lbl">
            <Truck size={12} /> Lương chuyến ({salary.tripDays} ngày)
          </span>
          <span className="salary-summary-dark__row-val">
            <Money value={salary.totalTripSalary} />
          </span>
        </div>

        <div className="salary-summary-dark__row salary-summary-dark__row--muted">
          <span className="salary-summary-dark__row-lbl">
            <Coffee size={12} /> Lương chờ việc ({salary.standbyDays} ngày)
          </span>
          <span className="salary-summary-dark__row-val">
            <Money value={salary.supplementPay} />
          </span>
        </div>
      </div>
    </div>
  );
}


// ── Mobile Day List (replaces calendar grid on mobile) ────────────────────────
export interface MobileDayListProps {
  dates: string[];
  workDayMap: Map<string, WorkDayRecord>;
  isUpdating: boolean;
  isConfirmed: boolean;
  onCycle: (date: string, current: WorkDayRecord | undefined) => void;
  parseLocalDate: (s: string) => Date;
}

export function MobileDayList({ dates, workDayMap, isUpdating: _isUpdating, isConfirmed, onCycle, parseLocalDate }: MobileDayListProps) {
  return (
    <div className="mobile-day-list">
      {dates.map(dateStr => {
        const dateObj = parseLocalDate(dateStr);
        const day = dateObj.getDate();
        const cellMonth = dateObj.getMonth() + 1;
        const dow = dateObj.getDay(); // 0=Sun
        const dowLabel = DOW_LABELS[dow];
        const isSun = dow === 0;
        const workDay = workDayMap.get(dateStr);
        const status = workDay?.status ?? (isSun ? 'WEEKLY_OFF' : 'STANDBY');
        const cfg = STATUS_CONFIG[status];
        const isClickable = !isConfirmed && status !== 'TRIP_DAY';

        return (
          <div
            key={dateStr}
            onClick={() => isClickable && onCycle(dateStr, workDay)}
            className={`mobile-day-row status-${status.toLowerCase()} ${isClickable ? 'is-clickable' : ''}`}
          >
            {/* Date column */}
            <div className="mobile-day-row__date-col">
              <span className="mobile-day-row__day-num">{day}/{cellMonth}</span>
              <span className={`mobile-day-row__dow ${isSun ? 'is-sunday' : ''}`}>{dowLabel}</span>
            </div>

            {/* Status column */}
            <div className="mobile-day-row__status-col">
              <span className="mobile-day-row__status-icon" style={{ background: cfg.bg, color: cfg.color }}>
                <cfg.icon size={15} strokeWidth={2} />
              </span>
              <span className="mobile-day-row__status-label">{cfg.label}</span>
            </div>

            {/* Right column: trip code */}
            <div className="mobile-day-row__right-col">
              {status === 'TRIP_DAY' && workDay?.trip?.tripCode ? (
                <span className="mobile-day-row__trip-badge" title={workDay.trip.routeName || undefined}>
                  {workDay.trip.tripCode}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {/* Compact legend */}
      <div className="mobile-day-legend">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <span key={key} className={`mobile-day-legend__item status-${key.toLowerCase()}`}>
            <cfg.icon size={11} strokeWidth={2} />
            {cfg.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Driver payout modal (B1 — feedback202606 GAP 4) ──────────────────────────
// MANAGER/ACCOUNTANT records a salary/cash payout to a driver. Posts a
// DRIVER_PAYOUT debit on the DRIVER ledger, reducing the company's payable
// balance for that driver. Drivers may not record their own payouts.

export interface DriverPayoutForm {
  driverId: number | '';
  amount: string;
  method: 'CASH' | 'BANK';
  payoutDate: string;
  note: string;
}

export function DriverPayoutModal({
  isOpen,
  onClose,
  initialDriverId,
  drivers,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialDriverId: number | null;
  drivers: Array<{ id: number; name: string }>;
}) {
  const payout = usePostDriverPayout();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<DriverPayoutForm>({
    driverId: '', amount: '', method: 'CASH', payoutDate: today, note: '',
  });

  useEffect(() => {
    if (isOpen) {
      setForm({
        driverId: initialDriverId ?? '',
        amount: '',
        method: 'CASH',
        payoutDate: today,
        note: '',
      });
    }
  }, [isOpen, initialDriverId, today]);

  const sortedDrivers = useMemo(
    () => drivers.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [drivers],
  );

  const amountNum = Number(form.amount);
  const overLimit = Number.isFinite(amountNum) && amountNum > 1_000_000_000;
  const canSubmit =
    !payout.isPending &&
    form.driverId !== '' &&
    form.amount.trim() !== '' &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !overLimit &&
    form.payoutDate.trim() !== '';

  const handleSubmit = () => {
    if (!canSubmit || form.driverId === '') return;
    payout.mutate(
      {
        driverId: Number(form.driverId),
        amount: amountNum,
        method: form.method,
        payoutDate: form.payoutDate,
        note: form.note.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({ kind: 'success', message: 'Đã ghi thanh toán lương cho lái xe.' });
          onClose();
        },
        onError: (err) => {
          const msg = (err as Error)?.message ?? 'Không thể ghi thanh toán.';
          toast({ kind: 'error', message: msg });
        },
      },
    );
  };

  const error = payout.error ? (payout.error as Error).message : null;

  return (
    <Modal
      isOpen={isOpen}
      title="Ghi thanh toán lương"
      onClose={onClose}
      onConfirm={handleSubmit}
      maxWidth={480}
      footer={
        <>
          <button className="btn btn--secondary btn--sm" onClick={onClose} disabled={payout.isPending}>
            Hủy bỏ
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleSubmit} disabled={!canSubmit}>
            {payout.isPending ? 'Đang ghi...' : 'Ghi nhận'}
          </button>
        </>
      }
    >
      <div className="commission-form">
        {error && (
          <div className="commission-form__error" role="alert">{error}</div>
        )}
        <div className="field">
          <label htmlFor="payout-driver">Lái xe <span className="req" aria-hidden="true">*</span></label>
          <select
            id="payout-driver"
            className="input"
            value={form.driverId}
            onChange={e => setForm(f => ({ ...f, driverId: e.target.value === '' ? '' : Number(e.target.value) }))}
          >
            <option value="">— Chọn lái xe —</option>
            {sortedDrivers.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="payout-amount">Số tiền <span className="req" aria-hidden="true">*</span></label>
          <input
            id="payout-amount"
            className="input"
            type="number"
            min="0"
            max="1000000000"
            step="1000"
            placeholder="VD: 5000000"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
          />
          {overLimit && (
            <div className="commission-form__error" role="note">Số tiền vượt quá giới hạn tối đa 1 tỷ VND.</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="payout-method">Phương thức <span className="req" aria-hidden="true">*</span></label>
          <select
            id="payout-method"
            className="input"
            value={form.method}
            onChange={e => setForm(f => ({ ...f, method: e.target.value as 'CASH' | 'BANK' }))}
          >
            <option value="CASH">Tiền mặt</option>
            <option value="BANK">Chuyển khoản</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="payout-date">Ngày thanh toán <span className="req" aria-hidden="true">*</span></label>
          <input
            id="payout-date"
            className="input"
            type="date"
            value={form.payoutDate}
            onChange={e => setForm(f => ({ ...f, payoutDate: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="payout-note">Ghi chú (tuỳ chọn)</label>
          <input
            id="payout-note"
            className="input"
            type="text"
            maxLength={500}
            placeholder="VD: Tạm ứng tháng lương"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
