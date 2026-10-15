// Đối chiếu chấm công lái xe — the Kế toán board. Same grid read-only, plus a
// signed per-day trip correction (NEGATIVE ALLOWED: a trip the paperwork does
// not support must be removable), the month's salary by mode and the
// efficiency metrics leadership reads.
//
// Design: shared record-table + ops-table + SummaryRail, no page-local skin.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TIMESHEET_SYMBOL_RULES } from '@tingting/shared';
import { CheckCircle2, ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react';

import { Btn, PageHeader, Panel } from '../components/UI';
import { Money } from '../components/shared/Money';
import { SummaryRail } from '../design-system';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';
import { useMonthRoute } from '../design-system/hooks/useMonthRoute';
import { qk } from '../api/keys';
import {
  adjustTimesheetDay,
  getTimesheetRollup,
  listTimesheetMonths,
  reconcileTimesheetMonth,
  reopenTimesheetMonth,
} from '../api/timesheetClient';
import { toastActionError } from '../lib/api/action-error';
import { useToast } from '../components/shared';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './TimesheetGridPage.css';

export default function TimesheetReconciliationPage() {
  const { month, year, goPrev, goNext } = useMonthRoute();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [monthId, setMonthId] = useState<number | null>(null);

  const monthsQuery = useQuery({
    queryKey: qk.timesheet.months(year, month),
    queryFn: () => listTimesheetMonths(year, month),
  });
  const months = monthsQuery.data ?? [];
  const activeId = monthId ?? months[0]?.id ?? null;
  const active = months.find(row => row.id === activeId) ?? null;

  const rollupQuery = useQuery({
    queryKey: qk.timesheet.rollup(year, month),
    queryFn: () => getTimesheetRollup(year, month),
  });

  function applyMutation<T>(mutation: () => Promise<T>) {
    return () => {
      mutation().catch(error => toastActionError(toast, 'Lưu thay đổi chấm công', error, 'Không lưu được thay đổi.'));
    };
  }

  const adjustMutation = useMutation({
    mutationFn: ({ dayId, value }: { dayId: number; value: number }) => {
      if (!active) throw new Error('Chưa chọn bảng chấm công.');
      return adjustTimesheetDay(active.id, dayId, value);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.timesheet.month(saved.driverId, saved.year, saved.month), saved);
      // The rollup feeds leadership, so an adjustment must refresh it too —
      // invalidating only `months` would leave stale salary on this very board.
      void queryClient.invalidateQueries({ queryKey: qk.timesheet.all });
    },
    onError: (error) => toastActionError(toast, 'Lưu chỉnh lệch chuyến', error, 'Không lưu được chỉnh lệch chuyến.'),
  });

  const reconcileMutation = useMutation({
    mutationFn: () => (active ? reconcileTimesheetMonth(active.id) : Promise.reject(new Error('Chưa chọn bảng.'))),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.timesheet.all }),
  });
  const reopenMutation = useMutation({
    mutationFn: () => (active ? reopenTimesheetMonth(active.id) : Promise.reject(new Error('Chưa chọn bảng.'))),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.timesheet.all }),
  });

  const rows = rollupQuery.data ?? [];
  const totals = rows.reduce((sum, row) => ({
    trips: sum.trips + row.trips,
    workdays: sum.workdays + row.workdays,
    salary: sum.salary + row.salary,
    revenue: sum.revenue + (row.revenue ?? 0),
  }), { trips: 0, workdays: 0, salary: 0, revenue: 0 });

  return (
    <div className="ts-page">
      <PageHeader
        title="Đối chiếu chấm công"
        action={
          active && (active.status === 'RECONCILED' ? (
            <Btn onClick={applyMutation(() => reopenMutation.mutateAsync())} disabled={reopenMutation.isPending}>
              <Unlock size={16} /> Mở lại
            </Btn>
          ) : (
            <Btn onClick={applyMutation(() => reconcileMutation.mutateAsync())} disabled={reconcileMutation.isPending}>
              <CheckCircle2 size={16} /> Đối chiếu xong
            </Btn>
          ))
        }
      />

      <div className="ts-toolbar">
        <button className="btn btn--ghost btn--icon btn--sm" onClick={goPrev} aria-label="Tháng trước">
          <ChevronLeft size={16} />
        </button>
        <span className="ts-period">{`Tháng ${String(month).padStart(2, '0')}/${year}`}</span>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={goNext} aria-label="Tháng sau">
          <ChevronRight size={16} />
        </button>
        <div className="ts-driver-select">
          <UuiSelectField
            label="Chọn bảng chấm công"
            hideLabel
            ariaLabel="Chọn bảng chấm công"
            value={activeId === null ? '' : String(activeId)}
            onChange={event => setMonthId(Number(event.target.value))}
            options={months.map(row => ({
              value: String(row.id),
              label: `${row.driverName} — ${row.status === 'RECONCILED' ? 'đã đối chiếu' : 'đang mở'}`,
            }))}
          />
        </div>
      </div>

      {active?.warnings.map(warning => (
        <p key={warning} className="ts-hint">{warning}</p>
      ))}

      {active && (
        <>
          <p className="ts-legend">
            {active.status === 'RECONCILED'
              ? <><Lock size={14} /> Đã đối chiếu — mở lại để sửa.</>
              : <>Chỉnh lệch chuyến nhập số âm được (ví dụ −1 khi thiếu chứng từ).</>}
          </p>

          <div className="record-table-wrap">
            <table className="record-table ops-table ts-grid">
              <caption className="sr-only">Lưới đối chiếu {active.driverName} tháng {month}/{year}</caption>
              <thead>
                <tr>
                  <th scope="col">Ngày</th>
                  <th scope="col">Ký hiệu</th>
                  <th scope="col">Chuyến</th>
                  <th scope="col">Chỉnh lệch</th>
                  <th scope="col">Ngày công</th>
                </tr>
              </thead>
              <tbody>
                {active.days.filter(day => day.symbol).map(day => (
                  <tr key={day.workDate}>
                    <td data-label="Ngày">{day.workDate}</td>
                    <td data-label="Ký hiệu">
                      {day.symbol ? `${day.symbol} — ${TIMESHEET_SYMBOL_RULES[day.symbol].label}` : '—'}
                    </td>
                    <td className="num" data-label="Chuyến">{day.trips}</td>
                    <td data-label="Chỉnh lệch">
                      <input
                        className="ts-adjust"
                        type="number"
                        step={1}
                        min={-10}
                        max={10}
                        defaultValue={day.tripAdjustment}
                        aria-label={`Chỉnh lệch chuyến ngày ${day.workDate}`}
                        disabled={!day.id || active.status === 'RECONCILED'}
                        onBlur={event => {
                          if (!day.id) return;
                          // An emptied field is not a correction: `Number('')`
                          // is 0, which would silently wipe an existing one.
                          if (event.target.value.trim() === '') {
                            event.target.value = String(day.tripAdjustment);
                            return;
                          }
                          const value = Math.min(10, Math.max(-10, Number(event.target.value)));
                          if (!Number.isInteger(value)) {
                            event.target.value = String(day.tripAdjustment);
                            return;
                          }
                          // The field is uncontrolled, so a rejected value must
                          // be snapped back to what was actually persisted.
                          event.target.value = String(value);
                          if (value !== day.tripAdjustment) {
                            adjustMutation.mutate({ dayId: day.id, value });
                          }
                        }}
                      />
                    </td>
                    <td className="num" data-label="Ngày công">{day.isSunday ? 'Chủ nhật' : 'Có'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SummaryRail
            ariaLabel="Tổng lương tháng"
            items={[
              { label: 'Chuyến', value: active.salary.trips },
              { label: 'Ngày công', value: active.salary.workdays },
              { label: 'Chuyến thưởng', value: active.salary.bonusTrips },
              { label: 'Tiền chuyến', value: active.salary.perTripPay },
              { label: 'Thưởng chuyến', value: active.salary.extraTripBonus },
              { label: 'Lương ngày', value: active.salary.dailyBasePay },
              { label: 'Tổng lương', value: active.salary.salaryTotal },
            ]}
          />
        </>
      )}

      <Panel title="Tổng hợp tháng">
        <div className="record-table-wrap">
          <table className="record-table ops-table">
            <caption className="sr-only">Tổng hợp chấm công và hiệu quả theo lái xe</caption>
            <thead>
              <tr>
                <th scope="col">Lái xe</th>
                <th scope="col">Đơn</th>
                <th scope="col">Kẹp</th>
                <th scope="col">Quay đầu</th>
                <th scope="col">Lưu ca</th>
                <th scope="col">Nghỉ</th>
                <th scope="col">Nghỉ phép</th>
                <th scope="col">Chuyến</th>
                <th scope="col">Ngày công</th>
                <th scope="col">Chuyến CN</th>
                <th scope="col">Doanh thu</th>
                <th scope="col">Chi phí</th>
                <th scope="col">Lương</th>
                <th scope="col">Lương / DT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.driverId}>
                  <td data-label="Lái xe">{row.driverName}</td>
                  <td className="num" data-label="Đơn">{row.donCount}</td>
                  <td className="num" data-label="Kẹp">{row.kepCount}</td>
                  <td className="num" data-label="Quay đầu">{row.quayDauCount}</td>
                  <td className="num" data-label="Lưu ca">{row.luuCaCount}</td>
                  <td className="num" data-label="Nghỉ">{row.nghiCount}</td>
                  <td className="num" data-label="Nghỉ phép">{row.nghiPhepCount}</td>
                  <td className="num" data-label="Chuyến">{row.trips}</td>
                  <td className="num" data-label="Ngày công">{row.workdays}</td>
                  <td className="num" data-label="Chuyến CN">{row.sundayTrips}</td>
                  <td className="num" data-label="Doanh thu">{row.revenue === null ? '—' : <Money value={row.revenue} />}</td>
                  <td className="num" data-label="Chi phí">{row.cost === null ? '—' : <Money value={row.cost} />}</td>
                  <td className="num" data-label="Lương"><Money value={row.salary} /></td>
                  <td className="num" data-label="Lương / DT">
                    {row.salaryRatio === null ? '—' : `${(row.salaryRatio * 100).toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ts-hint">
          {`Tổng ${totals.trips} chuyến · ${totals.workdays} ngày công · `}
          <Money value={totals.salary} />
        </p>
      </Panel>
    </div>
  );
}