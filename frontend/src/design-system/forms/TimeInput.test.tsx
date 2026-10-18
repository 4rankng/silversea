import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TimeInput } from './TimeInput';

function Harness({ onParentKeyDown = vi.fn(), onKeyDown }: {
  onParentKeyDown?: React.KeyboardEventHandler<HTMLFormElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [value, setValue] = useState('08:17');
  return <form onKeyDown={onParentKeyDown}>
    <TimeInput label="Giờ giao" value={value} onChange={setValue} validateOnBlur onKeyDown={onKeyDown} />
  </form>;
}

describe('TimeInput outer-field keyboard ownership', () => {
  it('FB-002 (181026000027): a HAND-TYPED draft\'s Enter reaches the host even while its picker is open', () => {
    const parentKeyDown = vi.fn();
    render(<Harness onParentKeyDown={parentKeyDown} />);
    const input = screen.getByLabelText('Giờ giao');
    act(() => input.focus());
    // The click that focuses the field also opens the picker.
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: '14:23' } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The typed draft's Enter must NOT be consumed: it closes the picker and
    // flows to the host's save path (the QA flow on the "Chỉnh sửa Lịch
    // trình" dialog — typing giờ + Enter used to be a dead key).
    expect(fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('14:23');
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('still consumes Enter while its picker is open when nothing was typed (picker finishing)', () => {
    const parentKeyDown = vi.fn();
    render(<Harness onParentKeyDown={parentKeyDown} />);
    const input = screen.getByLabelText('Giờ giao');
    act(() => input.focus());
    fireEvent.click(input);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Pure picker use (opened, nothing typed): Enter finishes the picker and
    // must NOT submit the surrounding editor — the card 20260915_6/8 law.
    expect(fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it.each(['14:', '25:99'])('reveals invalid time feedback on Enter and never forwards it: %s', (value) => {
    const parentKeyDown = vi.fn();
    render(<Harness onParentKeyDown={parentKeyDown} />);
    const input = screen.getByLabelText('Giờ giao');
    fireEvent.click(input);
    fireEvent.change(input, { target: { value } });
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })).toBe(false);
    expect(input).toHaveValue(value);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeInvalid();
    expect(screen.getByText('Nhập giờ từ 00:00 đến 23:59 (HH:mm).')).toBeInTheDocument();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('preserves valid closed-picker Enter behavior for its owning form', () => {
    const parentKeyDown = vi.fn();
    render(<Harness onParentKeyDown={parentKeyDown} />);
    expect(fireEvent.keyDown(screen.getByLabelText('Giờ giao'), { key: 'Enter', code: 'Enter' })).toBe(true);
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('respects a custom handler that owns Enter without changing its picker', () => {
    const onKeyDown = vi.fn<React.KeyboardEventHandler<HTMLInputElement>>((event) => event.preventDefault());
    render(<Harness onKeyDown={onKeyDown} />);
    const input = screen.getByLabelText('Giờ giao');
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('FB-030/075 (171026215500): fires onComplete once a typed entry completes a valid time (auto-colon path)', () => {
    const onComplete = vi.fn();
    const onChange = vi.fn();
    render(<TimeInput label="Giờ giao" value="" onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByLabelText('Giờ giao');
    fireEvent.change(input, { target: { value: '1430' } });
    expect(onChange).toHaveBeenCalledWith('14:30');
    expect(onComplete).toHaveBeenCalledTimes(1);
    // A partial entry never completes.
    onComplete.mockClear();
    fireEvent.change(input, { target: { value: '14' } });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('FB-002 round 22: a digit typed into a FULL prefilled field restarts the entry (type-over law)', () => {
    const onChange = vi.fn();
    render(<TimeInput label="Giờ giao" value="14:30" onChange={onChange} />);
    const input = screen.getByLabelText('Giờ giao');
    // Collapsed caret at the end of a full (maxLength 5) field: the keystroke
    // must restart the entry instead of being silently dropped by maxLength —
    // editing a lot that already carries a giờ was a dead field.
    fireEvent.keyDown(input, { key: '1', code: 'Digit1' });
    expect(onChange).toHaveBeenCalledWith('1');
    // Selection present (not collapsed): native behavior — nothing restarts.
    onChange.mockClear();
    (input as HTMLInputElement).setSelectionRange(0, 5);
    fireEvent.keyDown(input, { key: '9', code: 'Digit9' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
