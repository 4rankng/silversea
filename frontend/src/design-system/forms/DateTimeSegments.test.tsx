import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimeSegments } from './DateTimeSegments';

// The component derives every segment from the canonical draft string, so the
// harness must round-trip onValueChange through state for assertions to see
// the re-rendered segments (act-safe: fireEvent already wraps updates).
function Harness({ part, value = '' }: { part: 'time' | 'date'; value?: string }) {
  const [current, setCurrent] = useState(value);
  const anchor = useRef<HTMLInputElement>(null);
  return <DateTimeSegments id="t" part={part} groupAriaLabel="test" value={current} onValueChange={setCurrent} anchorRef={anchor} onOpenPicker={() => {}} />;
}

const seg = (key: string) => document.querySelector<HTMLInputElement>(`[data-seg="${key}"]`)!;
const activeLabel = () => document.activeElement?.getAttribute('aria-label') ?? '';
const type = (key: string, text: string) => fireEvent.change(seg(key), { target: { value: text } });
const press = (key: string, eventKey: string) => fireEvent.keyDown(seg(key), { key: eventKey });

describe('DateTimeSegments', () => {
  it('auto-advances to the minute after the second in-range hour digit (1, 4)', () => {
    render(<Harness part="time" />);
    act(() => seg('hh').focus());
    type('hh', '0');
    expect(activeLabel()).toBe('Giờ — test');
    type('hh', '08');
    expect(seg('hh')).toHaveValue('08');
    expect(activeLabel()).toBe('Phút — test');
  });

  it('keeps an out-of-range hour focused and flagged, clearing once valid again (2)', () => {
    render(<Harness part="time" />);
    act(() => seg('hh').focus());
    type('hh', '99');
    expect(seg('hh')).toHaveValue('99');
    expect(activeLabel()).toBe('Giờ — test');
    expect(seg('hh')).toHaveClass('date-seg--invalid');
    expect(seg('hh')).toHaveAttribute('aria-invalid', 'true');
    type('hh', '09');
    expect(seg('hh')).not.toHaveClass('date-seg--invalid');
  });

  it('keeps an out-of-range minute in place without advancing (3)', () => {
    render(<Harness part="time" />);
    type('hh', '08');
    expect(activeLabel()).toBe('Phút — test');
    type('mm', '75');
    expect(seg('mm')).toHaveValue('75');
    expect(activeLabel()).toBe('Phút — test');
    expect(seg('mm')).toHaveClass('date-seg--invalid');
  });

  it('backspace on an empty minute returns focus to the hour without deleting (5)', () => {
    render(<Harness part="time" />);
    type('hh', '08');
    press('mm', 'Backspace');
    expect(activeLabel()).toBe('Giờ — test');
    expect(seg('hh')).toHaveValue('08');
    expect(seg('mm')).toHaveValue('');
  });

  it('arrow keys walk between time segments (6)', () => {
    render(<Harness part="time" />);
    press('hh', 'ArrowRight');
    expect(activeLabel()).toBe('Phút — test');
    press('mm', 'ArrowLeft');
    expect(activeLabel()).toBe('Giờ — test');
  });

  it('distributes a pasted HH:mm across both segments and stops on the minute (7)', () => {
    render(<Harness part="time" />);
    type('hh', '08:30');
    expect(seg('hh')).toHaveValue('08');
    expect(seg('mm')).toHaveValue('30');
    expect(activeLabel()).toBe('Phút — test');
  });

  // Card 326 class: the hand-off to the next segment must not depend on the
  // controlled re-render. A parent that keeps the draft as a primitive string
  // bails out of rendering when the update leaves the string unchanged — and
  // with the render goes the effect that used to be the only thing moving
  // focus. The typed path cannot produce a same-string draft (React drops a
  // change event whose value matches the tracked input), so the reachable
  // instance is the multi-char path: a full paste over the same text
  // (re-pasting the current value, autofill/undo/IME commits).
  it('hands focus to the next segment when a full paste leaves the draft string unchanged', async () => {
    function BailHarness() {
      const [current, setCurrent] = useState('08:30');
      return <DateTimeSegments id="t" part="time" groupAriaLabel="test" value={current} onValueChange={setCurrent} onOpenPicker={() => {}} />;
    }
    render(<BailHarness />);
    act(() => seg('hh').focus());
    type('hh', '08:30');
    expect(seg('hh')).toHaveValue('08');
    expect(seg('mm')).toHaveValue('30');
    await waitFor(() => expect(activeLabel()).toBe('Phút — test'));
  });

  it.each([
    { part: 'date' as const, initial: '19/09/2026', segments: ['dd', 'mm2', 'yyyy'], partial: '/09/2026' },
    { part: 'time' as const, initial: '08:30', segments: ['hh', 'mm'], partial: ':30' },
  ])('emits empty only after every $part segment is cleared, preserving partial separators (UI50)', ({ part, initial, segments, partial }) => {
    const changes: string[] = [];
    function ClearHarness() {
      const [current, setCurrent] = useState(initial);
      return <DateTimeSegments id="clear" part={part} groupAriaLabel="clear" value={current}
        onValueChange={next => { changes.push(next); setCurrent(next); }} onOpenPicker={() => {}} />;
    }
    render(<ClearHarness />);
    type(segments[0], '');
    expect(changes).toEqual([partial]);
    for (const key of segments.slice(1)) type(key, '');
    expect(changes.at(-1)).toBe('');
    for (const key of segments) expect(seg(key)).toHaveValue('');
  });

  it('walks day → month → year and ends naturally on the year (8)', () => {
    render(<Harness part="date" />);
    type('dd', '19');
    expect(activeLabel()).toBe('Tháng — test');
    type('mm2', '09');
    expect(activeLabel()).toBe('Năm — test');
    type('yyyy', '2026');
    expect(seg('yyyy')).toHaveValue('2026');
    expect(activeLabel()).toBe('Năm — test');
  });

  it('flags out-of-range day and month without advancing (9)', () => {
    const { unmount } = render(<Harness part="date" />);
    act(() => seg('dd').focus());
    type('dd', '32');
    expect(seg('dd')).toHaveClass('date-seg--invalid');
    expect(activeLabel()).toBe('Ngày — test');
    unmount();
    render(<Harness part="date" />);
    type('dd', '19');
    type('mm2', '13');
    expect(seg('mm2')).toHaveClass('date-seg--invalid');
    expect(activeLabel()).toBe('Tháng — test');
  });

  it('backspace on an empty month returns to the day and ArrowRight moves forward (10)', () => {
    render(<Harness part="date" />);
    type('dd', '19');
    press('mm2', 'Backspace');
    expect(activeLabel()).toBe('Ngày — test');
    press('dd', 'ArrowRight');
    expect(activeLabel()).toBe('Tháng — test');
  });

  it('distributes a pasted full date across all three segments (11)', () => {
    render(<Harness part="date" />);
    type('dd', '19/09/2026');
    expect(seg('dd')).toHaveValue('19');
    expect(seg('mm2')).toHaveValue('09');
    expect(seg('yyyy')).toHaveValue('2026');
    expect(activeLabel()).toBe('Năm — test');
  });

  it('triggers onComplete when the final time segment is filled (12)', () => {
    const onComplete = vi.fn();
    function TimeHarness() {
      const [current, setCurrent] = useState('');
      return <DateTimeSegments id="t" part="time" groupAriaLabel="test" value={current} onValueChange={setCurrent} onOpenPicker={() => {}} onComplete={onComplete} />;
    }
    render(<TimeHarness />);
    act(() => seg('hh').focus());
    type('hh', '08');
    expect(onComplete).not.toHaveBeenCalled();
    type('mm', '00');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('pressing separator in a segment advances and pads single digits (13)', () => {
    render(<Harness part="time" />);
    act(() => seg('hh').focus());
    type('hh', '8');
    press('hh', ':');
    expect(seg('hh')).toHaveValue('08');
    expect(activeLabel()).toBe('Phút — test');
  });

  it('triggers onBackFromStart when backspacing an empty first segment (14)', () => {
    const onBack = vi.fn();
    function BackHarness() {
      const [current, setCurrent] = useState('');
      return <DateTimeSegments id="t" part="date" groupAriaLabel="test" value={current} onValueChange={setCurrent} onOpenPicker={() => {}} onBackFromStart={onBack} />;
    }
    render(<BackHarness />);
    act(() => seg('dd').focus());
    press('dd', 'Backspace');
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('DateTimeSegments — type-over restart (thẻ 326 revocation, user retest 04/10/2026)', () => {
  // User retest on build 813a2b0d: "auto-advance is still broken". The engine
  // advances correctly ONLY while the segment keeps its select-on-focus
  // selection; with a collapsed caret the input's maxLength silently swallows
  // every digit (value can never change → never completes → never advances).
  // The contract is the standard segmented-input one: typing a digit into a
  // FULL segment restarts it (replace-first), regardless of selection state.
  it('typing a digit into a full segment with a collapsed caret restarts the segment (replace-first)', () => {
    render(<Harness part="time" value="13:30" />);
    const mmSeg = seg('mm');
    act(() => {
      mmSeg.focus();
      mmSeg.setSelectionRange(2, 2); // collapsed caret at end — the broken state
    });
    fireEvent.keyDown(mmSeg, { key: '0' });
    // Native input would reject this keystroke (maxLength reached) and no
    // onChange would fire — pre-fix the segment stayed "30" and focus stuck.
    expect(seg('mm')).toHaveValue('0');
  });

  it('a full hour restarted by typing still completes and auto-advances', () => {
    render(<Harness part="time" value="13:30" />);
    const hhSeg = seg('hh');
    act(() => {
      hhSeg.focus();
      hhSeg.setSelectionRange(2, 2);
    });
    fireEvent.keyDown(hhSeg, { key: '1' });
    expect(seg('hh')).toHaveValue('1');
    type('hh', '13');
    expect(seg('hh')).toHaveValue('13');
    expect(activeLabel()).toBe('Phút — test');
  });

  it('clicking a segment re-selects its digits even when focus does not change', () => {
    render(<Harness part="time" value="13:30" />);
    const hhSeg = seg('hh');
    act(() => {
      hhSeg.focus();
      hhSeg.setSelectionRange(2, 2); // e.g. a second click parked the caret
    });
    fireEvent.click(hhSeg);
    expect(hhSeg.selectionStart).toBe(0);
    expect(hhSeg.selectionEnd).toBe(2);
  });

  it('single-digit type-over replaces a full segment without scattering across parts (mobile virtual keyboard fallback)', () => {
    render(<Harness part="time" value="13:30" />);
    // Simulate mobile virtual keyboard emitting '138' (1 digit added to full segment)
    type('hh', '138');
    expect(seg('hh')).toHaveValue('8');
    expect(seg('mm')).toHaveValue('30');
  });
});

