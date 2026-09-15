import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatDateTime24, parseDateTime24 } from '../../lib/format';
import './DateTimePickerPanels.css';

/**
 * Shared datetime picker (card _43): the appointment-popover dialog design.
 * Per-field titled dialog — CHỌN NHANH NGÀY quick pills, a buffered
 * HH:mm DD/MM/YYYY text input with a calendar-grid toggle, KHUNG GIỜ PHỔ
 * BIẾN common-slot pills and an Xác nhận confirm — 24h only, design tokens
 * only, no native popup, never a bare calendar grid. One implementation for
 * every BufferedUuiDateTimeInput consumer.
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

  const monthLabel = `Tháng ${view.m0 + 1} ${view.y}`;

  return (
    <div className="dtp-date" role="group" aria-label="Chọn ngày">
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
  const [draft, setDraft] = useState<string>(() => (value ? formatDateTime24(value) : ''));
  const [error, setError] = useState('');
  const [gridOpen, setGridOpen] = useState(false);

  useEffect(() => {
    setDraft(value ? formatDateTime24(value) : '');
  }, [value]);

  const draftDate = useMemo(() => {
    const parsed = draft.trim() ? parseDateTime24(draft.trim()) : null;
    return parsed ? parsed.slice(0, 10) : '';
  }, [draft]);

  const draftTime = useMemo(() => {
    const parsed = draft.trim() ? parseDateTime24(draft.trim()) : null;
    return parsed ? parsed.slice(11, 16) : '';
  }, [draft]);

  const setDraftParts = (date: string, time: string) => {
    setDraft(formatDateTime24(`${date}T${time}`));
    setError('');
  };

  const commit = () => {
    const parsed = draft.trim() ? parseDateTime24(draft.trim()) : null;
    if (!parsed) {
      setError('Nhập ngày giờ đầy đủ theo định dạng HH:mm DD/MM/YYYY.');
      return;
    }
    onConfirm(parsed);
  };

  const quickDays = [
    { label: 'Hôm nay', iso: offsetDate(0) },
    { label: 'Ngày mai', iso: offsetDate(1) },
    { label: 'Ngày kia', iso: offsetDate(2) },
  ];

  return (
    <div className="dtp-popover dtp-popover--portal dtp-dialog" role="dialog" aria-label={title}>
      <header className="dtp-dialog__head">
        <CalendarDays size={14} aria-hidden="true" />
        <strong className="dtp-dialog__title">{title}</strong>
        <button type="button" className="dtp-dialog__close" aria-label="Đóng" onClick={onClose}><X size={14} aria-hidden="true" /></button>
      </header>
      <div className="dtp-dialog__section-label">Chọn nhanh ngày</div>
      <div className="dtp-dialog__pills" role="group" aria-label="Chọn nhanh ngày">
        {quickDays.map((day) => (
          <button key={day.iso} type="button" className={`dtp-pill${draftDate === day.iso ? ' is-active' : ''}`} onClick={() => setDraftParts(day.iso, draftTime || '08:00')}>{day.label}</button>
        ))}
      </div>
      <div className="dtp-dialog__input-row">
        <input
          className="dtp-dialog__input"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          placeholder="HH:mm DD/MM/YYYY"
          maxLength={16}
          autoComplete="off"
          aria-label={`Nhập ${title}`}
        />
        <button type="button" className="dtp-nav" aria-label="Mở lịch" aria-expanded={gridOpen} onClick={() => setGridOpen((v) => !v)}><Calendar size={14} aria-hidden="true" /></button>
      </div>
      {gridOpen && <DatePanel value={draftDate} onChange={(iso) => setDraftParts(iso, draftTime || '08:00')} />}
      <div className="dtp-dialog__section-label">Khung giờ phổ biến</div>
      <div className="dtp-dialog__pills" role="group" aria-label="Khung giờ phổ biến">
        {commonSlots.map((slot) => (
          <button key={slot} type="button" className={`dtp-pill${draftTime === slot ? ' is-active' : ''}`} onClick={() => setDraftParts(draftDate || offsetDate(0), slot)}>{slot}</button>
        ))}
      </div>
      {error && <p className="dtp-dialog__error" role="alert">{error}</p>}
      <button type="button" className="dtp-dialog__confirm" onClick={commit}>Xác nhận</button>
    </div>
  );
}
