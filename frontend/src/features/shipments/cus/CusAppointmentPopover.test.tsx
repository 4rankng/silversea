import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    // Single buffered 24h text input under the combined date+time contract.
    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    expect(datetimeInput.type).toBe('text');
    expect(datetimeInput.value).toBe('10:30 08/09/2026');
    expect(datetimeInput.placeholder).toBe('HH:mm DD/MM/YYYY');
  });

  it('labels the single 24h input "Ngày giờ" with no visible native locale-driven inputs', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T20:45"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // Thứ tự hiển thị khớp hợp đồng "giờ trước ngày" qua đúng MỘT trường văn
    // bản 24h — không còn input native HIỂN THỊ theo locale trình duyệt
    // (AM/PM). Lịch chọn (datetime-local) phải luôn ẩn.
    const labels = Array.from(container.querySelectorAll('.cus-appointment-input-wrap label'));
    expect(labels.map((label) => label.textContent)).toEqual(['Ngày giờ']);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('_39: the calendar button opens the designed picker dialog — no native input', () => {
    const { container } = render(
      <CusAppointmentPopover isOpen={true} value="2026-09-08T08:00" containerLabel="MSKU1234567" onClose={vi.fn()} onChange={vi.fn()} />,
    );
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày giờ từ lịch' }));
    expect(screen.getByRole('dialog', { name: 'Chọn ngày giờ' })).toBeTruthy();
  });

  it('_39: picking a day in the designed panel applies the draft and rehydrates the 24h display', () => {
    const handleChange = vi.fn();
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={handleChange}
      />,
    );

    // Open the designed panels and pick day 15 of the value's month.
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày giờ từ lịch' }));
    fireEvent.click(screen.getByRole('button', { name: '15 Tháng 9 2026' }));
    // Existing 08:00 carries over — the composed draft is the buffered contract.
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T08:00');

    // The typed display rehydrates to the same 24h contract.
    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    expect(datetimeInput.value).toBe('08:00 15/09/2026');
  });

  it('falls back to focusing the text input when the browser has no showPicker', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // Older engines: no showPicker on the prototype — clicking the calendar
    // button must not throw and must keep the typed path usable.
    const calendarBtn = screen.getByRole('button', { name: 'Chọn ngày giờ từ lịch' });
    expect(() => fireEvent.click(calendarBtn)).not.toThrow();
    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    expect(datetimeInput).toBeDefined();
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

  it('emits the draft value for complete 24h text entry across the day', () => {
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

    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    // Card verify list: 20:46, 00:15, 23:45 — every entry stays on the 24h
    // clock and rehydrates the same naive wire value.
    fireEvent.change(datetimeInput, { target: { value: '20:46 15/09/2026' } });
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T20:46');

    fireEvent.change(datetimeInput, { target: { value: '00:15 15/09/2026' } });
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T00:15');

    fireEvent.change(datetimeInput, { target: { value: '23:45 15/09/2026' } });
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T23:45');

    // 08:00/13:30 through the input agree with the preset pills.
    fireEvent.change(datetimeInput, { target: { value: '13:30 15/09/2026' } });
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T13:30');
  });

  it('keeps typing without firing onChange until the entry is complete', () => {
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

    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    fireEvent.change(datetimeInput, { target: { value: '13:3' } });
    fireEvent.change(datetimeInput, { target: { value: '13:30 15/0' } });
    expect(handleChange).not.toHaveBeenCalled();

    // Blur normalizes the abandoned incomplete draft back to the current value.
    fireEvent.blur(datetimeInput);
    expect(datetimeInput.value).toBe('08:00 08/09/2026');
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

  it('Enter fires the commit callback once; Escape never commits', async () => {
    const handleClose = vi.fn();
    const handleCommit = vi.fn();
    render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="Cont 1"
        onClose={handleClose}
        onChange={vi.fn()}
        onCommit={handleCommit}
      />,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(handleCommit).toHaveBeenCalledTimes(1);
    // The close waits for the commit result — async even for a void commit.
    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(handleCommit).toHaveBeenCalledTimes(1);
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
    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    expect(datetimeInput.value).toBe('13:30 11/09/2026');
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

    const datetimeInput = container.querySelector('.cus-appointment-input') as HTMLInputElement;
    expect(datetimeInput.value).toBe('09:00 11/09/2026');
  });
  it('confirms once from the visible button and keeps a rejected save open for retry', async () => {
    const onClose = vi.fn();
    let reject!: (reason: Error) => void;
    const onCommit = vi.fn(() => new Promise<boolean>((_resolve, fail) => { reject = fail; }));
    render(<CusAppointmentPopover isOpen value="2026-09-08T08:00" containerLabel="Cont 1" onClose={onClose} onChange={vi.fn()} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-09-08T08:00');
    expect(screen.getByLabelText('Ngày giờ')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ngày mai' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xóa hẹn' })).toBeDisabled();
    reject(new Error('network unavailable'));
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeEnabled();
  });

  it('does not confirm an incomplete typed date using Enter', () => {
    const onCommit = vi.fn();
    render(<CusAppointmentPopover isOpen value="2026-09-08T08:00" containerLabel="Cont 1" onClose={vi.fn()} onChange={vi.fn()} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('Ngày giờ'), { target: { value: '12:3' } });
    fireEvent.keyDown(screen.getByLabelText('Ngày giờ'), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập ngày giờ đầy đủ');
  });

  it('ignores an earlier save result after closing and reopening the editor', async () => {
    let resolveFirst!: (ok: boolean) => void;
    const onClose = vi.fn();
    const onCommit = vi.fn(() => new Promise<boolean>((resolve) => { resolveFirst = resolve; }));
    const props = { value: '2026-09-08T08:00', containerLabel: 'Cont 1', onClose, onChange: vi.fn(), onCommit };
    const { rerender } = render(<CusAppointmentPopover {...props} isOpen />);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    rerender(<CusAppointmentPopover {...props} isOpen={false} />);
    rerender(<CusAppointmentPopover {...props} isOpen />);
    expect(screen.getByLabelText('Ngày giờ')).toBeEnabled();
    await act(async () => { resolveFirst(true); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });


});
