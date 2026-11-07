import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

export function directionLabel(direction: ShipmentCusContainerFlatRow['direction'], isLotLevel = false): string {
  // Card 261022213755c: a lot-level row IS an LCL lot (container-less), so
  // its direction reads "Nhập lẻ"/"Xuất lẻ" — lẻ vs cont reads apart at a
  // glance in the same direction cell.
  if (direction === 'IMPORT') return isLotLevel ? 'Nhập lẻ' : 'Nhập';
  if (direction === 'EXPORT') return isLotLevel ? 'Xuất lẻ' : 'Xuất';
  return isLotLevel ? 'Lẻ' : '—';
}

export function formatScheduleTime(row: ShipmentCusContainerFlatRow): string | null {
  const value = row.customerAppointmentAt;
  const input = formatVietnamDateTimeInput(value);
  return input ? input.slice(11, 16) : null;
}

/**
 * SIL-645 (id 750): the lot-level row's schedule instant, for the LỊCH TRÌNH
 * cell. The cell used to print the date-only expectedDeliveryDate and DROP
 * the lot's real giờ even though the data carried one — the exact sources
 * the Tổng quan renders (scheduleTimestamp's LCL law):
 *   1. stored closingAt / plannedReturnAt (the "Chỉnh sửa Lịch trình" dialog
 *      writes the SHIPMENT-level instants; direction-aware cross-fallback),
 *   2. derivedScheduleAt — the legacy (pre-SIL-587) lot's live-trip "Giờ
 *      chạy" instant the BE derives under the SIL-610 law.
 * Null = only the bare EDD day exists: the cell keeps the honest date-only
 * render (SIL-586 law — never fabricate a 00:00). Container rows never take
 * this path (their schedule is the per-container appointment).
 */
export function lotScheduleInstantFor(row: ShipmentCusContainerFlatRow): string | null {
  if (!row.isLotLevel) return null;
  const stored = row.direction === 'IMPORT'
    ? (row.plannedReturnAt ?? row.closingAt)
    : (row.closingAt ?? row.plannedReturnAt);
  return stored ?? row.derivedScheduleAt ?? null;
}

export function fallback(value: string | null, label: string) {
  return value || <span className="shipment-container-ledger__missing">{label}</span>;
}
