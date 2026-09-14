import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'all', label: 'Tất cả' },
  { id: 'blocked', label: 'Không khả dụng', disabled: true },
  { id: 'active', label: 'Đang thực hiện' },
];

describe('Tabs keyboard navigation', () => {
  it('keeps one enabled tab reachable when the selected tab is unavailable', () => {
    render(<Tabs tabs={tabs} value="blocked" onChange={() => {}} ariaLabel="Công việc" />);
    expect(screen.getByRole('tab', { name: 'Tất cả' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Không khả dụng' }).tabIndex).toBe(-1);
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it('skips disabled tabs, wraps and handles Home/End within its own group', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="all" onChange={onChange} ariaLabel="Công việc" />);
    const first = screen.getByRole('tab', { name: 'Tất cả' });
    const last = screen.getByRole('tab', { name: 'Đang thực hiện' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(last);
    expect(onChange).toHaveBeenLastCalledWith('active');
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('does not duplicate DOM identifiers when groups reuse tab item IDs', () => {
    render(<>
      <Tabs tabs={tabs} value="all" onChange={() => {}} ariaLabel="Lô hàng" />
      <Tabs tabs={tabs} value="all" onChange={() => {}} ariaLabel="Chuyến xe" />
    </>);
    const first = within(screen.getByRole('tablist', { name: 'Lô hàng' })).getByRole('tab', { name: 'Tất cả' });
    const second = within(screen.getByRole('tablist', { name: 'Chuyến xe' })).getByRole('tab', { name: 'Tất cả' });
    expect(first.id).not.toBe(second.id);
  });
});
