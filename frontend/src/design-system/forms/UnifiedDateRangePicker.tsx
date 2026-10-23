import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { DateRangeValue } from './DateRangeFields';
import './UnifiedDateRangePicker.css';

/**
 * UnifiedDateRangePicker — the ONE unified range picker (owner redesign
 * 23/10, spec v2 (d): "XÓA cả 3 cơ chế cũ → 1 Unified Date Range Picker").
 *
 * A single 280×36 trigger ("📅 DD/MM/YYYY – DD/MM/YYYY") opening ONE popover
 * with two panels: a vertical preset rail (Hôm nay / Tuần này / Tháng này /
 * Tháng trước / Quý này) and a dual-month range calendar. Auto-apply: a
 * preset commits immediately; the calendar commits the moment the second
 * endpoint lands (a from-only draft never fires — closing the popover
 * discards it, so the bar never shows a half range).
 *
 * This supersedes — ON THIS SURFACE ONLY — the 2026-09-27 "two separate
 * from/to fields" ruling, by the owner's later explicit decision (authority
 * order: current user decision > dated ruling). `DateRangeFields` stays the
 * primitive for every surface whose owner has not asked for the unified
 * shape; both speak the same `DateRangeValue` ISO contract, so a surface can
 * migrate between them without touching URL semantics.
 *
 * House building blocks only: `useClickOutside`/`useFocusTrap` dismissal +
 * focus law (the InlineLabelSelect trio), design tokens in the companion CSS,
 * Monday-first month grids like `DateTimePickerPanels`' DatePanel.
 */

export interface UnifiedDateRangePreset {
  id: string;
  label: string;
  /** Evaluated on demand so relative ranges stay today-anchored. */
  range: () => DateRangeValue;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const isoOfDay = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toIso(d);
};

/** Monday..Sunday of the current week (VN convention, Monday start). */
const weekBounds = (): DateRangeValue => {
  const now = new Date();
  const lead = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - lead);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: toIso(monday), to: toIso(sunday) };
};

const monthBounds = (offset: number): DateRangeValue => {
  const now = new Date();
  return {
    from: toIso(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    to: toIso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
  };
};

const quarterBounds = (): DateRangeValue => {
  const now = new Date();
  const start = Math.floor(now.getMonth() / 3) * 3;
  return {
    from: toIso(new Date(now.getFullYear(), start, 1)),
    to: toIso(new Date(now.getFullYear(), start + 3, 0)),
  };
};

/** The preset rail the quyết toán bar ships (owner spec v2 (d)). */
export const UNIFIED_RANGE_PRESETS: UnifiedDateRangePreset[] = [
  { id: 'today', label: 'Hôm nay', range: () => ({ from: isoOfDay(0), to: isoOfDay(0) }) },
  { id: 'this-week', label: 'Tuần này', range: weekBounds },
  { id: 'this-month', label: 'Tháng này', range: () => monthBounds(0) },
  { id: 'prev-month', label: 'Tháng trước', range: () => monthBounds(-1) },
  { id: 'this-quarter', label: 'Quý này', range: quarterBounds },
];

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** Monday-first 6×7 matrix covering (year, month0) — DatePanel's law. */
function monthMatrix(year: number, month0: number): DayCell[] {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month0, 1 - lead);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ iso: toIso(d), day: d.getDate(), inMonth: d.getMonth() === month0 });
  }
  return cells;
}

export function parseIsoParts(iso: string): { y: number; m0: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m0: Number(match[2]) - 1, d: Number(match[3]) };
}

const displayDate = (iso: string) => {
  const parts = parseIsoParts(iso);
  return parts ? `${pad2(parts.d)}/${pad2(parts.m0 + 1)}/${parts.y}` : '';
};

export interface UnifiedDateRangePickerProps {
  id?: string;
  /** Controlled ISO range ('' = unset). */
  value: DateRangeValue;
  /** Fires on complete range commit (preset, second calendar click, clear). */
  onChange: (value: DateRangeValue) => void;
  ariaLabel: string;
  className?: string;
}

export function UnifiedDateRangePicker({ id, value, onChange, ariaLabel, className = '' }: UnifiedDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const todayIso = useMemo(() => isoOfDay(0), []);
  // The calendar's anchor month (left panel); the right panel is anchor + 1.
  const anchorOf = (iso: string) => {
    const parts = parseIsoParts(iso);
    const now = new Date();
    return parts ? { y: parts.y, m0: parts.m0 } : { y: now.getFullYear(), m0: now.getMonth() };
  };
  const [anchor, setAnchor] = useState(() => anchorOf(value.from || value.to));
  // The pending first endpoint while the user composes a range by hand. It is
  // LOCAL: it never leaks into `value` (and the URL) until the pair completes.
  const [draftFrom, setDraftFrom] = useState<string | null>(null);

  useEffect(() => {
    if (open) setAnchor(anchorOf(value.from || value.to));
    else setDraftFrom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useClickOutside(rootRef, () => setOpen(false), { escapeKey: true, enabled: open });
  useFocusTrap(popoverRef, open);

  const shiftAnchor = (months: number) => {
    setAnchor((v) => {
      const total = v.y * 12 + v.m0 + months;
      return { y: Math.floor(total / 12), m0: ((total % 12) + 12) % 12 };
    });
  };

  const activePreset = UNIFIED_RANGE_PRESETS.find((preset) => {
    const range = preset.range();
    return value.from !== '' && range.from === value.from && range.to === value.to;
  })?.id ?? '';

  const pickDay = (iso: string) => {
    if (draftFrom == null) {
      setDraftFrom(iso);
      return;
    }
    // Second endpoint: normalize the order, commit, drop the draft.
    const from = iso < draftFrom ? iso : draftFrom;
    const to = iso < draftFrom ? draftFrom : iso;
    setDraftFrom(null);
    onChange({ from, to });
  };

  /** A preset/clear commit REPLACES the range wholesale — a pending from-only
   *  draft must never survive it (H1 review finding: day-click → preset →
   *  day-click would otherwise compose a range from the stale draft and
   *  silently commit the wrong scope on an auto-apply surface). */
  const commitRange = (range: DateRangeValue) => {
    setDraftFrom(null);
    onChange(range);
  };

  const monthTitle = (m0: number, y: number) => `Tháng ${m0 + 1} ${y}`;

  const renderMonth = (m0: number, y: number, hiddenLabel: string) => (
    <div className="udrp-month" role="group" aria-label={hiddenLabel}>
      <div className="udrp-month__weekdays" aria-hidden="true">
        {WEEKDAYS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="udrp-month__grid">
        {monthMatrix(y, m0).map((cell) => {
          const isSelectedEnd = cell.iso === value.from || cell.iso === value.to;
          const isDraftEnd = draftFrom != null && cell.iso === draftFrom;
          const inRange = value.from !== '' && value.to !== '' && cell.iso > value.from && cell.iso < value.to;
          return (
            <button
              key={cell.iso}
              type="button"
              className={[
                'udrp-day',
                cell.inMonth ? '' : 'udrp-day--outside',
                isSelectedEnd || isDraftEnd ? 'udrp-day--end' : '',
                inRange ? 'udrp-day--in' : '',
                cell.iso === todayIso ? 'udrp-day--today' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={isSelectedEnd || isDraftEnd}
              aria-label={`${cell.day} Tháng ${m0 + 1} ${y}`}
              onClick={() => pickDay(cell.iso)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );

  const nextM0 = (anchor.m0 + 1) % 12;
  const nextY = anchor.m0 === 11 ? anchor.y + 1 : anchor.y;
  const triggerText = value.from && value.to
    ? `${displayDate(value.from)} – ${displayDate(value.to)}`
    : value.from
      ? `${displayDate(value.from)} – …`
      : '';

  return (
    <div className={`udrp${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="udrp__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${ariaLabel}${triggerText ? `: ${triggerText}` : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Calendar size={14} aria-hidden="true" />
        {triggerText ? <span className="udrp__value">{triggerText}</span> : <span className="udrp__placeholder">DD/MM/YYYY – DD/MM/YYYY</span>}
        <ChevronRight size={12} className="udrp__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="udrp__popover" role="dialog" aria-label={ariaLabel} ref={popoverRef}>
          <div className="udrp__presets" role="group" aria-label="Khoảng nhanh">
            {UNIFIED_RANGE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`udrp-preset${activePreset === preset.id ? ' udrp-preset--active' : ''}`}
                aria-pressed={activePreset === preset.id}
                onClick={() => commitRange(preset.range())}
              >
                {preset.label}
              </button>
            ))}
            {(value.from !== '' || value.to !== '') && (
              <button type="button" className="udrp-preset udrp-preset--clear" onClick={() => commitRange({ from: '', to: '' })}>
                <X size={12} aria-hidden="true" /> Xoá khoảng ngày
              </button>
            )}
          </div>
          <div className="udrp__calendar">
            <div className="udrp__calendar-head">
              <button type="button" className="udrp-nav" aria-label="Tháng trước" onClick={() => shiftAnchor(-1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="udrp__calendar-title">{monthTitle(anchor.m0, anchor.y)}</span>
              <span className="udrp__calendar-sep" aria-hidden="true">·</span>
              <span className="udrp__calendar-title">{monthTitle(nextM0, nextY)}</span>
              <button type="button" className="udrp-nav" aria-label="Tháng sau" onClick={() => shiftAnchor(1)}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="udrp__months">
              {renderMonth(anchor.m0, anchor.y, monthTitle(anchor.m0, anchor.y))}
              {renderMonth(nextM0, nextY, monthTitle(nextM0, nextY))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
