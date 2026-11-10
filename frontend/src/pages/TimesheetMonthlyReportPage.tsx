// FB-104 (card 141026230810) — Báo cáo "TỔNG HỢP XẾP LỆNH THÁNG" theo mẫu
// Excel khách đang dùng: mỗi dòng một lái xe (STT · Loại xe · Biển kiểm soát ·
// Hình thức lương · Lái xe) với lưới ký hiệu theo ngày, dòng "Tổng lệnh
// kẹp/ngày" + tỷ lệ % theo ngày, và các cột tổng hợp ở cuối dòng.
//
// Quy ước màu theo mô tả của khách — SIL-774 (Bảng 4, khách chốt 09/11/2026):
// xanh = ô tạo chuyến tính lương chuyến (K/Q/Đ), vàng = Chủ nhật và lưu ca
// (không tạo chuyến trong ngày), N = nền đỏ chữ trắng (nghỉ tai nạn / nghỉ
// việc gia đình có phép), P = nền trắng chữ đen in hoa (nghỉ sửa xe / bảo
// dưỡng định kỳ). Tỷ lệ % = lệnh kẹp / tổng lệnh của ngày.

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

// SIL-774 — quy ước màu khách (Bảng 4): N = nghỉ tai nạn / nghỉ việc gia
// đình có phép → nền đỏ chữ trắng; P = nghỉ sửa xe / bảo dưỡng định kỳ →
// nền trắng chữ đen in hoa.
function cellClass(symbol: TimesheetSymbol | null, sunday: boolean): string {
  if (symbol === 'N') return 'ts-report__cell--n';
  if (symbol === 'P') return 'ts-report__cell--p';
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
      let nghiHuongLuong = 0;
      let nghiPhep = 0;
      for (const day of monthRow.days) {
        if (day.symbol === 'Đ') don += 1;
        if (day.symbol === 'K') kep += 1;
        // SIL-775 (khách chốt 09/11/2026): mỗi ngày Q tính 1 chuyến quay đầu
        // trong công thức tổng — thay luật cũ 'Q = 2 chuyến' (card 230790).
        // Ký hiệu Q trên lưới vẫn mang nghĩa 2 cuốc/ngày; chỉ cách ĐẾM ở cột
        // tổng đổi thành 1 chuyến/ngày Q.
        if (day.symbol === 'Q') quayDau += 1;
        // SIL-774 — cột 6 'Số ngày nghỉ được hưởng lương' đếm ngày P (nghỉ
        // sửa xe / bảo dưỡng định kỳ theo chế độ); cột 7 'Số ngày nghỉ phép'
        // đếm ngày N (nghỉ tai nạn / nghỉ việc gia đình có phép).
        if (day.symbol === 'P') nghiHuongLuong += 1;
        if (day.symbol === 'N') nghiPhep += 1;
      }
      return { monthRow, driver, byDay, don, kep, quayDau, nghiHuongLuong, nghiPhep };
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
        <div className="ts-month-picker">
          <button className="btn btn--ghost btn--icon btn--sm" onClick={goPrev} aria-label="Tháng trước">
            <ChevronLeft size={16} />
          </button>
          <span className="ts-period">{`Tháng ${String(month).padStart(2, '0')}/${year}`}</span>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={goNext} aria-label="Tháng sau">
            <ChevronRight size={16} />
          </button>
        </div>
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
                {/* SIL-774 — cột 6/7 của mẫu 10 cột khách: cột 6 đếm ngày P,
                    cột 7 đếm ngày N. */}
                <th scope="col">Số ngày nghỉ được hưởng lương</th>
                <th scope="col">Số ngày nghỉ phép</th>
                {/* SIL-775 — cột 10: Tổng lệnh kẹp / Tổng số chuyến × 100%,
                    với Tổng số chuyến = Đ + K + Q (mỗi ngày Q tính 1). */}
                <th scope="col">Tỷ lệ kẹp ghép / ngày (%)</th>
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
                  {/* SIL-775 — Tổng số chuyến = Đ + K + Q (ngày), không còn
                      dùng salary.trips (Q nặng 2 cho LƯƠNG, không cho cột này). */}
                  <td className="num" data-label="Tổng số chuyến">{row.don + row.kep + row.quayDau}</td>
                  <td className="num" data-label="Số ngày công">{row.monthRow.salary.workdays}</td>
                  <td className="num" data-label="Số ngày nghỉ được hưởng lương">{row.nghiHuongLuong}</td>
                  <td className="num" data-label="Số ngày nghỉ phép">{row.nghiPhep}</td>
                  <td className="num" data-label="Tỷ lệ kẹp ghép / ngày (%)">
                    {row.don + row.kep + row.quayDau === 0
                      ? '—'
                      : `${Math.round((row.kep / (row.don + row.kep + row.quayDau)) * 1000) / 10}%`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={8}>Tổng lệnh kẹp/ngày</th>
                {perDay.map(day => (
                  <td key={day.dayNumber} className="num ts-report__cell">{day.kep === 0 ? '' : day.kep}</td>
                ))}
                <td colSpan={8} />
              </tr>
              <tr>
                <th scope="row" colSpan={8}>Tỷ lệ %</th>
                {perDay.map(day => (
                  <td key={day.dayNumber} className="num ts-report__cell">{day.pct === null ? '' : `${day.pct}%`}</td>
                ))}
                <td colSpan={8} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
