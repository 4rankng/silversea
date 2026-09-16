import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';

function clickWithFocus(element: HTMLElement) {
  fireEvent.pointerDown(element);
  fireEvent.mouseDown(element);
  act(() => element.focus());
  fireEvent.click(element);
}

function Harness({ value = '', onChange = vi.fn() }: { value?: string; onChange?: (value: string) => void }) {
  const [current, setCurrent] = useState(value);
  return <form><SplitDateTimeField label="Hẹn" value={current} onChange={(next) => { setCurrent(next); onChange(next); }} /></form>;
}

describe('SplitDateTimeField', () => {
  it('keeps partial time/date visible and only emits complete timestamps or empty', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const time = screen.getByLabelText('Giờ — Hẹn');
    const date = screen.getByLabelText('Ngày — Hẹn');
    fireEvent.change(time, { target: { value: '20:4' } });
    fireEvent.blur(time);
    expect(time).toHaveValue('20:4');
    expect(time).toBeInvalid();
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.change(time, { target: { value: '20:46' } });
    fireEvent.change(date, { target: { value: '19/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T20:46');
    expect(time).toBeValid();
    expect(date).toBeValid();
    fireEvent.change(date, { target: { value: '19/0' } });
    expect(time).toHaveValue('20:46');
    expect(date).toHaveValue('19/0');
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(date).toBeInvalid();
  });

  it('disabling during picker editing closes the portal and refuses further changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SplitDateTimeField label="Hẹn" value="2026-09-19T08:00" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Giờ — Hẹn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(<SplitDateTimeField label="Hẹn" value="2026-09-19T08:00" onChange={onChange} disabled />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Giờ — Hẹn')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Giờ — Hẹn'), { target: { value: '13:30' } });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<SplitDateTimeField label="Hẹn" value="2026-09-19T08:00" onChange={onChange} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens independent date and 24h time pickers and restores focus after selection', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-09-19T08:00" onChange={onChange} />);
    const dateTrigger = screen.getByLabelText('Ngày — Hẹn');
    fireEvent.click(dateTrigger);
    let dialog = screen.getByRole('dialog', { name: 'Chọn ngày — Hẹn' });
    expect(within(dialog).queryByRole('listbox', { name: 'Giờ 00–23' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '20 Tháng 9 2026' }));
    expect(screen.getByLabelText('Ngày — Hẹn')).toHaveValue('20/09/2026');
    expect(dateTrigger).toHaveFocus();
    fireEvent.click(screen.getByLabelText('Giờ — Hẹn'));
    dialog = screen.getByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
    fireEvent.click(within(within(dialog).getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '23' }));
    fireEvent.click(within(within(dialog).getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '45' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-09-20T23:45');
    expect(screen.getByLabelText('Giờ — Hẹn')).toHaveValue('23:45');
    // Selections keep the panel open (user ruling 2026-09-16); Xong is the
    // explicit close and hands focus back to the field.
    expect(screen.getByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Giờ — Hẹn')).toHaveFocus());
  });

  it('clicking fields opens their picker without stealing typing focus or showing premature errors', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const time = screen.getByLabelText('Giờ — Hẹn');
    const date = screen.getByLabelText('Ngày — Hẹn');
    expect(screen.queryByRole('button', { name: /Chọn giờ|Chọn ngày/ })).not.toBeInTheDocument();
    clickWithFocus(time);
    expect(time).toHaveFocus();
    expect(time).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(time, { target: { value: '13:30' } });
    expect(time).toHaveValue('13:30');
    expect(time).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    clickWithFocus(date);
    expect(date).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(date, { target: { value: '19/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T13:30');
    fireEvent.keyDown(date, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(date).toHaveFocus();
    expect(date).toHaveValue('19/09/2026');
  });

  it('picking time first preserves the incomplete pair without red feedback until group exit', async () => {
    render(<><Harness /><button type="button">Outside</button></>);
    const time = screen.getByLabelText('Giờ — Hẹn');
    clickWithFocus(time);
    clickWithFocus(within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '13' }));
    clickWithFocus(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '30' }));
    // Selections apply and keep the panel open (2026-09-16 ruling); Xong
    // is the explicit close and hands focus back to the field.
    expect(screen.getByRole('listbox', { name: 'Phút 00–59' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(time).toHaveFocus());
    expect(time).not.toHaveAttribute('aria-invalid', 'true');
    expect((time as HTMLInputElement).validity.valid).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    clickWithFocus(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
    expect(time).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([false, true])('settles late selector focus cleanup without stealing a genuine outside focus: %s', async (leaveGroup) => {
    let nextFrame: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { nextFrame = callback; return 1; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    try {
      render(<><Harness /><input aria-label="Outside field" /></>);
      const time = screen.getByLabelText('Giờ — Hẹn');
      clickWithFocus(time);
      clickWithFocus(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '05' }));
      clickWithFocus(within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '01' }));
      expect(time).toHaveValue('01:05');
      // Selections keep the panel open (2026-09-16 ruling); Xong closes.
      expect(screen.getByRole('listbox', { name: 'Giờ 00–23' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Chrome can perform the picker's remaining focus cleanup after the
      // panel closes; finish the handoff before judging focus.
      const outside = screen.getByLabelText('Outside field');
      act(() => { if (leaveGroup) outside.focus(); else time.blur(); });
      act(() => nextFrame?.(0));
      if (leaveGroup) {
        expect(outside).toHaveFocus();
        expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
      } else {
        expect(time).toHaveFocus();
        expect(time).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      }
    } finally { raf.mockRestore(); cancel.mockRestore(); }
  });

  it('Enter and native invalid events expose incomplete-pair feedback without submitting', () => {
    render(<Harness />);
    const time = screen.getByLabelText('Giờ — Hẹn');
    fireEvent.change(time, { target: { value: '13:30' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(time, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
    fireEvent.change(time, { target: { value: '14:30' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.invalid(time);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('treats date labels and field wrappers as inside the partially edited group', () => {
    render(<Harness />);
    const time = screen.getByLabelText('Giờ — Hẹn');
    clickWithFocus(time);
    fireEvent.change(time, { target: { value: '13:30' } });
    // The batch cabf2036 a11y rework replaced label elements with aria-labels
    // on the controls; the group's own wrapper elements are the inside-the-
    // group press targets now.
    const dateWrapper = screen.getByLabelText('Ngày — Hẹn').closest('.split-datetime__field')!;
    fireEvent.pointerDown(dateWrapper);
    fireEvent.mouseDown(dateWrapper);
    fireEvent.click(dateWrapper);
    const date = screen.getByLabelText('Ngày — Hẹn');
    fireEvent.pointerDown(date.parentElement!);
    fireEvent.mouseDown(date.parentElement!);
    expect(time).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps picker hour synchronized with manual edits while open', () => {
    render(<Harness value="2026-09-19T08:00" />);
    const time = screen.getByLabelText('Giờ — Hẹn');
    clickWithFocus(time);
    fireEvent.change(time, { target: { value: '20:46' } });
    const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
    expect(within(hours).getByRole('option', { name: '20' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '45' }));
    expect(time).toHaveValue('20:45');
  });

  it('keyboard group exit closes the picker without reclaiming focus and starts a fresh edit baseline', () => {
    render(<><Harness value="2026-09-19T08:00" /><input aria-label="Next field" /></>);
    const time = screen.getByLabelText('Giờ — Hẹn');
    const next = screen.getByLabelText('Next field');
    clickWithFocus(time);
    fireEvent.change(time, { target: { value: '13:30' } });
    act(() => next.focus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(next).toHaveFocus();
    act(() => time.focus());
    fireEvent.change(time, { target: { value: '14:' } });
    fireEvent.keyDown(time, { key: 'Escape' });
    expect(time).toHaveValue('13:30');
  });

  it('Escape in a manual field restores its original ISO value without leaking the formatted display', () => {
    const onChange = vi.fn();
    render(<Harness value="2026-09-19T08:00" onChange={onChange} />);
    const input = screen.getByLabelText('Giờ — Hẹn');
    input.focus();
    fireEvent.change(input, { target: { value: '13:' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('08:00');
    expect(screen.getByLabelText('Ngày — Hẹn')).toHaveValue('19/09/2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T08:00');
  });

  it('Escape cancels picker changes and neither submits nor erases manual drafts', () => {
    const onChange = vi.fn();
    render(<Harness value="2026-09-19T08:00" onChange={onChange} />);
    const input = screen.getByLabelText('Giờ — Hẹn');
    fireEvent.change(input, { target: { value: '13:' } });
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Đóng' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveValue('13:');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
