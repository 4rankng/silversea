// FB-104 (card 141026230810) — Báo cáo "TỔNG HỢP XẾP LỆNH THÁNG" theo mẫu
// Excel khách đang dùng: mỗi dòng một lái xe (STT · Loại xe · Biển kiểm soát ·
// Hình thức lương · Lái xe) với lưới ký hiệu theo ngày, 2 dòng chỉ số toàn đội
// xe ("Tổng lệnh kẹp/ngày" + "% Tỷ lệ kẹp ghép trong ngày") phía TRÊN dòng tiêu
// đề ngày (SIL-781), và 10 cột tổng hợp ở cuối dòng.
//
// Quy ước màu theo spec REV 2 Phần V (SIL-781, id 904) + SIL-774 (Bảng 4,
// khách chốt 09/11/2026): K chữ đậm, Đ thường, Q chữ xanh, L chữ cam,
// P nền trắng chữ đen in hoa, N NỀN ĐỎ chữ trắng, lái xe nghỉ việc (INACTIVE)
// cả chuỗi ngày nền đỏ đậm, cột Chủ nhật nền vàng dọc cột. Màu lấy từ token
// nhà (info/warning/danger/surface) thay vì màu thô của Excel — cùng họ màu
// emerald mà owner đã chốt, đủ tương phản AA.
//
// SIL-775 (khách chốt 09/11/2026): cột tổng đếm MỖI NGÀY Q = 1 chuyến quay
// đầu (không còn Q = 2 của card 230790 ở cột này); Tổng số chuyến = Đ + K + Q
// (ngày); Tỷ lệ kẹp ghép / ngày = Tổng lệnh kẹp / Tổng số chuyến × 100%.

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

/** SIL-781 — per-symbol spec class; the Sunday tint and the quit chain ride
 *  on top as separate cell classes (cellClassName below). */
function symbolCellClass(symbol: TimesheetSymbol | null): string {
  switch (symbol) {
    case 'K': return 'ts-report__sym--k';
    case 'Q': return 'ts-report__sym--q';
    case 'L': return 'ts-report__sym--l';
    case 'P': return 'ts-report__cell--p';
    case 'N': return 'ts-report__cell--n';
    default: return '';
  }
}

/** SIL-781 — calendar Sunday test for the report's day columns, shared by the
 *  two header stat rows, the day-number row and the vertical yellow column. */
function isSundayDay(year: number, month: number, dayNumber: number): boolean {
  return new Date(Date.UTC(year, month - 1, dayNumber)).getUTCDay() === 0;
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
      // SIL-781 — the 10 end-of-month columns. Đ/K/Q counted per CELL;
      // SIL-775 — "Số chuyến quay đầu" đếm 1 chuyến cho mỗi ngày Q.
      let donCells = 0;
      let kepCells = 0;
      let quayDau = 0;
      let actualDays = 0;
      let paidLeaveDays = 0;
      let leaveDays = 0;
      let sundayDays = 0;
      for (const day of monthRow.days) {
        if (day.symbol === 'Đ') donCells += 1;
        if (day.symbol === 'K') kepCells += 1;
        if (day.symbol === 'Q') quayDau += 1;
        // Ngày công đi làm thực tế: có mặt (K/Q/Đ/L), Chủ nhật không tính
        // (house law: Chủ nhật không là ngày công) và nghỉ phép không tính.
        const present = day.symbol === 'K' || day.symbol === 'Q' || day.symbol === 'Đ' || day.symbol === 'L';
        if (present && !day.isSunday) actualDays += 1;
        if (present && day.isSunday) sundayDays += 1;
        // SIL-774 — cột 6 'Số ngày nghỉ được hưởng lương' đếm ngày P (nghỉ
        // sửa xe / bảo dưỡng định kỳ theo chế độ); cột 7 'Số ngày nghỉ phép'
        // đếm ngày N (nghỉ tai nạn / nghỉ việc gia đình có phép).
        if (day.symbol === 'P') paidLeaveDays += 1;
        if (day.symbol === 'N') leaveDays += 1;
      }
      // SIL-775 — Tổng số chuyến = Đ + K + Q (ngày); Tỷ lệ kẹp ghép / ngày =
      // Tổng lệnh kẹp / Tổng số chuyến × 100, in "—" khi lái xe chưa chạy
      // lệnh nào.
      const totalTrips = donCells + kepCells + quayDau;
      const kepPct = totalTrips === 0 ? null : Math.round((kepCells / totalTrips) * 1000) / 10;
      return {
        monthRow,
        driver,
        byDay,
        donCells,
        kepCells,
        quayDau,
        totalTrips,
        actualDays,
        paidLeaveDays,
        leaveDays,
        sundayDays,
        kepPct,
        quit: driver?.status === 'INACTIVE',
      };
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
          // SIL-802 — chữ Q của legend PHẢI xanh dương ở CẢ hai trang:
          // ts-report__sym--q chỉ scoped bên trong .ts-report (bảng), còn
          // .ts-legend đứng NGOÀI bảng nên span không bao giờ nhận màu — chữ
          // Q của legend rơi mực mặc định, đúng lớp lỗi (b) của ticket.
          <span key={symbol} className={symbolCellClass(symbol)}>
            <b className={symbol === 'Q' ? 'ts-legend-sym--q' : undefined}>{symbol}</b> {TIMESHEET_SYMBOL_RULES[symbol].label} ({TIMESHEET_SYMBOL_RULES[symbol].trips} chuyến)
          </span>
        ))}
        <span className="ts-report__cell--sunday">Chủ nhật — nền vàng, ghi chuyến, không tính ngày công</span>
        <span className="ts-report__cell--quit">Đã nghỉ việc — cả chuỗi ngày nền đỏ đậm</span>
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
              {/* SIL-781 — 2 dòng chỉ số toàn đội xe NGAY PHÍA TRÊN dòng tiêu
                  đề ngày (spec REV 2 Phần V). Cột Chủ nhật giữ nền vàng dọc
                  cả hai dòng chỉ số. */}
              <tr>
                <th scope="row" colSpan={5}>Tổng lệnh kẹp/ngày</th>
                {dayNumbers.map(dayNumber => {
                  const sunday = isSundayDay(year, month, dayNumber);
                  const kep = perDay.find(day => day.dayNumber === dayNumber)?.kep ?? 0;
                  return <td key={dayNumber} className={`num ts-report__cell${sunday ? ' ts-report__cell--sunday' : ''}`}>{kep === 0 ? '' : kep}</td>;
                })}
                <td colSpan={10} aria-hidden="true" />
              </tr>
              <tr>
                <th scope="row" colSpan={5}>% Tỷ lệ kẹp ghép trong ngày</th>
                {dayNumbers.map(dayNumber => {
                  const sunday = isSundayDay(year, month, dayNumber);
                  const pct = perDay.find(day => day.dayNumber === dayNumber)?.pct ?? null;
                  return <td key={dayNumber} className={`num ts-report__cell${sunday ? ' ts-report__cell--sunday' : ''}`}>{pct === null ? '' : `${pct}%`}</td>;
                })}
                <td colSpan={10} aria-hidden="true" />
              </tr>
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
                {/* SIL-781 — 10 cột tổng hợp cuối bảng; tên cột 6/7/10 theo
                    mẫu 10 cột khách (SIL-774/775). */}
                <th scope="col">Tổng lệnh đơn</th>
                <th scope="col">Tổng lệnh kẹp</th>
                <th scope="col">Số chuyến quay đầu</th>
                <th scope="col">Tổng số chuyến</th>
                <th scope="col">Ngày công thực tế</th>
                <th scope="col">Số ngày nghỉ được hưởng lương</th>
                <th scope="col">Số ngày nghỉ phép</th>
                <th scope="col">Ngày làm CN</th>
                <th scope="col">Tổng ngày công</th>
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
                  <td data-label="Lái xe">{row.monthRow.driverName}{row.quit && <small className="ts-report__quit-note"> · Đã nghỉ việc</small>}</td>
                  {dayNumbers.map(dayNumber => {
                    const day = row.byDay.get(dayNumber);
                    const symbol = day?.symbol ?? null;
                    // SIL-781 — ký hiệu theo spec + tint Chủ nhật + chuỗi đỏ
                    // đậm của lái xe đã nghỉ việc (đè mọi ký hiệu còn sót).
                    const classes = [symbolCellClass(symbol)];
                    if (day?.isSunday) classes.push('ts-report__cell--sunday');
                    if (row.quit) classes.push('ts-report__cell--quit');
                    return (
                      <td key={dayNumber} className={`ts-report__cell ${classes.filter(Boolean).join(' ')}`} data-label={`Ngày ${dayNumber}`}>
                        {symbol ?? ''}
                      </td>
                    );
                  })}
                  <td className="num" data-label="Tổng lệnh đơn">{row.donCells}</td>
                  <td className="num" data-label="Tổng lệnh kẹp">{row.kepCells}</td>
                  <td className="num" data-label="Số chuyến quay đầu">{row.quayDau}</td>
                  <td className="num" data-label="Tổng số chuyến">{row.totalTrips}</td>
                  <td className="num" data-label="Ngày công thực tế">{row.actualDays}</td>
                  <td className="num" data-label="Số ngày nghỉ được hưởng lương">{row.paidLeaveDays}</td>
                  <td className="num" data-label="Số ngày nghỉ phép">{row.leaveDays}</td>
                  <td className="num" data-label="Ngày làm CN">{row.sundayDays}</td>
                  <td className="num" data-label="Tổng ngày công">{row.monthRow.salary.workdays}</td>
                  <td className="num" data-label="Tỷ lệ kẹp ghép / ngày (%)">{row.kepPct === null ? '—' : `${row.kepPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
