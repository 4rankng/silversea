import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeriodFilter } from './PeriodFilter';

describe('PeriodFilter', () => {
  const baseProps = {
    onModeChange: () => {},
    onMonthYearChange: () => {},
    onRangeChange: () => {},
    month: 7,
    year: 2026,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
  } as const;

  it('stacks the mode toggle and month controls until the large breakpoint', () => {
    render(
      <PeriodFilter
        {...baseProps}
        mode="month"
      />,
    );

    const root = screen.getByRole('group', { name: 'Bộ lọc thời gian' });
    expect(root.className).toContain('period-filter');
    expect(root.className).toContain('border-y');

    const modeToggle = screen.getByRole('tablist', { name: 'Chế độ lọc' });
    expect(modeToggle.className).toContain('d-join-vertical');
    expect(modeToggle.className).toContain('lg:d-join-horizontal');

    // UuiSelectField renders a button trigger for short option lists, or a
    // searchable combobox input once the list is long enough (month/year here).
    const buttonTriggers = screen.getAllByRole('button').filter(b => b.getAttribute('aria-haspopup') === 'listbox');
    const comboboxTriggers = screen.queryAllByRole('combobox');
    expect(buttonTriggers.length + comboboxTriggers.length).toBe(2);
  });

  it('renders the range inputs as a two-column block with full-width fields', () => {
    render(
      <PeriodFilter
        {...baseProps}
        mode="range"
      />,
    );

    const inputs = screen.getAllByDisplayValue(/07\/2026$/);
    expect(inputs).toHaveLength(2);
    inputs.forEach(input => {
      expect((input as HTMLElement).className).toContain('w-full');
    });

    const labels = screen.getAllByText(/Từ ngày|Đến ngày/);
    expect(labels).toHaveLength(2);

    const root = screen.getByRole('group', { name: 'Bộ lọc thời gian' });
    expect(root.className).toContain('period-filter');
  });
});
