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
  it('consumes Enter while its picker is open instead of submitting the surrounding editor', () => {
    const parentKeyDown = vi.fn();
    render(<Harness onParentKeyDown={parentKeyDown} />);
    const input = screen.getByLabelText('Giờ giao');
    act(() => input.focus());
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: '14:23' } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('14:23');
    expect(input).toHaveFocus();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it.each(['14:', '25:99'])('reveals invalid time feedback on Enter and never forwards it: %s', (value) => {
    const parentKeyDown = vi.fn();
    render(<Harness onParentKeyDown={parentKeyDown} />);
    const input = screen.getByLabelText('Giờ giao');
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
});
