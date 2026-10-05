import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';
import { DateTimePickerDialog, TimePanel } from './DateTimePickerPanels';
import { BufferedUuiDateTimeInput } from './BufferedUuiDateTimeInput';
import { ShipmentScheduleTimeField } from '../../features/shipments/detail/ShipmentScheduleTimeField';
import { registerOverlayToken, unregisterOverlayToken, isTopOverlayToken } from '../../hooks/useAnimatedOverlay';
import { TimePickerSurface } from './TimePickerSurface';

function click(element: HTMLElement) {
  fireEvent.pointerDown(element); fireEvent.mouseDown(element);
  act(() => element.focus()); fireEvent.click(element);
}
function SplitHarness({ value = '' }: { value?: string }) {
  const [current, setCurrent] = useState(value);
  return <SplitDateTimeField label="Hẹn" value={current} onChange={setCurrent} />;
}
function ScheduleHarness() {
  const [time, setTime] = useState('20:46');
  return <ShipmentScheduleTimeField label="Giờ giao" value={time} onChange={setTime} disabled={false} />;
}

describe('adaptive time entry', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('_8: any open picker surface holds the top overlay token — desktop mode included', () => {
    const parentToken = registerOverlayToken();
    render(<TimePickerSurface id='tp' label='Giờ' value='20:46' onPick={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} panelRef={{ current: null }} anchorRef={{ current: null }} />);
    // The surface registers its token in every mode (sheet, popover, inline),
    // so a parent dialog's window-level Escape/Enter shortcuts yield whenever
    // any picker panel is open — not only on the mobile sheet.
    expect(isTopOverlayToken(parentToken)).toBe(false);
    unregisterOverlayToken(parentToken);
  });

  it('accepts numeric phone entry, retains exact off-step minutes and rejects invalid time on explicit apply', () => {
    const onPick = vi.fn();
    render(<TimePanel value="20:46" onPick={onPick} />);
    const exact = screen.getByLabelText('Giờ chính xác (HH:mm)');
    expect(exact).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(exact, { target: { value: '1417' } });
    expect(exact).toHaveValue('14:17');
    expect(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '17' })).toHaveAttribute('aria-selected', 'true');
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('14:17');
    fireEvent.change(exact, { target: { value: '2599' } });
    expect(exact).toHaveValue('25:99');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(exact, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập giờ hợp lệ');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('positions the selected hour within its own list after collection mount without scrolling the page', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(132);
    const rowHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    const offset = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'option' ? Number(this.textContent) * 44 : 0;
    });
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    try {
      render(<TimePanel value="14:17" onPick={vi.fn()} />);
      const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
      await waitFor(() => expect(hours.scrollTop).toBe(572));
      expect(pageScroll).not.toHaveBeenCalled();
    } finally { height.mockRestore(); rowHeight.mockRestore(); offset.mockRestore(); pageScroll.mockRestore(); }
  });

  describe('mobile modal sheet', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 640px)', media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      })));
    });

    it('_6: sheet registers as top overlay — parent window shortcuts yield while it is open', () => {
      const parentToken = registerOverlayToken();
      render(<TimePickerSurface id='tp' label='Giờ' value='20:46' onPick={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} panelRef={{ current: null }} anchorRef={{ current: null }} />);
      // While the mobile sheet slides up over the parent quick-edit dialog,
      // the sheet's own token sits on top of the stack, above the parent's —
      // window-level Escape/Enter shortcuts registered by a parent dialog
      // must yield while the sheet is open.
      expect(isTopOverlayToken(parentToken)).toBe(false);
      unregisterOverlayToken(parentToken);
    });

    // Card 326 (user retest 05/10): clicking a segment opens the mobile
    // sheet, whose react-aria Dialog autofocuses its content — the popup
    // "stole focus" and swallowed the digits the user typed next. A
    // POINTER-opened sheet must leave focus on the anchor segment so fast
    // typing never breaks; a keyboard-invoked sheet keeps the dialog focus.
    // Card 20261005_366: typing into a segment while a POINTER-opened sheet
    // is up closes the sheet — the sheet covers the field at narrow widths,
    // so manual entry must reclaim the view. Picker selections do NOT close
    // it (2026-09-16 ruling: only explicit apply closes); a keyboard-opened
    // sheet is unaffected (its focus lives in the exact-entry field).
    it('first digit typed into a segment closes the pointer-opened sheet', async () => {
      render(<><SplitHarness /><input aria-label="Outside" /></>);
      const time = screen.getByLabelText('Giờ — Hẹn');
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
      fireEvent.keyDown(time, { key: '1' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(time).toHaveFocus();
      // The keydown closes the sheet; the keystroke itself still lands.
      fireEvent.change(time, { target: { value: '1' } });
      expect(time).toHaveValue('1');
    });

    it('a picker selection keeps the pointer sheet open (explicit apply still rules)', async () => {
      render(<><SplitHarness /><input aria-label="Outside" /></>);
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      const dialog = await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
      fireEvent.keyDown(screen.getByLabelText('Giờ — Hẹn'), { key: '1' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Reopen and pick from the listbox: the selection must NOT close it.
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      const reopened = await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
      click(within(reopened).getByRole('option', { name: '07' }));
      expect(screen.queryByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' })).toBeInTheDocument();
    });

    it('pointer-opened sheet leaves focus on the anchor segment (no popup focus steal)', async () => {
      render(<><SplitHarness /><input aria-label="Outside" /></>);
      const time = screen.getByLabelText('Giờ — Hẹn');
      act(() => time.focus());
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
      expect(time).toHaveFocus();
    });

    it('keeps exact entry inside the modal, applies without premature pair error and restores the original field', async () => {
      render(<><SplitHarness /><input aria-label="Outside" /></>);
      const time = screen.getByLabelText('Giờ — Hẹn');
      const trigger = screen.getByRole('textbox', { name: 'Giờ — Hẹn' });
      click(trigger);
      const dialog = await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
      expect(dialog.closest('.time-picker__sheet')).toBeInTheDocument();
      // Card 326: a pointer-opened sheet leaves focus on the segment — the
      // user keeps typing (HH then MM) instead of the sheet swallowing it.
      expect(time).toHaveFocus();
      const exact = within(dialog).getByLabelText('Giờ chính xác (HH:mm)');
      click(exact);
      fireEvent.change(exact, { target: { value: '1417' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.keyDown(exact, { key: 'Enter', code: 'Enter' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(time).toHaveValue('14');
      expect(screen.getByLabelText('Phút — Hẹn')).toHaveValue('17');
      await waitFor(() => expect(time).toHaveFocus());
      expect(time).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps minute-first blank selection partial, and completes without inventing the hour', async () => {
      render(<SplitHarness />);
      const time = screen.getByLabelText('Giờ — Hẹn');
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      const dialog = await screen.findByRole('dialog');
      click(within(within(dialog).getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '05' }));
      expect(time).toHaveValue('');
      expect(within(dialog).getByLabelText('Giờ chính xác (HH:mm)')).toHaveValue('--:05');
      click(within(within(dialog).getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '01' }));
      // Completing the pair applies the value and keeps the panel open
      // (2026-09-16 ruling); Xong is the explicit close.
      expect(within(dialog).getByLabelText('Giờ chính xác (HH:mm)')).toHaveValue('01:05');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Xong' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(time).toHaveFocus());
      expect(time).toHaveValue('01');
      expect(screen.getByLabelText('Phút — Hẹn')).toHaveValue('05');
      expect(time).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('cancels an exact off-step value without rounding, closing its parent, or reopening on focus return', async () => {
      render(<ScheduleHarness />);
      const time = screen.getByLabelText('Giờ giao');
      click(time);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByLabelText('Giờ chính xác (HH:mm)')).toHaveValue('20:46');
      expect(within(within(dialog).getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '46' })).toHaveAttribute('aria-selected', 'true');
      const exact = within(dialog).getByLabelText('Giờ chính xác (HH:mm)');
      click(exact); fireEvent.change(exact, { target: { value: '1417' } });
      fireEvent.keyDown(exact, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(time).toHaveValue('20:46');
      await waitFor(() => expect(time).toHaveFocus());
      expect(time).toHaveAttribute('aria-expanded', 'false');
    });

    it('pointer sheet keeps background focus where it is and still dismisses through the backdrop', async () => {
      render(<><SplitHarness value="2026-09-19T20:46" /><input aria-label="Outside" /></>);
      const time = screen.getByLabelText('Giờ — Hẹn');
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      const dialog = await screen.findByRole('dialog');
      // Card 326: no focus containment on the pointer sheet — the segments
      // keep focus; moving focus outside stays outside (the sheet is a
      // passive popup for pointer users).
      expect(time).toHaveFocus();
      act(() => screen.getByLabelText('Outside').focus());
      expect(document.activeElement).toBe(screen.getByLabelText('Outside'));
      const overlay = document.querySelector<HTMLElement>('[data-time-picker-overlay]')!;
      fireEvent.pointerDown(overlay); fireEvent.mouseDown(overlay); fireEvent.pointerUp(overlay); fireEvent.mouseUp(overlay); fireEvent.click(overlay);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(time).toHaveValue('20');
      expect(screen.getByLabelText('Phút — Hẹn')).toHaveValue('46');
    });

    it('nested picker Escape closes only the picker and preserves the buffered value', async () => {
      const onChange = vi.fn();
      render(<BufferedUuiDateTimeInput label="Hẹn" value="2026-09-19T20:46" onChange={onChange} />);
      click(screen.getByRole('textbox', { name: 'Giờ — Hẹn' }));
      const sheet = await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' });
      const exact = within(sheet).getByLabelText('Giờ chính xác (HH:mm)');
      click(exact); fireEvent.change(exact, { target: { value: '1417' } });
      expect(sheet).toBeInTheDocument();
      fireEvent.keyDown(exact, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chọn giờ (24h) — Hẹn' })).not.toBeInTheDocument());
      expect(screen.getByLabelText('Giờ — Hẹn')).toHaveValue('20');
      expect(screen.getByLabelText('Phút — Hẹn')).toHaveValue('46');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('shares the same sheet in combined appointments and keeps their explicit final confirmation', async () => {
      const onConfirm = vi.fn(); const onClose = vi.fn();
      render(<DateTimePickerDialog title="Appointment" value="2026-09-19T20:46" onConfirm={onConfirm} onClose={onClose} />);
      click(screen.getByRole('button', { name: /^GIỜ/ }));
      const sheet = await screen.findByRole('dialog', { name: 'Chọn giờ (24h)' });
      const exact = within(sheet).getByLabelText('Giờ chính xác (HH:mm)');
      click(exact); fireEvent.change(exact, { target: { value: '1417' } }); fireEvent.keyDown(exact, { key: 'Enter' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chọn giờ (24h)' })).not.toBeInTheDocument());
      expect(onConfirm).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('2026-09-19T14:17');
    });
  });
});
