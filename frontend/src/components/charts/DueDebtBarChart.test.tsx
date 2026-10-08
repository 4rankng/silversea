import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DueDebtBarChart, type DueDebtGroup } from './DueDebtBarChart';

/** Contract labels (REQ-5.10-02) verbatim — including the en-dash. */
const groups: DueDebtGroup[] = [
  { key: 'dueSoon5d', label: 'Sắp đến hạn (≤ 5 ngày)', amount: 12_000_000, customers: 3 },
  { key: 'overdue1to10', label: 'Quá hạn 1–10 ngày', amount: 0, customers: 0 },
  { key: 'overdue11to30', label: 'Quá hạn 30 ngày', amount: 4_500_000, customers: 1 },
  { key: 'overdue30plus', label: 'Quá hạn 60 ngày', amount: 9_000_000, customers: 2 },
];

/** X-axis captions and count sublabels live in SVG <text> nodes; the <desc>
 * summary repeats group labels too, so label assertions must scope to the
 * rendered text nodes, not the whole DOM. */
function axisTexts(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent);
}

function barHeight(container: HTMLElement, groupIndex: number): number {
  const rect = container.querySelector(`[data-chart-bar="amount"][data-group-index="${groupIndex}"]`);
  expect(rect).not.toBeNull();
  return Number(rect?.getAttribute('height') ?? 'NaN');
}

describe('DueDebtBarChart', () => {
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

  it('renders exactly one x-axis label per group', () => {
    const { container } = render(<DueDebtBarChart groups={groups} />);
    const labels = axisTexts(container);
    expect(labels.filter((label) => groups.some((g) => g.label === label))).toHaveLength(4);
    for (const group of groups) {
      expect(labels.filter((label) => label === group.label)).toHaveLength(1);
    }
  });

  it('renders a zero-height bar for an empty group while keeping its labels', () => {
    const { container } = render(<DueDebtBarChart groups={groups} />);
    expect(barHeight(container, 1)).toBe(0);
    expect(barHeight(container, 0)).toBeGreaterThan(0);
    expect(barHeight(container, 2)).toBeGreaterThan(0);
    expect(barHeight(container, 3)).toBeGreaterThan(0);
    expect(axisTexts(container)).toContain('Quá hạn 1–10 ngày');
    expect(axisTexts(container)).toContain('0 khách');
  });

  it('shows the customer-count sublabel under each column', () => {
    const { container } = render(<DueDebtBarChart groups={groups} />);
    groups.forEach((group, i) => {
      const sublabel = container.querySelector(`[data-chart-count="${i}"]`);
      expect(sublabel?.textContent).toBe(`${group.customers} khách`);
    });
  });

  it('shows the empty-state text when groups is empty', () => {
    render(<DueDebtBarChart groups={[]} />);
    expect(screen.getByText('Chưa có dữ liệu công nợ trong kỳ')).toBeInTheDocument();
  });

  it('renders a single group without crashing', () => {
    const single = [groups[0]];
    const { container } = render(<DueDebtBarChart groups={single} />);
    expect(container.querySelectorAll('[data-chart-bar="amount"]')).toHaveLength(1);
    expect(axisTexts(container)).toContain('Sắp đến hạn (≤ 5 ngày)');
  });

  it('exposes hover tooltip content to assistive tech', () => {
    const { container } = render(
      <DueDebtBarChart groups={groups} formatTooltip={(v) => v.toLocaleString('en-US')} />,
    );
    fireEvent.mouseEnter(container.querySelector('[data-chart-hit="0"]')!);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Sắp đến hạn (≤ 5 ngày)');
    expect(tooltip).toHaveTextContent('12,000,000');
    expect(tooltip).toHaveTextContent('3 khách');

    // The chart links the tooltip from its accessible description so screen
    // readers announce it; the SVG <desc> mirrors the same data unhovered.
    const svg = screen.getByRole('img');
    const describedBy = svg.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toContain(tooltip.id);
    expect(container.querySelector('svg desc')?.textContent).toContain('3 khách');
  });

  it('keeps the Vietnamese legend visible', () => {
    render(<DueDebtBarChart groups={groups} />);
    expect(screen.getByText('Nhóm hạn nợ')).toBeInTheDocument();
  });
});
