import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';

/**
 * Card 071026204700 (FB-001) — the appointment cell must open ONE popup that
 * carries both the calendar and the 24h time grid. Before this, clicking the
 * field opened a date-only calendar ("Chọn ngày") and the time lived in the
 * separate HH:mm boxes — the QA's "không có chọn giờ trong popup". The mode is
 * opt-in (`combinedPicker`): surfaces without it keep the one-panel-per-part
 * behaviour byte for byte.
 */

function renderField(combined: boolean) {
  const onChange = vi.fn();
  render(
    <SplitDateTimeField
      id="apt"
      label="Ngày giờ đóng trả"
      value="2026-09-20T09:30"
      onChange={onChange}
      combinedPicker={combined}
    />,
  );
  return onChange;
}

function openPart(part: 'date' | 'time') {
  const group = document.querySelector(`[data-seg-part="${part}"]`);
  if (!group) throw new Error(`segments group (${part}) not found`);
  fireEvent.click(group);
}

describe('SplitDateTimeField combinedPicker (card 071026204700)', () => {
  it('one dialog carries both the calendar and the time grid', () => {
    renderField(true);
    openPart('date');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    const dialog = dialogs[0]!;
    expect(dialog.textContent).toContain('Chọn ngày giờ');
    expect(dialog.querySelector('.combined-datetime__date')).toBeTruthy();
    expect(dialog.querySelector('.combined-datetime__time')).toBeTruthy();
  });

  it('stays a single combined dialog when the user moves to the time segments', () => {
    renderField(true);
    openPart('date');
    openPart('time');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]!.querySelector('.combined-datetime__date')).toBeTruthy();
    expect(dialogs[0]!.querySelector('.combined-datetime__time')).toBeTruthy();
  });

  it('without the flag the part popup keeps its date-only contract', () => {
    renderField(false);
    openPart('date');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]!.querySelector('.combined-datetime__date, .combined-datetime__time')).toBeNull();
    expect(dialogs[0]!.textContent).toContain('Chọn ngày');
    expect(screen.queryByText('Chọn ngày giờ')).toBeNull();
  });
});
