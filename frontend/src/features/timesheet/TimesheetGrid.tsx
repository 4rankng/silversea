/**
 * The timesheet grid cell and its keyboard behaviour (owner ruling
 * 2026-10-14: "Điều vận điền lưới", fast symbol entry).
 *
 * One component owns the cell so the dispatcher grid and the accountant
 * reconciliation board cannot drift in how a symbol is entered. Typing a symbol
 * writes it and steps right; Backspace on an empty cell walks back; Escape
 * clears the cell.
 */

import { useRef } from 'react';
import { TIMESHEET_SYMBOL_RULES, type TimesheetSymbol } from '@tingting/shared';
import type { TimesheetDayCell } from '../../api/timesheetClient';

/** What a dispatcher types on a US/no-accent keyboard → the stored symbol. */
const TYPED_SYMBOLS: Record<string, TimesheetSymbol> = {
  k: 'K',
  q: 'Q',
  d: 'Đ',
  'đ': 'Đ',
  l: 'L',
  n: 'N',
  p: 'P',
};

export function symbolFromTypedKey(key: string): TimesheetSymbol | null {
  return TYPED_SYMBOLS[key.toLowerCase()] ?? null;
}

/** -1 = previous cell, +1 = next cell, ±7 = one week when 7 day-columns. */
export type TimesheetMove = -7 | -1 | 1 | 7;

export interface TimesheetCellProps {
  day: TimesheetDayCell;
  /** Dispatcher writes symbols; the accountant's board reads them. */
  readOnly?: boolean;
  onEnter: (workDate: string, symbol: TimesheetSymbol | null) => void;
  onMove: (move: TimesheetMove) => void;
  registerRef: (element: HTMLInputElement | null) => void;
}

const ARROW_MOVES: Record<string, TimesheetMove> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: 7,
  ArrowUp: -7,
};

// SIL-884 (5.2) — a cell the system wrote from a completed trip is a SOFT
// suggestion ('Hệ thống tự gợi ý'): it refreshes when a second trip lands,
// and a cell the dispatcher typed/edited becomes THEIRS ('Điều vận đã chỉnh
// tay') — later sync never overwrites it. The tooltip must say which is
// which before the operator edits anything.
const AUTO_SOURCE_TITLE = 'Hệ thống tự gợi ý';
const MANUAL_OVERRIDE_TITLE = 'Điều vận đã chỉnh tay';
/** Same facts for the screen reader — lower case because they trail the label. */
const AUTO_SOURCE_LABEL = 'hệ thống tự gợi ý';
const MANUAL_OVERRIDE_LABEL = 'điều vận đã chỉnh tay';

export function TimesheetGridCell({ day, readOnly, onEnter, onMove, registerRef }: TimesheetCellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isAuto = day.source === 'AUTO';
  // The Sunday rule and the write-source marker are two independent facts
  // about the same cell, so the title carries all that apply. The MANUAL
  // cell now states its override explicitly (SIL-884 5.2) — the same tooltip
  // vocabulary as the monthly report.
  const titleParts: string[] = [];
  if (day.isSunday) titleParts.push('Chủ nhật: ghi chuyến, không tính ngày công');
  titleParts.push(isAuto ? AUTO_SOURCE_TITLE : MANUAL_OVERRIDE_TITLE);

  return (
    <input
      ref={(element) => {
        inputRef.current = element;
        registerRef(element);
      }}
      // A one-character grid cell: the value IS the symbol, never free text.
      value={day.symbol ?? ''}
      readOnly={readOnly}
      maxLength={1}
      className="ts-cell"
      data-symbol={day.symbol ?? undefined}
      data-sunday={day.isSunday ? 'true' : undefined}
      data-adjustment={day.tripAdjustment !== 0 ? String(day.tripAdjustment) : undefined}
      // Always present, so the grid can be read without hovering any cell.
      data-source={day.source}
      aria-label={`Ngày ${day.workDate}${day.symbol ? ` — ${TIMESHEET_SYMBOL_RULES[day.symbol].label}` : ' — chưa nhập'}${day.isSunday ? ' (Chủ nhật)' : ''} — ${isAuto ? AUTO_SOURCE_LABEL : MANUAL_OVERRIDE_LABEL}`}
      title={titleParts.length > 0 ? titleParts.join(' — ') : undefined}
      onChange={(event) => {
        // Controlled one-character cell: emptying it (Backspace/Delete on a
        // filled cell) is how the operator clears the day.
        if (readOnly) return;
        if (event.target.value === '') onEnter(day.workDate, null);
      }}
      onFocus={() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }}
      onKeyDown={(event) => {
        if (readOnly) return;
        if (event.key === 'Enter') { event.preventDefault(); onMove(1); return; }
        if (event.key === 'Backspace') {
          // On an empty cell Backspace walks BACK — the usual spreadsheet feel.
          if (!day.symbol) { event.preventDefault(); onMove(-1); }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onEnter(day.workDate, null);
          return;
        }
        const arrow = ARROW_MOVES[event.key];
        if (arrow) { event.preventDefault(); onMove(arrow); return; }
        if (event.key.length !== 1) return;
        const symbol = symbolFromTypedKey(event.key);
        if (!symbol) return;
        event.preventDefault();
        onEnter(day.workDate, symbol);
        onMove(1);
      }}
    />
  );
}