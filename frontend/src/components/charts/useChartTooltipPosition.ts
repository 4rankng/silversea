import { useLayoutEffect, type RefObject } from 'react';

export interface ChartTooltipRect { left: number; top: number; right: number; bottom: number }
interface ChartTooltipClip { rect: ChartTooltipRect; x: boolean; y: boolean }
type Alignment = 'start' | 'center' | 'end';

export function intersectChartTooltipClip(viewport: ChartTooltipRect, ancestors: readonly ChartTooltipClip[]) {
  return ancestors.reduce((clip, ancestor) => ({
    left: ancestor.x ? Math.max(clip.left, ancestor.rect.left) : clip.left,
    right: ancestor.x ? Math.min(clip.right, ancestor.rect.right) : clip.right,
    top: ancestor.y ? Math.max(clip.top, ancestor.rect.top) : clip.top,
    bottom: ancestor.y ? Math.min(clip.bottom, ancestor.rect.bottom) : clip.bottom,
  }), { ...viewport });
}

export function placeChartTooltip(
  anchor: { x: number; y: number }, size: { width: number; height: number },
  clip: ChartTooltipRect, alignment: Alignment, gap = 12,
) {
  const leftMin = clip.left + 4, leftMax = clip.right - 4 - size.width;
  const topMin = clip.top + 4, topMax = clip.bottom - 4 - size.height;
  const preferredLeft = anchor.x - (alignment === 'start' ? 0 : alignment === 'end' ? size.width : size.width / 2);
  const above = anchor.y - gap - size.height, below = anchor.y + gap;
  const preferredTop = above < topMin && below <= topMax ? below : above;
  const left = Math.max(leftMin, Math.min(preferredLeft, leftMax));
  const top = Math.max(topMin, Math.min(preferredTop, topMax));
  return { left, top, fits: size.width <= clip.right - clip.left - 8 && size.height <= clip.bottom - clip.top - 8 };
}

interface PositionArgs {
  isOpen: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  tooltipRef: RefObject<HTMLDivElement | null>;
  anchorX: number;
  anchorY: number;
  chartWidth: number;
  chartHeight: number;
  alignment: Alignment;
}

/** Measure this chart's natural tooltip against its actual clipping ancestors. */
export function useChartTooltipPosition({
  isOpen, containerRef, tooltipRef, anchorX, anchorY, chartWidth, chartHeight, alignment,
}: PositionArgs) {
  useLayoutEffect(() => {
    const container = containerRef.current, tooltip = tooltipRef.current;
    if (!isOpen || !container || !tooltip) return;
    const ancestors: HTMLElement[] = [];
    for (let element = container.parentElement; element; element = element.parentElement) ancestors.push(element);
    const setProperty = (name: string, value: number) => {
      const next = `${value}px`;
      if (tooltip.style.getPropertyValue(name) !== next) tooltip.style.setProperty(name, next);
    };
    const position = () => {
      const owner = container.getBoundingClientRect();
      if (!(owner.width > 0 && owner.height > 0 && chartWidth > 0 && chartHeight > 0)) return;
      const scaleX = owner.width / chartWidth, scaleY = owner.height / chartHeight;
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
        right: Math.min(document.documentElement.clientWidth, (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth)),
        bottom: Math.min(document.documentElement.clientHeight, (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight)),
      };
      const clips = ancestors.map(element => {
        const style = window.getComputedStyle(element), rect = element.getBoundingClientRect();
        const sx = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
        const sy = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
        const containsPaint = /(?:paint|strict|content)/.test(style.contain);
        return {
          rect: { left: rect.left + element.clientLeft * sx, top: rect.top + element.clientTop * sy,
            right: rect.left + (element.clientLeft + element.clientWidth) * sx,
            bottom: rect.top + (element.clientTop + element.clientHeight) * sy },
          x: containsPaint || /(?:auto|scroll|hidden|clip)/.test(style.overflowX),
          y: containsPaint || /(?:auto|scroll|hidden|clip)/.test(style.overflowY),
        };
      });
      const clip = intersectChartTooltipClip(viewport, clips);
      const availableWidth = Math.max(0, clip.right - clip.left - 8) / scaleX;
      setProperty('--chart-tooltip-min-width', Math.min(192, availableWidth));
      setProperty('--chart-tooltip-max-width', availableWidth);
      const measured = tooltip.getBoundingClientRect();
      const placed = placeChartTooltip(
        { x: owner.left + anchorX * scaleX, y: owner.top + anchorY * scaleY },
        { width: measured.width, height: measured.height }, clip, alignment, 12 * scaleY,
      );
      setProperty('--chart-tooltip-left', (placed.left - owner.left) / scaleX);
      setProperty('--chart-tooltip-top', (placed.top - owner.top) / scaleY);
      tooltip.dataset.chartTooltipBoxFits = String(placed.fits);
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    for (const element of [container, tooltip, ...ancestors]) observer?.observe(element);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', position);
    visual?.addEventListener('scroll', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      visual?.removeEventListener('resize', position);
      visual?.removeEventListener('scroll', position);
    };
  }, [isOpen, containerRef, tooltipRef, anchorX, anchorY, chartWidth, chartHeight, alignment]);
}
