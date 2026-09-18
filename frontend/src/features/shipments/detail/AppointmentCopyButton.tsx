// The bulk appointment copy affordance, split out of ShipmentContainerLedger
// (structure-guard ratchet). Rendered inside the row's identity cell; the
// ledger owns nothing about it beyond the props contract below.
import { Copy } from 'lucide-react';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { appointmentCopyLabel } from './appointment-copy';

/** Props contract shared with the ledgers that render the affordance. */
export interface AppointmentCopyProps {
  /** Bulk entry: write this row's appointment to every still-empty container of
   *  the SAME lot (the write resolves the lot's authoritative container set, so
   *  rows outside the current page are included). Absent on surfaces that do
   *  not offer the affordance. */
  onCopyAppointmentToEmpty?: (source: ShipmentCusContainerFlatRow) => void;
  /** True while a copy batch is in flight — the affordance locks itself so a
   *  second click cannot start a competing batch. */
  copying?: boolean;
}

export function AppointmentCopyButton({
  row,
  copying = false,
  disabled = false,
  onCopy,
}: {
  /** The source row — the one whose appointment gets copied. */
  row: ShipmentCusContainerFlatRow;
  copying?: boolean;
  disabled?: boolean;
  onCopy?: (source: ShipmentCusContainerFlatRow) => void;
}) {
  if (!onCopy || disabled || row.customerAppointmentAt == null || !row.customerAppointmentEditable) return null;
  const label = appointmentCopyLabel(row);
  return (
    <button
      type="button"
      className="shipment-container-ledger__copy"
      onClick={() => onCopy(row)}
      disabled={copying}
      title={`Copy ${label} sang các container chưa có lịch của lô này`}
      aria-label={`Copy ngày giờ đóng trả ${label} sang các container chưa có lịch của lô này`}
    >
      <Copy size={13} aria-hidden="true" />
    </button>
  );
}
