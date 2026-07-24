import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDashboardAnimations } from './useDashboardAnimations';

const { createDrawable } = vi.hoisted(() => ({
  createDrawable: vi.fn((path: SVGPathElement) => {
    path.style.strokeDasharray = '0 1010';
    return path;
  }),
}));

vi.mock('animejs', () => ({
  animate: vi.fn(),
  stagger: vi.fn(() => 0),
  createScope: vi.fn(() => ({
    add(callback: () => void) {
      callback();
      return this;
    },
    revert: vi.fn(),
  })),
  utils: {
    set: vi.fn(),
  },
  svg: {
    createDrawable,
  },
}));

function DashboardAnimationHarness() {
  const { rootRef } = useDashboardAnimations(true);

  return (
    <div ref={rootRef}>
      <div className="wf-kpi" />
      <section className="wf-chart">
        <svg>
          <path data-testid="chart-series" d="M 0 0 L 10 10" stroke="#005A2D" />
        </svg>
      </section>
    </div>
  );
}

describe('useDashboardAnimations', () => {
  it('keeps chart series visible while dashboard entrance animations run', () => {
    const { getByTestId } = render(<DashboardAnimationHarness />);
    const chartSeries = getByTestId('chart-series');

    expect(createDrawable).not.toHaveBeenCalled();
    expect(chartSeries.style.strokeDasharray).toBe('');
  });
});
