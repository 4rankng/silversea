import { act, fireEvent, render } from '@testing-library/react';
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
