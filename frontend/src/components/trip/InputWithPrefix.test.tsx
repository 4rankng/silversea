import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InputWithPrefix } from './InputWithPrefix';

// QA-AUDIT-POLICY-245 (ADR 2026-10-01, card 20261002_293 AC3): trip quantity,
// rate and allowance inputs stay nonnegative. The money-mode input enforces it
// at the keystroke layer — the minus sign never survives into the stored raw
// digit string, so a negative trip cost cannot be typed, let alone persisted.

function type(raw: string) {
  const onChange = vi.fn();
  const { container } = render(<InputWithPrefix prefix="đ" type="money" value="" onChange={onChange} />);
  const input = container.querySelector('input')!;
  fireEvent.change(input, { target: { value: raw } });
  return { onChange, input };
}

describe('InputWithPrefix money mode — nonnegative trip inputs (QA-AUDIT-POLICY-245)', () => {
  it('drops a leading minus sign — a negative cost cannot be typed', () => {
    const { onChange } = type('-1500000');
    expect(onChange).toHaveBeenCalledWith('1500000');
  });

  it('strips an embedded minus and keeps the surrounding digits', () => {
    const { onChange } = type('15-00000');
    expect(onChange).toHaveBeenCalledWith('1500000');
  });

  it('keeps valid nonnegative digits as the stored raw string', () => {
    const { onChange } = type('1500000');
    expect(onChange).toHaveBeenCalledWith('1500000');
  });

  it('accepts an explicit zero as a value (0 is a value, card 20261002_293)', () => {
    const { onChange } = type('0');
    expect(onChange).toHaveBeenCalledWith('0');
  });
});
