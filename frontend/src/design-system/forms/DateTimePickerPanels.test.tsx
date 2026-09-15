import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatePanel, TimePanel } from './DateTimePickerPanels';

describe('DateTimePickerPanels (_39 designed pickers)', () => {
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

  it('TimePanel: hour + minute pick composes 24h HH:mm; no AM/PM anywhere', () => {
    const onPick = vi.fn();
    render(<TimePanel value="" onPick={onPick} />);
    const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
    const minutes = screen.getByRole('listbox', { name: 'Phút (bước 5 phút)' });
    fireEvent.click(within(hours).getByRole('option', { name: '20' }));
    fireEvent.click(within(minutes).getByRole('option', { name: '45' }));
    expect(onPick).toHaveBeenCalledWith('20:45');
    expect(document.body.textContent).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it('TimePanel: hour 23 stays 24h (never 11 PM)', () => {
    const onPick = vi.fn();
    render(<TimePanel value="" onPick={onPick} />);
    const hours = screen.getByRole('listbox', { name: 'Giờ 00–23' });
    const minutes = screen.getByRole('listbox', { name: 'Phút (bước 5 phút)' });
    fireEvent.click(within(hours).getByRole('option', { name: '23' }));
    fireEvent.click(within(minutes).getByRole('option', { name: '05' }));
    expect(onPick).toHaveBeenCalledWith('23:05');
  });
});
