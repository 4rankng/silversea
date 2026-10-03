import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TimeSegmentsField } from './TimeSegmentsField';

// Card 20261002_275. AC1-AC3 are the segmented time entry's own contract, already
// proven in `DateTimeSegments.test.tsx`; what this suite adds is AC4 — proof that
// a surface which owns its DATE separately can mount that same entry, so the last
// native `type="time"` in the app is gone rather than merely the only one left.
//
// The field is controlled, so the harness round-trips onChange through state the
// way a real parent does; assertions read the re-rendered segments.

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (time: string) => void }) {
  const [current, setCurrent] = useState(initial);
  return <TimeSegmentsField label="Giờ đóng/trả" value={current} onChange={(time) => { setCurrent(time); onChange?.(time); }} />;
}

const seg = (key: string) => document.querySelector<HTMLInputElement>(`[data-seg="${key}"]`)!;
const activeLabel = () => document.activeElement?.getAttribute('aria-label') ?? '';
const type = (key: string, text: string) => fireEvent.change(seg(key), { target: { value: text } });
const press = (key: string, eventKey: string) => fireEvent.keyDown(seg(key), { key: eventKey });

describe('TimeSegmentsField (card 20261002_275)', () => {
  it('AC1 — two in-range hour digits advance the caret to the minute', () => {
    render(<Harness />);
    act(() => seg('hh').focus());
    type('hh', '0');
    expect(activeLabel()).toBe('Giờ — Giờ đóng/trả');
    type('hh', '08');
    expect(activeLabel()).toBe('Phút — Giờ đóng/trả');
  });

  it('AC1 — an out-of-range hour stays put and is flagged, then advances once valid', () => {
    render(<Harness />);
    act(() => seg('hh').focus());
    type('hh', '2');
    type('hh', '25');
    expect(activeLabel()).toBe('Giờ — Giờ đóng/trả');
    type('hh', '23');
    expect(activeLabel()).toBe('Phút — Giờ đóng/trả');
  });

  it('AC2 — Backspace on an empty minute returns to the hour, which is selected for editing', () => {
    render(<Harness />);
    type('hh', '08');
    expect(activeLabel()).toBe('Phút — Giờ đóng/trả');
    press('mm', 'Backspace');
    expect(activeLabel()).toBe('Giờ — Giờ đóng/trả');
    // The hour is selected, so typing replaces it instead of appending.
    expect(seg('hh').selectionStart).toBe(0);
    expect(seg('hh').selectionEnd).toBe(seg('hh').value.length);
  });

  it('AC3 — Left and Right walk between the two segments', () => {
    render(<Harness />);
    act(() => seg('hh').focus());
    press('hh', 'ArrowRight');
    expect(activeLabel()).toBe('Phút — Giờ đóng/trả');
    press('mm', 'ArrowLeft');
    expect(activeLabel()).toBe('Giờ — Giờ đóng/trả');
  });

  it('AC4 — carries no native time input and reports the HH:mm draft to its parent', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    expect(document.querySelector('input[type="time"]')).toBeNull();
    type('hh', '08');
    type('mm', '30');
    // The parent keeps the time apart from the date, so the value it receives is
    // the segments' own draft — the same string the native input produced.
    expect(onChange).toHaveBeenLastCalledWith('08:30');
  });

  it('AC4 — a seeded value renders into the segments, not as one opaque string', () => {
    render(<Harness initial="08:30" />);
    expect(seg('hh')).toHaveValue('08');
    expect(seg('mm')).toHaveValue('30');
  });

  it('opens the 24h picker from the segments group and applies a chosen time', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    act(() => seg('hh').focus());
    // The segments GROUP is the picker trigger (`DateTimeSegments` binds onClick
    // there), not the field wrapper.
    fireEvent.click(document.querySelector('[data-seg-part="time"]') as HTMLElement);
    const picker = screen.getByRole('dialog', { name: 'Chọn giờ — Giờ đóng/trả' });
    expect(picker).toBeTruthy();

    // The panel offers hour/minute listboxes plus an exact HH:mm entry; `Xong`
    // is the only path that applies and closes (operator ruling 2026-09-16:
    // a selection keeps the picker open).
    fireEvent.change(screen.getByLabelText('Giờ chính xác (HH:mm)'), { target: { value: '15:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    expect(onChange).toHaveBeenLastCalledWith('15:30');
  });

  it('Escape closes the picker without leaking to a parent dialog', () => {
    const onParentEscape = vi.fn();
    render(<div onKeyDown={onParentEscape}><Harness /></div>);

    act(() => seg('hh').focus());
    fireEvent.click(document.querySelector('[data-seg-part="time"]') as HTMLElement);
    fireEvent.keyDown(seg('hh'), { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Chọn giờ — Giờ đóng/trả' })).toBeNull();
    expect(onParentEscape).not.toHaveBeenCalled();
  });
});
