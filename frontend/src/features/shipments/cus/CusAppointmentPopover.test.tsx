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

  it('renders giờ before ngày with 24h locale pinned to en-GB', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T20:45"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // Thứ tự trường khớp định dạng cột bảng "20:45 8/9/26": giờ trước, ngày sau.
    const labels = Array.from(container.querySelectorAll('.cus-appointment-input-wrap label'));
    expect(labels.map((label) => label.textContent)).toEqual(['Giờ', 'Ngày']);

    // ép input date/time hiển thị 24h + dd/mm/yyyy bất kể locale trình duyệt (AM/PM)
    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(timeInput.getAttribute('lang')).toBe('en-GB');
    expect(dateInput.getAttribute('lang')).toBe('en-GB');
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

  it('closes when clicking outside via mousedown on document', () => {
    const handleClose = vi.fn();
    render(
      <div>
        <div data-testid="outside-area">Outside element</div>
        <CusAppointmentPopover
          isOpen={true}
          value="2026-09-08T08:00"
          containerLabel="Cont 1"
          onClose={handleClose}
          onChange={vi.fn()}
        />
      </div>,
    );

    const outside = screen.getByTestId('outside-area');
    fireEvent.mouseDown(outside);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking outside via pointerdown on document', () => {
    const handleClose = vi.fn();
    render(
      <div>
        <div data-testid="outside-area">Outside element</div>
        <CusAppointmentPopover
          isOpen={true}
          value="2026-09-08T08:00"
          containerLabel="Cont 1"
          onClose={handleClose}
          onChange={vi.fn()}
        />
      </div>,
    );

    const outside = screen.getByTestId('outside-area');
    fireEvent.pointerDown(outside);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the popover dialog', () => {
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
    fireEvent.mouseDown(dialog);
    fireEvent.pointerDown(dialog);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('closes when clicking the backdrop element', () => {
    const handleClose = vi.fn();
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={handleClose}
        onChange={vi.fn()}
      />,
    );

    const backdrop = container.querySelector('.cus-appointment-backdrop') as HTMLElement;
    expect(backdrop).toBeDefined();
    fireEvent.pointerDown(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('prefills Vietnam wall-clock from a UTC instant on any browser timezone', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-11T06:30:00.000Z"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // 06:30Z = 13:30 +07 — the old parse rendered browser-local (14:30 on a
    // +08 host), so the recomposed write drifted another hour.
    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(timeInput.value).toBe('13:30');
    expect(dateInput.value).toBe('2026-09-11');
  });

  it('round-trips a naive draft verbatim without re-interpreting it', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-11T09:00"
        containerLabel="MSK0098765"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(timeInput.value).toBe('09:00');
    expect(dateInput.value).toBe('2026-09-11');
  });
});
