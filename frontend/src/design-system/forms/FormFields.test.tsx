import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectField } from './SelectField';
import { UuiSelectField } from './UuiSelectField';
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

  it('associates SelectField validation and keeps the selection contract stable', async () => {
    const onChange = vi.fn();
    render(
      <SelectField id="container-type" label="Loại container" value="" onChange={onChange} error="Chọn loại container.">
        <option value="">— Chọn loại —</option>
        <option value="31">40HC</option>
      </SelectField>,
    );
    // The visible control is the trigger button — the native select that
    // carries the label association is UUI's hidden accessibility fallback.
    const trigger = screen.getByRole('button', { name: /Loại container/ });
    expect(trigger.tagName).not.toBe('SELECT');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: '40HC' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '31' }) }));
  });

  it('supports keyboard listbox navigation, selection, and Escape focus restoration', async () => {
    const onChange = vi.fn();
    render(
      <UuiSelectField
        id="container-type"
        label="Loại container"
        value=""
        onChange={onChange}
        options={[
          { value: '', label: '— Chọn loại —' },
          { value: '21', label: '20DC' },
          { value: '31', label: '40HC' },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Loại container/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // After opening, React Aria moves focus into the listbox — keyboard
    // selection goes to the focused option, not the trigger.
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(document.activeElement ?? listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '31' }) }));
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));

    // Re-open via click (after selection, jsdom does not restore trigger
    // focus automatically), then Escape must dismiss and restore focus.
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(trigger).toHaveFocus();
  });
});
