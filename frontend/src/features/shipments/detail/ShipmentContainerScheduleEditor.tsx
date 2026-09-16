// Schedule-mode body of the shipment-container inline editor — the
// appointment-popover design language (7ad16f89): the popover header, the
// quick-day pills, the giờ-first paired grid, and the common-hours presets.
// Split out of ShipmentContainerLedger.tsx (structure-guard ratchet);
// appointment state (ngày + giờ) stays owned by the parent InlineEditor,
// which passes values and setters down.
import { Clock, X } from 'lucide-react';
import { useState } from 'react';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { BufferedUuiDateInput } from '../../../design-system';
import { TimeInput } from '../../../design-system/forms/TimeInput';

/** Common appointment hours offered as one-tap shortcuts in the schedule editor. */
const SCHEDULE_TIME_PRESETS = ['08:00', '10:00', '13:30', '16:00'];

/** Quick-date shortcuts mirror the customer appointment popover's Hôm nay / Ngày mai / Ngày kia row. */
const SCHEDULE_QUICK_DAYS = [
  { label: 'Hôm nay', offsetDays: 0 },
  { label: 'Ngày mai', offsetDays: 1 },
  { label: 'Ngày kia', offsetDays: 2 },
] as const;

function getOffsetDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ScheduleEditorBodyProps {
  /** The container row being scheduled — drives the direction-aware labels. */
  row: ShipmentCusContainerFlatRow;
  appointmentDate: string;
  scheduleTime: string;
  saving: boolean;
  /** Mirrors line.permissions.customerAppointmentEditable. */
  canEdit: boolean;
  onAppointmentDateChange: (value: string) => void;
  onScheduleTimeChange: (value: string) => void;
  onClose: () => void;
  /** Lot cargo mode — non-FCL rows additionally carry the lot-level
   *  transport date (shipments.expectedDeliveryDate), which no appointment
   *  field can set (FCL derives its transport date from the container
   *  appointments, so FCL rows offer only the appointment fields). */
  cargoMode?: 'FCL' | 'LCL' | null;
  /** Current lot transport date (yyyy-mm-dd) — empty when unset. */
  transportDate?: string;
  /** Mirrors row.shipmentScheduleEditable — the lot-level schedule gate. */
  canEditTransport?: boolean;
  onTransportDateChange?: (value: string) => void;
}

/**
 * The schedule-mode popover: header + quick-day pills + the paired
 * ngày/giờ grid + common-hours presets. All mutations flow through the
 * props so the parent InlineEditor keeps owning the draft state.
 */
export function ScheduleEditorBody({
  row, appointmentDate, scheduleTime, saving, canEdit,
  onAppointmentDateChange, onScheduleTimeChange, onClose,
  cargoMode, transportDate = '', canEditTransport = false, onTransportDateChange,
}: ScheduleEditorBodyProps) {
  const [dateResetKey, setDateResetKey] = useState(0);
  return (
    <>
      <div className="shipment-container-ledger__schedule-header">
        <div className="shipment-container-ledger__schedule-title">
          <strong>Chỉnh sửa lịch trình</strong>
          <span className="shipment-container-ledger__schedule-badge">{row.containerNumber || `Container số ${row.ordinal}`}</span>
        </div>
        <button
          type="button"
          className="shipment-container-ledger__schedule-close"
          onClick={onClose}
          aria-label="Đóng bảng chỉnh sửa lịch trình"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="shipment-container-ledger__schedule-section">Chọn nhanh ngày</div>
      <div className="shipment-container-ledger__schedule-pills" role="group" aria-label="Chọn nhanh ngày">
        {SCHEDULE_QUICK_DAYS.map(({ label, offsetDays }) => {
          const quickDate = getOffsetDateString(offsetDays);
          const active = appointmentDate === quickDate;
          return (
            <button
              key={label}
              type="button"
              className={`shipment-container-ledger__schedule-pill${active ? ' is-active' : ''}`}
              disabled={saving || !canEdit}
              onClick={() => {
                setDateResetKey((key) => key + 1);
                onAppointmentDateChange(quickDate);
                if (!scheduleTime) onScheduleTimeChange('08:00');
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="shipment-container-ledger__editor-grid shipment-container-ledger__editor-grid--schedule">
        <label><span>{row.direction === 'IMPORT' ? 'Giờ trả hàng' : 'Giờ đóng hàng'}</span><TimeInput label={row.direction === 'IMPORT' ? 'Giờ trả hàng' : 'Giờ đóng hàng'} value={scheduleTime} onChange={onScheduleTimeChange} disabled={saving || !canEdit} /></label>
        <BufferedUuiDateInput key={dateResetKey} label={row.direction === 'IMPORT' ? 'Ngày trả hàng' : 'Ngày đóng hàng'} size="sm" value={appointmentDate} onChange={onAppointmentDateChange} disabled={saving || !canEdit} />
      </div>
      {cargoMode != null && cargoMode !== 'FCL' && (
        <>
          <div className="shipment-container-ledger__schedule-section">Ngày vận chuyển toàn lô</div>
          <div className="shipment-container-ledger__editor-grid">
            <label>
              <span>Ngày vận chuyển</span>
              <BufferedUuiDateInput
                size="sm"
                lang="en-GB"
                value={transportDate}
                onChange={(value) => onTransportDateChange?.(value)}
                disabled={saving || !canEditTransport}
              />
            </label>
          </div>
          <small>Ngày vận chuyển áp dụng cho cả lô hàng; lịch hẹn ở trên thuộc riêng container này.</small>
        </>
      )}
      <div className="shipment-container-ledger__schedule-section">
        <Clock size={11} aria-hidden="true" />
        Khung giờ phổ biến
      </div>
      <div className="shipment-container-ledger__schedule-times" role="group" aria-label="Khung giờ phổ biến">
        {SCHEDULE_TIME_PRESETS.map((presetTime) => (
          <button
            key={presetTime}
            type="button"
            className={`shipment-container-ledger__schedule-time-pill${scheduleTime === presetTime ? ' is-active' : ''}`}
            disabled={saving || !canEdit}
            onClick={() => {
              onScheduleTimeChange(presetTime);
              if (!appointmentDate) onAppointmentDateChange(getOffsetDateString(0));
            }}
          >
            {presetTime}
          </button>
        ))}
      </div>
    </>
  );
}
