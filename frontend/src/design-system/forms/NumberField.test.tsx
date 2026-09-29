import { fireEvent, render, screen } from '@testing-library/react';
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
