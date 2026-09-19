import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CusAppointmentPopover } from './CusAppointmentPopover';
import { getOffsetDateString } from './cusAppointmentUtils';

// The segmented datetime rework split each part into per-digit inputs
// ([data-seg]) inside the shared SplitDateTimeField; these helpers target the
// segments. Full-string changes still work on the first segment of a part
// (paste distribution fills the rest).
function splitInputs(container: HTMLElement | Document): {
  time: HTMLInputElement; date: HTMLInputElement;
  hour: HTMLInputElement; minute: HTMLInputElement; day: HTMLInputElement; month: HTMLInputElement; year: HTMLInputElement;
} {
  const root = container.querySelector('[data-split-datetime]');
  expect(root).toBeTruthy();
  const seg = (key: string) => {
    const input = root!.querySelector<HTMLInputElement>(`input[data-seg="${key}"]`);
    expect(input).toBeTruthy();
    return input!;
  };
  const hour = seg('hh'); const minute = seg('mm'); const day = seg('dd'); const month = seg('mm2'); const year = seg('yyyy');
  return { time: hour, date: day, hour, minute, day, month, year };
}

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

  it('renders correctly when isOpen is true with container badge and split inputs', () => {
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

    const { hour, minute, day, month, year } = splitInputs(container);
    expect(hour.value).toBe('10');
    expect(minute.value).toBe('30');
    expect(day.value).toBe('08');
    expect(month.value).toBe('09');
    expect(year.value).toBe('2026');
  });

  it('labels the separate time/date inputs and keeps native locale pickers out', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T20:45"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const { time, date } = splitInputs(container);
    expect(time.getAttribute('aria-label')).toMatch(/^Giờ — /);
    expect(date.getAttribute('aria-label')).toMatch(/^Ngày — /);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('opens the date panel from the date trigger and applies the picked day', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch — Giờ hẹn đóng/trả' }));
    const dayCell = document.querySelector<HTMLButtonElement>('.dtp-grid button[data-idx="15"]');
    expect(dayCell).toBeTruthy();
    fireEvent.click(dayCell!);

    // Time was prefilled (08:00), so the completed pair publishes immediately.
    expect(handleChange).toHaveBeenCalledWith('2026-09-15T08:00');
    const { day, month, year } = splitInputs(container);
    expect(day.value).toBe('15');
    expect(month.value).toBe('09');
    expect(year.value).toBe('2026');
  });

  it('keeps time and date as plain editable text inputs', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen={true}
        value="2026-09-08T08:00"
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const { hour, minute, day, month, year } = splitInputs(container);
    for (const input of [hour, minute, day, month, year]) {
      expect(input.type).toBe('text');
      expect(input.inputMode).toBe('numeric');
    }
    expect(hour.placeholder).toBe('HH');
    expect(minute.placeholder).toBe('mm');
    expect(day.placeholder).toBe('DD');
    expect(month.placeholder).toBe('MM');
    expect(year.placeholder).toBe('YYYY');
  });

  it('emits the composed value for complete 24h text entry across the day', () => {
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

    const { time, date } = splitInputs(container);
    const cases: Array<[string, string, string]> = [
      ['20:46', '15/09/2026', '2026-09-15T20:46'],
      ['00:15', '15/09/2026', '2026-09-15T00:15'],
      ['23:45', '15/09/2026', '2026-09-15T23:45'],
      ['13:30', '15/09/2026', '2026-09-15T13:30'],
    ];
    for (const [nextTime, nextDate, wire] of cases) {
      fireEvent.change(time, { target: { value: nextTime } });
      fireEvent.change(date, { target: { value: nextDate } });
      expect(handleChange).toHaveBeenCalledWith(wire);
    }
  });

  it('keeps incomplete typing visible without firing onChange', () => {
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

    const { time, date, hour, minute } = splitInputs(container);
    fireEvent.change(time, { target: { value: '13:3' } });
    fireEvent.change(date, { target: { value: '15/09/2026' } });
    expect(handleChange).not.toHaveBeenCalled();
    // The partial draft stays visible (unified contract: incomplete text is
    // never silently cleared or saved).
    expect(hour.value).toBe('13');
    expect(minute.value).toBe('3');
    expect(date.value).toBe('15');
  });

  it('closes when pressing outside via pointerdown on document', () => {
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
    // The press-dismiss contract is a single pointerdown listener (the compat
    // mousedown double-listener was retired with the unified pickers).
    fireEvent.pointerDown(outside);
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
    const { hour, minute, day, month, year } = splitInputs(container);
    expect(hour.value).toBe('13');
    expect(minute.value).toBe('30');
    expect(day.value).toBe('11');
    expect(month.value).toBe('09');
    expect(year.value).toBe('2026');
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

    const { hour, minute, day, month, year } = splitInputs(container);
    expect(hour.value).toBe('09');
    expect(minute.value).toBe('00');
    expect(day.value).toBe('11');
    expect(month.value).toBe('09');
    expect(year.value).toBe('2026');
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
    const { hour, minute, day, month, year } = splitInputs(document);
    for (const input of [hour, minute, day, month, year]) expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ngày mai' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xóa hẹn' })).toBeDisabled();
    reject(new Error('network unavailable'));
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeEnabled();
  });

  it('does not confirm an incomplete typed date using Enter', () => {
    const onCommit = vi.fn();
    const { container } = render(<CusAppointmentPopover isOpen value="2026-09-08T08:00" containerLabel="Cont 1" onClose={vi.fn()} onChange={vi.fn()} onCommit={onCommit} />);
    const { time } = splitInputs(container);
    fireEvent.change(time, { target: { value: '13:3' } });
    fireEvent.keyDown(time, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ');
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
    const { time } = splitInputs(document);
    expect(time).toBeEnabled();
    await act(async () => { resolveFirst(true); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('_15: an appointment-less container opens with empty inputs and inactive pills', () => {
    const { container } = render(
      <CusAppointmentPopover
        isOpen
        value={null}
        containerLabel="MSKU1234567"
        onClose={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const { hour, minute, day, month, year } = splitInputs(container);
    for (const input of [hour, minute, day, month, year]) expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Hôm nay' }).className).not.toContain('is-active');
    for (const slot of ['08:00', '10:00', '13:30', '16:00']) {
      expect(screen.getByRole('button', { name: slot }).className).not.toContain('is-active');
    }
  });

  it('_15: Enter without any explicit pick on an appointment-less container does not commit', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    render(
      <CusAppointmentPopover
        isOpen
        value={null}
        containerLabel="MSKU1234567"
        onClose={onClose}
        onChange={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa chọn ngày giờ để lưu');
  });

  it('_15: Xác nhận stays disabled until the user makes an explicit pick, then commits it', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    // The pill derives its slot via businessDateOffsetISO (Vietnam-anchored
    // day). Freeze the clock BEFORE the first render so every render's slot
    // and the assertion below share one instant — runs straddling midnight
    // VN/local can no longer split the two.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-19T09:00:00+07:00'));
    const expectedDay = getOffsetDateString(0, new Date());
    render(
      <CusAppointmentPopover
        isOpen
        value={null}
        containerLabel="MSKU1234567"
        onClose={onClose}
        onChange={vi.fn()}
        onCommit={onCommit}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận' });
    expect(confirmBtn).toBeDisabled();

    // Explicit pick via quick pill — commits the picked slot.
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(confirmBtn).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(`${expectedDay}T08:00`));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    vi.useRealTimers();
  });

  it('closes on Escape; Enter without a commit path shows an error and stays open', () => {
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

    // _34: Enter without a wired commit path is a configuration error —
    // never a silent close (that signature shipped the cut-#27 zero-POST bug).
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Không thể lưu: phiên chỉnh sửa không còn đường lưu.')).toBeTruthy();
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
});
