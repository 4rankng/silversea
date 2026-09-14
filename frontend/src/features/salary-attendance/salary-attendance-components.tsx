import React, { useState, useMemo, useEffect } from 'react';
import { Truck, Coffee, XCircle, DollarSign, Info, Edit, ArrowRightLeft, Clock3 } from 'lucide-react';
import { Money } from '../../components/shared/Money';
import { Modal } from '../../components/UI';
import { usePostDriverPayout } from '../../hooks/useFinancialQueries';
import type {
  WorkDayRecord,
  AttendanceSalary,
  SalaryPeriodAdjustmentItem,
} from '../../api/salaryClient';
import { useToast } from '../../components/shared/Toast';
import { DateInput } from '../../design-system/forms/DateInput';
import { UuiSelectField } from '../../design-system';
import { DOW_LABELS, STATUS_CONFIG } from './salary-attendance-constants';
import '../../pages/SalaryAttendancePage.css';


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
  // Full calendar date + attendance state as the accessible name — the
  // compact cell shows only a day number, so screen readers get the whole
  // sentence ("15/09/2026 — Đã làm việc").
  const [cy, cm, cd] = dateStr.split('-').map(Number);
  const fullDate = `${cd}/${cm}/${cy}`;
  const stateLabel = workDay?.trip?.tripCode
    ? `${workDay.trip.tripCode} – ${workDay.trip.routeName || ''}`
    : cfg?.label || '';
  const label = `${fullDate}${stateLabel ? ` — ${stateLabel}` : ''}`;

  return (
    <button
      type="button"
      title={workDay?.trip ? `${workDay.trip.tripCode || ''} – ${workDay.trip.routeName || ''}` : cfg?.label || ''}
      onClick={() => isClickable && onCycle(dateStr, workDay)}
      aria-label={label}
      aria-disabled={!isClickable}
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
    </button>
  );
}

// ── Salary Summary Card ───────────────────────────────────────────────────────
export function SalarySummaryCard({ salary, onEditBaseSalary, driverName }: { salary: AttendanceSalary; onEditBaseSalary?: () => void; driverName?: string }) {
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
            <button
              type="button"
              className="salary-edit-link"
              title="Sửa lương cứng"
              onClick={() => onEditBaseSalary?.()}
              aria-label={`Sửa lương cứng ${driverName ?? ''}`}
            >
              <Edit size={10} />
            </button>
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

        {(salary.postCloseAdjustment ?? 0) !== 0 && (
          <div className="salary-summary-dark__row">
            <span className="salary-summary-dark__row-lbl">
              <ArrowRightLeft size={12} /> Điều chỉnh liên kỳ
            </span>
            <span className={`salary-summary-dark__row-val ${(salary.postCloseAdjustment ?? 0) > 0 ? 'salary-summary-dark__row-val--pos' : 'salary-summary-dark__row-val--neg'}`}>
              <Money
                value={Math.abs(salary.postCloseAdjustment ?? 0)}
                sign={(salary.postCloseAdjustment ?? 0) > 0 ? '+' : '-'}
              />
            </span>
          </div>
        )}

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

export function MobileDayList({ dates, workDayMap, isUpdating, isConfirmed, onCycle, parseLocalDate }: MobileDayListProps) {
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
        const isClickable = !isUpdating && !isConfirmed && status !== 'TRIP_DAY';
        const stateLabel = workDay?.trip?.tripCode
          ? `${workDay.trip.tripCode} – ${workDay.trip.routeName || ''}`
          : cfg?.label || '';
        const ariaLabel = `${day}/${cellMonth} — ${stateLabel}`;

        return (
          <div
            key={dateStr}
            role="button"
            tabIndex={isClickable ? 0 : undefined}
            aria-disabled={!isClickable}
            aria-label={ariaLabel}
            onClick={() => isClickable && onCycle(dateStr, workDay)}
            onKeyDown={(e) => {
              if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onCycle(dateStr, workDay);
              }
            }}
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

export function PostCloseAdjustmentList({
  items,
}: {
  items: SalaryPeriodAdjustmentItem[];
}) {
  if (items.length === 0) {
    return (
      <div className="salary-empty-inline" style={{ padding: '18px 14px' }}>
        <Clock3 size={16} />
        <span>Chưa có điều chỉnh liên kỳ cho lái xe này.</span>
      </div>
    );
  }

  return (
    <div className="payslip-container">
      {items.map((item) => {
        const incoming = item.relationship === 'TARGET';
        return (
          <div key={item.adjustmentId} className="payslip-row">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <ArrowRightLeft size={14} />
                <span>{incoming ? `Từ kỳ ${item.sourcePeriod}` : `Sang kỳ ${item.targetPeriod}`}</span>
              </div>
              <span className={`payslip-value ${incoming ? 'is-positive' : 'is-negative'}`}>
                <Money value={Math.abs(item.amount)} sign={incoming ? '+' : '-'} />
              </span>
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--fg-2)' }}>{item.reason}</div>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--fg-3)' }}>
              <span>Duyệt bởi {item.approvedByName || 'Người dùng không xác định'}</span>
              <span>{new Date(item.approvedAt).toLocaleDateString('vi-VN')}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PostCloseAdjustmentModal({
  isOpen,
  onClose,
  sourcePeriod,
  onSubmit,
  submitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  sourcePeriod: string;
  onSubmit: (payload: { targetPeriod: string; amount: number; reason: string }) => Promise<void> | void;
  submitting: boolean;
}) {
  const [targetPeriod, setTargetPeriod] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTargetPeriod('');
      setAmount('');
      setReason('');
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const normalizedTarget = targetPeriod.trim();
    const normalizedReason = reason.trim();
    const parsedAmount = Number(amount.replace(/[^0-9-]/g, ''));

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalizedTarget)) {
      setError('Kỳ đích phải ở dạng YYYY-MM');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      setError('Số tiền điều chỉnh phải khác 0');
      return;
    }
    if (!normalizedReason) {
      setError('Lý do điều chỉnh là bắt buộc');
      return;
    }

    setError(null);
    await onSubmit({
      targetPeriod: normalizedTarget,
      amount: parsedAmount,
      reason: normalizedReason,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tạo khoản điều chỉnh liên kỳ">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
          Kỳ nguồn: <strong>{sourcePeriod}</strong>. Kỳ cũ giữ nguyên snapshot, khoản điều chỉnh sẽ đi vào kỳ đích đang mở.
        </div>
        <label className="input-group">
          <span>Kỳ đích (YYYY-MM)</span>
          <input className="input" value={targetPeriod} onChange={(event) => setTargetPeriod(event.target.value)} placeholder="2026-08" />
        </label>
        <label className="input-group">
          <span>Số tiền điều chỉnh (VND)</span>
          <input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="250000" />
        </label>
        <label className="input-group">
          <span>Lý do điều chỉnh</span>
          <textarea className="input" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Ví dụ: bổ sung công chuyến hoàn tất sau khi đã phát hành phiếu lương" />
        </label>
        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn--secondary" onClick={onClose} disabled={submitting}>Hủy</button>
          <button className="btn btn--primary" onClick={() => { void handleSubmit(); }} disabled={submitting}>
            {submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}
          </button>
        </div>
      </div>
    </Modal>
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
        <UuiSelectField
          id="payout-driver"
          label="Lái xe"
          required
          value={form.driverId === null || form.driverId === undefined ? '' : String(form.driverId)}
          onChange={e => setForm(f => ({ ...f, driverId: e.target.value === '' ? '' : Number(e.target.value) }))}
          options={[{ value: '', label: '— Chọn lái xe —' }, ...sortedDrivers.map(d => ({ value: String(d.id), label: d.name }))]}
          wrapperClassName="field commission-form__field--full"
        />
        <div className="field">
          <label htmlFor="payout-amount">Số tiền <span className="req" aria-hidden="true">*</span></label>
          <input
            id="payout-amount"
            className="input"
            type="number"
            min="0"
            max="1000000000"
            step="1000"
            placeholder="Ví dụ: 5000000"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
          />
          {overLimit && (
            <div className="commission-form__error" role="note">Số tiền vượt quá giới hạn tối đa 1 tỷ VND.</div>
          )}
        </div>
        <UuiSelectField
          id="payout-method"
          label="Phương thức"
          required
          value={form.method}
          onChange={e => setForm(f => ({ ...f, method: e.target.value as 'CASH' | 'BANK' }))}
          options={[{ value: 'CASH', label: 'Tiền mặt' }, { value: 'BANK', label: 'Chuyển khoản' }]}
          wrapperClassName="field"
        />
        <div className="field">
          <label htmlFor="payout-date">Ngày thanh toán <span className="req" aria-hidden="true">*</span></label>
          <DateInput
            id="payout-date"
            className="input"
            value={form.payoutDate}
            onChange={(value) => setForm(f => ({ ...f, payoutDate: value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="payout-note">Ghi chú (tuỳ chọn)</label>
          <input
            id="payout-note"
            className="input"
            type="text"
            maxLength={500}
            placeholder="Ví dụ: Tạm ứng tháng lương"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
