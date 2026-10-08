import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BufferedUuiDateInput } from './BufferedUuiDateInput';
import { BufferedUuiDateTimeInput } from './BufferedUuiDateTimeInput';
import { DateTimeField } from './DateTimeField';
import { TimeSegmentsField } from './TimeSegmentsField';

/**
 * Card 326 revocation-#2 rework: the auto-advance sweep must cover EVERY host
 * wrapper, not just the dispatch dialog — each wrapper is the wiring a
 * production surface mounts (engine flows are pinned in DateTimeSegments.test
 * and SplitDateTimeField.test). Per-keystroke activeElement is the assertion.
 */

/** Controlled round-trip harness — mirrors how every host wires the wrappers. */
function DateTimeFieldHarness() {
  const [value, setValue] = useState('2026-10-06T07:30');
  return <DateTimeField label="Giờ trả hàng" value={value} onChange={setValue} />;
}

function BufferedDateTimeHarness() {
  const [value, setValue] = useState('');
  return <BufferedUuiDateTimeInput label="Giờ hẹn đóng/trả" value={value} onChange={setValue} />;
}

function BufferedDateHarness() {
  const [value, setValue] = useState('');
  return <BufferedUuiDateInput label="Ngày đóng/trả" value={value} onChange={setValue} />;
}

function TimeSegmentsHarness() {
  const [value, setValue] = useState('');
  return <TimeSegmentsField label="Giờ đóng/trả" value={value} onChange={setValue} />;
}

const seg = (part: string, key: string) =>
  document.querySelector<HTMLInputElement>(`[data-seg-part="${part}"] [data-seg="${key}"]`)!;
const activeLabel = () => document.activeElement?.getAttribute('aria-label') ?? '';
const activeSeg = () => document.activeElement?.getAttribute('data-seg') ?? '';
const type = (part: string, key: string, text: string) =>
  fireEvent.change(seg(part, key), { target: { value: text } });

describe('card 326 host×pattern auto-advance matrix', () => {
  it('DateTimeField (dispatch dialog wiring): empty hour advances on "08"; full-hour type-over restarts and advances; minute completion hands off to the date day', () => {
    render(<DateTimeFieldHarness />);
    // Prefilled full value: type-over restart (the user's exact flow).
    act(() => seg('time', 'hh').focus());
    const hour = seg('time', 'hh');
    act(() => hour.setSelectionRange(0, 0)); // collapsed caret, as after a re-render timing loss
    fireEvent.keyDown(hour, { key: '0' }); // type-over guard: replaces the segment
    expect(seg('time', 'hh')).toHaveValue('0');
    type('time', 'hh', '08'); // next keystroke completes the restarted segment
    expect(activeLabel()).toBe('Phút — Giờ trả hàng');
    // Empty minute completes → time→date hand-off (the original complaint #3 group).
    // The prefilled minute is already "30" — a same-value change would be a
    // React dedupe no-op, so restart it with a different digit first.
    type('time', 'mm', '3');
    type('time', 'mm', '30');
    expect(activeLabel()).toBe('Ngày — Giờ trả hàng');
    // Date side advances within itself: empty day "05" → month.
    type('date', 'dd', '05');
    expect(activeLabel()).toBe('Tháng — Giờ trả hàng');
    type('date', 'dd', '0510');
    expect(seg('date', 'dd')).toHaveValue('05');
  });

  it('BufferedUuiDateTimeInput (CUS container add row wiring): hour "08" advances, minute "30" hands off to date', () => {
    render(<BufferedDateTimeHarness />);
    act(() => seg('time', 'hh').focus());
    type('time', 'hh', '0');
    expect(activeLabel()).toBe('Giờ — Giờ hẹn đóng/trả');
    type('time', 'hh', '08');
    expect(activeLabel()).toBe('Phút — Giờ hẹn đóng/trả');
    type('time', 'mm', '30');
    expect(activeLabel()).toBe('Ngày — Giờ hẹn đóng/trả');
  });

  it('BufferedUuiDateInput (schedule editor + ledger date wiring): day "02" advances to month', () => {
    render(<BufferedDateHarness />);
    act(() => seg('date', 'dd').focus());
    // The first segment's aria-label is deliberately suppressed (a real
    // <Label htmlFor> names it) — assert by segment key, not label.
    type('date', 'dd', '0');
    expect(activeSeg()).toBe('dd');
    type('date', 'dd', '02');
    expect(activeLabel()).toBe('Tháng — Ngày đóng/trả');
  });

  it('TimeSegmentsField (ledger add-row time wiring): hour "08" advances to minute', () => {
    render(<TimeSegmentsHarness />);
    act(() => seg('time', 'hh').focus());
    type('time', 'hh', '0');
    expect(activeLabel()).toBe('Giờ — Giờ đóng/trả');
    type('time', 'hh', '08');
    expect( activeLabel()).toBe('Phút — Giờ đóng/trả');
  });
});
