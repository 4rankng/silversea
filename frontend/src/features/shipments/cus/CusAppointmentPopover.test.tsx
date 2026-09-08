import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CusAppointmentPopover } from './CusAppointmentPopover';

describe('CusAppointmentPopover', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={false}
        value="2026-09-08T08:00"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.cus-appointment-popover')).toBeNull();
  });

  it('renders correctly when isOpen is true with container badge and inputs', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T10:30"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: /MSKU1234567/ })).toBeDefined();
    expect(screen.getByText('MSKU1234567')).toBeDefined();

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-09-08');
    expect(timeInput.value).toBe('10:30');
  });

  it('selects quick date pill and immediately calls onChange', () => {
    const handleChange = vi.fn();
    render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={vi.fn()}
        onChange={handleChange}
      />,
    );

    const tomorrowButton = screen.getByRole('button', { name: 'Ngày mai' });
    fireEvent.click(tomorrowButton);

    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 1);
    const y = expectedDate.getFullYear();
    const m = String(expectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(expectedDate.getDate()).padStart(2, '0');

    expect(handleChange).toHaveBeenCalledWith(`${y}-${m}-${d}T08:00`);
  });

  it('selects quick time pill and immediately calls onChange', () => {
    const handleChange = vi.fn();
    render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={vi.fn()}
        onChange={handleChange}
      />,
    );

    const time1330 = screen.getByRole('button', { name: '13:30' });
    fireEvent.click(time1330);
    expect(handleChange).toHaveBeenCalledWith('2026-09-08T13:30');
  });

  it('updates value when date and time inputs change', () => {
    const handleChange = vi.fn();
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={vi.fn()}
        onChange={handleChange}
      />,
    );

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-09-15' } });
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T08:00');

    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(timeInput, { target: { value: '14:00' } });
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T14:00');
  });

  it('calls onChange with empty string when clicking Xóa hẹn', () => {
    const handleChange = vi.fn();
    const handleClose = vi.fn();
    render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={handleClose}
        onChange={handleChange}
      />,
    );

    const clearBtn = screen.getByRole('button', { name: 'Xóa hẹn' });
    fireEvent.click(clearBtn);
    expect(handleChange).toHaveBeenCalledWith('');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes when pressing Escape or Enter', () => {
    const handleClose = vi.fn();
    render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={handleClose}
        onChange={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
