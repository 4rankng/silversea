import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

export function directionLabel(direction: ShipmentCusContainerFlatRow['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
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
