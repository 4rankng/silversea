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
import { useClickOutside } from '../../../hooks/useClickOutside';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { DATE_TIME_24_PLACEHOLDER, useBufferedDateTimeValue } from '../../../design-system';

export interface CusAppointmentPopoverProps {
  value: string | null | undefined;
  containerLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onChange: (val: string) => void;
  idPrefix?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  portal?: boolean;
}

function parseDateTimeParts(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  // Server values are instants (…Z / ±hh:mm) — prefill as Vietnam wall-clock,
  // never the browser zone. Naive drafts from this popover's own onChange
  // ("YYYY-MM-DDTHH:mm") round-trip verbatim.
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(value)) {
    const input = formatVietnamDateTimeInput(value);
    return input ? { date: input.slice(0, 10), time: input.slice(11, 16) } : { date: '', time: '' };
  }
  const [d = '', t = ''] = value.split('T');
  return { date: d, time: t.slice(0, 5) };
}

function getOffsetDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function CusAppointmentPopover({
  value,
  containerLabel,
  isOpen,
  onClose,
  onChange,
  idPrefix = 'cus-apt',
  triggerRef,
  portal,
}: CusAppointmentPopoverProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Sync state whenever opened or value changes
  useEffect(() => {
    if (isOpen) {
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
    setDate(newDate);
    setTime(newTime);
    if (newDate) {
      onChange(`${newDate}T${newTime || '08:00'}`);
    } else {
      onChange('');
    }
  };

  const handleClear = () => {
    setDate('');
    setTime('');
    onChange('');
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onClose();
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
            onClick={() => updateDateTime(todayStr, time || '08:00')}
          >
            Hôm nay
          </button>
          <button
            type="button"
            className={`cus-quick-pill${date === tomorrowStr ? ' is-active' : ''}`}
            onClick={() => updateDateTime(tomorrowStr, time || '08:00')}
          >
            Ngày mai
          </button>
          <button
            type="button"
            className={`cus-quick-pill${date === dayAfterStr ? ' is-active' : ''}`}
            onClick={() => updateDateTime(dayAfterStr, time || '08:00')}
          >
            Ngày kia
          </button>
        </div>

        {/* Time and Date Inputs — giờ trước ngày, khớp định dạng "20:45 8/9/26" của cột bảng.
            Native time/date inputs render per browser UI locale (12h AM/PM) and element lang
            cannot override it, so this types into the same buffered 24h text input as
            /shipments/new ("HH:mm DD/MM/YYYY"); the pills below stay the fast path. */}
        <div className="cus-appointment-popover__inputs">
          <div className="cus-appointment-input-wrap">
            <label htmlFor={`${idPrefix}-datetime`}>Ngày giờ</label>
            <input
              ref={buffered.ref}
              id={`${idPrefix}-datetime`}
              type="text"
              inputMode="numeric"
              className="cus-appointment-input"
              placeholder={DATE_TIME_24_PLACEHOLDER}
              maxLength={16}
              autoComplete="off"
              defaultValue={buffered.defaultValue}
              onChange={buffered.onChange}
              onBlur={buffered.onBlur}
            />
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
              onClick={() => updateDateTime(date || todayStr, presetTime)}
            >
              {presetTime}
            </button>
          ))}
        </div>

        {/* Footer: Clear button and dismiss hint */}
        <div className="cus-appointment-popover__footer">
          {value ? (
            <button
              type="button"
              className="cus-appointment-popover__clear"
              onClick={handleClear}
              title="Xóa giờ hẹn đã chọn"
            >
              Xóa hẹn
            </button>
          ) : <span />}
          <span className="cus-appointment-popover__hint">Bấm ra ngoài để đóng</span>
        </div>
      </div>
    </>
  );

  if (shouldPortal && typeof document !== 'undefined') {
    return createPortal(popoverElement, document.body);
  }
  return popoverElement;
}
