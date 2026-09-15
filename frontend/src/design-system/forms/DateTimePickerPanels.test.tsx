import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BufferedUuiDateTimeInput } from './BufferedUuiDateTimeInput';
import { DatePanel, DateTimePickerDialog, TimePanel } from './DateTimePickerPanels';

function offsetIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DateTimePickerDialog (_43 P0 rework: split NGÀY/GIỜ, compact)', () => {
  it('offers every 24h hour, five-minute shortcuts and the selected exact minute', () => {
    render(<TimePanel value="13:46" onPick={vi.fn()} />);
    const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
    const minutes = screen.getByRole('listbox', { name: 'Phút 00–59' });
    expect(within(hours).getAllByRole('option')).toHaveLength(24);
    expect(within(minutes).getAllByRole('option')).toHaveLength(13);
    expect(within(hours).getByRole('option', { name: '13' })).toHaveAttribute('aria-selected', 'true');
    expect(within(minutes).getByRole('option', { name: '46' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a minute-first selection incomplete until an hour is activated', () => {
    const onPick = vi.fn();
    render(<TimePanel value="" onPick={onPick} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '45' }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '20' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('20:45');
  });

  it('reselecting the existing minute commits the newly chosen hour', () => {
    const onPick = vi.fn();
    render(<TimePanel value="08:46" onPick={onPick} />);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: '20' }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '46' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('20:46');
  });

  it('allows arrow navigation then Enter activation without confirming the parent appointment', () => {
    const onConfirm = vi.fn();
    render(<DateTimePickerDialog title="Appointment" value="2026-09-19T08:46" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^GIỜ/ }));
    const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
    const eight = within(hours).getByRole('option', { name: '08' });
    act(() => eight.focus());
    fireEvent.keyDown(eight, { key: 'ArrowDown' });
    const nine = within(hours).getByRole('option', { name: '09' });
    expect(nine).toHaveFocus();
    expect(eight).toHaveAttribute('aria-selected', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(nine, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(nine, { key: 'Enter', code: 'Enter' });
    expect(nine).toHaveAttribute('aria-selected', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
    const minute = within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '46' });
    act(() => minute.focus());
    fireEvent.keyDown(minute, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(minute, { key: 'Enter', code: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('2026-09-19T09:46');
  });

  it('DatePanel: clicking a day fires the YYYY-MM-DD contract', () => {
    const onChange = vi.fn();
    render(<DatePanel value="2026-09-01" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '15 Tháng 9 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-09-15');
  });

  it('announces and selects adjacent-month dates with their actual month and year', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DatePanel value="2026-09-01" onChange={onChange} />);
    expect(screen.queryByRole('button', { name: '31 Tháng 9 2026' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '31 Tháng 8 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-31');
    fireEvent.click(screen.getByRole('button', { name: '1 Tháng 10 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01');
    rerender(<DatePanel value="2026-12-01" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '1 Tháng 1 2027' }));
    expect(onChange).toHaveBeenLastCalledWith('2027-01-01');
  });

  it('split controls: NGÀY and GIỜ each open their own panel and feed their part', () => {
    const onConfirm = vi.fn();
    render(<DateTimePickerDialog title="T" value="2026-09-08T08:00" onConfirm={onConfirm} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^NGÀY/ }).textContent).toContain('08/09/2026');
    // NGÀY opens the date grid; picking a day feeds the NGÀY part.
    fireEvent.click(screen.getByRole('button', { name: /^NGÀY/ }));
    fireEvent.click(screen.getByRole('button', { name: '15 Tháng 9 2026' }));
    // GIỜ opens the time panel; picking a minute feeds the GIỜ part.
    fireEvent.click(screen.getByRole('button', { name: /^GIỜ/ }));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: '10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-15T08:10');
  });

  it('quick-day and common-slot pills feed NGÀY/GIỜ respectively; Xác nhận composes', () => {
    const onConfirm = vi.fn();
    render(<DateTimePickerDialog title="T" value="" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Chọn nhanh ngày' })).getByRole('button', { name: 'Ngày mai' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Khung giờ phổ biến' })).getByRole('button', { name: '10:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirm).toHaveBeenCalledWith(`${offsetIso(1)}T10:00`);
    expect(document.body.textContent).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it('missing a part blocks Xác nhận with a visible error', () => {
    const onConfirm = vi.fn();
    render(<DateTimePickerDialog title="T" value="" onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Chọn nhanh ngày' })).getByRole('button', { name: 'Hôm nay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Chọn đủ ngày và giờ');
  });

  it('disabling a field closes its open picker and does not reopen it after saving', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BufferedUuiDateTimeInput label="Hẹn" value="2026-09-19T08:00" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Hẹn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(<BufferedUuiDateTimeInput label="Hẹn" value="2026-09-19T08:00" onChange={onChange} isDisabled />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<BufferedUuiDateTimeInput label="Hẹn" value="2026-09-19T08:00" onChange={onChange} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Alt+ArrowDown opens the field picker; Escape returns focus without submitting the parent', () => {
    const submitted = vi.fn();
    render(<form onSubmit={(event) => { event.preventDefault(); submitted(); }}><DialogHost onChange={vi.fn()} /></form>);
    const input = screen.getByLabelText('Hẹn');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Hẹn' });
    expect(dialog).not.toHaveClass('dtp-popover--portal');
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Đóng' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('_43: the input opens the compact portaled dialog and Xác nhận writes the buffered contract', () => {
    const onChange = vi.fn();
    render(<DialogHost onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Hẹn'));
    const dialog = screen.getByRole('dialog', { name: 'Hẹn' }) as HTMLElement;
    expect(dialog.className).toContain('dtp-dialog');
    expect(dialog.parentElement!.className).toContain('dtp-dialog-host');
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    fireEvent.click((dialog.querySelector('[aria-label="Chọn nhanh ngày"] button')) as HTMLElement);
    fireEvent.click((dialog.querySelector('[aria-label="Khung giờ phổ biến"] button:nth-of-type(3)')) as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(onChange).toHaveBeenCalledWith(`${offsetIso(0)}T13:30`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

function DialogHost({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <BufferedUuiDateTimeInput
      label="Hẹn"
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
    />
  );
}

describe('BufferedUuiDateTimeInput — wrapper-level click handler (P0 regression)', () => {
  it('clicking the wrapper div (not the native <input>) opens the picker', () => {
    render(<DialogHost onChange={vi.fn()} />);
    const wrapper = document.querySelector('[data-input-wrapper]')!;
    fireEvent.click(wrapper);
    expect(screen.getByRole('dialog', { name: 'Hẹn' })).toBeTruthy();
  });

  it('clicking the label also opens the picker (label inside wrapper)', () => {
    render(<DialogHost onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Hẹn'));
    expect(screen.getByRole('dialog', { name: 'Hẹn' })).toBeTruthy();
  });

  it('disabled input does not open picker on click', () => {
    render(
      <BufferedUuiDateTimeInput
        label="Hẹn"
        value=""
        onChange={vi.fn()}
        isDisabled
      />,
    );
    fireEvent.click(document.querySelector('[data-input-wrapper]')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
