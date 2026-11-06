// Schedule-mode body of the shipment-container inline editor — the
// appointment-popover design language (7ad16f89): the popover header, the
// quick-day pills, the giờ-first paired grid, and the common-hours presets.
// Split out of ShipmentContainerLedger.tsx (structure-guard ratchet);
// appointment state (ngày + giờ) stays owned by the parent InlineEditor,
// which passes values and setters down.
import { Clock, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { BufferedUuiDateInput } from '../../../design-system';
import { TimeInput } from '../../../design-system/forms/TimeInput';
import { CopyCodeButton } from '../../../components/trip/CopyCodeButton';
import { businessDateOffsetISO, formatDateTime24 } from '../../../lib/format';

/** Common appointment hours offered as one-tap shortcuts in the schedule editor. */
const SCHEDULE_TIME_PRESETS = ['08:00', '10:00', '13:30', '16:00'];

/** Quick-date shortcuts mirror the customer appointment popover's Hôm nay / Ngày mai / Ngày kia row. */
const SCHEDULE_QUICK_DAYS = [
  { label: 'Hôm nay', offsetDays: 0 },
  { label: 'Ngày mai', offsetDays: 1 },
  { label: 'Ngày kia', offsetDays: 2 },
] as const;

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
  // SIL-251 (FB-009): the draft's canonical 'DD/MM/YYYY HH:mm' — '' until
  // both halves parse (formatDateTime24 returns '' for a malformed draft),
  // which gates the copy affordance below.
  const copyValue = formatDateTime24(`${appointmentDate}T${scheduleTime}`);
  // SIL-608 (id 711, owner 30/10): NGÀY leads the pair, GIỜ closes it — the
  // VN order every datetime field now runs. The FB-030/075 no-stuck law
  // survives REVERSED: a completed năm hands focus to the giờ box (the same
  // hand-off SplitDateTimeField runs from its date half to its time half),
  // so "gõ đủ ngày" still lands the caret where the next digit belongs.
  const scheduleTimeFieldRef = useRef<HTMLLabelElement>(null);
  return (
    <>
      <div className="shipment-container-ledger__schedule-header">
        <div className="shipment-container-ledger__schedule-title">
          <strong>Chỉnh sửa lịch trình</strong>
          <span className="shipment-container-ledger__schedule-badge">{row.containerNumber || `Container số ${row.ordinal}`}</span>
          {/* SIL-251 (FB-009, ticket 131026233500 / QA fail 06/11): the
              schedule popover is the "dialog giờ / dialog ngày" the card
              named — it carries the same copy-time affordance the combined
              picker got (CopyCodeButton, house pattern): one tap writes the
              canonical 'DD/MM/YYYY HH:mm' of the DRAFT (quick-day pills and
              presets included), and the icon flips to a check for 1.6s. It
              only exists once both halves parse — a half-picked draft has no
              time to copy, the same FB-009 law the picker surface runs. */}
          {copyValue && (
            <CopyCodeButton
              className="shipment-container-ledger__schedule-copy"
              value={copyValue}
              label="giờ hẹn trong hộp thoại"
            />
          )}
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
          const quickDate = businessDateOffsetISO(offsetDays);
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
        <BufferedUuiDateInput key={dateResetKey} label={row.direction === 'IMPORT' ? 'Ngày trả hàng' : 'Ngày đóng hàng'} size="sm" value={appointmentDate} onChange={onAppointmentDateChange} disabled={saving || !canEdit} onComplete={() => { scheduleTimeFieldRef.current?.querySelector<HTMLInputElement>('input')?.focus(); }} />
        <label ref={scheduleTimeFieldRef}><span>{row.direction === 'IMPORT' ? 'Giờ trả hàng' : 'Giờ đóng hàng'}</span><TimeInput label={row.direction === 'IMPORT' ? 'Giờ trả hàng' : 'Giờ đóng hàng'} value={scheduleTime} onChange={onScheduleTimeChange} disabled={saving || !canEdit} /></label>
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
              if (!appointmentDate) onAppointmentDateChange(businessDateOffsetISO(0));
            }}
          >
            {presetTime}
          </button>
        ))}
      </div>
    </>
  );
}
