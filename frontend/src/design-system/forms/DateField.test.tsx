import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateField } from './DateField';

describe('DateField', () => {
  it('renders a label-bound date input', () => {
    render(<DateField id="from" label="Từ ngày" value="2024-12-15" onChange={() => {}} />);
    const input = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    // The unified batch made the shared date input a buffered DD/MM/YYYY
    // text field (native locale pickers cannot force 24h/vi display).
    expect(input.type).toBe('text');
    expect(input.getAttribute('placeholder')).toBe('DD/MM/YYYY');
    expect(input.value).toBe('15/12/2024');
    expect(input.id).toBe('from');
  });

  it('marks itself invalid and links the error message via aria-describedby', () => {
    render(
      <DateField id="from" label="Từ ngày" value="" onChange={() => {}} error="Ngày bắt buộc" />,
    );
    const input = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('from-error');
    expect(document.getElementById('from-error')?.textContent).toBe('Ngày bắt buộc');
  });

  it('shows a required marker on the label when required', () => {
    render(<DateField id="from" label="Từ ngày" value="" onChange={() => {}} required />);
    expect(screen.getByText('Từ ngày').textContent).toContain('Từ ngày');
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('uses a stable label-to-input association when no id is provided', () => {
    render(<DateField label="Từ ngày" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    expect(input.id).toBeTruthy();
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toContain('Từ ngày');
  });

  it('renders helper text below the input when no error is set', () => {
    render(
      <DateField
        id="from"
        label="Từ ngày"
        value=""
        onChange={() => {}}
        helpText="Định dạng YYYY-MM-DD"
      />,
    );
    expect(screen.getByText('Định dạng YYYY-MM-DD')).toBeTruthy();
  });

  it('prefers the error message over helper text when both are set', () => {
    render(
      <DateField
        id="from"
        label="Từ ngày"
        value=""
        onChange={() => {}}
        error="Ngày không hợp lệ"
        helpText="Định dạng YYYY-MM-DD"
      />,
    );
    expect(screen.getByText('Ngày không hợp lệ')).toBeTruthy();
    expect(screen.queryByText('Định dạng YYYY-MM-DD')).toBeNull();
  });

  it('disables the input when disabled is true', () => {
    render(<DateField id="from" label="Từ ngày" value="" onChange={() => {}} disabled />);
    const input = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('does not call onChange for a partial draft (the flash bug fix)', () => {
    const onChange = vi.fn();
    render(<DateField id="from" label="Từ ngày" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Từ ngày') as HTMLInputElement;

    // Simulate a partial entry — even though the browser would reject the
    // value attribute, we drive the underlying onChange handler to verify
    // the component does not propagate the partial draft to the parent.
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '15/1' } });
    fireEvent.change(input, { target: { value: '15/12/20' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange once when the user completes a date', () => {
    const onChange = vi.fn();
    render(<DateField id="from" label="Từ ngày" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Từ ngày') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '15/12/2024' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2024-12-15');
  });

  it('propagates only complete (or cleared) values to the parent — the contract that prevents the flash bug', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateField id="from" label="Từ ngày" value="" onChange={onChange} />,
    );
    const input = container.querySelector('#from') as HTMLInputElement;

    // The buffered text input only emits once the DD/MM/YYYY entry parses;
    // partial drafts stay in the field without reaching the parent.
    fireEvent.change(input, { target: { value: '15/12/2024' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2024-12-15');

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
