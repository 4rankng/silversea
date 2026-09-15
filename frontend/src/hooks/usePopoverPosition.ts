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

      const vh = window.innerHeight || 900;
      const vw = window.innerWidth || 1440;

      const spaceBelow = vh - triggerRect.bottom - gap - padding;
      const spaceAbove = triggerRect.top - gap - padding;

      let top: number;
      if (popoverHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        top = triggerRect.bottom + gap;
      } else {
        top = triggerRect.top - gap - popoverHeight;
      }
      top = Math.max(padding, Math.min(top, vh - padding - popoverHeight));

      let left = triggerRect.right - popoverWidth;
      left = Math.max(padding, Math.min(left, vw - padding - popoverWidth));

      setCoords({ top: Math.round(top), left: Math.round(left) });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, triggerRef, popoverRef, fallbackWidth, fallbackHeight]);

  return coords;
}
