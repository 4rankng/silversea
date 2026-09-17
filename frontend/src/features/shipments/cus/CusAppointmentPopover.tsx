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
import { getOffsetDateString, parseDateTimeParts } from './cusAppointmentUtils';
import { SplitDateTimeField } from '../../../design-system/forms/SplitDateTimeField';
import { useClickOutside } from '../../../hooks/useClickOutside';
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
  const [explicit, setExplicit] = useState(false);
  const explicitRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const committing = useRef(false);
  const session = useRef(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const lastPublishedValue = useRef(value);
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
    explicitRef.current = false;
    setExplicit(false);
    setSaving(false);
    return () => { session.current += 1; };
  }, [isOpen]);

  // Preserve partial drafts when the parent echoes a published value.
  // A new, appointment-less editor opens empty; only an explicit action
  // chooses a date/time. External server changes still replace the draft.
  useEffect(() => {
    if (!isOpen) {
      wasOpen.current = false;
      return;
    }
    const opening = !wasOpen.current;
    wasOpen.current = true;
    if (opening || value !== lastPublishedValue.current) {
      lastPublishedValue.current = value;
      setSaveError('');
      const parts = parseDateTimeParts(value);
      setDate(parts.date);
      setTime(parts.time);
    }
  }, [isOpen, value]);

  useClickOutside(popoverRef, onClose, {
    escapeKey: true,
    enabled: isOpen,
    additionalRefs: triggerRef ? [triggerRef] : [],
    ignoreSelector: '[data-time-picker-overlay], .time-picker__popup, [data-date-picker]',
  });

  const coords = usePopoverPosition(popoverRef, triggerRef, isOpen);


  if (!isOpen) return null;

  const publishDateTime = (next: string) => {
    if (committing.current) return;
    explicitRef.current = true;
    setExplicit(true);
    const [nextDate = '', nextTime = ''] = next.split('T');
    setDate(nextDate);
    setTime(nextTime.slice(0, 5));
    setSaveError('');
    lastPublishedValue.current = next;
    onChange(next);
  };

  const updateDateTime = (newDate: string, newTime: string) => {
    publishDateTime(newDate ? `${newDate}T${newTime || '08:00'}` : '');
  };

  const updateField = (next: string) => {
    if (committing.current) return;
    explicitRef.current = true;
    setExplicit(true);
    // The shared field emits '' while incomplete so forms cannot submit an old
    // timestamp. This popover also owns a parent draft that survives dismissal;
    // do not turn an abandoned partial edit into a cleared appointment there.
    const fields = popoverRef.current?.querySelectorAll<HTMLInputElement>('[data-split-datetime] input:not([type="hidden"])');
    if (!next && fields && Array.from(fields).some((input) => input.value.trim())) {
      setDate('');
      setTime('');
      setSaveError('');
      return;
    }
    publishDateTime(next);
  };

  const handleClear = () => {
    if (committing.current) return;
    publishDateTime('');
    onClose();
  };

  const commit = (confirmedValue?: string) => {
    if (committing.current) return;
    if (!value && !explicitRef.current) {
      setSaveError('Chưa chọn ngày giờ để lưu.');
      return;
    }
    const invalidInput = popoverRef.current?.querySelector<HTMLInputElement>('[data-split-datetime] input:invalid');
    if (invalidInput) {
      setSaveError('Nhập đủ giờ HH:mm và ngày DD/MM/YYYY hợp lệ.');
      invalidInput.focus();
      invalidInput.reportValidity();
      return;
    }
    const composed = confirmedValue ?? (date && time ? `${date}T${time}` : '');
    setSaveError('');
    lastPublishedValue.current = composed;
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
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    // Portalled selectors are separate keyboard layers, including their buttons.
    if ((event.target as HTMLElement).closest('[data-date-picker], [data-time-picker-overlay], .time-picker__popup')) return;
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

        <div className="cus-appointment-popover__inputs">
          <SplitDateTimeField
            id={`${idPrefix}-datetime`}
            label="Giờ hẹn đóng/trả"
            hideLabel
            value={date && time ? `${date}T${time}` : ''}
            onChange={updateField}
            onCommit={commit}
            disabled={saving}
          />
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
            onClick={() => commit()}
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
