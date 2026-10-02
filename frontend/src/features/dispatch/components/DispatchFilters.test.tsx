import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DispatchFilters } from './DispatchFilters';

const counts = { all: 12, running: 4, ready: 3, noassign: 2, maint: 3 };

const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('DispatchFilters — the boxed status group (card 20260927_152)', () => {
  it('renders the shared Tabs primitive instead of the bespoke .filter-tabs row', () => {
    const { container } = render(
      <DispatchFilters fleetFilter="all" fleetCounts={counts} onFilterChange={() => {}} />,
    );

    const group = screen.getByRole('tablist', { name: 'Lọc theo trạng thái xe' });
    expect(group.className).toContain('ds-tabs--boxed');
    // No bespoke plane and no bespoke segment classes survive the cutover.
    expect(container.querySelector('.filter-tabs')).toBeNull();
    expect(container.querySelector('.tab')).toBeNull();
  });

  it('keeps every bucket id, label and count', () => {
    render(<DispatchFilters fleetFilter="all" fleetCounts={counts} onFilterChange={() => {}} />);

    const buckets: Array<[RegExp, string, string]> = [
      [/^Tất cả/, 'Tất cả', '12'],
      [/^Đang chạy/, 'Đang chạy', '4'],
      [/^Sẵn sàng/, 'Sẵn sàng', '3'],
      [/^Chưa giao lái xe/, 'Chưa giao lái xe', '2'],
      [/^Bảo dưỡng/, 'Bảo dưỡng', '3'],
    ];
    for (const [name, label, count] of buckets) {
      const el = tab(name);
      expect(el.querySelector('.ds-tabs__label')).toHaveTextContent(label);
      expect(el.querySelector('.ds-tabs__count')).toHaveTextContent(count);
    }
  });

  it('marks the active bucket and reports the same filter ids to the page', () => {
    const onFilterChange = vi.fn();
    render(<DispatchFilters fleetFilter="maint" fleetCounts={counts} onFilterChange={onFilterChange} />);

    expect(tab(/^Bảo dưỡng/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Tất cả/)).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(tab(/^Đang chạy/));
    expect(onFilterChange).toHaveBeenCalledWith('running');
  });
});
