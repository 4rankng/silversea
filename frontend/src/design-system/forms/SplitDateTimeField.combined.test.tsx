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

  // Card 081026230510 (FB-001 round 8): the appointment cell is a tap surface
  // (card 051026230627) but only the ~3px frame strip + separators inside the
  // segment groups opened the picker — clicks on the field's dead space (the
  // fit-content grid's leftover inside the 240px cell) did nothing, so a
  // normal click on the field no longer opened anything. The whole field body
  // must open the combined picker; segment clicks stay caret clicks.
  it('a click on the field body outside the segment groups opens the combined picker', () => {
    renderField(true);
    const root = document.querySelector('[data-split-datetime]');
    expect(root).toBeTruthy();
    fireEvent.click(root!);
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]!.textContent).toContain('Chọn ngày giờ');
    expect(dialogs[0]!.querySelector('.combined-datetime__date')).toBeTruthy();
    expect(dialogs[0]!.querySelector('.combined-datetime__time')).toBeTruthy();
  });

  it('a double click on the field body outside the segment groups also opens the picker', () => {
    renderField(true);
    const root = document.querySelector('[data-split-datetime]');
    fireEvent.click(root!);
    fireEvent.click(root!);
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.textContent?.includes('Chọn ngày giờ'));
    expect(dialogs.length).toBe(1);
  });

  // Card 091026091500 (FB-001 round 8, lan 2): SUPERSEDES the 4da7470f pin
  // "a click on a segment input stays a caret click and opens no picker" for
  // combinedPicker hosts — the owner contract is that a click anywhere on the
  // field body, segments included, opens the combined picker. The 061026172803
  // caret law still governs the segment surface itself (the click still
  // focuses/selects the segment and typing keeps type-over editing) and keeps
  // its byte-for-byte contract on hosts without combinedPicker.
  it('a click on a segment input opens the combined picker and typing keeps caret editing', () => {
    renderField(true);
    const hh = document.querySelector('input[data-seg="hh"]') as HTMLInputElement;
    expect(hh).toBeTruthy();
    fireEvent.click(hh);
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]!.textContent).toContain('Chọn ngày giờ');
    expect(dialogs[0]!.querySelector('.combined-datetime__date')).toBeTruthy();
    expect(dialogs[0]!.querySelector('.combined-datetime__time')).toBeTruthy();
    // Caret editing survives the open picker: typing into the focused segment
    // still writes the draft (type-over contract 061026172803/#326).
    fireEvent.change(hh, { target: { value: '08' } });
    expect(hh).toHaveValue('08');
  });

  it('a double click on a segment input still yields exactly one combined dialog', () => {
    renderField(true);
    const hh = document.querySelector('input[data-seg="hh"]') as HTMLInputElement;
    fireEvent.click(hh);
    fireEvent.click(hh);
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.textContent?.includes('Chọn ngày giờ'));
    expect(dialogs.length).toBe(1);
  });

  it('without the flag the dead-space click stays inert (hosts keep their contract)', () => {
    renderField(false);
    const root = document.querySelector('[data-split-datetime]');
    fireEvent.click(root!);
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);
  });
});

/**
 * Card 091026225700 (FB-030 verify-fail): the container row on /shipments/new is
 * the one host that passes `combinedPicker`, and it is ALSO the host QA typed
 * into. The plain host's auto-advance is pinned in DateTimeSegments.test.tsx,
 * but nothing pinned it THROUGH this host — a regression here would be
 * invisible to the whole suite. Type "15" into the hour segment and the focus
 * must land on the minute segment.
 */
describe('SplitDateTimeField combinedPicker — auto-advance through this host (card 091026225700)', () => {
  it('typing two in-range hour digits focuses the minute segment', () => {
    renderField(true);
    const group = document.querySelector('[data-seg-part="time"]');
    if (!group) throw new Error('time segments group not found');
    const [hh, mm] = Array.from(group.querySelectorAll<HTMLInputElement>('input'));
    if (!hh || !mm) throw new Error('hour/minute inputs not found');

    fireEvent.focus(hh);
    fireEvent.keyDown(hh, { key: '1' });
    fireEvent.change(hh, { target: { value: '1' } });
    fireEvent.keyDown(hh, { key: '5' });
    fireEvent.change(hh, { target: { value: '15' } });

    expect(document.activeElement).toBe(mm);
  });
});
