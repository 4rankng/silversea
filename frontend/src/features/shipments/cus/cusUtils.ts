import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  FileLock2,
  Truck,
} from 'lucide-react';
import {
  ShipmentDocumentCustody,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { ApiError } from '../../../lib/api';
import { formatDateTimeShort } from '../../../lib/format';

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

export function directionLabel(direction: ShipmentCusWorkspaceListItem['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
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
    return `${item.operational.totalContainers.toLocaleString('vi-VN')} cont`;
  }
  if (item.packageCount != null) {
    return `${item.packageCount.toLocaleString('vi-VN')} ${item.packageType || 'kiện'}`;
  }
  return '—';
}

export function scheduleTimestamp(item: ShipmentCusWorkspaceListItem): string | null {
  return item.direction === 'IMPORT' ? item.plannedReturnAt : item.closingAt;
}

export function scheduleTime(item: ShipmentCusWorkspaceListItem): string {
  const value = scheduleTimestamp(item);
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * One display line per per-container appointment group:
 * "09:00 25/08/2026 · Sunrise · 1x40HC" — the time, date, effective factory
 * (SILVER L1), and container-type mix of every container sharing that
 * (local date, factory) group in the lot.
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
    ? `${Number(day)}/${Number(month)}/${year}`
    : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
  return `${time} ${formattedLocalDate}`;
}

/** Factory segment of a group line; empty string when the factory is unknown. */
export function appointmentGroupFactorySegment(factoryName: string | null): string {
  const trimmed = factoryName?.trim();
  return trimmed ? ` · ${trimmed}` : '';
}

export function vehicleReadinessLabel(item: ShipmentCusWorkspaceListItem): string {
  const { totalContainers, plateAssignedContainers, vehicleReadiness } = item.operational;
  if (vehicleReadiness === 'READY') return 'Đã phân xe';
  if (vehicleReadiness === 'NO_CONTAINERS') return 'Không áp dụng điều xe';
  const waiting = Math.max(0, totalContainers - plateAssignedContainers);
  if (waiting >= totalContainers) return 'Toàn bộ chưa phân xe';
  return `${waiting.toLocaleString('vi-VN')} cont chưa phân xe`;
}

export function noteLines(note: string | null | undefined): string[] {
  return (note ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
}

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
  declarationNumber: string;
  // Existing declaration identity — needed because the PUT endpoint replaces
  // the whole row, so the modal must resend issuedAt/scope/note verbatim.
  declarationId: number | null;
  declarationIssuedAt: string | null;
  declarationScope: 'SINGLE' | 'SHARED' | null;
  declarationNote: string | null;
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  shippingLineName: string;
  packageCount: string;
  packageType: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
}

export function quickEditTitle(field: ShipmentQuickEditDraft['field']): string {
  const labels: Record<ShipmentQuickEditDraft['field'], string> = {
    identity: 'Khách hàng & nhà máy',
    documents: 'Chứng từ',
    classification: 'Phân loại & hãng tàu',
    cargo: 'Tổng quan hàng hóa',
    schedule: 'Lịch trình',
    notes: 'Ghi chú',
  };
  return `Chỉnh sửa ${labels[field]}`;
}

export function dispatchStatusLabel(status: ShipmentCusWorkspaceContainerLine['dispatchStatus']): string {
  if (status === 'PLANNED') return 'Đã phân xe';
  if (status === 'CREATED') return 'Đã tạo chuyến';
  if (status === 'IN_TRANSIT') return 'Đang chạy';
  if (status === 'COMPLETED') return 'Hoàn thành';
  return 'Chưa điều xe';
}

export function accountingConfirmationLabel(
  confirmation: ShipmentCusWorkspaceListItem['accountingConfirmation'],
): string {
  if (confirmation.status === 'CONFIRMED') {
    return `Đã xác nhận: ${formatDateTimeShort(confirmation.confirmedAt)}`;
  }
  if (confirmation.status === 'STALE') return 'Cần xác nhận lại';
  if (confirmation.status === 'UNAVAILABLE') return 'Chưa đủ dữ liệu xác nhận';
  return 'Chờ xác nhận';
}

export function safeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

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
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
    signals.push({ key: 'carrier', label: `Thiếu nhà xe ${item.operational.missingCarrierContainers} cont`, tone: 'warning', icon: Truck });
  } else if (item.operational.vehicleReadiness === 'WAITING_PLATE') {
    signals.push({ key: 'plate', label: `Thiếu BKS ${item.operational.missingPlateContainers} cont`, tone: 'warning', icon: Truck });
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
      ? 'Chờ Kế toán'
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

export function derivePrimaryShipmentSignal(item: ShipmentCusWorkspaceListItem): ShipmentSignal | null {
  return deriveShipmentSignals(item).reduce<ShipmentSignal | null>((primary, signal) => {
    if (!primary) return signal;
    return SHIPMENT_SIGNAL_TONE_PRIORITY[signal.tone] < SHIPMENT_SIGNAL_TONE_PRIORITY[primary.tone]
      ? signal
      : primary;
  }, null);
}
