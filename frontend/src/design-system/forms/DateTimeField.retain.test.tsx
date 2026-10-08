import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeField } from './DateTimeField';

function clickWithFocus(element: HTMLElement) {
  fireEvent.pointerDown(element);
  fireEvent.mouseDown(element);
  act(() => element.focus());
  fireEvent.click(element);
}

function openViaFrame(part: 'time' | 'date' = 'time') {
  const group = document.querySelector(`[data-seg-part="${part}"]`);
  if (!group) throw new Error(`segments group (${part}) not found`);
  fireEvent.click(group);
}

function Harness({ value = '', onChange }: { value?: string; onChange?: (value: string) => void }) {
  const [current, setCurrent] = useState(value);
  return <form><DateTimeField label="Giờ trả hàng" value={current} onChange={(next) => { setCurrent(next); onChange?.(next); }} /></form>;
}

const hour = () => screen.getByLabelText('Giờ — Giờ trả hàng');
const minute = () => screen.getByLabelText('Phút — Giờ trả hàng');
const day = () => screen.getByLabelText('Ngày — Giờ trả hàng');
const month = () => screen.getByLabelText('Tháng — Giờ trả hàng');
const year = () => screen.getByLabelText('Năm — Giờ trả hàng');

/** Real-keystroke simulation: keydown + selection-aware edit (select-all
 * replace and append-at-caret both land as the browser would). */
function typeInto(input: HTMLElement, keys: string[]) {
  const el = input as HTMLInputElement;
  for (const key of keys) {
    fireEvent.keyDown(input, { key });
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const edited = (el.value.slice(0, start) + key + el.value.slice(end)).replace(/\D/g, '');
    fireEvent.change(input, { target: { value: edited.slice(0, 2) } });
  }
}

function mobileWidth() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 640px)',
    media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

// Retention contract for segmented datetime entry: a two-digit completion
// hands focus to the next segment AND every sibling segment keeps its value.
// Both halves must hold with the picker pointer-opened (its close lands on
// the same keystroke), at mobile-sheet width, on an empty field, and with no
// picker involved at all. The keystroke simulation is selection-aware: the
// first digit replaces the select-on-focus selection, later digits append.
describe('segmented datetime advances and retains siblings', () => {
  it('type-over on a full hour with the picker open advances to the minute and retains every sibling', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-10-06T14:45" onChange={onChange} />);
    expect(hour()).toHaveValue('14');
    expect(minute()).toHaveValue('45');
    clickWithFocus(hour()); openViaFrame();
    await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' });
    expect(hour()).toHaveFocus();
    typeInto(hour(), ['0', '8']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('45');
    expect(day()).toHaveValue('06');
    expect(month()).toHaveValue('10');
    expect(year()).toHaveValue('2026');
    expect(minute()).toHaveFocus();
  });

  it('at mobile-sheet width the same type-over closes the sheet on the first digit and still advances', async () => {
    mobileWidth();
    const onChange = vi.fn();
    render(<Harness value="2026-10-06T14:45" onChange={onChange} />);
    clickWithFocus(hour()); openViaFrame();
    await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' });
    typeInto(hour(), ['0', '8']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('45');
    expect(day()).toHaveValue('06');
    expect(minute()).toHaveFocus();
  });
  it('typing two digits into an empty field advances even though the target segment is empty', async () => {
    const onChange = vi.fn();
    render(<Harness value="" onChange={onChange} />);
    clickWithFocus(hour()); openViaFrame();
    await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' });
    typeInto(hour(), ['0', '8']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveFocus();
  });

  it('keyboard entry with no picker involved advances and retains siblings', () => {
    const onChange = vi.fn();
    render(<Harness value="2026-10-06T14:45" onChange={onChange} />);
    act(() => hour().focus());
    typeInto(hour(), ['0', '8']);
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('45');
    expect(day()).toHaveValue('06');
    expect(minute()).toHaveFocus();
  });
});
