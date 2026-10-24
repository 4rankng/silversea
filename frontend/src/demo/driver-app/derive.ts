/**
 * Driver-app derivations (SIL-162, spec §5): every display fact the phone
 * mockup shows is derived here from the SIL-155 fixtures — pure functions,
 * no React, so the unit tests pin behaviour without rendering.
 *
 * Vocabulary follows the spec: "giờ có mặt" = first timeline block, kẹp đôi
 * = two 20′ containers sharing one booking + tractor on the same day, and
 * the card's financial guidance mirrors who pays the port (UNC vs lái xe).
 */
import { formatCurrency } from '@/lib/format';
import { DEMO_TODAY, demoTrips } from '../data';
import type { DemoTrip } from '../data';

/** Ngày demo mà ứng dụng lái xe hiển thị (mặc định hôm nay của fixture). */
export const DRIVER_APP_DAY = DEMO_TODAY;

/** Format ngày 'YYYY-MM-DD' → 'Thứ bảy, 24/10/2026' (vi-VN, dài). */
export function formatDriverDay(date: string): string {
  const d = new Date(`${date}T00:00:00+07:00`);
  const wd = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
  const dm = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
  return `${wd}, ${dm}`;
}

/** Giờ có mặt tại cảng — khối timeline đầu tiên của chuyến ('HH:mm'). */
export function attendanceTime(trip: DemoTrip): string {
  return trip.timeline[0]?.start ?? '--:--';
}

/** Chuyến của một tài xế trong ngày, xếp theo giờ có mặt. */
export function driverDayTrips(driverId: string, date: string = DRIVER_APP_DAY): DemoTrip[] {
  return demoTrips
    .filter((t) => t.driverId === driverId && t.date === date)
    .sort((a, b) => attendanceTime(a).localeCompare(attendanceTime(b)));
}

/** Một điểm dừng trên lộ trình (chip). */
export interface TripStop {
  kind: 'lift' | 'factory' | 'drop';
  label: string;
}

/**
 * Lộ trình dạng chip: routeText của fixture đã là chuỗi hiển thị
 * ('Cát Lái ➔ Samsung SEHC ➔ Cát Lái') nên tách theo '➔' — chip luôn khớp
 * dữ liệu seed thay vì hệ chuỗi tên riêng. Chỉ lược 2 hậu tố logistics mà
 * badge/khung khác đã nói (xe ngoài, kẹp đôi); tên địa điểm kiểu
 * 'Nhựa Duy Tan (VSIP II)' giữ nguyên. Chuyến không trả vỏ (import giao
 * nhà máy) chỉ có 2 điểm: cảng nâng ➔ nhà máy.
 */
export function routeStops(trip: DemoTrip): TripStop[] {
  const parts = trip.routeText
    .split('➔')
    .map((s) => s.trim().replace(/\s*\((?:xe ngoài|kẹp đôi)\)$/, ''))
    .filter(Boolean);
  if (parts.length === 0) return [{ kind: 'lift', label: trip.routeText }];
  const stops: TripStop[] = [{ kind: 'lift', label: parts[0] }];
  for (const part of parts.slice(1, -1)) stops.push({ kind: 'factory', label: part });
  if (parts.length > 1) stops.push({ kind: 'drop', label: parts[parts.length - 1] });
  return stops;
}

/**
 * CHẠY KẸP: ≥ 2 chuyến cùng ngày + cùng booking + cùng đầu kéo (seed: cặp
 * 20′ T-2403/T-2404 của DRV-02). Xe ngoài không gắn đầu kéo nên không kẹp.
 */
export function isTwinLiftTrip(trip: DemoTrip, all: readonly DemoTrip[] = demoTrips): boolean {
  if (!trip.truckId || !trip.bookingNo) return false;
  return (
    all.filter((t) => t.date === trip.date && t.bookingNo === trip.bookingNo && t.truckId === trip.truckId).length > 1
  );
}

/** Tông dòng chỉ dẫn tài chính (dot màu trên thẻ lệnh). */
export type FinanceTone = 'green' | 'orange' | 'yellow';

export interface FinanceLine {
  tone: FinanceTone;
  text: string;
}

/**
 * Chỉ dẫn tài chính tại cảng cho lái xe (spec §5). Cổng vào lấy lệnh là phí
 * nâng, nên dòng đầu tiên phát từ phí nâng:
 * - unc + đã chuyển   → 🟢 "Công ty đã UNC — vào lấy lệnh"
 * - unc + chưa chuyển → 🟡 chờ kế toán
 * - driver-cash       → 🟠 "Lái xe tự chi {tổng tự chi} — HĐ về tên {đơn vị}"
 * Khi nâng do công ty UNC nhưng phụ phí/vé bãi lái xe tự chi thêm (T-2408,
 * T-2412), thêm dòng 🟠 riêng cho phần tự chi ngoài phí nâng.
 */
export function financeLines(trip: DemoTrip): FinanceLine[] {
  const lift = trip.fees.find((f) => f.kind === 'lift');
  const cashFees = trip.fees.filter((f) => f.method === 'driver-cash');
  const cashLine = (fees: typeof cashFees): FinanceLine => ({
    tone: 'orange',
    text: `Lái xe tự chi ${formatCurrency(fees.reduce((s, f) => s + f.amountVnd, 0))} — HĐ về tên ${[
      ...new Set(fees.map((f) => f.invoiceTo)),
    ].join(' / ')}`,
  });
  const lines: FinanceLine[] = [];

  if (!lift || lift.method === 'driver-cash') {
    // Nâng (nếu có) đã nằm trong nhóm tự chi — gộp tổng một dòng.
    if (cashFees.length > 0) lines.push(cashLine(cashFees));
    return lines;
  }

  lines.push(
    lift.uncStatus === 'paid'
      ? { tone: 'green', text: 'Công ty đã UNC — vào lấy lệnh' }
      : { tone: 'yellow', text: 'Chờ kế toán UNC phí nâng — chưa vào lấy lệnh được' },
  );

  const extraCash = cashFees; // phí nâng là UNC nên mọi khoản tự chi đều ngoài nâng
  if (extraCash.length > 0) {
    lines.push({
      tone: 'orange',
      text: `Tự chi phụ phí ${formatCurrency(extraCash.reduce((s, f) => s + f.amountVnd, 0))} — HĐ về tên ${[
        ...new Set(extraCash.map((f) => f.invoiceTo)),
      ].join(' / ')}`,
    });
  }
  return lines;
}

/** Giá trị 4 ô sau khi "AI OCR đọc" ảnh cửa container. */
export interface OcrFieldValues {
  contNo: string;
  sealNo: string;
  maxGrossKg: string;
  tareKg: string;
}

/**
 * Demo OCR: chuyến đã có `containerSpec` (lái xe cập nhật từ trước) đọc lại
 * đúng số liệu seed; chuyến thiếu spec (T-2404, T-2407) — đúng kịch bản
 * "chưa có số chì, chờ OCR" — điền giá trị chuẩn suy ra từ cỡ cont, số chì
 * lấy từ dãy số của contNo để deterministic cho test.
 */
export function ocrDemoValues(trip: DemoTrip): OcrFieldValues {
  const digits = (trip.contNo.match(/\d+/g) ?? ['000000']).join('');
  return {
    contNo: trip.contNo,
    sealNo: trip.containerSpec?.sealNo ?? `SL-${digits}`,
    maxGrossKg: String(trip.containerSpec?.maxGrossKg ?? (trip.size === 40 ? 32500 : 30480)),
    tareKg: String(trip.containerSpec?.tareKg ?? (trip.size === 40 ? 3900 : 2250)),
  };
}

/** Thời gian OCR mô phỏng đọc ảnh (ms) — badge "Đang đọc dữ liệu...". */
export const OCR_READ_MS = 1200;
