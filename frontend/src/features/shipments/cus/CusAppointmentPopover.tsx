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
import { DatePanel, TimePanel } from '../../../design-system/forms/DateTimePickerPanels';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { DATE_TIME_24_PLACEHOLDER, useBufferedDateTimeValue } from '../../../design-system';

export interface CusAppointmentPopoverProps {
  value: string | null | undefined;
  containerLabel: string;
  isOpen: boolean;
  onClose: () => void;
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
  onChange,
  onCommit,
  idPrefix = 'cus-apt',
  triggerRef,
  portal,
}: CusAppointmentPopoverProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const committing = useRef(false);
  const session = useRef(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  useClickOutside(panelRef, () => setPanelOpen(false), { escapeKey: true, enabled: panelOpen, additionalRefs: [pickerTriggerRef] });
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useFocusTrap(popoverRef, isOpen);
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

  // Sync state whenever opened or value changes
  useEffect(() => {
    if (isOpen) {
      setSaveError('');
      const parts = parseDateTimeParts(value);
      setDate(parts.date || getOffsetDateString(0));
      setTime(parts.time || '08:00');
    }
  }, [isOpen, value]);

  // Combined 24h text input (see the input block below): the draft date+time
  // state rehydrates it on pills/presets, and a complete "HH:mm DD/MM/YYYY"
  // entry splits back into the draft state AND emits the recomposed naive
  // value — same wire shape the old native inputs produced. Incomplete
  // typing never fires.
  const buffered = useBufferedDateTimeValue({
    value: date && time ? `${date}T${time}` : '',
    onChange: (next) => {
      if (committing.current) return;
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
  });

  // Viewport-aware positioning relative to trigger
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef?.current;
    if (!trigger) return;

    const updatePosition = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const popoverEl = popoverRef.current;
      const popoverWidth = popoverEl?.offsetWidth || 275;
      const popoverHeight = popoverEl?.offsetHeight || 280;
      const gap = 4;
      const padding = 12;

      const vh = window.innerHeight || 900;
      const vw = window.innerWidth || 1440;

      const spaceBelow = vh - triggerRect.bottom - gap - padding;
      const spaceAbove = triggerRect.top - gap - padding;

      let top: number;
      if (popoverHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        top = triggerRect.bottom + gap;
      } else {
        top = triggerRect.top - gap - popoverHeight;
      }
      top = Math.max(padding, Math.min(top, vh - padding - popoverHeight));

      let left = triggerRect.right - popoverWidth;
      left = Math.max(padding, Math.min(left, vw - padding - popoverWidth));

      setCoords({ top: Math.round(top), left: Math.round(left) });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;

  const updateDateTime = (newDate: string, newTime: string) => {
    if (committing.current) return;
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
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
        onClick={(e) => {
          e.stopPropagation();
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
                <div ref={panelRef} className="dtp-popover cus-appointment-dtp" role="dialog" aria-label="Chọn ngày giờ">
                  <DatePanel value={date} onChange={(d) => updateDateTime(d, time || '08:00')} />
                  <TimePanel value={time} onPick={(t) => { updateDateTime(date || getOffsetDateString(0), t); setPanelOpen(false); }} />
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
            disabled={saving}
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
