import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectField } from './SelectField';
import { TextField } from './TextField';

describe('form field accessibility', () => {
  it('associates a stable TextField id with its label and error', () => {
    render(<TextField id="booking-ref" label="Số Bill/Book" error="Nhập số Bill hoặc số Booking." />);
    const input = screen.getByLabelText('Số Bill/Book');
    expect(input.id).toBe('booking-ref');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('booking-ref-error');
    expect(document.getElementById('booking-ref-error')?.textContent).toBe('Nhập số Bill hoặc số Booking.');
  });

  it('associates SelectField validation and keeps option ids stable', () => {
    const onChange = vi.fn();
    render(
      <SelectField id="container-type" label="Loại container" value="" onChange={onChange} error="Chọn loại container.">
        <option value="">— Chọn loại —</option>
        <option value="31">40HC</option>
      </SelectField>,
    );
    const trigger = screen.getByLabelText('Loại container');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('container-type-error');
    expect(document.querySelectorAll('#container-type')).toHaveLength(1);
    expect(document.getElementById('container-type-native')).toBeTruthy();
    fireEvent.click(trigger);
    fireEvent.click(document.getElementById('container-type-option-31')!);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '31' }) }));
  });

  it('supports keyboard listbox navigation, selection, and Escape focus restoration', async () => {
    const onChange = vi.fn();
    render(
      <SelectField id="container-type" label="Loại container" value="" onChange={onChange}>
        <option value="">— Chọn loại —</option>
        <option value="21">20DC</option>
        <option value="31">40HC</option>
      </SelectField>,
    );

    const trigger = screen.getByLabelText('Loại container');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-activedescendant')).toBe('container-type-option-21');

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe('container-type-option-');
    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe('container-type-option-');
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe('container-type-option-31');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '31' }) }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(trigger, { key: ' ' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(trigger);
  });
});
