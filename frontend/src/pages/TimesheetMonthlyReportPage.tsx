// FB-104 (card 141026230810) — Báo cáo "TỔNG HỢP XẾP LỆNH THÁNG" theo mẫu
// Excel khách đang dùng: mỗi dòng một lái xe (STT · Loại xe · Biển kiểm soát ·
// Hình thức lương · Lái xe) với lưới ký hiệu theo ngày, dòng "Tổng lệnh
// kẹp/ngày" + tỷ lệ % theo ngày, và các cột tổng hợp ở cuối dòng.
//
// Quy ước màu theo mô tả của khách (ảnh mẫu Excel chưa có): xanh = ô tạo chuyến
// tính lương chuyến (K/Q/Đ), vàng = Chủ nhật và lưu ca (không tạo chuyến trong
// ngày), đỏ = nghỉ (N/P). Tỷ lệ % = lệnh kẹp / tổng lệnh của ngày.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TIMESHEET_SYMBOL_RULES, type TimesheetSymbol } from '@tingting/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageHeader } from '../components/UI';
import { EmptyState } from '../design-system';
import { useMonthRoute } from '../design-system/hooks/useMonthRoute';
import { SALARY_MODE_LABELS } from '../features/timesheet/salary-modes';
import { qk } from '../api/keys';
import { listTimesheetDrivers, listTimesheetMonths } from '../api/timesheetClient';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './TimesheetMonthlyReportPage.css';

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function cellClass(symbol: TimesheetSymbol | null, sunday: boolean): string {
  if (symbol === 'N' || symbol === 'P') return 'ts-report__cell--off';
  if (sunday) return 'ts-report__cell--sunday';
  if (symbol === 'L') return 'ts-report__cell--standby';
  if (symbol) return 'ts-report__cell--trip';
  return '';
}

export default function TimesheetMonthlyReportPage() {
  const { month, year, goPrev, goNext } = useMonthRoute();
  const monthsQuery = useQuery({
    queryKey: qk.timesheet.months(year, month),
    queryFn: () => listTimesheetMonths(year, month),
  });
  const driversQuery = useQuery({
    queryKey: qk.timesheet.drivers(year, month),
    queryFn: () => listTimesheetDrivers(year, month),
  });

  const dayNumbers = useMemo(() => {
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => index + 1);
  }, [year, month]);

  const rows = useMemo(() => {
    const drivers = driversQuery.data ?? [];
    return (monthsQuery.data ?? []).map(monthRow => {
      const driver = drivers.find(item => item.id === monthRow.driverId) ?? null;
      const byDay = new Map(monthRow.days.map(day => [Number(day.workDate.slice(8, 10)), day]));
      let don = 0;
      let kep = 0;
      let quayDau = 0;
      for (const day of monthRow.days) {
        if (day.symbol === 'Đ') don += 1;
        if (day.symbol === 'K') kep += 1;
        // "Q = quay đầu → tính 2 chuyến" (card 230790): cột đếm CHUYẾN.
        if (day.symbol === 'Q') quayDau += 2;
      }
      return { monthRow, driver, byDay, don, kep, quayDau };
    });
  }, [monthsQuery.data, driversQuery.data]);

  // "Tổng lệnh kẹp/ngày" + tỷ lệ % theo ngày (kẹp / tổng lệnh K+Q+Đ của ngày).
  const perDay = useMemo(() => dayNumbers.map(dayNumber => {
    let kep = 0;
    let commands = 0;
    for (const row of rows) {
      const symbol = row.byDay.get(dayNumber)?.symbol ?? null;
      if (!symbol) continue;
      if (symbol === 'K') kep += 1;
      if (symbol === 'K' || symbol === 'Q' || symbol === 'Đ') commands += 1;
    }
    return { dayNumber, kep, pct: commands === 0 ? null : Math.round((kep / commands) * 1000) / 10 };
  }), [rows, dayNumbers]);

  return (
    <div className="ts-page">
      <PageHeader title="Tổng hợp xếp lệnh tháng" />

      <div className="ts-toolbar">
        <button className="btn btn--ghost btn--icon btn--sm" onClick={goPrev} aria-label="Tháng trước">
          <ChevronLeft size={16} />
        </button>
        <span className="ts-period">{`Tháng ${String(month).padStart(2, '0')}/${year}`}</span>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={goNext} aria-label="Tháng sau">
          <ChevronRight size={16} />
        </button>
      </div>

      <h2 className="ts-report__title">{`TỔNG HỢP XẾP LỆNH THÁNG ${String(month).padStart(2, '0')}/${year}`}</h2>

      <p className="ts-legend">
        {(['K', 'Q', 'Đ', 'L', 'N', 'P'] as TimesheetSymbol[]).map(symbol => (
          <span key={symbol} className={cellClass(symbol, false)}>
            <b>{symbol}</b> {TIMESHEET_SYMBOL_RULES[symbol].label} ({TIMESHEET_SYMBOL_RULES[symbol].trips} chuyến)
          </span>
        ))}
        <span className="ts-report__cell--sunday">Chủ nhật — ghi chuyến, không tính ngày công</span>
      </p>

      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          context="finance"
          title="Chưa có bảng chấm công trong tháng này."
          description="Kế toán mở bảng chấm công cho lái xe rồi quay lại xem báo cáo."
        />
      ) : (
        <div className="record-table-wrap">
          <table className="record-table ops-table ts-report">
            <caption className="sr-only">{`Tổng hợp xếp lệnh tháng ${String(month).padStart(2, '0')}/${year}`}</caption>
            <thead>
              <tr>
                <th scope="col">STT</th>
                <th scope="col">Loại xe</th>
                <th scope="col">Biển kiểm soát</th>
                <th scope="col">Hình thức lương</th>
                <th scope="col">Lái xe</th>
                {dayNumbers.map(dayNumber => {
                  const weekday = new Date(Date.UTC(year, month - 1, dayNumber)).getUTCDay();
                  return (
                    <th
                      key={dayNumber}
                      scope="col"
                      className={`ts-report__day${weekday === 0 ? ' ts-report__cell--sunday' : ''}`}
                    >
                      {dayNumber}
                      <small>{WEEKDAY_LABELS[(weekday + 6) % 7]}</small>
                    </th>
                  );
                })}
                <th scope="col">Tổng lệnh đơn</th>
                <th scope="col">Tổng lệnh kẹp</th>
                <th scope="col">Số chuyến quay đầu</th>
                <th scope="col">Tổng số chuyến</th>
                <th scope="col">Số ngày công</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.monthRow.id}>
                  <td data-label="STT">{index + 1}</td>
                  <td data-label="Loại xe">{row.driver?.vehicleClass ?? '—'}</td>
                  <td data-label="Biển kiểm soát">{row.driver?.plateNumber ?? '—'}</td>
                  <td data-label="Hình thức lương">{SALARY_MODE_LABELS[row.monthRow.salaryMode]}</td>
                  <td data-label="Lái xe">{row.monthRow.driverName}</td>
                  {dayNumbers.map(dayNumber => {
                    const day = row.byDay.get(dayNumber);
                    const symbol = day?.symbol ?? null;
                    return (
                      <td key={dayNumber} className={`ts-report__cell ${cellClass(symbol, day?.isSunday ?? false)}`} data-label={`Ngày ${dayNumber}`}>
                        {symbol ?? ''}
                      </td>
                    );
                  })}
                  <td className="num" data-label="Tổng lệnh đơn">{row.don}</td>
                  <td className="num" data-label="Tổng lệnh kẹp">{row.kep}</td>
                  <td className="num" data-label="Số chuyến quay đầu">{row.quayDau}</td>
                  <td className="num" data-label="Tổng số chuyến">{row.monthRow.salary.trips}</td>
                  <td className="num" data-label="Số ngày công">{row.monthRow.salary.workdays}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>Tổng lệnh kẹp/ngày</th>
                {perDay.map(day => (
                  <td key={day.dayNumber} className="num ts-report__cell">{day.kep === 0 ? '' : day.kep}</td>
                ))}
                <td colSpan={5} />
              </tr>
              <tr>
                <th scope="row" colSpan={5}>Tỷ lệ %</th>
                {perDay.map(day => (
                  <td key={day.dayNumber} className="num ts-report__cell">{day.pct === null ? '' : `${day.pct}%`}</td>
                ))}
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
