import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'all', label: 'Tất cả' },
  { id: 'blocked', label: 'Không khả dụng', disabled: true },
  { id: 'active', label: 'Đang thực hiện' },
];

function setCoarsePointer(coarse: boolean) {
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation(query => {
    const actual = matchMedia(query);
    return query === '(pointer: coarse)' ? { ...actual, matches: coarse } : actual;
  });
}

describe('Tabs keyboard navigation', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('reveals the active tab inside its strip without scrolling the page', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const left = this.getAttribute('role') === 'tablist' ? 10 : 300;
      const width = this.getAttribute('role') === 'tablist' ? 200 : 100;
      return { left, right: left + width, top: 0, bottom: 40, width, height: 40, x: left, y: 0, toJSON: () => ({}) };
    });
    render(<Tabs tabs={tabs} value="active" onChange={() => {}} ariaLabel="Công việc" />);
    expect(screen.getByRole('tablist').scrollLeft).toBe(190);
    expect(document.documentElement.scrollTop).toBe(0);
  });
  it('keeps one enabled tab reachable when the selected tab is unavailable', () => {
    render(<Tabs tabs={tabs} value="blocked" onChange={() => {}} ariaLabel="Công việc" />);
    expect(screen.getByRole('tab', { name: 'Tất cả' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Không khả dụng' }).tabIndex).toBe(-1);
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it('retains fine-wide boxed keyboard navigation, disabled skipping and Home/End', () => {
    setCoarsePointer(false);
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

  it('commits dropdown category IDs while retaining counts and disabled choices', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs.map(tab => ({ ...tab, count: tab.id === 'all' ? 12 : 0 }))} value="all" onChange={onChange} ariaLabel="Công việc" presentation="select" />);
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: /Công việc/ }), { key: 'ArrowDown' });
    const blocked = await screen.findByRole('option', { name: 'Không khả dụng (0)' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option', { name: 'Đang thực hiện (0)' }));
    expect(onChange).toHaveBeenCalledWith('active');
  });

  it('uses the existing finite dropdown for coarse-wide boxed categories without enabling disabled choices', async () => {
    setCoarsePointer(true);
    const onChange = vi.fn();
    const countedTabs = tabs.map(tab => ({ ...tab, count: tab.id === 'all' ? 12 : 0 }));
    const { rerender } = render(<Tabs tabs={countedTabs} value="all" onChange={onChange} ariaLabel="Công việc" />);
    expect(screen.queryByRole('tablist')).toBeNull();
    const trigger = screen.getByRole('button', { name: /Công việc/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveTextContent('Tất cả (12)');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const blocked = await screen.findByRole('option', { name: 'Không khả dụng (0)' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option', { name: 'Đang thực hiện (0)' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('active');
    rerender(<Tabs tabs={countedTabs} value="active" onChange={onChange} ariaLabel="Công việc" />);
    expect(screen.getByRole('button', { name: /Công việc/ })).toHaveTextContent('Đang thực hiện (0)');
  });

  it.each(['bordered', 'plain'] as const)('retains %s tablists and native keyboard navigation on a coarse-wide pointer', variant => {
    setCoarsePointer(true);
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="all" onChange={onChange} ariaLabel="Công việc" variant={variant} />);
    const list = screen.getByRole('tablist', { name: 'Công việc' });
    const first = within(list).getByRole('tab', { name: 'Tất cả' });
    const last = within(list).getByRole('tab', { name: 'Đang thực hiện' });
    expect(within(list).getByRole('tab', { name: 'Không khả dụng' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Công việc/ })).toBeNull();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(last);
    expect(onChange).toHaveBeenLastCalledWith('active');
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(last);
    expect(onChange).toHaveBeenLastCalledWith('active');
  });

  it('keeps rich category titles and supporting text readable in the dropdown', async () => {
    render(<Tabs tabs={[
      { id: 'ledger', label: <>Chi tiết công nợ<small>{0} khoản phát sinh</small></> },
      { id: 'note', label: <>Giấy báo nợ<small>Nhắc nợ theo mẫu</small></> },
    ]} value="ledger" onChange={() => {}} ariaLabel="Chọn nghiệp vụ công nợ" presentation="select" />);
    const trigger = screen.getByRole('button', { name: /Chọn nghiệp vụ công nợ/ });
    expect(trigger).toHaveTextContent('Chi tiết công nợ 0 khoản phát sinh');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: 'Giấy báo nợ Nhắc nợ theo mẫu' })).toBeVisible();
  });
});
