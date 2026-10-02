import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Positions a chart's HTML tooltip overlay (the `data-chart-tooltip` element)
 * around an SVG anchor point, entirely through CSS custom properties so the
 * tooltip's own style stays declarative:
 *
 *   - `--chart-tooltip-left` / `--chart-tooltip-top` — the box position in px
 *     relative to the chart container;
 *   - `--chart-tooltip-min-width` — the readable floor for the value rows.
 *
 * Horizontal alignment mirrors the anchor semantics: `start` keeps the box's
 * left edge on the anchor (first point), `end` its right edge (last point),
 * `center` centers it — then the box is clamped inside the chart so a edge
 * month's tooltip never overflows the canvas. Vertically the tooltip floats
 * ABOVE the anchor (12px gap); when there is no headroom it drops below
 * instead of clipping through the chart top.
 */
const GAP_PX = 12;
const EDGE_PADDING_PX = 4;
/** The two Vietnamese label/value pairs need more than 160px once their
 *  markers and horizontal padding are accounted for. */
const MIN_WIDTH_PX = '192px';

interface ChartTooltipPositionArgs {
  isOpen: boolean;
  containerRef: RefObject<HTMLElement | null>;
  tooltipRef: RefObject<HTMLElement | null>;
  anchorX: number;
  anchorY: number;
  chartWidth: number;
  chartHeight: number;
  alignment: 'start' | 'center' | 'end';
}

export function useChartTooltipPosition({
  isOpen, containerRef, tooltipRef, anchorX, anchorY, chartWidth, chartHeight, alignment,
}: ChartTooltipPositionArgs): void {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!isOpen) {
      container.style.removeProperty('--chart-tooltip-left');
      container.style.removeProperty('--chart-tooltip-top');
      return;
    }

    container.style.setProperty('--chart-tooltip-min-width', MIN_WIDTH_PX);

    // Metrics are 0 in jsdom (and on the very first frame before layout) —
    // skip the clamping that depends on them rather than guessing a width.
    const width = tooltipRef.current?.offsetWidth ?? 0;
    const height = tooltipRef.current?.offsetHeight ?? 0;

    const shift = alignment === 'center' ? width / 2 : alignment === 'end' ? width : 0;
    let left = anchorX - shift;
    if (width > 0) {
      const maxLeft = Math.max(EDGE_PADDING_PX, chartWidth - width - EDGE_PADDING_PX);
      left = Math.min(Math.max(left, EDGE_PADDING_PX), maxLeft);
    }

    let top = anchorY - height - GAP_PX;
    if (height > 0 && top < EDGE_PADDING_PX) top = anchorY + GAP_PX;

    container.style.setProperty('--chart-tooltip-left', `${left}px`);
    container.style.setProperty('--chart-tooltip-top', `${top}px`);
  }, [isOpen, anchorX, anchorY, chartWidth, chartHeight, alignment, containerRef, tooltipRef]);
}
