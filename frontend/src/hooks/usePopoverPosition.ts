import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface PopoverPosition {
  top: number;
  left: number;
}

/**
 * Viewport-aware positioning for a fixed popover anchored to a trigger
 * (extracted from CusAppointmentPopover for the _34 rework): flips above
 * when there is no room below, clamps to the viewport padding, right-aligns
 * to the trigger, and re-computes on resize/scroll.
 */
export function usePopoverPosition(
  popoverRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null> | undefined,
  isOpen: boolean,
  fallbackWidth = 275,
  fallbackHeight = 280,
): PopoverPosition | null {
  const [coords, setCoords] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef?.current;
    if (!trigger) {
      setCoords(null);
      return;
    }

    const updatePosition = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const popoverEl = popoverRef.current;
      const popoverWidth = popoverEl?.offsetWidth || fallbackWidth;
      const popoverHeight = popoverEl?.offsetHeight || fallbackHeight;
      const gap = 4;
      const padding = 12;

      const viewport = window.visualViewport;
      const vh = viewport?.height || window.innerHeight || 900;
      const vw = viewport?.width || window.innerWidth || 1440;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;

      const spaceBelow = viewportTop + vh - triggerRect.bottom - gap - padding;
      const spaceAbove = triggerRect.top - viewportTop - gap - padding;

      let top: number;
      if (popoverHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        top = triggerRect.bottom + gap;
      } else {
        top = triggerRect.top - gap - popoverHeight;
      }
      top = Math.max(viewportTop + padding, Math.min(top, viewportTop + vh - padding - popoverHeight));

      let left = triggerRect.right - popoverWidth;
      left = Math.max(viewportLeft + padding, Math.min(left, viewportLeft + vw - padding - popoverWidth));

      setCoords({ top: Math.round(top), left: Math.round(left) });
    };

    updatePosition();
    // Calendar/time panels change height without a window resize.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer?.disconnect();
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, triggerRef, popoverRef, fallbackWidth, fallbackHeight]);

  return coords;
}
