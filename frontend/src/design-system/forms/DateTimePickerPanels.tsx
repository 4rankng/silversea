import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './DateTimePickerPanels.css';

/**
 * Shared app-styled date & time picker panels (card _39).
 *
 * Two SEPARATE panels — never a combined datetime popup — themed only with
 * design tokens. The time panel is strictly 24-hour (00:00–23:59): no AM/PM
 * anywhere, per the app-wide ruling. Panels write the canonical contracts
 * ('YYYY-MM-DD' / 'HH:mm'); composition into the buffered datetime contract
 * is the caller's job.
 */

export interface DatePanelProps {
  /** Selected date 'YYYY-MM-DD'; '' = none. */
  value: string;
  onChange: (date: string) => void;
  /** Called with the panel requests dismissal (e.g. second click on selected day). */
  onRequestClose?: () => void;
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

/** Monday-first 6×7 matrix covering the month of (year, month0). */
function monthMatrix(year: number, month0: number): DayCell[] {
  const first = new Date(year, month0, 1);
  // JS getDay(): 0=Sun..6=Sat → Monday-first offset.
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
  const todayIso = useMemo(() => {
    const now = new Date();
    return toIso(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const initial = parseIsoParts(value) ?? parseIsoParts(todayIso)!;
  const [view, setView] = useState({ y: initial.y, m0: initial.m0 });

  // Re-derive the visible month when the selected value moves to another month.
  useEffect(() => {
    const parts = parseIsoParts(value);
    if (parts) setView({ y: parts.y, m0: parts.m0 });
  }, [value]);

  const gridRef = useRef<HTMLDivElement>(null);

  const cells = monthMatrix(view.y, view.m0);

  // Roving-focus arrow navigation over the 6×7 grid (AC: arrow keys).
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

  const monthLabel = `Tháng ${view.m0 + 1} ${view.y}`;

  return (
    <div className="dtp-panel dtp-date" role="group" aria-label="Chọn ngày">
      <div className="dtp-date__head">
        <button type="button" className="dtp-nav" aria-label="Tháng trước" onClick={() => setView((v) => (v.m0 === 0 ? { y: v.y - 1, m0: 11 } : { y: v.y, m0: v.m0 - 1 }))}><ChevronLeft size={15} /></button>
        <span className="dtp-date__month">{monthLabel}</span>
        <button type="button" className="dtp-nav" aria-label="Tháng sau" onClick={() => setView((v) => (v.m0 === 11 ? { y: v.y + 1, m0: 0 } : { y: v.y, m0: v.m0 + 1 }))}><ChevronRight size={15} /></button>
      </div>
      <div className="dtp-weekdays" aria-hidden="true">
        {WEEKDAYS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="dtp-grid" ref={gridRef} onKeyDown={handleGridKeyDown}>
        {cells.map((cell, idx) => {
          const isSelected = cell.iso === value;
          const isToday = cell.iso === todayIso;
          return (
            <button
              key={cell.iso}
              type="button"
              data-idx={idx}
              className={`dtp-day${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${cell.inMonth ? '' : ' is-outside'}`}
              aria-pressed={isSelected}
              aria-label={`${cell.day} ${monthLabel}`}
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

export interface TimePanelProps {
  /** Selected time 'HH:mm'; '' = none. */
  value: string;
  /** Fires the complete 'HH:mm' when the user picks a minute (completes the time). */
  onPick: (time: string) => void;
}

export function TimePanel({ value, onPick }: TimePanelProps) {
  const [hour, currentMinute] = value ? value.split(':') : ['', ''];
  const [draftHour, setDraftHour] = useState<number | null>(hour ? Number(hour) : null);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => Array.from({ length: 12 }, (_, i) => i * 5), []);

  const pickMinute = (minute: number) => {
    const h = draftHour ?? (hour ? Number(hour) : 8);
    onPick(`${pad2(h)}:${pad2(minute)}`);
  };

  // Roving-focus arrows inside whichever pill list has focus (AC: arrow keys).
  const handleListKeyDown = (event: React.KeyboardEvent) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-col]'));
    const active = document.activeElement as HTMLButtonElement | null;
    const pos = active ? buttons.indexOf(active) : -1;
    if (pos === -1) return;
    const next = Math.min(buttons.length - 1, Math.max(0, pos + delta));
    buttons[next]?.focus();
  };

  const readout = `${pad2(draftHour ?? (hour ? Number(hour) : 8))}:${currentMinute || '00'}`;

  return (
    <div className="dtp-panel dtp-time" role="group" aria-label="Chọn giờ (24h)">
      <div className="dtp-time__readout" aria-live="polite">{readout}</div>
      <div className="dtp-time__label">Giờ</div>
      <div className="dtp-pills" role="listbox" aria-label="Giờ 00–23" onKeyDown={handleListKeyDown}>
        {hours.map((h) => (
          <button
            key={h}
            type="button"
            data-col
            role="option"
            aria-selected={(draftHour ?? (hour ? Number(hour) : null)) === h}
            className={`dtp-pill${(draftHour ?? (hour ? Number(hour) : null)) === h ? ' is-active' : ''}`}
            onClick={() => setDraftHour(h)}
          >
            {pad2(h)}
          </button>
        ))}
      </div>
      <div className="dtp-time__label">Phút</div>
      <div className="dtp-pills" role="listbox" aria-label="Phút (bước 5 phút)" onKeyDown={handleListKeyDown}>
        {minutes.map((m) => (
          <button
            key={m}
            type="button"
            data-col
            role="option"
            className="dtp-pill"
            onClick={() => pickMinute(m)}
          >
            {pad2(m)}
          </button>
        ))}
      </div>
    </div>
  );
}
