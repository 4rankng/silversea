import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusMissingField,
  ShipmentCusMissingFieldCode,
} from '@tingting/shared';
import { modeLabelForTrigger, type ShipmentDetailEditMode } from './ShipmentContainerLedger';

/** Destination editors a missing field can jump to. */
type MissingFieldDestinationMode = 'documents' | 'container' | 'route' | 'schedule' | 'vehicle';

/**
 * Each missing-field code → the ledger edit mode whose editor owns the fix,
 * so the details list doubles as jump-to-editor navigation. DECLARATION is
 * absent on purpose: tờ khai rides its own controlled document flow (the
 * documents editor's inline note), so it renders as a plain non-actionable
 * item instead of a button.
 */
const MISSING_FIELD_EDIT_MODE: Partial<Record<ShipmentCusMissingFieldCode, MissingFieldDestinationMode>> = {
  DIRECTION: 'documents',
  BILL_BOOKING: 'documents',
  SHIPPING_LINE: 'documents',
  ROUTE: 'route',
  LIFT_SITE: 'route',
  DROPOFF_SITE: 'route',
  CONTAINER_NUMBER: 'container',
  CONTAINER_TYPE: 'container',
  TRANSPORT_DATE: 'schedule',
  APPOINTMENT: 'schedule',
  CARRIER: 'vehicle',
  BKS: 'vehicle',
};

/**
 * Compact missing-fields summary for the ledger's status cell: collapsed it
 * is a single line — warning icon + "Thiếu N thông tin" disclosure button —
 * so an incomplete row keeps the workboard's compact row height instead of
 * wrapping a long label list down the narrow status column. Expanded, every
 * missing field renders as a button that opens the inline editor owning it
 * (the count on the toggle always equals the rendered list length).
 */
export function ShipmentMissingFieldsSummary({
  row,
  missingFields,
  editableModes,
  editLocked,
  onStartEdit,
}: {
  row: ShipmentCusContainerFlatRow;
  missingFields: ShipmentCusMissingField[];
  /** Whether the row may open each destination editor (per cell editability). */
  editableModes: Record<MissingFieldDestinationMode, boolean>;
  /** True while any inline edit is open or this row is saving — mirrors the
   *  cell triggers' gating so the two entry points can never fight. */
  editLocked: boolean;
  onStartEdit: (row: ShipmentCusContainerFlatRow, mode: ShipmentDetailEditMode, triggerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `shipment-detail-missing-fields-${row.id}`;
  // Card 20260922_24: a bare "Thiếu dữ liệu" contradicted the row's own status
  // ("Đã điều xe" + "Thiếu dữ liệu") and never said WHAT is missing. Name the
  // single missing field; fall back to the count (the expanded list names each)
  // when there are several, so the narrow status column stays one line.
  const summaryLabel = missingFields.length === 1
    ? `Thiếu ${missingFields[0].label}`
    : `Thiếu ${missingFields.length} thông tin`;
  return (
    <span className="shipment-container-ledger__row-warning shipment-container-ledger__missing-fields">
      <AlertTriangle aria-hidden="true" />
      <button
        type="button"
        className="shipment-container-ledger__missing-fields-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {summaryLabel}{open ? ' ▴' : ' ▾'}
      </button>
      {open && (
        <span className="shipment-container-ledger__missing-fields-list" id={listId} role="group" aria-label="Thông tin còn thiếu">
          {missingFields.map((field) => {
            const mode = MISSING_FIELD_EDIT_MODE[field.code];
            if (mode == null) {
              return (
                <span
                  key={field.code}
                  className="shipment-container-ledger__missing-fields-item shipment-container-ledger__missing-fields-item--external"
                  title="Tờ khai dùng luồng chứng từ có kiểm soát riêng"
                >
                  {field.label}
                </span>
              );
            }
            const disabled = !editableModes[mode] || editLocked;
            // The trigger id doubles as the button's own id: focus restoration
            // after the editor closes looks the trigger up by that id, so a
            // summary-opened editor must return focus here, not to <body>.
            const triggerId = `shipment-detail-missing-${field.code}-${row.id}`;
            // Buttons keep their native role — the jump-to-editor affordance
            // must announce as actionable, so no list-item role overrides.
            return (
              <button
                key={field.code}
                type="button"
                id={triggerId}
                className="shipment-container-ledger__missing-fields-item"
                disabled={disabled}
                title={disabled ? 'Ô đích hiện chỉ xem được hoặc đang soạn thay đổi khác' : `Chỉnh sửa ô ${modeLabelForTrigger(mode)}`}
                onClick={() => onStartEdit(row, mode, triggerId)}
              >
                {field.label}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
