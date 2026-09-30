import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';

/**
 * The `signed` opt-in on grouped money inputs.
 *
 * Grouped mode renders a TEXT input and strips every non-digit on entry, so a
 * user cannot type a negative no matter what `min` says — in grouped mode
 * `min`/`max`/`step` are not forwarded at all, because they are meaningless on
 * a text field and NumberField enforces bounds save-side instead.
 *
 * That is why `signed` is opt-in and not a change to `grouped` itself: many
 * money fields are genuinely unsigned (quantities, rates, counts), and quietly
 * letting a minus into those would be a new defect. These cases pin both
 * halves — signed takes the sign, unsigned still refuses it.
 */
function renderField(props: Partial<React.ComponentProps<typeof NumberField>> = {}) {
  const onChange = vi.fn();
  render(<NumberField label="Số tiền" value="" onChange={onChange} grouped {...props} />);
  return { field: screen.getByLabelText('Số tiền') as HTMLInputElement, onChange };
}

describe('NumberField — grouped signed input', () => {
  it('unsigned grouped still refuses a minus (the default must not change)', () => {
    const { field, onChange } = renderField();
    fireEvent.change(field, { target: { value: '-30000' } });
    // The sign is stripped; only the digits survive.
    expect(onChange).toHaveBeenCalledWith(30000);
  });

  it('signed grouped accepts a leading minus', () => {
    const { field, onChange } = renderField({ signed: true });
    fireEvent.change(field, { target: { value: '-30000' } });
    expect(onChange).toHaveBeenCalledWith(-30000);
  });

  it('signed grouped keeps only ONE sign, so Number() cannot become NaN', () => {
    const { field, onChange } = renderField({ signed: true });
    onChange.mockClear();
    fireEvent.change(field, { target: { value: '--30000' } });
    // A second minus is not meaningful; the emitted value must stay a number.
    for (const call of onChange.mock.calls) {
      expect(call[0]).not.toBeNaN();
    }
  });

  it('signed grouped renders a negative value with its sign', () => {
    render(<NumberField label="Số tiền" value={-30000} onChange={() => {}} grouped signed />);
    expect((screen.getByLabelText('Số tiền') as HTMLInputElement).value).toBe('-30.000');
  });

  it('a lone minus is not committed as a value', () => {
    const { field, onChange } = renderField({ signed: true });
    onChange.mockClear();
    fireEvent.change(field, { target: { value: '-' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('grouped still drops min/max/step — they are meaningless on a text input', () => {
    const { field } = renderField({ min: 1, max: 999_999_999_999_999 });
    expect(field.getAttribute('min')).toBeNull();
    expect(field.getAttribute('max')).toBeNull();
    expect(field.getAttribute('type')).toBe('text');
  });
});

/**
 * Card 20260930_224 — the keystroke-level contract, inheriting every money
 * entry surface (the module lib/moneyInput.ts is deleted; these cases are the
 * behavioural lock that replaced it). Keystrokes are simulated as successive
 * input changes, exactly what a real keyboard does to a controlled field.
 */
/** Controlled harness: the real parent holds the value, so display assertions
 * observe exactly what a user sees after each keystroke. */
function KeystrokeHarness(props: { label: string; initial?: number | ''; grouped?: boolean; signed?: boolean }) {
  const [value, setValue] = useState<number | ''>(props.initial ?? '');
  return <NumberField label={props.label} value={value} onChange={setValue} grouped={props.grouped} signed={props.signed} />;
}

describe('NumberField — keystroke-level money entry', () => {
  it('minus-first: the sign is held while the digits are not there yet, then applied', () => {
    render(<KeystrokeHarness label="Chi phí" grouped signed />);
    const field = screen.getByLabelText('Chi phí') as HTMLInputElement;

    fireEvent.change(field, { target: { value: '-' } });
    expect(field).toHaveValue('-'); // held in the field, not re-rendered away

    fireEvent.change(field, { target: { value: '-30' } });
    expect(field).toHaveValue('-30');

    fireEvent.change(field, { target: { value: '-30000' } });
    expect(field).toHaveValue('-30.000'); // grouped display derives the separators
  });

  it('separators: typed digits group live, and a hand-typed separator is re-derived away', () => {
    render(<KeystrokeHarness label="Cước" grouped />);
    const field = screen.getByLabelText('Cước') as HTMLInputElement;

    for (const typed of ['1', '12', '120', '1200', '12000', '120000', '1200000']) {
      fireEvent.change(field, { target: { value: typed } });
    }
    expect(field).toHaveValue('1.200.000');

    // A user typing "1.2.0.0" gets the grouped rendering of the digits only.
    fireEvent.change(field, { target: { value: '1.2.0.0' } });
    expect(field).toHaveValue('1.200');
  });

  it('paste: a formatted amount with currency noise normalizes to the number', () => {
    render(<KeystrokeHarness label="Số tiền" grouped />);
    const field = screen.getByLabelText('Số tiền') as HTMLInputElement;

    fireEvent.change(field, { target: { value: '  1.234.567đ ' } });
    expect(field).toHaveValue('1.234.567');
  });

  it('empty state: clearing emits "" and renders "" — never a stale 0', () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberField label="Tạm ứng" value={50000} onChange={onChange} grouped />);
    const field = screen.getByLabelText('Tạm ứng') as HTMLInputElement;
    expect(field).toHaveValue('50.000');

    fireEvent.change(field, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
    rerender(<NumberField label="Tạm ứng" value={''} onChange={onChange} grouped />);
    expect(field).toHaveValue('');
  });

  it('ungrouped decimal path: "1.5" stays one and a half, not a stripped integer', () => {
    render(<KeystrokeHarness label="Định mức" />);
    const field = screen.getByLabelText('Định mức') as HTMLInputElement;

    fireEvent.change(field, { target: { value: '1.5' } });
    // A type=number input reports its value as a number to the DOM.
    expect(field).toHaveValue(1.5);
  });
});
