import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BufferedUuiDateTimeInput } from './BufferedUuiDateTimeInput';
import { DatePanel, DateTimePickerDialog } from './DateTimePickerPanels';

function offsetIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DateTimePickerDialog (_43 P0 rework: split NGÀY/GIỜ, compact)', () => {
  it('DatePanel: clicking a day fires the YYYY-MM-DD contract', () => {
    const onChange = vi.fn();
    render(<DatePanel value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '15 Tháng 9 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-09-15');
  });

  it('split controls: NGÀY and GIỜ each open their own panel and feed their part', () => {
    const onConfirm = vi.fn();
    render(<DateTimePickerDialog title="T" value="2026-09-08T08:00" onConfirm={onConfirm} onClose={vi.fn()} />);
    // NGÀY opens the date grid; picking a day feeds the NGÀY part.
    fireEvent.click(screen.getByRole('button', { name: /^NGÀY/ }));
    fireEvent.click(screen.getByRole('button', { name: '15 Tháng 9 2026' }));
    // GIỜ opens the time panel; picking a minute feeds the GIỜ part.
    fireEvent.click(screen.getByRole('button', { name: /^GIỜ/ }));
    fireEvent.click((document.querySelector('[aria-label="Phút (bước 5 phút)"] button:nth-of-type(3)')) as HTMLElement);
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
