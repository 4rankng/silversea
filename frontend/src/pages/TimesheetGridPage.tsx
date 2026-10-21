// Chấm công lái xe — the Điều vận grid. One cell per calendar day, one
// character per cell (K/Q/Đ/L/N/P), running totals under the board. Sundays
// are marked and never count as an attended day; the trips still record.
//
// Design: the shared record-table base + ops-table typography (no page-local
// table skin) and the shared SummaryRail — see docs/design-system/03.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Role, TIMESHEET_SYMBOL_RULES, countDayTrips, type TimesheetSymbol, type TimesheetSalaryMode } from '@tingting/shared';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';

import { Btn, Modal, PageHeader } from '../components/UI';
import { NumberField, SummaryRail } from '../design-system';
import { formatMoney } from '../lib/format';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';
import { useMonthRoute } from '../design-system/hooks/useMonthRoute';
import { useAuth } from '../hooks/useAuth';
import { TimesheetGridCell, type TimesheetMove } from '../features/timesheet/TimesheetGrid';
import { SALARY_MODE_LABELS, SALARY_MODE_OPTIONS } from '../features/timesheet/salary-modes';
import { qk } from '../api/keys';
import {
  createTimesheetMonth,
  listTimesheetDrivers,
  listTimesheetMonths,
  saveTimesheetDays,
  type TimesheetDayCell,
  type TimesheetMonth,
} from '../api/timesheetClient';
import { toastActionError } from '../lib/api/action-error';
import { useToast } from '../components/shared';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './TimesheetGridPage.css';

const COLUMN_COUNT = 7;

export default function TimesheetGridPage() {
  const { month, year, goPrev, goNext } = useMonthRoute();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // FB-101 — kế toán xem được lưới (mục không còn bị ẩn) nhưng KHÔNG ghi ký
  // hiệu: backend chặn ghi lưới ngoài dispatcherOrAbove. Ô để read-only, nút
  // "Lưu lưới" chỉ hiện cho vai trò ghi được.
  const { user } = useAuth();
  const canEditGrid = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.DISPATCHER;
  // FB-102 — mở bảng chấm công là việc của kế toán (POST /months accountantOnly).
  const canOpenBoard = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT;
  const cellRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [driverId, setDriverId] = useState<number | null>(null);
  // Keyed by period+driver: a month switch must not carry October's edits into
  // November's grid (the service rejects the cross-month batch as 400).
  const [pending, setPending] = useState<Record<string, TimesheetSymbol | null>>({});
  const driversQuery = useQuery({
    queryKey: qk.timesheet.drivers(year, month),
    queryFn: () => listTimesheetDrivers(year, month),
  });

  const activeDriverId = driverId ?? driversQuery.data?.[0]?.id ?? null;
  const activeDriver = driversQuery.data?.find(row => row.id === activeDriverId) ?? null;
  // Month navigation keeps the component mounted, so unsaved edits are
  // dropped explicitly when the period changes rather than leaking into the
  // next month (the service would reject the cross-month batch as 400).
  const periodKey = `${year}-${month}:${activeDriverId ?? 'none'}`;
  useEffect(() => { setPending({}); }, [periodKey]);


  const monthQuery = useQuery({
    queryKey: qk.timesheet.month(activeDriverId, year, month),
    queryFn: () => listTimesheetMonths(year, month).then(rows =>
      rows.find(row => row.id === activeDriver?.monthId) ?? null),
    enabled: activeDriverId !== null,
  });

  // Local edits layer over the saved month so typing never waits on the network.
  const timesheet: TimesheetMonth | null = monthQuery.data ?? null;
  const days: TimesheetDayCell[] = useMemo(() => (timesheet?.days ?? []).map(day => (
    // Trips are recomputed from the LOCAL symbol, so the running totals follow
    // the keystroke instead of waiting for the save round-trip.
    day.workDate in pending
      ? { ...day, symbol: pending[day.workDate], trips: countDayTrips({ symbol: pending[day.workDate], workDate: day.workDate, tripAdjustment: day.tripAdjustment }) }
      : day
  )), [timesheet, pending]);

  const saveMutation = useMutation({
    mutationFn: (changes: Array<{ workDate: string; symbol: TimesheetSymbol | null }>) => {
      if (!timesheet) throw new Error('Chưa có bảng chấm công cho lái xe này.');
      return saveTimesheetDays(timesheet.id, changes);
    },
    onSuccess: (saved, sentChanges) => {
      // Drop only what was SENT — a symbol typed while the request was in
      // flight must survive, or the operator's keystroke silently reverts.
      setPending(current => {
        const rest = { ...current };
        for (const change of sentChanges) delete rest[change.workDate];
        return rest;
      });
      queryClient.setQueryData(qk.timesheet.month(saved.driverId, saved.year, saved.month), saved);
      void queryClient.invalidateQueries({ queryKey: qk.timesheet.all });
    },
    onError: (error) => toastActionError(toast, 'Lưu lưới chấm công', error, 'Không lưu được lưới chấm công.'),
  });

  const dirty = Object.keys(pending).length > 0;

  // FB-102 (card 141026230790) — tháng mới chưa có bảng thì không nhập ký hiệu
  // được; kế toán mở bảng ngay tại đây (POST /months), sau đó điền lưới.
  // FB-103 (card 141026230800) — mở bảng = chọn hình thức lương của lái xe.
  const [boardFormOpen, setBoardFormOpen] = useState(false);
  const [boardMode, setBoardMode] = useState<TimesheetSalaryMode>('PER_TRIP');
  const [boardDailyBase, setBoardDailyBase] = useState<number | ''>('');
  const [boardFlatAmount, setBoardFlatAmount] = useState<number | ''>('');
  const openBoardMutation = useMutation({
    mutationFn: () => {
      if (activeDriverId === null) throw new Error('Chọn lái xe trước khi mở bảng chấm công.');
      return createTimesheetMonth({
        driverId: activeDriverId,
        year,
        month,
        salaryMode: boardMode,
        ...(boardMode === 'PER_TRIP'
          ? { dailyBase: boardDailyBase === '' ? null : boardDailyBase }
          : { flatAmount: boardFlatAmount === '' ? null : boardFlatAmount }),
      });
    },
    onSuccess: () => {
      setBoardFormOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.timesheet.all });
    },
    onError: (error) => toastActionError(toast, 'Mở bảng chấm công', error, 'Không mở được bảng chấm công.'),
  });

  function moveFocus(fromIndex: number, move: TimesheetMove) {
    const target = Math.min(Math.max(fromIndex + move, 0), days.length - 1);
    cellRefs.current[target]?.focus();
  }

  function enterSymbol(workDate: string, symbol: TimesheetSymbol | null) {
    setPending(current => ({ ...current, [workDate]: symbol }));
  }

  const weeks = useMemo(() => (days.length > 0 ? chunkDays(days) : []), [days]);

  const totals = useMemo(() => {
    const counts = { K: 0, Q: 0, 'Đ': 0, L: 0, N: 0, P: 0 } as Record<TimesheetSymbol, number>;
    let trips = 0;
    for (const day of days) {
      if (!day.symbol) continue;
      counts[day.symbol] += 1;
      trips += day.trips;
    }
    return { counts, trips };
  }, [days]);

  return (
    <div className="ts-page">
      <PageHeader
        title="Chấm công lái xe"
        action={
          canEditGrid ? (
            <Btn onClick={() => saveMutation.mutate(Object.entries(pending).map(([workDate, symbol]) => ({ workDate, symbol })))} disabled={!dirty || saveMutation.isPending}>
              <Save size={16} /> Lưu lưới
            </Btn>
          ) : undefined
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
          label="Chọn lái xe"
          hideLabel
          ariaLabel="Chọn lái xe"
          value={activeDriverId === null ? '' : String(activeDriverId)}
          onChange={event => setDriverId(Number(event.target.value))}
          options={(driversQuery.data ?? []).map(driver => ({ value: String(driver.id), label: driver.name }))}
        />
        </div>
      </div>

      {!timesheet && (
        <p className="ts-hint">
          Lái xe này chưa có bảng chấm công tháng {String(month).padStart(2, '0')}/{year}. Kế toán mở bảng trước, sau đó Điều vận điền lưới.
          {canOpenBoard && activeDriverId !== null && (
            <Btn
              size="sm"
              onClick={() => {
                // FB-103 (ticket 171026215600) — mở dialog với chế độ mặc định
                // của lái xe (đặt ở dialog "Sửa lương cứng" / sửa lái xe), kế
                // toán vẫn đổi được từng tháng ngay trong dialog này.
                setBoardMode(activeDriver?.defaultSalaryMode ?? 'PER_TRIP');
                setBoardFormOpen(true);
              }}
            >
              Mở bảng chấm công
            </Btn>
          )}
        </p>
      )}

      {timesheet && (
        <>
          <p className="ts-legend">
            {(['K', 'Q', 'Đ', 'L', 'N', 'P'] as TimesheetSymbol[]).map(symbol => (
              <span key={symbol}><b>{symbol}</b> {TIMESHEET_SYMBOL_RULES[symbol].label} ({TIMESHEET_SYMBOL_RULES[symbol].trips} chuyến)</span>
            ))}
          </p>

          <p className="ts-hint">
            {`Hình thức lương: ${SALARY_MODE_LABELS[timesheet.salaryMode]}`}
            {/* Card 191026160000 (§1): money always prints grouped —
                "18.500.000 ₫", never the raw integer. */}
            {timesheet.salaryMode === 'PER_TRIP' && timesheet.dailyBase !== null ? ` · Lương ngày ${formatMoney(timesheet.dailyBase)} ₫` : ''}
            {timesheet.salaryMode === 'FLAT_MONTHLY' && timesheet.flatAmount !== null ? ` · Lương tháng ${formatMoney(timesheet.flatAmount)} ₫` : ''}
          </p>

          <div className="record-table-wrap">
            <table className="record-table ops-table ts-grid">
              <caption className="sr-only">Lưới chấm công tháng {month}/{year}</caption>
              <thead>
                <tr>
                  <th scope="col">Ngày</th>
                  {WEEKDAY_LABELS.map(label => (
                    <th key={label} scope="col">{label}</th>
                  ))}
                  <th scope="col">Chuyến</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, weekIndex) => (
                  <tr key={weekIndex}>
                    <th scope="row">{`Tuần ${weekIndex + 1}`}</th>
                    {week.map((day, columnIndex) => (
                      <td key={day?.workDate ?? `blank-${weekIndex}-${columnIndex}`} data-label={day?.workDate}>
                        {day && (
                          <TimesheetGridCell
                            day={day}
                            readOnly={!canEditGrid}
                            registerRef={element => {
                              cellRefs.current[days.findIndex(row => row.workDate === day.workDate)] = element;
                            }}
                            onEnter={enterSymbol}
                            onMove={move => moveFocus(days.findIndex(row => row.workDate === day.workDate), move)}
                          />
                        )}
                      </td>
                    ))}
                    <td className="num">{week.reduce((sum, day) => sum + (day?.trips ?? 0), 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SummaryRail
            ariaLabel="Tổng chấm công tháng"
            items={[
              { label: 'Chuyến', value: timesheet.salary.trips },
              { label: 'Ngày công', value: timesheet.salary.workdays },
              ...(['K', 'Q', 'Đ', 'L', 'N', 'P'] as TimesheetSymbol[])
                .map(symbol => ({ label: TIMESHEET_SYMBOL_RULES[symbol].label, value: totals.counts[symbol] })),
            ]}
          />
        </>
      )}

      {/* FB-103 — mở bảng = chọn hình thức lương của lái xe (POST /months). */}
      <Modal
        isOpen={boardFormOpen}
        title="Mở bảng chấm công"
        onClose={() => setBoardFormOpen(false)}
        footer={(
          <>
            <button type="button" className="btn btn--secondary" disabled={openBoardMutation.isPending} onClick={() => setBoardFormOpen(false)}>Hủy</button>
            <button type="button" className="btn btn--primary" disabled={openBoardMutation.isPending} onClick={() => openBoardMutation.mutate()}>
              {openBoardMutation.isPending ? 'Đang mở bảng…' : 'Mở bảng'}
            </button>
          </>
        )}
      >
        <div className="ts-mode-form">
          <UuiSelectField
            label="Hình thức lương"
            value={boardMode}
            onChange={event => setBoardMode(event.target.value as TimesheetSalaryMode)}
            options={SALARY_MODE_OPTIONS}
          />
          {boardMode === 'PER_TRIP' ? (
            <NumberField controlSize="sm" label="Lương ngày (VND)" value={boardDailyBase} min={0} step={1} grouped onChange={setBoardDailyBase} />
          ) : (
            <NumberField controlSize="sm" label="Lương tháng cố định (VND)" value={boardFlatAmount} min={0} step={1} grouped onChange={setBoardFlatAmount} />
          )}
          <p className="ts-hint">Để trống nếu chưa có mức — hệ thống cảnh báo tới khi kế toán nhập.</p>
        </div>
      </Modal>
    </div>
  );
}

/** Vietnamese weekday headers, Monday (T2) first — the grid's column order. */
const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T1'];

/**
 * The month laid out as weeks of 7, Monday first. The first week is padded so
 * day 1 sits under its own weekday column; `null` marks a pad cell.
 */
function chunkDays<T extends { workDate: string }>(days: T[]): Array<Array<T | null>> {
  const leading = (new Date(`${days[0].workDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weeks: Array<Array<T | null>> = [];
  let current: Array<T | null> = Array.from({ length: leading }, () => null);
  for (const day of days) {
    current.push(day);
    if (current.length === COLUMN_COUNT) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) weeks.push([...current, ...Array.from({ length: COLUMN_COUNT - current.length }, () => null)]);
  return weeks;
}