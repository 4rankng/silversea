import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import './ForwarderTripDateRangePicker.css';

type DateRange = { dateFrom: string; dateTo: string };
type ActiveDate = 'from' | 'to';

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function displayDate(value: string): string {
  if (!value) return 'Chọn ngày';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function monthLabel(date: Date) { return `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`; }

export function ForwarderTripDateRangePicker({ dateFrom, dateTo, onChange }: DateRange & { onChange: (range: DateRange) => void }) {
  const dialogId = useId();
  const fromTriggerRef = useRef<HTMLButtonElement>(null);
  const toTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [activeDate, setActiveDate] = useState<ActiveDate>('from');
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(dateFrom ? new Date(`${dateFrom}T12:00:00`) : new Date()));
  const selected = activeDate === 'from' ? dateFrom : dateTo;
  const days = useMemo(() => {
    const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
    const length = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    return Array.from({ length: firstDay + length }, (_, index) => index < firstDay ? null : new Date(viewMonth.getFullYear(), viewMonth.getMonth(), index - firstDay + 1));
  }, [viewMonth]);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => (activeDate === 'from' ? fromTriggerRef : toTriggerRef).current?.focus({ preventScroll: true }));
  }, [activeDate]);
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 767px)').matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [close, open]);

  const trapDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href]'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const select = (value: string) => {
    if (activeDate === 'from') {
      onChange({ dateFrom: value, dateTo: dateTo && dateTo < value ? '' : dateTo });
      setActiveDate('to');
    } else {
      onChange({ dateFrom: dateFrom && dateFrom > value ? value : dateFrom, dateTo: value });
    }
  };
  const openFor = (target: ActiveDate) => {
    setActiveDate(target);
    const value = target === 'from' ? dateFrom : dateTo;
    setViewMonth(startOfMonth(value ? new Date(`${value}T12:00:00`) : new Date()));
    setOpen(true);
  };

  return (
    <div className="ftrip-date-picker">
      <div className="ftrip-date-picker__triggers" aria-label="Khoảng ngày lọc lệnh">
        <CalendarDays size={17} aria-hidden="true" />
        <button ref={fromTriggerRef} type="button" onClick={() => openFor('from')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}>
          <span>Từ ngày</span><strong>{displayDate(dateFrom)}</strong>
        </button>
        <span className="ftrip-date-picker__divider" aria-hidden="true" />
        <button ref={toTriggerRef} type="button" onClick={() => openFor('to')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined}>
          <span>Đến ngày</span><strong>{displayDate(dateTo)}</strong>
        </button>
      </div>
      {open && <>
        <button type="button" className="ftrip-date-picker__backdrop" aria-label="Đóng chọn khoảng ngày" onClick={close} />
        <section ref={dialogRef} id={dialogId} className="ftrip-date-picker__dialog" role="dialog" aria-modal="true" aria-label="Chọn khoảng ngày" onKeyDown={trapDialogFocus}>
          <header>
            <div><span>Khoảng ngày</span><strong>Chọn {activeDate === 'from' ? 'ngày bắt đầu' : 'ngày kết thúc'}</strong></div>
            <button type="button" onClick={() => onChange({ dateFrom: '', dateTo: '' })}><RotateCcw size={15} aria-hidden="true" /> Xóa</button>
          </header>
          <div className="ftrip-date-picker__range-tabs" role="group" aria-label="Phần ngày đang chọn">
            <button type="button" className={activeDate === 'from' ? 'is-active' : ''} onClick={() => setActiveDate('from')}>Từ: {displayDate(dateFrom)}</button>
            <button type="button" className={activeDate === 'to' ? 'is-active' : ''} onClick={() => setActiveDate('to')}>Đến: {displayDate(dateTo)}</button>
          </div>
          <div className="ftrip-date-picker__month"><button type="button" aria-label="Tháng trước" onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={18} /></button><strong>{monthLabel(viewMonth)}</strong><button type="button" aria-label="Tháng sau" onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={18} /></button></div>
          <div className="ftrip-date-picker__weekdays">{['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="ftrip-date-picker__days">{days.map((date, index) => date ? <button key={isoDate(date)} type="button" className={`${selected === isoDate(date) ? 'is-selected' : ''}${dateFrom && dateTo && isoDate(date) >= dateFrom && isoDate(date) <= dateTo ? ' is-in-range' : ''}`} onClick={() => select(isoDate(date))}>{date.getDate()}</button> : <span key={`blank-${index}`} />)}</div>
          <footer><button type="button" className="btn btn--primary" onClick={close}>Áp dụng khoảng ngày</button></footer>
        </section>
      </>}
    </div>
  );
}
