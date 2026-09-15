import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Clock, X } from 'lucide-react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { parseDateTime24 } from '../../../lib/format';
import { getOffsetDateString, parseDateTimeParts } from './cusAppointmentUtils';
import { DateTimePickerDialog } from '../../../design-system/forms/DateTimePickerPanels';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { DATE_TIME_24_PLACEHOLDER, useBufferedDateTimeValue } from '../../../design-system';
import { usePopoverPosition } from '../../../hooks/usePopoverPosition';

export interface CusAppointmentPopoverProps {
  value: string | null | undefined;
  containerLabel: string;
  isOpen: boolean;
  onClose: () => void;
  /** _34: dismissal without commit — the owner reverts the draft part so
   *  Escape/outside never leak the abandoned value into the next open. */
  onCancel?: () => void;
  onChange: (val: string) => void;
  /** Called on confirmation or Enter — should validate and persist the value. Return false
   *  to keep the popover open (e.g. validation failure). */
  onCommit?: (val: string) => Promise<boolean> | boolean | void;
  idPrefix?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  portal?: boolean;
}

export function CusAppointmentPopover({
  value,
  containerLabel,
  isOpen,
  onClose,
  onCancel,
  onChange,
  onCommit,
  idPrefix = 'cus-apt',
  triggerRef,
  portal,
}: CusAppointmentPopoverProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  // _15 ruling: a pick must be EXPLICIT — pills/typing/panel-confirm mark it;
  // opening an appointment-less popover marks nothing by itself.
  const [explicit, setExplicit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const committing = useRef(false);
  const session = useRef(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const closePanel = () => { setPanelOpen(false); pickerTriggerRef.current?.focus(); };
  useClickOutside(panelRef, closePanel, { escapeKey: true, enabled: panelOpen, additionalRefs: [pickerTriggerRef], ignoreSelector: '[data-time-picker-overlay]' });
  useFocusTrap(popoverRef, isOpen);
  useFocusTrap(panelRef, panelOpen);
  const panelCoords = usePopoverPosition(panelRef, pickerTriggerRef, panelOpen, 396, 200);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef?.current ?? document.activeElement as HTMLElement | null;
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [isOpen, triggerRef]);

  // A request may finish after this editor is dismissed and opened again.
  // Its result must never close or unlock a newer editing session.
  useLayoutEffect(() => {
    session.current += 1;
    committing.current = false;
    setSaving(false);
    return () => { session.current += 1; };
  }, [isOpen]);

  // Sync state whenever opened or value changes. No seed: an appointment-less
  // container opens EMPTY — a fabricated "08:00 hôm nay" display let a bare
  // Enter/Xác nhận commit a slot the user never picked (_15 ruling: never
  // silently commit an unchosen value; the pills remain explicit quick-picks).
  useEffect(() => {
    if (isOpen) {
      setSaveError('');
      const parts = parseDateTimeParts(value);
      setDate(parts.date);
      setTime(parts.time);
    }
  }, [isOpen, value]);

  // Explicit-pick tracking resets only on the OPEN edge — the [isOpen, value]
  // effect above re-runs mid-edit whenever a pick round-trips through the
  // parent, and resetting there would un-mark a just-made choice.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) setExplicit(false);
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Combined 24h text input (see the input block below): the draft date+time
  // state rehydrates it on pills/presets, and a complete "HH:mm DD/MM/YYYY"
  // entry splits back into the draft state AND emits the recomposed naive
  // value — same wire shape the old native inputs produced. Incomplete
  // typing never fires.
  const buffered = useBufferedDateTimeValue({
    value: date && time ? `${date}T${time}` : '',
    onChange: (next) => {
      if (committing.current) return;
      setExplicit(true);
      const [nextDate, nextTime] = next ? next.split('T') : ['', ''];
      setDate(nextDate);
      setTime(nextTime.slice(0, 5));
      onChange(next);
    },
  });

  useClickOutside(popoverRef, onClose, {
    escapeKey: true,
    enabled: isOpen,
    additionalRefs: triggerRef ? [triggerRef] : [],
    ignoreSelector: '[data-time-picker-overlay]',
  });

  const coords = usePopoverPosition(popoverRef, triggerRef, isOpen);


  if (!isOpen) return null;

  const updateDateTime = (newDate: string, newTime: string) => {
    if (committing.current) return;
    setExplicit(true);
    setDate(newDate);
    setTime(newTime);
    if (newDate) {
      onChange(`${newDate}T${newTime || '08:00'}`);
    } else {
      onChange('');
    }
  };

  const handleClear = () => {
    if (committing.current) return;
    setDate('');
    setTime('');
    onChange('');
    onClose();
  };

  const commit = () => {
    if (committing.current) return;
    // _15 ruling: an appointment-less popover with no explicit pick must not
    // silently save a fabricated slot — guide instead of committing.
    if (!value && !explicit) {
      setSaveError('Chưa chọn ngày giờ để lưu.');
      return;
    }
    const input = popoverRef.current?.querySelector<HTMLInputElement>('.cus-appointment-input');
    const raw = input?.value.trim() ?? '';
    const composed = raw ? parseDateTime24(raw) : '';
    if (composed === null) {
      setSaveError('Nhập ngày giờ đầy đủ theo định dạng HH:mm DD/MM/YYYY.');
      input?.focus();
      return;
    }
    setSaveError('');
    onChange(composed);
    // _34: a missing commit path is a configuration error — surface it in
    // the popover instead of silently closing as if the save happened.
    if (!onCommit) { setSaveError('Không thể lưu: phiên chỉnh sửa không còn đường lưu.'); return; }
    const saveSession = session.current;
    committing.current = true;
    setSaving(true);
    const save = async () => {
      try {
        const ok = await onCommit(composed);
        if (session.current === saveSession && ok !== false) onClose();
      } catch {
        if (session.current === saveSession) setSaveError('Chưa lưu được giờ hẹn. Vui lòng thử lại.');
      } finally {
        if (session.current === saveSession) {
          committing.current = false;
          setSaving(false);
        }
      }
    };
    void save();
  };

  const dismissWithoutCommit = () => {
    onCancel?.();
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissWithoutCommit();
    } else if (event.key === 'Enter') {
      event.stopPropagation();
      // Buttons retain native keyboard activation (including date/time presets).
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      commit();
    }
  };

  const todayStr = getOffsetDateString(0);
  const tomorrowStr = getOffsetDateString(1);
  const dayAfterStr = getOffsetDateString(2);

  const shouldPortal = portal ?? Boolean(triggerRef);

  const popoverElement = (
    <>
      <div
        className="cus-appointment-backdrop"
        style={coords ? { zIndex: 1040 } : undefined}
        data-escape-boundary="true"
        onClick={(e) => {
          e.stopPropagation();
          // Outside-click KEEPS the draft part (the explicit save commits it);
          // only the Escape key reverts (see dismissWithoutCommit).
          onClose();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        data-escape-boundary="true"
        className="cus-appointment-popover"
        style={coords ? {
          position: 'fixed',
          top: `${coords.top}px`,
          left: `${coords.left}px`,
          right: 'auto',
          bottom: 'auto',
          zIndex: 1050,
        } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`Chọn giờ hẹn đóng/trả cho container ${containerLabel}`}
        onKeyDown={handleKeyDown}
        aria-busy={saving}
      >
        <div className="cus-appointment-popover__header">
          <div className="cus-appointment-popover__title">
            <Calendar size={14} aria-hidden="true" />
            <strong>Giờ hẹn đóng/trả</strong>
          </div>
          <span className="cus-appointment-popover__badge">{containerLabel}</span>
          <button
            type="button"
            className="cus-appointment-popover__close"
            onClick={onClose}
            aria-label="Đóng bảng chọn ngày giờ"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Quick Date Shortcuts */}
        <div className="cus-appointment-popover__section-label">Chọn nhanh ngày</div>
        <div className="cus-appointment-popover__pills" role="group" aria-label="Phím tắt ngày">
          <button
            type="button"
            className={`cus-quick-pill${date === todayStr ? ' is-active' : ''}`}
            disabled={saving}
            onClick={() => updateDateTime(todayStr, time || '08:00')}
          >
            Hôm nay
          </button>
          <button
            type="button"
            className={`cus-quick-pill${date === tomorrowStr ? ' is-active' : ''}`}
            disabled={saving}
            onClick={() => updateDateTime(tomorrowStr, time || '08:00')}
          >
            Ngày mai
          </button>
          <button
            type="button"
            className={`cus-quick-pill${date === dayAfterStr ? ' is-active' : ''}`}
            disabled={saving}
            onClick={() => updateDateTime(dayAfterStr, time || '08:00')}
          >
            Ngày kia
          </button>
        </div>

        {/* Keep the visible value in 24h format; the clipped native input only opens the picker. */}
        <div className="cus-appointment-popover__inputs">
          <div className="cus-appointment-input-wrap">
            <label htmlFor={`${idPrefix}-datetime`}>Ngày giờ</label>
            <div className="cus-appointment-input-row">
              <input
                ref={buffered.ref}
                id={`${idPrefix}-datetime`}
                type="text"
                inputMode="numeric"
                className="cus-appointment-input"
                disabled={saving}
                placeholder={DATE_TIME_24_PLACEHOLDER}
                maxLength={16}
                autoComplete="off"
                defaultValue={buffered.defaultValue}
                onChange={buffered.onChange}
                onBlur={buffered.onBlur}
              />
              <button
                type="button"
                ref={pickerTriggerRef}
                className="cus-appointment-picker-btn"
                aria-label="Chọn ngày giờ từ lịch"
                aria-haspopup="dialog"
                aria-expanded={panelOpen}
                disabled={saving}
                title="Mở lịch chọn ngày giờ"
                onClick={() => setPanelOpen((v) => !v)}
              >
                <Calendar size={14} aria-hidden="true" />
              </button>
              {panelOpen && (
                <div ref={panelRef} className="dtp-dialog-host cus-appointment-dtp" style={{ top: panelCoords?.top ?? 12, left: panelCoords?.left ?? 12 }}>
                  <DateTimePickerDialog
                    title={`Giờ hẹn đóng/trả — ${containerLabel}`}
                    value={date && time ? `${date}T${time}` : ''}
                    onConfirm={(composed) => {
                      const [d = '', t = ''] = composed.split('T');
                      updateDateTime(d, t);
                      setPanelOpen(false);
                    }}
                    onClose={closePanel}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Time Shortcuts */}
        <div className="cus-appointment-popover__section-label">
          <Clock size={11} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
          Khung giờ phổ biến
        </div>
        <div className="cus-appointment-popover__times" role="group" aria-label="Phím tắt giờ">
          {['08:00', '10:00', '13:30', '16:00'].map((presetTime) => (
            <button
              key={presetTime}
              type="button"
              className={`cus-time-pill${time === presetTime ? ' is-active' : ''}`}
              disabled={saving}
            onClick={() => updateDateTime(date || todayStr, presetTime)}
            >
              {presetTime}
            </button>
          ))}
        </div>

        {saveError && <p className="cus-appointment-popover__error" role="alert">{saveError}</p>}
        {/* Touch and keyboard share the same commit path. */}
        <div className="cus-appointment-popover__footer">
          {value ? (
            <button
              type="button"
              className="cus-appointment-popover__clear"
              disabled={saving}
              onClick={handleClear}
              title="Xóa giờ hẹn đã chọn"
            >
              Xóa hẹn
            </button>
          ) : <span />}
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || (!value && !explicit)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={commit}
          >
            {saving ? 'Đang lưu…' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </>
  );

  if (shouldPortal && typeof document !== 'undefined') {
    return createPortal(popoverElement, document.body);
  }
  return popoverElement;
}
