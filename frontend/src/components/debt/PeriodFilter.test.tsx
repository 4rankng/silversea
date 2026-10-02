import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders the mode switch and the month controls as one shared-bar group', () => {
    render(
      <PeriodFilter
        {...baseProps}
        mode="month"
      />,
    );

    // Card 20260927_152: the group is ONE item of the shared strip, so it rides
    // the shared row discipline and declares no page-local layout of its own
    // (the `fieldset` chrome and the `flex flex-col lg:flex-row` stack are gone).
    const root = screen.getByRole('group', { name: 'Bộ lọc thời gian' });
    expect(root.className).toContain('period-filter');
    expect(root.className).toContain('filter-bar');
    expect(root.className).not.toContain('border-y');

    // Mode switch is the shared boxed Tabs primitive (one group shape app-wide).
    const modeToggle = screen.getByRole('tablist', { name: 'Chế độ lọc' });
    expect(modeToggle.className).toContain('ds-tabs');
    expect(modeToggle.className).toContain('ds-tabs--boxed');
    expect(modeToggle.className).not.toContain('d-join');
    expect(screen.getByRole('tab', { name: 'Theo tháng' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Theo khoảng' }).getAttribute('aria-selected')).toBe('false');

    // UuiSelectField renders a button trigger for short option lists, or a
    // searchable combobox input once the list is long enough (month/year here).
    const buttonTriggers = screen.getAllByRole('button').filter(b => b.getAttribute('aria-haspopup') === 'listbox');
    const comboboxTriggers = screen.queryAllByRole('combobox');
    expect(buttonTriggers.length + comboboxTriggers.length).toBe(2);
  });

  it('renders the shared from/to date group and refuses an out-of-order range', () => {
    const onRangeChange = vi.fn();
    render(
      <PeriodFilter
        {...baseProps}
        mode="range"
        onRangeChange={onRangeChange}
      />,
    );

    // Card 20260927_152: Từ/Đến are the shared `DateRangeFields` group — two
    // independent fields inside one `role="group"`, cross-clamped by each
    // other's min/max (CHIEF 2026-09-27: "choose from and to separately instead
    // of one long control"). The page-local two-column block with full-width
    // fields is deleted with the layout it declared.
    const group = screen.getByRole('group', { name: 'Khoảng ngày' });
    const from = screen.getByLabelText('Từ ngày');
    const to = screen.getByLabelText('Đến ngày');
    expect(group).toContainElement(from);
    expect(group).toContainElement(to);

    // A Từ ngày inside the range is emitted for both ends of the pair…
    fireEvent.change(from, { target: { value: '05/07/2026' } });
    expect(onRangeChange).toHaveBeenCalledWith({ dateFrom: '2026-07-05', dateTo: '2026-07-31' });

    // …and one past Đến ngày is refused by the field's own bound.
    onRangeChange.mockClear();
    fireEvent.change(from, { target: { value: '05/08/2026' } });
    expect(onRangeChange).not.toHaveBeenCalled();

    const root = screen.getByRole('group', { name: 'Bộ lọc thời gian' });
    expect(root.className).toContain('period-filter');
  });
});
