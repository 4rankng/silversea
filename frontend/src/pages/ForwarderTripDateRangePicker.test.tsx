import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForwarderTripDateRangePicker } from './ForwarderTripDateRangePicker';

describe('ForwarderTripDateRangePicker', () => {
  it('orders a reversed range and returns focus when the picker is applied', async () => {
    const onChange = vi.fn();
    render(<ForwarderTripDateRangePicker dateFrom="2026-08-20" dateTo="" onChange={onChange} />);

    const toTrigger = screen.getByRole('button', { name: /Đến ngày/ });
    fireEvent.click(toTrigger);
    fireEvent.click(screen.getByRole('button', { name: '5' }));

    const selectedRange = onChange.mock.calls.at(-1)?.[0];
    expect(selectedRange.dateFrom <= selectedRange.dateTo).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng khoảng ngày' }));
    await waitFor(() => expect(document.activeElement).toBe(toTrigger));
  });

  it('clears both dates and can be dismissed with Escape', async () => {
    const onChange = vi.fn();
    render(<ForwarderTripDateRangePicker dateFrom="2026-08-05" dateTo="2026-08-09" onChange={onChange} />);

    const fromTrigger = screen.getByRole('button', { name: /Từ ngày/ });
    fireEvent.click(fromTrigger);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(onChange).toHaveBeenLastCalledWith({ dateFrom: '', dateTo: '' });
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(fromTrigger));
  });
});
