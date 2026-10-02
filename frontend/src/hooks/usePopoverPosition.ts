import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface PopoverPosition {
  top: number;
  left: number;
  /**
   * Ceiling for the panel on the side it opens towards, in px. Undefined when
   * the anchor has no room on either side — the panel then keeps its natural
   * size and the viewport clamp applies, which is the only legal outcome.
   */
  maxHeight?: number;
}

/**
 * Viewport-aware positioning for a fixed popover anchored to a trigger
 * (extracted from CusAppointmentPopover for the _34 rework): flips above
 * when there is no room below, clamps to the viewport padding, right-aligns
 * to the trigger, and re-computes on resize/scroll.
 *
 * Two promises added by card 20260927_152 (operator 2026-09-27: "why the
 * dropdown jump around not right below where I clicked"):
 *
 *   1. **No coordinates means no position.** A 0×0 trigger rect is *not
 *      measured* — the hook returns `null` and the caller keeps its panel
 *      hidden. It never falls back to the viewport padding corner, which is
 *      how a panel used to paint over the page header.
 *   2. **Self-healing after mount.** The first pass runs synchronously in a
 *      layout effect, but the panel may mount an effect later (portal,
 *      Suspense) and the TRIGGER can move without a window resize (the bar
 *      re-wraps, a banner mounts, data loads). So: two rAF passes after open,
 *      a ResizeObserver on the popover, and a second ResizeObserver on the
 *      trigger.
 */
export function usePopoverPosition(
  popoverRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null> | undefined,
  isOpen: boolean,
  fallbackWidth = 275,
  fallbackHeight = 280,
): PopoverPosition | null {
  const [coords, setCoords] = useState<PopoverPosition | null>(null);

  // A closed popover holds no coordinates: keeping them would paint the panel
  // at its previous spot for one frame on reopen (the "jump" the operator
  // reported), and a hidden panel must never report a position.
  useLayoutEffect(() => {
    if (isOpen) return;
    setCoords((prev) => (prev === null ? prev : null));
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef?.current;
    if (!trigger) {
      setCoords(null);
      return;
    }

    const updatePosition = () => {
      const triggerRect = trigger.getBoundingClientRect();
      // Not measured yet (display:none host, not laid out, closed drawer):
      // stay hidden instead of parking the panel in the padding corner.
      if (triggerRect.width === 0 && triggerRect.height === 0) {
        setCoords(null);
        return;
      }
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

      // Card 20260928_158: the side is chosen first, then the panel is bounded
      // by the space on THAT side. Bounding it to the viewport instead (the old
      // `max-height: 100dvh - 24px`) is what made a filter sheet taller than
      // its anchor slide up over the button that opened it: the clamp above
      // pins a full-viewport panel to the top padding, and the trigger sits
      // inside it. Measured 2026-09-28 on /dispatch-detail at 390px — a sheet
      // needing 820px, only 583px available below the trigger, so it covered
      // the trigger by 233px. Bounded to the anchor it opens under the trigger
      // and scrolls instead, which is the whole point of a scrollable body.
      const opensBelow = popoverHeight <= spaceBelow || spaceBelow >= spaceAbove;
      const room = Math.max(0, opensBelow ? spaceBelow : spaceAbove);

      let top: number;
      if (opensBelow) {
        top = triggerRect.bottom + gap;
      } else {
        top = triggerRect.top - gap - popoverHeight;
      }
      top = Math.max(viewportTop + padding, Math.min(top, viewportTop + vh - padding - popoverHeight));

      let left = triggerRect.right - popoverWidth;
      left = Math.max(viewportLeft + padding, Math.min(left, viewportLeft + vw - padding - popoverWidth));

      const top_ = Math.round(top);
      const left_ = Math.round(left);
      // Room is the ceiling, not a fixed size: a short panel keeps its natural
      // height and only a panel that outgrows its anchor is capped and scrolled.
      const maxHeight_ = room > 0 ? Math.round(room) : undefined;
      // Identity-stable so the rAF passes below are free when nothing moved.
      setCoords((prev) => (
        prev && prev.top === top_ && prev.left === left_ && prev.maxHeight === maxHeight_
          ? prev
          : { top: top_, left: left_, maxHeight: maxHeight_ }
      ));
    };

    let popoverObserver: ResizeObserver | null = null;
    const observePopover = () => {
      if (popoverObserver || typeof ResizeObserver === 'undefined') return;
      const popoverEl = popoverRef.current;
      if (!popoverEl) return; // Mounted later than this effect — the rAF pass retries.
      popoverObserver = new ResizeObserver(updatePosition);
      popoverObserver.observe(popoverEl);
    };

    updatePosition();
    observePopover();

    // A bar re-wrap moves the trigger without a window resize.
    const triggerObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    triggerObserver?.observe(trigger);

    // Two passes: the panel/parent may settle in the same frame (wrapping,
    // fonts, a portal host) — the second pass re-measures once it has.
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      updatePosition();
      observePopover();
      frame2 = requestAnimationFrame(() => {
        updatePosition();
        observePopover();
      });
    });

    window.visualViewport?.addEventListener('resize', updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      popoverObserver?.disconnect();
      triggerObserver?.disconnect();
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, triggerRef, popoverRef, fallbackWidth, fallbackHeight]);

  return coords;
}
