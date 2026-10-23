import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedDateRangePicker, UNIFIED_RANGE_PRESETS } from './UnifiedDateRangePicker';

const onChange = vi.fn();

function renderPicker(value: { from: string; to: string } = { from: '', to: '' }) {
  const view = render(
    <UnifiedDateRangePicker ariaLabel="Khoảng ngày quyết toán" value={value} onChange={onChange} />,
  );
  return {
    view,
    rerenderWith: (next: { from: string; to: string }) => view.rerender(
      <UnifiedDateRangePicker ariaLabel="Khoảng ngày quyết toán" value={next} onChange={onChange} />,
    ),
  };
}

beforeEach(() => { onChange.mockClear(); });

const openPopover = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Khoảng ngày quyết toán/ }));
  return screen.findByRole('dialog', { name: 'Khoảng ngày quyết toán' });
};

/** Preset ranges evaluate against "now" — assert by identity of the emitted
 *  range against the same preset's own computation (today-anchored). */
const presetRange = (id: string) => UNIFIED_RANGE_PRESETS.find((preset) => preset.id === id)!.range();

const originalMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMedia; });

describe('UnifiedDateRangePicker (owner redesign 23/10 spec v2 (d))', () => {
  it('opens ONE popover with the preset rail and the dual-month calendar', async () => {
    renderPicker();
    const popover = await openPopover();
    for (const label of ['Hôm nay', 'Tuần này', 'Tháng này', 'Tháng trước', 'Quý này']) {
      expect(within(popover).getByText(label)).toBeTruthy();
    }
    // The dual-month head names TWO consecutive months.
    const titles = within(popover).getAllByText(/Tháng \d+ \d+/);
    expect(titles.length).toBe(2);
    // No separate from/to field pair leaked in (the old trio is gone).
    expect(screen.queryByLabelText('Từ ngày')).toBeNull();
    expect(screen.queryByLabelText('Đến ngày')).toBeNull();
  });

  it('a preset commits immediately (auto-apply) and paints itself active', async () => {
    const { rerenderWith } = renderPicker();
    const popover = await openPopover();
    fireEvent.click(within(popover).getByText('Tháng này'));
    expect(onChange).toHaveBeenCalledWith(presetRange('this-month'));
    // Controlled re-render with the committed value: the preset reads active
    // (the popover is still open — auto-apply never closes it).
    rerenderWith(presetRange('this-month'));
    const active = await screen.findByRole('button', { name: 'Tháng này' });
    expect(active.getAttribute('aria-pressed')).toBe('true');
  });

  it('two calendar clicks compose a normalized range and auto-apply on the second', async () => {
    renderPicker();
    const popover = await openPopover();
    // Pick "the 5th" then "the 3rd" of the current month — the picker must
    // normalize the order (from < to) and commit exactly once complete.
    const monthTitle = popover.querySelectorAll('.udrp-month')[0]!.getAttribute('aria-label')!;
    const first = within(popover).getAllByRole('button', { name: /^5 Tháng/ })[0]!;
    const second = within(popover).getAllByRole('button', { name: /^3 Tháng/ })[0]!;
    expect(monthTitle).toBeTruthy();
    fireEvent.click(first);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(second);
    const m = Number(/Tháng (\d+)/.exec(monthTitle)![1]);
    const y = Number(/(\d{4})/.exec(monthTitle)![1]);
    expect(onChange).toHaveBeenCalledWith({ from: `${y}-${String(m).padStart(2, '0')}-03`, to: `${y}-${String(m).padStart(2, '0')}-05` });
  });

  it('shows the formatted range on the trigger and clears through the popover action', async () => {
    renderPicker({ from: '2026-10-01', to: '2026-10-31' });
    expect(screen.getByRole('button', { name: /Khoảng ngày quyết toán: 01\/10\/2026 – 31\/10\/2026/ })).toBeTruthy();
    await openPopover();
    fireEvent.click(screen.getByText('Xoá khoảng ngày'));
    expect(onChange).toHaveBeenCalledWith({ from: '', to: '' });
  });

  it('Escape closes the popover and discards a from-only draft', async () => {
    renderPicker();
    const popover = await openPopover();
    fireEvent.click(within(popover).getAllByRole('button', { name: /^5 Tháng/ })[0]!);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  // H1 (independent review): a preset commit must REPLACE a pending
  // from-only draft — day-click → preset → day-click composes from the
  // preset's fresh anchor, never the stale draft.
  it('a preset commit discards the from-only draft (H1)', async () => {
    renderPicker();
    const popover = await openPopover();
    fireEvent.click(within(popover).getAllByRole('button', { name: /^5 Tháng/ })[0]!);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(popover).getByText('Hôm nay'));
    expect(onChange).toHaveBeenCalledWith(presetRange('today'));
    onChange.mockClear();
    // A later single day-click starts a NEW draft (no commit) instead of
    // pairing against the pre-preset one.
    fireEvent.click(within(popover).getAllByRole('button', { name: /^7 Tháng/ })[0]!);
    expect(onChange).not.toHaveBeenCalled();
  });
});
