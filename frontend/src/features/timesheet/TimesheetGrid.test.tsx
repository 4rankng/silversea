// The Điều vận grid cell (owner ruling 2026-10-14: "Điều vận điền lưới, nhập
// nhanh bằng ký hiệu"). These pin the two behaviours the dispatcher actually
// feels: typing a symbol writes it, and Backspace on an empty cell walks back.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimesheetGridCell, symbolFromTypedKey } from './TimesheetGrid';
import type { TimesheetDayCell } from '../../api/timesheetClient';

function day(overrides: Partial<TimesheetDayCell> = {}): TimesheetDayCell {
  return {
    id: 1,
    workDate: '2026-10-05',
    symbol: null,
    trips: 0,
    isSunday: false,
    tripAdjustment: 0,
    note: null,
    source: 'MANUAL',
    enteredBy: null,
    enteredAt: null,
    adjustedBy: null,
    adjustedAt: null,
    ...overrides,
  };
}

function renderCell(props: Partial<Parameters<typeof TimesheetGridCell>[0]> = {}) {
  const onEnter = vi.fn();
  const onMove = vi.fn();
  render(
    <TimesheetGridCell
      day={props.day ?? day()}
      readOnly={props.readOnly}
      onEnter={props.onEnter ?? onEnter}
      onMove={props.onMove ?? onMove}
      registerRef={() => {}}
    />,
  );
  return { cell: screen.getByRole('textbox'), onEnter, onMove };
}

describe('grid symbol keys', () => {
  it('maps every typed key to its symbol, including the unaccented Đ', () => {
    expect(symbolFromTypedKey('k')).toBe('K');
    expect(symbolFromTypedKey('Q')).toBe('Q');
    expect(symbolFromTypedKey('d')).toBe('Đ');
    expect(symbolFromTypedKey('l')).toBe('L');
    expect(symbolFromTypedKey('n')).toBe('N');
    expect(symbolFromTypedKey('p')).toBe('P');
  });

  it('ignores keys that are not a grid symbol', () => {
    expect(symbolFromTypedKey('z')).toBeNull();
    expect(symbolFromTypedKey('1')).toBeNull();
  });
});

describe('TimesheetGridCell keyboard entry', () => {
  it('typing a symbol writes it and steps to the next cell', () => {
    const { cell, onEnter, onMove } = renderCell();
    fireEvent.keyDown(cell, { key: 'q' });
    expect(onEnter).toHaveBeenCalledWith('2026-10-05', 'Q');
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it('a key that is not a symbol neither writes nor moves', () => {
    const { cell, onEnter, onMove } = renderCell();
    fireEvent.keyDown(cell, { key: 'z' });
    expect(onEnter).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Backspace on an EMPTY cell walks back instead of clearing', () => {
    const { cell, onEnter, onMove } = renderCell();
    fireEvent.keyDown(cell, { key: 'Backspace' });
    expect(onMove).toHaveBeenCalledWith(-1);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('clearing a FILLED cell reports the empty symbol', () => {
    const { cell, onEnter } = renderCell({ day: day({ symbol: 'Đ' }) });
    // The browser deletes the character first; the controlled cell reports the
    // empty value through onChange.
    fireEvent.change(cell, { target: { value: '' } });
    expect(onEnter).toHaveBeenCalledWith('2026-10-05', null);
  });

  it('Escape clears the cell and the arrow keys move without writing', () => {
    const { cell, onEnter, onMove } = renderCell({ day: day({ symbol: 'Q' }) });
    fireEvent.keyDown(cell, { key: 'Escape' });
    expect(onEnter).toHaveBeenCalledWith('2026-10-05', null);

    onEnter.mockClear();
    fireEvent.keyDown(cell, { key: 'ArrowDown' });
    expect(onMove).toHaveBeenCalledWith(7);
    expect(onEnter).not.toHaveBeenCalled();

    fireEvent.keyDown(cell, { key: 'ArrowLeft' });
    expect(onMove).toHaveBeenCalledWith(-1);
  });

  it('a read-only cell (accountant board) never writes', () => {
    const { cell, onEnter, onMove } = renderCell({ readOnly: true });
    fireEvent.keyDown(cell, { key: 'q' });
    expect(onEnter).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('names the Sunday rule in the accessible label and the title', () => {
    const { cell } = renderCell({ day: day({ workDate: '2026-10-11', isSunday: true, symbol: 'Đ' }) });
    expect(cell.getAttribute('aria-label')).toContain('Chủ nhật');
    // SIL-884 (5.2) — the title also states the write source; a typed cell is
    // the dispatcher's own.
    expect(cell.getAttribute('title')).toBe('Chủ nhật: ghi chuyến, không tính ngày công — Điều vận đã chỉnh tay');
  });
});

describe('TimesheetGridCell write-source marker (SIL-737 + SIL-884 CR-010)', () => {
  it('marks an auto cell as the system suggestion', () => {
    const { cell } = renderCell({ day: day({ symbol: 'Đ', source: 'AUTO' }) });
    expect(cell.getAttribute('data-source')).toBe('AUTO');
    expect(cell.getAttribute('title')).toContain('Hệ thống tự gợi ý');
    expect(cell.getAttribute('aria-label')).toContain('hệ thống tự gợi ý');
    // The symbol is still named — the marker adds to the label, never replaces it.
    expect(cell.getAttribute('aria-label')).toContain('Chạy đơn');
  });

  it('keeps BOTH the Sunday rule and the suggestion note on a Sunday auto cell', () => {
    const { cell } = renderCell({ day: day({ workDate: '2026-10-11', isSunday: true, symbol: 'Đ', source: 'AUTO' }) });
    const title = cell.getAttribute('title') ?? '';
    expect(title).toContain('Chủ nhật: ghi chuyến, không tính ngày công');
    expect(title).toContain('Hệ thống tự gợi ý');
    const label = cell.getAttribute('aria-label') ?? '';
    expect(label).toContain('Chủ nhật');
    expect(label).toContain('hệ thống tự gợi ý');
  });

  it('says a hand-typed cell is the dispatcher override — sync never overwrites it', () => {
    const { cell } = renderCell({ day: day({ symbol: 'Đ', source: 'MANUAL' }) });
    expect(cell.getAttribute('data-source')).toBe('MANUAL');
    // SIL-884 (5.2) — the tooltip vocabulary separates the soft suggestion
    // from the manual override ('Điều vận đã chỉnh tay').
    expect(cell.getAttribute('title')).toBe('Điều vận đã chỉnh tay');
    expect(cell.getAttribute('aria-label')).toContain('điều vận đã chỉnh tay');
    expect(cell.getAttribute('aria-label')).not.toContain('hệ thống tự gợi ý');
  });
});