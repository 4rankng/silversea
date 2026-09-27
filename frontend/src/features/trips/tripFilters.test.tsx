import { render, screen, within, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TripStatus } from '@tingting/shared';
import { TripFiltersBar, defaultStatusCounts, type StatusCounts, type TripFiltersBarProps } from './tripFilters';

// jsdom has no layout, so the bar always measures `inline`. The mode is a real
// measurement in the browser (`filter-bar-mode.ts`), so the collapse path is
// forced here the only way it can be — the measure is stubbed, nothing about the
// bar's markup or the dialog's behaviour is.
const modeState = vi.hoisted(() => ({ value: 'inline' as 'inline' | 'dialog' }));
vi.mock('../../components/filter-bar-mode', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFilterBarFit: () => modeState.value };
});

function counts(over: Partial<StatusCounts> = {}): StatusCounts {
  return {
    ...defaultStatusCounts(),
    all: 12,
    [TripStatus.CREATED]: 3,
    [TripStatus.IN_TRANSIT]: 4,
    [TripStatus.COMPLETED]: 3,
    [TripStatus.CANCELED]: 2,
    ...over,
  };
}

function setup(over: Partial<TripFiltersBarProps> = {}) {
  const onStatusFilter = vi.fn();
  const onSearch = vi.fn();
  const onTruckFilter = vi.fn();
  const onCustomerFilter = vi.fn();
  const props: TripFiltersBarProps = {
    statusCounts: counts(),
    statusFilter: '',
    onStatusFilter,
    searchQuery: '',
    onSearch,
    searching: false,
    truckOptions: [{ id: 1, licensePlate: '29A-11111' }, { id: 2, licensePlate: '29A-22222' }],
    truckFilter: '',
    onTruckFilter,
    customerOptions: [{ id: 7, name: 'Công ty A' }, { id: 8, name: 'Công ty B' }],
    customerFilter: '',
    onCustomerFilter,
    ...over,
  };
  const view = render(<TripFiltersBar {...props} />);
  return { onStatusFilter, onSearch, onTruckFilter, onCustomerFilter, ...view };
}

describe('TripFiltersBar — the shared filter bar, not a page-local card', () => {
  it('renders the shared ListFilterBar and none of the retired hand-rolled card', () => {
    const { container } = setup();
    const bar = container.querySelector('.filter-bar.list-filter-bar');
    expect(bar).toBeTruthy();
    // The two-row card scaffolding the page used to own is gone for good: a
    // page-local filter plane is what the 2026-09-27 ruling banned.
    for (const retired of ['.filters-card', '.filters-row-top', '.filters-row-bottom', '.filters-divider', '.filters-search']) {
      expect(container.querySelector(retired)).toBeNull();
    }
  });

  it('keeps the region order: search, criteria, quick filters, then the applied-status cluster', () => {
    const { container } = setup();
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    const kids = Array.from(bar.children);
    expect(kids[0].classList.contains('filter-bar__search-cell')).toBe(true);
    // The two criteria render INLINE while the strip fits two rows (jsdom has
    // no layout, so the measured mode stays `inline`): they are bar items, not
    // a page wrapper around them.
    expect(kids[1].classList.contains('ds-uui-select')).toBe(true);
    expect(kids[2].classList.contains('ds-uui-select')).toBe(true);
    expect(kids[3].classList.contains('list-filter-bar__quick')).toBe(true);
  });

  it('keeps the search label, placeholder and writer unchanged', () => {
    const { onSearch } = setup();
    const input = screen.getByRole('textbox', { name: 'Tìm chuyến đi' });
    expect(input).toHaveAttribute('placeholder', 'Tìm theo mã chuyến, KH, biển số, số cont');
    fireEvent.change(input, { target: { value: '29A' } });
    expect(onSearch).toHaveBeenCalledWith('29A');
  });

  it('renders the status segment as the shared boxed tab group and writes the status filter', () => {
    const { onStatusFilter } = setup();
    const group = screen.getByRole('tablist', { name: 'Lọc theo trạng thái chuyến' });
    expect(group.className).toContain('ds-tabs--boxed');
    expect(Array.from(group.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent))
      .toEqual(['Tất cả12', 'Mới tạo3', 'Đang chạy4', 'Hoàn thành3', 'Đã hủy2']);
    fireEvent.click(within(group).getByRole('tab', { name: /Đang chạy/ }));
    expect(onStatusFilter).toHaveBeenCalledWith(TripStatus.IN_TRANSIT);
    fireEvent.click(within(group).getByRole('tab', { name: /Tất cả/ }));
    expect(onStatusFilter).toHaveBeenLastCalledWith('');
  });

  it('keeps the two criteria names, their options and their numeric writers', () => {
    const { onTruckFilter, onCustomerFilter } = setup();
    // React Aria composes the trigger's accessible name from the value text and
    // the visible label; moving the select off the bar's pill and into `Bộ lọc`
    // leaves that name byte-identical (it read the same before the cutover).
    fireEvent.click(screen.getByRole('button', { name: /Phương tiện$/ }));
    fireEvent.click(screen.getByRole('option', { name: '29A-11111' }));
    expect(onTruckFilter).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: /Khách hàng$/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Công ty A' }));
    expect(onCustomerFilter).toHaveBeenCalledWith(7);
  });

  it('shows the search-bypass note only while searching, in the shared chip chrome', () => {
    const idle = setup();
    expect(screen.queryByText('Đang tìm trên tất cả tháng')).toBeNull();
    expect(idle.container.querySelector('.filter-bar__spacer')).toBeNull();
    idle.unmount();

    const { container } = setup({ searching: true, searchQuery: 'ABC' });
    const note = screen.getByText('Đang tìm trên tất cả tháng');
    expect(note).toHaveAttribute('title', 'Khi tìm kiếm, hệ thống bỏ qua bộ lọc tháng để tìm trên tất cả các tháng.');
    // The note wears the shared `.filter-chip` chrome, so the page declares no
    // height of its own for anything in the strip.
    expect(note.classList.contains('filter-chip')).toBe(true);
    expect(container.querySelector('.filter-bar__actions')?.contains(note)).toBe(true);
  });
});

describe('TripFiltersBar — the criteria collapse into `Bộ lọc`', () => {
  afterEach(() => { modeState.value = 'inline'; });

  it('keeps both criteria as bar chips while the strip fits two rows', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Phương tiện$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Khách hàng$/ })).toBeTruthy();
  });

  it('collapses them behind one trigger that reports how many are applied', () => {
    modeState.value = 'dialog';
    setup({ truckFilter: 3, customerFilter: 8 });
    const trigger = screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' });
    expect(trigger.querySelector('.filter-dropdown__count')?.textContent).toBe('2');
    expect(screen.queryByRole('button', { name: /Phương tiện$/ })).toBeNull();
  });

  it('has no applied count while nothing is applied', () => {
    modeState.value = 'dialog';
    setup();
    const trigger = screen.getByRole('button', { name: 'Bộ lọc' });
    expect(trigger.querySelector('.filter-dropdown__count')).toBeNull();
  });

  it('`Đặt lại` clears exactly the two criteria and touches nothing else', () => {
    modeState.value = 'dialog';
    const { onTruckFilter, onCustomerFilter, onStatusFilter, onSearch } = setup({ truckFilter: 3, customerFilter: 8, searchQuery: 'ABC' });
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    expect(onTruckFilter).toHaveBeenCalledWith('');
    expect(onCustomerFilter).toHaveBeenCalledWith('');
    expect(onStatusFilter).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });
});
