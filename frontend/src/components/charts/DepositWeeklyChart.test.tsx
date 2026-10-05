import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepositWeeklyChart, type DepositWeekRow } from './DepositWeeklyChart';

const weeks: DepositWeekRow[] = [
  { weekStart: '2026-09-01', label: 'Tuần 01/09', count: 4, depositAmount: 12_000_000, refundedAmount: 3_000_000 },
  { weekStart: '2026-09-08', label: 'Tuần 08/09', count: 0, depositAmount: 0, refundedAmount: 0 },
  { weekStart: '2026-09-15', label: 'Tuần 15/09', count: 2, depositAmount: 6_000_000, refundedAmount: 6_000_000 },
];

/** X-axis captions live in SVG <text> nodes; the <desc> summary repeats week
 * labels too, so week-label assertions must scope to the axis, not the DOM. */
function axisLabels(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent);
}

function barHeight(container: HTMLElement, series: string, weekIndex: number): number {
  const rect = container.querySelector(`[data-chart-bar="${series}"][data-week-index="${weekIndex}"]`);
  expect(rect).not.toBeNull();
  return Number(rect?.getAttribute('height') ?? 'NaN');
}

describe('DepositWeeklyChart', () => {
  beforeEach(() => {
    // The chart tracks its responsive size via ResizeObserver, which jsdom
    // does not provide — stub a no-op so the component keeps its default
    // 760×280 viewBox.
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders exactly one x-axis label per week', () => {
    const { container } = render(<DepositWeeklyChart weeks={weeks} />);
    const labels = axisLabels(container);
    for (const week of weeks) {
      expect(labels.filter((label) => label === week.label)).toHaveLength(1);
    }
  });

  it('renders zero-height bars for an empty week while keeping its x label', () => {
    const { container } = render(<DepositWeeklyChart weeks={weeks} />);
    for (const series of ['count', 'deposit', 'refund']) {
      expect(barHeight(container, series, 1)).toBe(0);
      expect(barHeight(container, series, 0)).toBeGreaterThan(0);
    }
    expect(axisLabels(container)).toContain('Tuần 08/09');
  });

  it('shows the empty-state text when weeks is empty', () => {
    render(<DepositWeeklyChart weeks={[]} />);
    expect(screen.getByText('Chưa có dữ liệu cược trong kỳ')).toBeInTheDocument();
  });

  it('renders a single week without crashing', () => {
    const single = [weeks[0]];
    const { container } = render(<DepositWeeklyChart weeks={single} />);
    expect(container.querySelectorAll('[data-chart-bar]')).toHaveLength(3);
    expect(axisLabels(container)).toContain('Tuần 01/09');
  });

  it('shows the Vietnamese legend labels', () => {
    render(<DepositWeeklyChart weeks={weeks} />);
    expect(screen.getByText('Số lượng')).toBeInTheDocument();
    expect(screen.getByText('Tiền cược')).toBeInTheDocument();
    expect(screen.getByText('Đã hoàn cược')).toBeInTheDocument();
  });
});
