import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import { DatePanel } from './DateTimePickerPanels';
import { formatISODate } from '../../lib/format';
import './DateRangePopover.css';

/**
 * DateRangePopover (card 20260926_50): one dual-calendar date-range trigger
 * replacing the two separate Từ/Đến inputs. Trigger reads
 * 'DD/MM/YYYY - DD/MM/YYYY'; the portal popover holds two Monday-first
 * DatePanels (Từ | Đến) with cross-clamping, optional in-popover preset
 * pills, and Xóa/Xong footer actions. Flat chrome — border + surface.
 */

export interface DateRangeValue {
  /** Inclusive ISO 'YYYY-MM-DD'; '' = unset. */
  from: string;
  to: string;
}

export interface DateRangePreset {
  id: string;
  label: string;
  /** Evaluated on click so relative ranges stay today-anchored. */
  range: () => DateRangeValue;
}

interface DateRangePopoverProps {
  id: string;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Quick pills rendered at the top of the open popover. */
  presets?: DateRangePreset[];
  ariaLabel: string;
  placeholder?: string;
  /** Trigger density — `sm` is the 32px toolbar height. */
  size?: 'sm' | 'md';
  className?: string;
}

function side(iso: string): string {
  return iso ? formatISODate(iso) : 'DD/MM/YYYY';
}

export function DateRangePopover({
  id,
  value,
  onChange,
  presets,
  ariaLabel,
  placeholder = 'DD/MM/YYYY - DD/MM/YYYY',
  size = 'md',
  className = '',
}: DateRangePopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panelRef, triggerRef, true, 520, 500);
  const close = useCallback(() => setIsOpen(false), []);
  useClickOutside(panelRef, close, { escapeKey: true, additionalRefs: [triggerRef] });

  const pickFrom = (date: string) => {
    onChange({ from: date, to: value.to && value.to < date ? '' : value.to });
  };
  const pickTo = (date: string) => {
    onChange({ from: value.from && date < value.from ? date : value.from, to: date });
  };

  const label = value.from || value.to ? `${side(value.from)} - ${side(value.to)}` : placeholder;
  const rootClass = ['date-range', className].filter(Boolean);

  const panel = isOpen ? (
    <div
      ref={panelRef}
      className="date-range__popover"
      style={{ top: position?.top ?? 12, left: position?.left ?? 12 }}
      data-component="date-range-popover"
      data-range-from={value.from}
      data-range-to={value.to}
      role="dialog"
      aria-label={ariaLabel}
    >
      <header className="date-range__head">
        <strong>Chọn khoảng ngày</strong>
        <button type="button" className="date-range__close" onClick={close} aria-label="Đóng lịch khoảng ngày">
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      {presets && presets.length > 0 && (
        <div className="date-range__presets" role="group" aria-label="Khoảng ngày nhanh">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="date-range__preset"
              data-preset-id={preset.id}
              aria-pressed={value.from === preset.range().from && value.to === preset.range().to}
              onClick={() => onChange(preset.range())}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="date-range__panels">
        <section className="date-range__panel" data-side="from">
          <h4>Từ</h4>
          <DatePanel value={value.from} max={value.to || undefined} onChange={pickFrom} />
        </section>
        <section className="date-range__panel" data-side="to">
          <h4>Đến</h4>
          <DatePanel value={value.to} min={value.from || undefined} onChange={pickTo} />
        </section>
      </div>
      <footer className="date-range__foot">
        <button type="button" className="date-range__clear" onClick={() => onChange({ from: '', to: '' })}>
          Xóa
        </button>
        <button type="button" className="date-range__done" onClick={close}>
          Xong
        </button>
      </footer>
    </div>
  ) : null;

  return (
    <div className={rootClass.join(' ')} data-component="date-range">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`date-range__trigger date-range__trigger--${size}${isOpen ? ' date-range__trigger--open' : ''}`}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <CalendarDays size={14} aria-hidden="true" />
        <span className={value.from || value.to ? 'date-range__label' : 'date-range__label date-range__label--placeholder'}>
          {label}
        </span>
        <ChevronDown size={14} className="date-range__chevron" aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </div>
  );
}
