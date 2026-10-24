/**
 * Pure presentation logic for the demo dispatch surface (SIL-156/157/158,
 * spec 2026.10.24_Demo_layout.docx §Phân hệ 1). No React, no I/O — every
 * helper is unit-testable with fixture data and a fixed clock.
 *
 * Layout constants are the locked Gemini consult (24/10, brief demo24):
 * grid cell = 3 lines (14px medium / 12px / 12px) · row 68px py-2.5 px-3;
 * gantt = 96px per hour, block min 48px (30′), < 64px text collapses to a
 * dot + hover popover; now-line 2px error-500 with a top triangle.
 */
import type {
  DemoCustomer,
  DemoDriver,
  DemoPortFee,
  DemoTrip,
  DemoTruck,
  DemoVendor,
} from '../data/types';
import { demoCustomers, demoDrivers, demoPorts, demoTrucks, demoVendors } from '../data/seed';

/* ── Gantt geometry (consult 24/10) ─────────────────────────────────── */

export const HOUR_PX = 96;
/** 30-minute block floor → 48px. */
export const MIN_BLOCK_PX = 48;
/** Below this width a block hides its text and keeps dot/icon + popover. */
export const TEXT_BLOCK_PX = 64;
export const DAY_MINUTES = 24 * 60;

/** 'HH:mm' → phút từ 00:00. */
export function minutesFromHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export interface MinuteWindow {
  startMin: number;
  endMin: number;
}

/** Khoảng thời gian của cả chuyến: timeline đầu → cuối (đề phòng seed thiếu). */
export function tripWindow(trip: DemoTrip): MinuteWindow {
  if (trip.timeline.length === 0) return { startMin: 0, endMin: 0 };
  const starts = trip.timeline.map((b) => minutesFromHHmm(b.start));
  const ends = trip.timeline.map((b) => minutesFromHHmm(b.end));
  return { startMin: Math.min(...starts), endMin: Math.max(...ends) };
}

export interface BlockGeometry {
  leftPx: number;
  widthPx: number;
}

/** Vị trí khối trên trục giờ: phút × HOUR_PX/60, ép sàn MIN_BLOCK_PX. */
export function blockGeometry(win: MinuteWindow, hourPx = HOUR_PX): BlockGeometry {
  const raw = ((win.endMin - win.startMin) / 60) * hourPx;
  return {
    leftPx: (win.startMin / 60) * hourPx,
    widthPx: Math.max(MIN_BLOCK_PX, raw),
  };
}

/* ── Trạng thái hành trình ───────────────────────────────────────────── */

export type TripStatus = 'new' | 'assigned' | 'running' | 'done';

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  new: 'Mới tạo',
  assigned: 'Đã phân xe',
  running: 'Đang chạy',
  done: 'Hoàn thành',
};

/** Ngày làm việc 'YYYY-MM-DD' của chuyến so với "hôm nay" demo. */
function compareDate(tripDate: string, todayIso: string): number {
  return tripDate.localeCompare(todayIso);
}

/**
 * Trạng thái suy ra từ timeline + ngày:
 * - ngày trước hôm nay → Hoàn thành;
 * - ngày sau hôm nay → Mới tạo khi chưa có xe, Đã phân xe khi đã có xe;
 * - hôm nay: chưa có xe → luôn Mới tạo (chuyến chưa chạy không thể "đang
 *   chạy"/"hoàn thành" chỉ vì giờ đã trôi); có xe: trước khối đầu → Đã phân
 *   xe, giữa timeline → Đang chạy, sau khối cuối → Hoàn thành.
 */
export function deriveTripStatus(trip: DemoTrip, now: Date, todayIso: string): TripStatus {
  const hasVehicle = Boolean(trip.truckId ?? trip.vendorId);
  const cmp = compareDate(trip.date, todayIso);
  if (cmp < 0) return 'done';
  if (cmp > 0) return hasVehicle ? 'assigned' : 'new';
  if (!hasVehicle) return 'new';
  const win = tripWindow(trip);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < win.startMin) return 'assigned';
  if (nowMin <= win.endMin) return 'running';
  return 'done';
}

/* ── Tín hiệu tài chính nâng/hạ (ô 6, badge pill consult 24/10) ──────── */

export type FeeSignal = 'unc-paid' | 'unc-pending' | 'driver-cash';

export const FEE_SIGNAL_LABELS: Record<FeeSignal, string> = {
  'unc-paid': 'Đã UNC',
  'unc-pending': 'Chờ KT UNC',
  'driver-cash': 'LX Chi',
};

export function feeSignal(fee: DemoPortFee | undefined): FeeSignal | undefined {
  if (!fee) return undefined;
  if (fee.method === 'driver-cash') return 'driver-cash';
  return fee.uncStatus === 'paid' ? 'unc-paid' : 'unc-pending';
}

export function liftFee(trip: DemoTrip): DemoPortFee | undefined {
  return trip.fees.find((f) => f.kind === 'lift');
}

export function dropFee(trip: DemoTrip): DemoPortFee | undefined {
  return trip.fees.find((f) => f.kind === 'drop');
}

export function surchargeFees(trip: DemoTrip): DemoPortFee[] {
  return trip.fees.filter((f) => f.kind === 'surcharge');
}

/* ── Cảnh báo vận hành (KPI 4 + ô 4) ─────────────────────────────────── */

/** Hàng Xuất chưa cập nhật đủ thông số vỏ (số chì / trọng lượng). */
export function exportSpecMissing(trip: DemoTrip): boolean {
  return trip.flow === 'export' && !trip.containerSpec;
}

/* ── Chạy kẹp (tag KẸP ô 4) ──────────────────────────────────────────── */

/** ≥ 2 vỏ 20′ cùng booking + cùng đầu kéo → chạy kẹp. */
export function isPairedTrip(trips: readonly DemoTrip[], trip: DemoTrip): boolean {
  return trips.some(
    (other) =>
      other.id !== trip.id &&
      other.bookingNo === trip.bookingNo &&
      other.truckId != null &&
      other.truckId === trip.truckId &&
      other.size === 20 &&
      trip.size === 20,
  );
}

/* ── KPI ─────────────────────────────────────────────────────────────── */

export interface DispatchKpis {
  total: number;
  size20: number;
  size40: number;
  inhouseTrips: number;
  activeTrucks: number;
  totalTrucks: number;
  vendorTrips: number;
  specWarnings: number;
}

export function dispatchKpis(trips: readonly DemoTrip[]): DispatchKpis {
  const inhouse = trips.filter((t) => t.source === 'inhouse');
  const trucks = new Set(inhouse.map((t) => t.truckId).filter(Boolean));
  return {
    total: trips.length,
    size20: trips.filter((t) => t.size === 20).length,
    size40: trips.filter((t) => t.size === 40).length,
    inhouseTrips: inhouse.length,
    activeTrucks: trucks.size,
    totalTrucks: demoTrucks.length,
    vendorTrips: trips.length - inhouse.length,
    specWarnings: trips.filter(exportSpecMissing).length,
  };
}

/* ── Bộ lọc + tìm kiếm ──────────────────────────────────────────────── */

export interface DispatchFilters {
  customerId: string | 'all';
  flow: 'all' | 'export' | 'import';
  source: 'all' | 'inhouse' | 'vendor';
  query: string;
}

export const EMPTY_FILTERS: DispatchFilters = {
  customerId: 'all',
  flow: 'all',
  source: 'all',
  query: '',
};

/** Tìm kiếm: Số cont / Booking / Bill / BKS / mã chuyến / tên tài xế & nhà xe. */
export function filterTrips(trips: readonly DemoTrip[], f: DispatchFilters): DemoTrip[] {
  const q = f.query.trim().toLowerCase();
  return trips.filter((t) => {
    if (f.customerId !== 'all' && t.customerId !== f.customerId) return false;
    if (f.flow !== 'all' && t.flow !== f.flow) return false;
    if (f.source !== 'all' && t.source !== f.source) return false;
    if (!q) return true;
    const truck = t.truckId ? demoTrucks.find((x) => x.id === t.truckId) : undefined;
    const driver = t.driverId ? demoDrivers.find((x) => x.id === t.driverId) : undefined;
    const vendor = t.vendorId ? demoVendors.find((x) => x.id === t.vendorId) : undefined;
    return [
      t.contNo,
      t.bookingNo,
      t.billNo ?? '',
      t.code,
      truck?.plate ?? '',
      driver?.fullName ?? '',
      vendor?.name ?? '',
    ].some((field) => field.toLowerCase().includes(q));
  });
}

/* ── Copy thông tin xe (ô 1) ─────────────────────────────────────────── */

export interface VehicleInfo {
  truck?: DemoTruck;
  driver?: DemoDriver;
  vendor?: DemoVendor;
}

/**
 * Chuỗi chuẩn copy cho khách/cảng:
 * `BKS đầu kéo / BKS rơ-moóc / Họ tên tài xế / SĐT / CCCD` (xe nhà) hoặc
 * `Tên nhà xe / SĐT` (xe ngoài).
 */
export function copyVehicleText(info: VehicleInfo): string {
  if (!info.truck) {
    return [info.vendor?.name ?? '', info.vendor?.phone ?? ''].filter(Boolean).join(' / ');
  }
  return [
    info.truck.plate,
    info.truck.trailerPlate,
    info.driver?.fullName ?? '',
    info.driver?.phone ?? '',
    info.driver?.idNumber ?? '',
  ]
    .filter(Boolean)
    .join(' / ');
}

/* ── Gantt: chuyến theo đầu kéo ──────────────────────────────────────── */

export interface TruckLane {
  truck: DemoTruck;
  driver: DemoDriver | undefined;
  trips: DemoTrip[];
}

/** Trục dọc = toàn bộ đầu kéo đội xe nhà (kèm tài xế mặc định), không kể trống. */
export function truckLanes(trips: readonly DemoTrip[]): TruckLane[] {
  return demoTrucks.map((truck) => ({
    truck,
    driver: demoDrivers.find((d) => d.id === truck.defaultDriverId),
    trips: trips.filter((t) => t.truckId === truck.id),
  }));
}

export interface PackedBlock {
  trip: DemoTrip;
  /** Chỉ số sub-row trong lane (0 = trên cùng). */
  row: number;
  /** Tổng số sub-row lane này cần (≥1) — block chồng lấn được chia đều. */
  rows: number;
}

/**
 * Xếp chuyến vào sub-row để các khối chồng lấn (chạy kẹp 2 vỏ 20′ cùng giờ)
 * không che nhau: greedy interval coloring theo thời điểm bắt đầu.
 */
export function packLaneRows(trips: readonly DemoTrip[]): PackedBlock[] {
  const sorted = [...trips].sort((a, b) => {
    const wa = tripWindow(a);
    const wb = tripWindow(b);
    return wa.startMin - wb.startMin || wa.endMin - wb.endMin || a.id.localeCompare(b.id);
  });
  const rowEnds: number[] = [];
  const placed: Array<{ trip: DemoTrip; row: number }> = [];
  for (const trip of sorted) {
    const win = tripWindow(trip);
    let row = rowEnds.findIndex((end) => win.startMin >= end);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(win.endMin);
    } else {
      rowEnds[row] = win.endMin;
    }
    placed.push({ trip, row });
  }
  const rows = rowEnds.length;
  return placed.map(({ trip, row }) => ({ trip, row, rows: Math.max(rows, 1) }));
}

/* ── Tham chiếu danh mục ─────────────────────────────────────────────── */

export function customerOf(trip: DemoTrip): DemoCustomer | undefined {
  return demoCustomers.find((c) => c.id === trip.customerId);
}

export function portName(portId: string): string {
  return demoPorts.find((p) => p.id === portId)?.name ?? portId;
}

export function portCode(portId: string): string {
  return demoPorts.find((p) => p.id === portId)?.code ?? portId;
}

/* ── Thanh ngày (Hôm qua | Hôm nay | Ngày mai) ───────────────────────── */

export interface DateTab {
  key: 'yesterday' | 'today' | 'tomorrow';
  date: string;
  label: string;
}

/** Demo "hôm nay" cố định theo seed (2026-10-24) — deterministic (UTC math). */
export function dateTabs(todayIso: string): DateTab[] {
  const base = new Date(`${todayIso}T00:00:00Z`);
  const shift = (days: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return [
    { key: 'yesterday', date: shift(-1), label: 'Hôm qua' },
    { key: 'today', date: todayIso, label: 'Hôm nay' },
    { key: 'tomorrow', date: shift(1), label: 'Ngày mai' },
  ];
}

/** 'Thứ Bảy, 24/10' cho header thanh ngày. */
export function dayLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const wd = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][d.getUTCDay()];
  return `${wd}, ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Vị trí now-line (px) trên trục giờ; undefined ngoài ngày demo hôm nay. */
export function nowLinePx(now: Date, hourPx = HOUR_PX): number {
  return ((now.getHours() * 60 + now.getMinutes()) / 60) * hourPx;
}
