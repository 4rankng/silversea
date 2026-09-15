import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BufferedUuiDateTimeInput } from './BufferedUuiDateTimeInput';
import { DatePanel, DateTimePickerDialog } from './DateTimePickerPanels';

function Hooked({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <BufferedUuiDateTimeInput
      label="Hẹn"
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
    />
  );
}

function offsetIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DateTimePickerDialog (_43 appointment-dialog design)', () => {
  it('DatePanel: clicking a day fires the YYYY-MM-DD contract', () => {
    const onChange = vi.fn();
    render(<DatePanel value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '15 Tháng 9 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-09-15');
  });

  it('DatePanel: today carries the is-today marker and month nav switches months', () => {
    const onChange = vi.fn();
    render(<DatePanel value="" onChange={onChange} />);
    expect(document.querySelector('.dtp-day.is-today')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    expect(screen.getByText('Tháng 10 2026')).toBeTruthy();
  });

  it('dialog: quick day pill + slot pill + Xác nhận composes the 24h contract', () => {
    const onConfirm = vi.fn();
    render(
      <DateTimePickerDialog
        title="Giờ hẹn đóng/trả"
        value="2026-09-08T08:00"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ngày mai' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Khung giờ phổ biến' })).getByRole('button', { name: '10:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirm).toHaveBeenCalledWith(`${offsetIso(1)}T10:00`);
    expect(document.body.textContent).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it('dialog: invalid draft shows the error and Xác nhận does not fire', () => {
    const onConfirm = vi.fn();
    render(<DateTimePickerDialog title="T" value="" onConfirm={onConfirm} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Nhập T');
    fireEvent.change(input, { target: { value: 'gibberish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('HH:mm DD/MM/YYYY');
  });

  it('_43: the input opens the titled dialog; Xác nhận writes the buffered contract', () => {
    const onChange = vi.fn();
    render(<Hooked onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Hẹn'));
    const dialog = screen.getByRole('dialog', { name: 'Hẹn' });
    expect(dialog.className).toContain('dtp-dialog');
    // Portaled: the dialog host mounts under document.body.
    expect(dialog.parentElement!.className).toContain('dtp-dialog-host');
    expect(dialog.parentElement!.parentElement).toBe(document.body);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hôm nay' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '13:30' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(onChange).toHaveBeenCalledWith(`${new Date().toISOString().slice(0, 10)}T13:30`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
