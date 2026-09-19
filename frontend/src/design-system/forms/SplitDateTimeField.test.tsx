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

// Segmented entry contract: each part is several [data-seg] inputs plus one
// icon trigger that opens the picker. Full-string changes still work on the
// first segment (paste distribution fills the following segments).
const timeTrigger = () => screen.getByRole('button', { name: 'Mở bộ chọn giờ — Hẹn' });
const dateTrigger = () => screen.getByRole('button', { name: 'Mở lịch — Hẹn' });
const hour = () => screen.getByLabelText('Giờ — Hẹn');
const minute = () => screen.getByLabelText('Phút — Hẹn');
const day = () => screen.getByLabelText('Ngày — Hẹn');

function Harness({ value = '', onChange = vi.fn() }: { value?: string; onChange?: (value: string) => void }) {
  const [current, setCurrent] = useState(value);
  return <form><SplitDateTimeField label="Hẹn" value={current} onChange={(next) => { setCurrent(next); onChange(next); }} /></form>;
}

describe('SplitDateTimeField', () => {
  it('keeps partial time/date visible and only emits complete timestamps or empty', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(hour(), { target: { value: '20:4' } });
    fireEvent.blur(hour());
    expect(hour()).toHaveValue('20');
    expect(minute()).toHaveValue('4');
    expect(hour()).toBeInvalid();
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.change(hour(), { target: { value: '20:46' } });
    fireEvent.change(day(), { target: { value: '19/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T20:46');
    expect(hour()).toBeValid();
    expect(day()).toBeValid();
    fireEvent.change(day(), { target: { value: '19/0' } });
    expect(hour()).toHaveValue('20');
    expect(minute()).toHaveValue('46');
    expect(day()).toHaveValue('19');
    expect(screen.getByLabelText('Tháng — Hẹn')).toHaveValue('0');
    expect(screen.getByLabelText('Năm — Hẹn')).toHaveValue('');
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(day()).toBeInvalid();
  });

  it('disabling during picker editing closes the portal and refuses further changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SplitDateTimeField label="Hẹn" value="2026-09-19T08:00" onChange={onChange} />);
    fireEvent.click(timeTrigger());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(<SplitDateTimeField label="Hẹn" value="2026-09-19T08:00" onChange={onChange} disabled />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hour()).toBeDisabled();
    fireEvent.change(hour(), { target: { value: '13:30' } });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<SplitDateTimeField label="Hẹn" value="2026-09-19T08:00" onChange={onChange} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens independent date and 24h time pickers and restores focus after selection', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-09-19T08:00" onChange={onChange} />);
    fireEvent.click(dateTrigger());
    let dialog = screen.getByRole('dialog', { name: 'Chọn ngày — Hẹn' });
    expect(within(dialog).queryByRole('listbox', { name: 'Giờ 00–23' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '20 Tháng 9 2026' }));
    expect(day()).toHaveValue('20');
    expect(screen.getByLabelText('Tháng — Hẹn')).toHaveValue('09');
    expect(screen.getByLabelText('Năm — Hẹn')).toHaveValue('2026');
    expect(day()).toHaveFocus();
    fireEvent.click(timeTrigger());
    dialog = screen.getByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
    fireEvent.click(within(within(dialog).getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '23' }));
    fireEvent.click(within(within(dialog).getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '45' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-09-20T23:45');
    expect(hour()).toHaveValue('23');
    expect(minute()).toHaveValue('45');
    // Selections keep the panel open (user ruling 2026-09-16); Xong is the
    // explicit close and hands focus back to the field.
    expect(screen.getByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(hour()).toHaveFocus());
  });

  it('keeps segment clicks for typing and routes picker opening through the icon trigger', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    clickWithFocus(hour());
    expect(hour()).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(hour(), { target: { value: '13:30' } });
    expect(hour()).toHaveValue('13');
    expect(minute()).toHaveValue('30');
    expect(hour()).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    clickWithFocus(dateTrigger());
    expect(dateTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(day(), { target: { value: '19/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T13:30');
    fireEvent.keyDown(day(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(day()).toHaveFocus();
    expect(day()).toHaveValue('19');
    expect(screen.getByLabelText('Tháng — Hẹn')).toHaveValue('09');
    expect(screen.getByLabelText('Năm — Hẹn')).toHaveValue('2026');
  });

  it('picking time first preserves the incomplete pair without red feedback until group exit', async () => {
    render(<><Harness /><button type="button">Outside</button></>);
    clickWithFocus(timeTrigger());
    clickWithFocus(within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '13' }));
    clickWithFocus(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '30' }));
    // Selections apply and keep the panel open (2026-09-16 ruling); Xong
    // is the explicit close and hands focus back to the field.
    expect(screen.getByRole('listbox', { name: 'Phút 00–59' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(hour()).toHaveFocus());
    expect(hour()).not.toHaveAttribute('aria-invalid', 'true');
    expect((hour() as HTMLInputElement).validity.valid).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    clickWithFocus(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
    expect(hour()).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([false, true])('settles late selector focus cleanup without stealing a genuine outside focus: %s', async (leaveGroup) => {
    let nextFrame: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { nextFrame = callback; return 1; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    try {
      render(<><Harness /><input aria-label="Outside field" /></>);
      clickWithFocus(timeTrigger());
      clickWithFocus(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '05' }));
      clickWithFocus(within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '01' }));
      expect(hour()).toHaveValue('01');
      expect(minute()).toHaveValue('05');
      // Selections keep the panel open (2026-09-16 ruling); Xong closes.
      expect(screen.getByRole('listbox', { name: 'Giờ 00–23' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Chrome can perform the picker's remaining focus cleanup after the
      // panel closes; finish the handoff before judging focus.
      const outside = screen.getByLabelText('Outside field');
      act(() => { if (leaveGroup) outside.focus(); else hour().blur(); });
      act(() => nextFrame?.(0));
      if (leaveGroup) {
        expect(outside).toHaveFocus();
        expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
      } else {
        expect(hour()).toHaveFocus();
        expect(hour()).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      }
    } finally { raf.mockRestore(); cancel.mockRestore(); }
  });

  it('Enter and native invalid events expose incomplete-pair feedback without submitting', () => {
    render(<Harness />);
    fireEvent.change(hour(), { target: { value: '13:30' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(hour(), { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đủ giờ và ngày hợp lệ.');
    fireEvent.change(hour(), { target: { value: '14:30' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.invalid(hour());
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('treats date labels and field wrappers as inside the partially edited group', () => {
    render(<Harness />);
    clickWithFocus(hour());
    fireEvent.change(hour(), { target: { value: '13:30' } });
    // The batch cabf2036 a11y rework replaced label elements with aria-labels
    // on the controls; the group's own wrapper elements are the inside-the-
    // group press targets now.
    const dateWrapper = day().closest('.split-datetime__field')!;
    fireEvent.pointerDown(dateWrapper);
    fireEvent.mouseDown(dateWrapper);
    fireEvent.click(dateWrapper);
    fireEvent.pointerDown(day().parentElement!);
    fireEvent.mouseDown(day().parentElement!);
    expect(hour()).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps picker hour synchronized with manual edits while open', () => {
    render(<Harness value="2026-09-19T08:00" />);
    clickWithFocus(timeTrigger());
    fireEvent.change(hour(), { target: { value: '20:46' } });
    const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
    expect(within(hours).getByRole('option', { name: '20' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '45' }));
    expect(hour()).toHaveValue('20');
    expect(minute()).toHaveValue('45');
  });

  it('keyboard group exit closes the picker without reclaiming focus and starts a fresh edit baseline', () => {
    render(<><Harness value="2026-09-19T08:00" /><input aria-label="Next field" /></>);
    const next = screen.getByLabelText('Next field');
    clickWithFocus(timeTrigger());
    fireEvent.change(hour(), { target: { value: '13:30' } });
    act(() => next.focus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(next).toHaveFocus();
    act(() => hour().focus());
    fireEvent.change(hour(), { target: { value: '14:' } });
    fireEvent.keyDown(hour(), { key: 'Escape' });
    expect(hour()).toHaveValue('13');
    expect(minute()).toHaveValue('30');
  });

  it('Escape in a manual field restores its original ISO value without leaking the formatted display', () => {
    const onChange = vi.fn();
    render(<Harness value="2026-09-19T08:00" onChange={onChange} />);
    act(() => hour().focus());
    fireEvent.change(hour(), { target: { value: '13:' } });
    fireEvent.keyDown(hour(), { key: 'Escape' });
    expect(hour()).toHaveValue('08');
    expect(minute()).toHaveValue('00');
    expect(day()).toHaveValue('19');
    expect(screen.getByLabelText('Tháng — Hẹn')).toHaveValue('09');
    expect(screen.getByLabelText('Năm — Hẹn')).toHaveValue('2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-09-19T08:00');
  });

  it('Escape cancels picker changes and neither submits nor erases manual drafts', () => {
    const onChange = vi.fn();
    render(<Harness value="2026-09-19T08:00" onChange={onChange} />);
    fireEvent.change(hour(), { target: { value: '13:' } });
    fireEvent.keyDown(hour(), { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Đóng' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hour()).toHaveValue('13');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
