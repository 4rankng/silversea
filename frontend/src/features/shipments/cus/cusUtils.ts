import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  FileLock2,
  Truck,
} from 'lucide-react';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  TripStatus,
  localDateInBusinessZone,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { ApiError } from '../../../lib/api';
import { formatISODate, formatDateTimeShort, formatNumber } from '../../../lib/format';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

export function formatQuantity(value: string | null, maximumFractionDigits = 2): string {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(amount)
    : value;
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN');
}

// Date/datetime rendering kept local: these intentionally differ from
// lib/format helpers (midnight-normalized dates; raw echo on invalid input)
// to keep the CUS workspace's visible output stable.

export function directionLabel(
  direction: ShipmentCusWorkspaceListItem['direction'],
  cargoMode?: ShipmentCusWorkspaceListItem['cargoMode'],
): string {
  // Card 261022213755c (TiepVu 22/10-2): hàng lẻ đọc "Nhập lẻ"/"Xuất lẻ"
  // ngay trên badge direction — lô lẻ phân biệt rõ với cont trong cùng một
  // pill, không thêm chrome thứ hai (owner ruling: classification là thông
  // tin, không phải control).
  if (direction === 'IMPORT') return cargoMode === 'LCL' ? 'Nhập lẻ' : 'Nhập';
  if (direction === 'EXPORT') return cargoMode === 'LCL' ? 'Xuất lẻ' : 'Xuất';
  return '—';
}

// Customer-facing cargo-mode terminology. Wire values stay FCL/LCL; only the
// visible label uses the approved Vietnamese short form.
export function cargoModeLabel(cargoMode: ShipmentCusWorkspaceListItem['cargoMode']): string {
  if (cargoMode === 'FCL') return 'Cont';
  if (cargoMode === 'LCL') return 'Lẻ';
  return '—';
}

export function worksheetQuantity(item: ShipmentCusWorkspaceListItem): string {
  if (item.operational.totalContainers > 0) {
    return `${formatNumber(item.operational.totalContainers)} cont`;
  }
  if (item.packageCount != null) {
    return `${formatNumber(item.packageCount)} ${item.packageType || 'kiện'}`;
  }
  return '—';
}

export function scheduleTimestamp(item: ShipmentCusWorkspaceListItem): string | null {
  // SIL-586 (salvage agy2): the lot-level cross-fallback (closingAt ↔
  // plannedReturnAt) and the transportDate day fallback are LCL-only laws
  // (r2). FCL keeps the original strict read — the direction's own instant
  // only — because an FCL lot schedules per-container appointments and its
  // date-level EDD is never a lot schedule.
  if (item.cargoMode !== 'LCL') {
    return item.direction === 'IMPORT' ? item.plannedReturnAt : item.closingAt;
  }
  const preferred = item.direction === 'IMPORT'
    ? (item.plannedReturnAt ?? item.closingAt)
    : (item.closingAt ?? item.plannedReturnAt);
  if (preferred) return preferred;
  // SIL-610 (id 713): a legacy date-only lot may still own one real time —
  // the instant the BE derives from the lot's own live trip ("Giờ chạy").
  // Ride it before the bare day so the cell renders "HH:mm DD/MM/YYYY" like
  // SIL-587 lots; the date-only day below stays the last resort (SIL-586 law:
  // never fabricate a 00:00).
  if (item.derivedScheduleAt) return item.derivedScheduleAt;
  if (item.transportDate) return item.transportDate;
  return null;
}

export function scheduleTime(item: ShipmentCusWorkspaceListItem): string {
  const value = scheduleTimestamp(item);
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * Datetime head of a per-container appointment group, in the canonical shape
 * (card 20260921_23): "09:00 25/08/2026" — padded time-first 24h + padded
 * date. Since SIL-603 (id 706) the workboard renders the group's factory and
 * container summary as their OWN lines beneath this head — the old
 * "09:00 25/08/2026 · Sunrise · 1x40HC" one-line packing is what an ellipsis
 * cut into "… · NEWEB…" (SIL-515 wrap law).
 */
export function formatAppointmentGroupLine(at: string, localDate?: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const vietnamParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const time = `${vietnamParts.find((part) => part.type === 'hour')?.value ?? '—'}:${vietnamParts.find((part) => part.type === 'minute')?.value ?? '—'}`;
  const [year, month, day] = (localDate ?? '').split('-');
  const formattedLocalDate = year && month && day
    ? `${day}/${month}/${year}`
    : formatISODate(at);
  return `${time} ${formattedLocalDate}`;
}

export function vehicleReadinessLabel(item: ShipmentCusWorkspaceListItem): string {
  const { totalContainers, plateAssignedContainers, vehicleReadiness } = item.operational;
  if (vehicleReadiness === 'READY') return 'Đã điều xe';
  if (vehicleReadiness === 'NO_CONTAINERS') return 'Không áp dụng điều xe';
  const waiting = Math.max(0, totalContainers - plateAssignedContainers);
  if (waiting >= totalContainers) return 'Toàn bộ chờ phân xe';
  return `${formatNumber(waiting)} cont chờ phân xe`;
}

/**
 * Empty day-filter copy for the cargo cell (card 191026181942 — wording hàng
 * lẻ; SIL-504 26/10 owner ruling — ngắn gọn): the sentence must name the
 * lot's own cargo object. A container lot misses cont; an LCL lot has no cont
 * at all — its missing object is hàng lẻ, named in a one-line label so the
 * cell never wraps the old three-line sentence ("…chạy ngày đã / chọn" đọc
 * thành "chọn ngay đã chọn").
 */
export function emptyDayCargoLabel(cargoMode: ShipmentCusWorkspaceListItem['cargoMode']): string {
  return cargoMode === 'LCL'
    ? 'Chưa chọn hàng lẻ'
    : 'Không có cont chạy ngày đã chọn';
}

export function noteLines(note: string | null | undefined): string[] {
  return (note ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
}

/* Vietnamese letters span Latin-1 Supplement → Latin Extended Additional, so
   these ranges see "XƯỚNG", "Đ", and "gửi" alike. */
const HAS_UPPERCASE = /[A-ZÀ-Ỹ]/;
const ALL_UPPERCASE = /^[A-ZÀ-Ỹ0-9\s.,;:!?()\-–—/&+%'"…]+$/;

/**
 * Notes are prose, not code: a note typed or imported in ALL CAPS (no
 * lowercase letter anywhere) reads as shouting next to mixed-case neighbor
 * cells, so render it in sentence case. Mixed-case values pass through
 * untouched — only the author's own casing is ever preserved.
 */
export function displayNote(note: string | null | undefined): string {
  const value = (note ?? '').trim();
  if (!HAS_UPPERCASE.test(value) || !ALL_UPPERCASE.test(value)) return value;
  const sentence = value.toLocaleLowerCase('vi');
  // Capitalize the first letter and letters after sentence breakers.
  return sentence.replace(/(^\p{L})|([.!?]\s+\p{L})/gu, (match) => match.toLocaleUpperCase('vi'));
}

/** One editable tờ khai row of the documents quick-edit (card 20260921_3).
 * Existing rows PUT the whole row, so passthrough metadata rides along. */
export interface ShipmentQuickEditDraft {
  shipmentId: number;
  field: 'identity' | 'documents' | 'classification' | 'cargo' | 'schedule' | 'notes';
  date: string;
  time: string;
  customerNote: string;
  operationalNote: string;
  factoryName: string;
  blNumber: string;
  bookingRef: string;
  // SIL-521: no lot-level declaration list on the draft — tờ khai is
  // per-cont only (Tổng quan ledger cells + drawer DeclarationCell).
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  shippingLineName: string;
  packageCount: string;
  packageType: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
}

/** FB-086 R29 remainder (steer 21/10): the Sửa-lô picker on the lot detail
 *  lists these same groups, so the labels live here — one source for the
 *  picker buttons and the modal title. */
export const QUICK_EDIT_GROUP_LABELS: Record<ShipmentQuickEditDraft['field'], string> = {
  identity: 'Khách hàng & nhà máy',
  documents: 'Chứng từ',
  classification: 'Phân loại & hãng tàu',
  cargo: 'Tổng quan hàng hóa',
  schedule: 'Lịch trình',
  notes: 'Ghi chú',
};

export function quickEditTitle(field: ShipmentQuickEditDraft['field']): string {
  return `Chỉnh sửa ${QUICK_EDIT_GROUP_LABELS[field]}`;
}

/** Container dispatch chip vocabulary (customer decision 2026-09-08, revised
 * the same evening): "Đã tạo chuyến" while a CREATED trip still misses its
 * ngày đóng/trả; "Chờ phân xe" once the date is set (or nothing scheduled)
 * but no vehicle is on the line; "Đã điều xe" once a vehicle is allocated —
 * the same plate the Phân xe column shows; "Đang chạy"/"Hoàn thành" follow
 * the trip. */
export function dispatchStatusLabel(status: ShipmentCusWorkspaceContainerLine['dispatchStatus']): string {
  if (status === 'CREATED') return 'Đã tạo chuyến';
  if (status === 'PLANNED') return 'Đã điều xe';
  if (status === 'IN_TRANSIT') return 'Đang chạy';
  if (status === 'COMPLETED') return 'Hoàn thành';
  return 'Chờ phân xe';
}

/**
 * SIL-592 (id 692) — the CUS staff-close gate for external-carrier trips.
 * External drivers never use the app, so dispatch/CUS close their trips on the
 * driver's behalf (`POST /trips/:id/complete-external`). Backend law
 * (trip-status-machine): staff close admits CREATED and IN_TRANSIT — an
 * external trip never enters IN_TRANSIT on its own. OWN-fleet trips close
 * through the driver app; terminal states never re-close. And a trip that ran
 * must carry its biển số (trip-external-close, card 20261004_359): the
 * deferred-plate row shows no affordance until "Phân xe lại" fills the plate,
 * so the button never dead-ends at the server's 409. SIL-592 retest 30/10
 * added the departure half: the close refuses while the trip's planned
 * departure date (VN wall clock, assertCompletionNotBeforeDeparture card
 * 061026221826) is still in the future, so a future-dated row must hide the
 * affordance the same way the plate-less row does — no dead button. Null
 * departureDate (legacy rows) leaves the gate to the server, mirroring the
 * server's own skip. The row wire's plateNumber is the fulfillment's planned
 * plate — written in the same issue/reassign command as the trip's external
 * plate, so it is the faithful precondition signal. Accepts the flat row or
 * the container line.
 */
export function canCompleteExternalTrip(trip: {
  tripId?: number | null;
  tripStatus?: TripStatus | null;
  carrierType?: 'OWN' | 'EXTERNAL' | null;
  plateNumber?: string | null;
  tripDepartureDate?: string | null;
}): boolean {
  if (!(trip.tripId != null
    && trip.carrierType === 'EXTERNAL'
    && (trip.tripStatus === TripStatus.CREATED || trip.tripStatus === TripStatus.IN_TRANSIT)
    && (trip.plateNumber?.trim().length ?? 0) > 0)) {
    return false;
  }
  const departureDate = trip.tripDepartureDate?.slice(0, 10);
  if (!departureDate) return true;
  const today = localDateInBusinessZone(new Date());
  if (!today) return true;
  return departureDate <= today;
}

export function accountingConfirmationLabel(
  confirmation: ShipmentCusWorkspaceListItem['accountingConfirmation'],
): string {
  if (confirmation.status === 'CONFIRMED') {
    return `Đã đối soát: ${formatDateTimeShort(confirmation.confirmedAt)}`;
  }
  if (confirmation.status === 'STALE') return 'Cần đối soát lại';
  if (confirmation.status === 'UNAVAILABLE') return 'Chưa đủ dữ liệu đối soát';
  return 'Chưa đối soát';
}

export function safeError(error: unknown, fallback: string): string {
  // An Error with an empty/whitespace message would render an empty alert
  // banner; fall back to the default message whenever text is missing.
  const message = error instanceof ApiError || error instanceof Error ? error.message : '';
  return message.trim() ? message : fallback;
}

/** StatusStrip color per CUS bucket (workboard rows + drawer swatch). */
export const SHIPMENT_BUCKET_COLORS: Record<ShipmentCusBucket, string> = {
  [ShipmentCusBucket.NEW]: 'var(--ink-3)',
  [ShipmentCusBucket.RUNNING]: 'var(--accent)',
  [ShipmentCusBucket.PENDING_LOCK]: 'var(--warning)',
  [ShipmentCusBucket.LOCKED]: 'var(--slate-4)',
};

/**
 * Split a joined container summary ("1x40HC + 1x20DC") into one line per
 * container type — the customer-requested layout for the "Tổng quan hàng hóa"
 * column when one book/bill carries mixed container types. Mirrors the
 * dispatch master-plan's formatContainerSummaryLines splitter.
 */
export function splitContainerSummaryLines(summary: string | null | undefined): string[] {
  if (!summary) return [];
  return summary
    .split(/\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface ContainerLineDraft {
  carrierKey: string;
  newCarrierName: string;
  plateNumber: string;
  containerTypeId: string;
  routeId: string;
  liftSiteId: string;
  dropoffSiteId: string;
  customerAppointmentAt: string;
}

export function toLocalDateTime(value: string | null): string {
  // Draft base must be Vietnam wall-clock, never the browser's: the popover
  // prefills from this value and the save path (localDateTimeToIso) persists
  // naive +07:00, so a GMT+8 host must not shift the base draft — that made
  // rows spuriously dirty, prefilled the popover an hour off, and fed the
  // −1h preview bug.
  return formatVietnamDateTimeInput(value);
}

export function lineDraft(line: ShipmentCusWorkspaceContainerLine): ContainerLineDraft {
  return {
    carrierKey: line.carrierType === 'OWN'
      ? 'OWN'
      : line.externalCarrierId ? `EXTERNAL:${line.externalCarrierId}` : '',
    newCarrierName: '',
    plateNumber: line.plateNumber ?? '',
    containerTypeId: line.containerTypeId ? String(line.containerTypeId) : '',
    routeId: line.routeId ? String(line.routeId) : '',
    liftSiteId: line.liftSiteId ? String(line.liftSiteId) : '',
    dropoffSiteId: line.dropoffSiteId ? String(line.dropoffSiteId) : '',
    customerAppointmentAt: toLocalDateTime(line.customerAppointmentAt),
  };
}

export function lineOperationalSignature(line: ShipmentCusWorkspaceContainerLine): string {
  return JSON.stringify([
    line.containerTypeId,
    line.routeId,
    line.carrierType,
    line.externalCarrierId,
    line.externalCarrierVehicleId,
    line.plateNumber,
    line.liftSiteId,
    line.dropoffSiteId,
    line.customerAppointmentAt,
  ]);
}

export function idempotencySignature(...parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => (part == null ? '' : String(part))).join(':');
}

export type ShipmentSignalTone = 'danger' | 'warning' | 'info';

export interface ShipmentSignal {
  key: string;
  label: string;
  tone: ShipmentSignalTone;
  icon: typeof AlertTriangle;
}

export function deriveShipmentSignals(item: ShipmentCusWorkspaceListItem): ShipmentSignal[] {
  const signals: ShipmentSignal[] = [];
  if (item.operational.scheduleReadiness === 'WAITING_DATE') {
    signals.push({ key: 'schedule', label: 'Chờ chốt lịch', tone: 'warning', icon: CalendarClock });
  } else if (item.operational.scheduleReadiness === 'OVERDUE') {
    signals.push({ key: 'schedule-overdue', label: 'Lịch đã quá hạn', tone: 'danger', icon: CalendarClock });
  }
  if (item.operational.vehicleReadiness === 'WAITING_CARRIER') {
    // Card 191026181942 (mute applicable-but-missing): the missing counts walk
    // CONTAINER rows only, so a containerless LCL lot reads 0 while its
    // lot-level allocation is still open — "Thiếu nhà xe 0 cont" was a red
    // false alarm. A zero count means the lot-level case: one muted pending
    // label instead of a counted warning.
    signals.push(item.operational.missingCarrierContainers === 0
      ? { key: 'carrier', label: 'Chưa phân xe', tone: 'info', icon: Truck }
      : { key: 'carrier', label: `Thiếu nhà xe ${item.operational.missingCarrierContainers} cont`, tone: 'warning', icon: Truck });
  } else if (item.operational.vehicleReadiness === 'WAITING_PLATE') {
    signals.push(item.operational.missingPlateContainers === 0
      ? { key: 'plate', label: 'Chưa phân xe', tone: 'info', icon: Truck }
      : { key: 'plate', label: `Thiếu BKS ${item.operational.missingPlateContainers} cont`, tone: 'warning', icon: Truck });
  }
  if (item.finance.isLoss) {
    signals.push({ key: 'loss', label: 'Lỗ', tone: 'danger', icon: AlertTriangle });
  }
  if (item.finance.hasPendingRecovery) {
    signals.push({ key: 'recovery', label: 'Chờ thu hồi', tone: 'warning', icon: CircleDollarSign });
  }
  if (item.documentCustody.status === ShipmentDocumentCustody.OPS_HOLDING) {
    signals.push({ key: 'custody', label: 'Phơi phiếu', tone: 'warning', icon: FileLock2 });
  }
  if (item.accountingConfirmation.status === 'STALE') {
    signals.push({ key: 'confirmation', label: 'Xác nhận hết hạn', tone: 'warning', icon: AlertTriangle });
  }
  if (item.action.kind === 'CONFIRM_FINANCE' && !item.debitNote.available) {
    signals.push({ key: 'debit-note', label: 'Chưa có Debit Note', tone: 'info', icon: FileLock2 });
  }
  if (!item.action.enabled && item.action.kind !== 'NONE' && !signals.some((signal) => signal.key === 'confirmation' || signal.key === 'debit-note')) {
    const label = item.action.kind === 'LOCK'
      ? 'Chờ đối soát'
      : item.action.kind === 'CONFIRM_FINANCE'
        ? 'Chưa thể xác nhận'
        : 'Chưa thể điều chỉnh';
    signals.push({ key: 'blocked-action', label, tone: 'info', icon: FileLock2 });
  }
  return signals;
}

const SHIPMENT_SIGNAL_TONE_PRIORITY: Record<ShipmentSignalTone, number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

export function derivePrimaryShipmentSignal(item: ShipmentCusWorkspaceListItem, displayedKeys: readonly string[] = []): ShipmentSignal | null {
  return deriveShipmentSignals(item).filter((signal) => !displayedKeys.includes(signal.key)).reduce<ShipmentSignal | null>((primary, signal) => {
    if (!primary) return signal;
    return SHIPMENT_SIGNAL_TONE_PRIORITY[signal.tone] < SHIPMENT_SIGNAL_TONE_PRIORITY[primary.tone]
      ? signal
      : primary;
  }, null);
}
