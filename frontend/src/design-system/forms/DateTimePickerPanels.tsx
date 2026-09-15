import { useEffect, useMemo, useRef, useState } from 'react';
import { TimePickerSurface } from './TimePickerSurface';
export { TimePanel } from './TimePanel';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';
import { formatDateTime24 } from '../../lib/format';
import './DateTimePickerPanels.css';

/**
 * Shared datetime picker (card _43 + P0 rework): the appointment-popover
 * dialog design with SPLIT NGÀY/GIỜ controls — NGÀY opens the date panel,
 * GIỜ opens the compact 24h time panel; quick-day pills feed NGÀY,
 * common-slot pills feed GIỜ; Xác nhận composes both into the buffered
 * contract. Compact by contract: ≤420px tall, ≤400px wide, whole dialog
 * visible with no page scroll at 390×844 / 1280×600 / 1440×900. 24h only,
 * design tokens only, no native popup.
 */

export interface DatePanelProps {
  /** Selected date 'YYYY-MM-DD'; '' = none. */
  value: string;
  onChange: (date: string) => void;
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function offsetDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-first 6×7 matrix covering the month of (year, month0). */
function monthMatrix(year: number, month0: number): DayCell[] {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month0, 1 - lead);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === month0 });
  }
  return cells;
}

function parseIsoParts(iso: string): { y: number; m0: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m0: Number(match[2]) - 1, d: Number(match[3]) };
}

export function DatePanel({ value, onChange }: DatePanelProps) {
  const todayIso = useMemo(() => offsetDate(0), []);
  const initial = parseIsoParts(value) ?? parseIsoParts(todayIso)!;
  const [view, setView] = useState({ y: initial.y, m0: initial.m0 });

  useEffect(() => {
    const parts = parseIsoParts(value);
    if (parts) setView({ y: parts.y, m0: parts.m0 });
  }, [value]);

  const gridRef = useRef<HTMLDivElement>(null);
  const cells = monthMatrix(view.y, view.m0);

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const delta = deltas[event.key];
    if (!delta || !gridRef.current) return;
    event.preventDefault();
    const active = event.target as HTMLElement;
    const idx = Number(active.getAttribute('data-idx'));
    if (Number.isNaN(idx)) return;
    const next = Math.min(41, Math.max(0, idx + delta));
    gridRef.current.querySelector<HTMLButtonElement>(`[data-idx="${next}"]`)?.focus();
  };

  return (
    <div className="dtp-date" role="group" aria-label="Chọn ngày">
      <div className="dtp-date__head">
        <button type="button" className="dtp-nav" aria-label="Tháng trước" onClick={() => setView((v) => (v.m0 === 0 ? { y: v.y - 1, m0: 11 } : { y: v.y, m0: v.m0 - 1 }))}><ChevronLeft size={14} /></button>
        <span className="dtp-date__month">{`Tháng ${view.m0 + 1} ${view.y}`}</span>
        <button type="button" className="dtp-nav" aria-label="Tháng sau" onClick={() => setView((v) => (v.m0 === 11 ? { y: v.y + 1, m0: 0 } : { y: v.y, m0: v.m0 + 1 }))}><ChevronRight size={14} /></button>
      </div>
      <div className="dtp-weekdays" aria-hidden="true">
        {WEEKDAYS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="dtp-grid" ref={gridRef} onKeyDown={handleGridKeyDown}>
        {cells.map((cell, idx) => {
          const cellDate = parseIsoParts(cell.iso)!;
          const isSelected = cell.iso === value;
          const isToday = cell.iso === todayIso;
          return (
            <button
              key={cell.iso}
              type="button"
              data-idx={idx}
              className={`dtp-day${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${cell.inMonth ? '' : ' is-outside'}`}
              aria-pressed={isSelected}
              aria-label={`${cell.day} Tháng ${cellDate.m0 + 1} ${cellDate.y}`}
              onClick={() => onChange(cell.iso)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DateTimePickerDialogProps {
  /** Dialog title — names the field the dialog edits. */
  title: string;
  /** Current value 'YYYY-MM-DDTHH:mm' or ''. */
  value: string;
  /** Fires the complete 'YYYY-MM-DDTHH:mm' on Xác nhận. */
  onConfirm: (value: string) => void;
  onClose: () => void;
  /** KHUNG GIỜ PHỔ BIẾN slots, 24h HH:mm. Configurable per surface. */
  commonSlots?: string[];
}

const DEFAULT_SLOTS = ['08:00', '10:00', '13:30', '16:00'];

export function DateTimePickerDialog({ title, value, onConfirm, onClose, commonSlots = DEFAULT_SLOTS }: DateTimePickerDialogProps) {
  const [date, setDate] = useState(() => (value ? value.slice(0, 10) : ''));
  const [time, setTime] = useState(() => (value ? (value.split('T')[1] ?? '').slice(0, 5) : ''));
  const [panel, setPanel] = useState<'date' | 'time' | null>(null);
  const [error, setError] = useState('');
  const timeTrigger = useRef<HTMLButtonElement>(null);
  const timePanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDate(value ? value.slice(0, 10) : '');
    setTime(value ? (value.split('T')[1] ?? '').slice(0, 5) : '');
  }, [value]);

  const confirm = () => {
    if (!date || !time) {
      setError('Chọn đủ ngày và giờ trước khi xác nhận.');
      return;
    }
    onConfirm(`${date}T${time}`);
  };

  return (
    <div className="dtp-popover dtp-dialog" role="dialog" aria-label={title}
      data-escape-boundary="true"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === 'Enter') {
          event.stopPropagation();
          if (!(event.target as HTMLElement).closest('button')) {
            event.preventDefault();
            confirm();
          }
        }
      }}>
      <header className="dtp-dialog__head">
        <CalendarDays size={14} aria-hidden="true" />
        <strong className="dtp-dialog__title">{title}</strong>
        <button type="button" className="dtp-dialog__close" aria-label="Đóng" onClick={onClose}><X size={14} aria-hidden="true" /></button>
      </header>

      {/* SPLIT NGÀY/GIỜ controls (P0 rework): each opens its own panel below. */}
      <div className="dtp-dialog__split">
        <button
          type="button"
          className={`dtp-dialog__field${panel === 'date' ? ' is-open' : ''}`}
          aria-expanded={panel === 'date'}
          onClick={() => setPanel((p) => (p === 'date' ? null : 'date'))}
        >
          <Calendar size={13} aria-hidden="true" />
          <span className="dtp-dialog__field-label">NGÀY</span>
          <span className="dtp-dialog__field-value">{date ? formatDateTime24(`${date}T00:00`).slice(6) : '—'}</span>
        </button>
        <button
          type="button"
          className={`dtp-dialog__field${panel === 'time' ? ' is-open' : ''}`}
          ref={timeTrigger}
          aria-expanded={panel === 'time'}
          onClick={() => setPanel((p) => (p === 'time' ? null : 'time'))}
        >
          <Clock3 size={13} aria-hidden="true" />
          <span className="dtp-dialog__field-label">GIỜ</span>
          <span className="dtp-dialog__field-value">{time || '—'}</span>
        </button>
      </div>

      {panel === 'date' && <DatePanel value={date} onChange={(iso) => { setDate(iso); setError(''); setPanel(null); }} />}
      {panel === 'time' && <TimePickerSurface label="Chọn giờ (24h)" value={time} panelRef={timePanel} anchorRef={timeTrigger} inline
        onDismiss={() => { setPanel(null); timeTrigger.current?.focus(); }} onExit={() => setPanel(null)}
        onPick={(t) => { setTime(t); setError(''); setPanel(null); timeTrigger.current?.focus(); }} />}

      <div className="dtp-dialog__strip">
        <span className="dtp-dialog__strip-label">Nhanh</span>
        <div className="dtp-dialog__pills" role="group" aria-label="Chọn nhanh ngày">
          {[0, 1, 2].map((offset) => (
            <button key={offset} type="button" className={`dtp-pill${date === offsetDate(offset) ? ' is-active' : ''}`} onClick={() => { setDate(offsetDate(offset)); setError(''); }}>{['Hôm nay', 'Ngày mai', 'Ngày kia'][offset]}</button>
          ))}
        </div>
      </div>
      <div className="dtp-dialog__strip">
        <span className="dtp-dialog__strip-label">Khung giờ</span>
        <div className="dtp-dialog__pills" role="group" aria-label="Khung giờ phổ biến">
          {commonSlots.map((slot) => (
            <button key={slot} type="button" className={`dtp-pill${time === slot ? ' is-active' : ''}`} onClick={() => { setTime(slot); setError(''); }}>{slot}</button>
          ))}
        </div>
      </div>

      {error && <p className="dtp-dialog__error" role="alert">{error}</p>}
      <button type="button" className="dtp-dialog__confirm" onClick={confirm}>Xác nhận</button>
    </div>
  );
}
