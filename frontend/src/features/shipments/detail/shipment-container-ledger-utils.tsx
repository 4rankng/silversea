import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

export function directionLabel(direction: ShipmentCusContainerFlatRow['direction'], isLotLevel = false): string {
  // Card 261022213755c: a lot-level row IS an LCL lot (container-less), so
  // its direction reads "Nhập lẻ"/"Xuất lẻ" — lẻ vs cont reads apart at a
  // glance in the same direction cell.
  if (direction === 'IMPORT') return isLotLevel ? 'Nhập lẻ' : 'Nhập';
  if (direction === 'EXPORT') return isLotLevel ? 'Xuất lẻ' : 'Xuất';
  return 'Chưa xác định';
}

export function formatScheduleTime(row: ShipmentCusContainerFlatRow): string | null {
  const value = row.customerAppointmentAt;
  const input = formatVietnamDateTimeInput(value);
  return input ? input.slice(11, 16) : null;
}

export function fallback(value: string | null, label: string) {
  return value || <span className="shipment-container-ledger__missing">{label}</span>;
}
