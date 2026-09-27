/**
 * Shared positioning logic for the searchable-select popover — used by both
 * the single-select `SearchableSelect` and the multi-select
 * `SearchableMultiSelect`. Kept in its own hook so the two view components
 * stay under the frontend structure-guard ceilings.
 *
 * Behaviour (card 20260927_152 — the operator's "why the dropdown jump around
 * not right below where I clicked" report):
 *   - The panel is ANCHORED TO ITS TRIGGER AT EVERY WIDTH. The ≤640px
 *     top-pinned sheet (`top: max(72px, env(safe-area-inset-top)); right: 8px`)
 *     is deleted: it painted the `Kế hoạch` picker over the page header instead
 *     of under the control the operator pressed, and it made the same control
 *     behave differently on either side of 640px.
 *   - Unmeasured means invisible. `data-positioned="true"` is written at the
 *     end of `positionPopover`; the stylesheet keeps the panel `visibility:
 *     hidden` until then, so the first paint never flashes it at (0,0).
 *   - A 0×0 trigger rect is NOT measured: coordinates are left untouched (the
 *     panel stays hidden) rather than clamped to (16,16). It is explicitly not
 *     treated as "scrolled out of view" — closing the picker would make an
 *     un-laid-out host (a closed drawer, a `display:none` ancestor) unable to
 *     open at all.
 *   - Measures the trigger's viewport rect and walks its ancestors to detect
 *     any scroll container whose clip rect excludes the trigger (the dropdown
 *     would be visually clipped too). On clip-out, the picker auto-closes.
 *   - Flips placement to `top` when the natural popover height exceeds the
 *     viewport space below the trigger AND there is more space above.
 *   - Repositions on `resize`, `scroll` (capture phase) and TRIGGER RESIZE —
 *     a bar re-wrap moves the trigger without a window resize.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface PositionArgs {
  isOpen: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  /** Run on every layout pass; close when the trigger is scrolled out of view. */
  onClose: () => void;
  /** Re-run when any of these change so the popover re-measures. */
  dependencies: ReadonlyArray<unknown>;
}

function isTriggerVisibleWithinScrollContainers(
  trigger: HTMLElement,
  triggerRect: DOMRect,
): boolean {
  // A 0×0 rect means "not laid out", not "visible": the caller reports it as
  // unmeasured before ever asking this question, so it is not visible here.
  if (triggerRect.width === 0 && triggerRect.height === 0) return false;
  const outsideViewport = triggerRect.bottom <= 0
    || triggerRect.top >= window.innerHeight
    || triggerRect.right <= 0
    || triggerRect.left >= window.innerWidth;
  if (outsideViewport) return false;

  let ancestor = trigger.parentElement;
  while (ancestor) {
    const style = window.getComputedStyle(ancestor);
    const ancestorRect = ancestor.getBoundingClientRect();
    const clipsHorizontally = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    const clipsVertically = /(auto|scroll|hidden|clip)/.test(style.overflowY);
    if (clipsHorizontally && (triggerRect.right <= ancestorRect.left || triggerRect.left >= ancestorRect.right)) {
      return false;
    }
    if (clipsVertically && (triggerRect.bottom <= ancestorRect.top || triggerRect.top >= ancestorRect.bottom)) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }
  return true;
}

export function useSearchableSelectPosition({
  isOpen,
  triggerRef,
  popoverRef,
  onClose,
  dependencies,
}: PositionArgs): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const viewportPadding = 16;
    const popoverGap = 6;
    const triggerRect = trigger.getBoundingClientRect();
    // Not measured yet — leave the panel hidden and retry on the next pass.
    // NEVER auto-close here: an un-laid-out host must still be able to open.
    if (triggerRect.width === 0 && triggerRect.height === 0) {
      popover.dataset.positioned = 'false';
      return;
    }
    if (!isTriggerVisibleWithinScrollContainers(trigger, triggerRect)) {
      onCloseRef.current();
      return;
    }

    popover.dataset.placement = 'bottom';
    popover.style.removeProperty('--searchable-select-popover-max-height');
    popover.style.setProperty('--searchable-select-popover-top', '0px');
    popover.style.setProperty('--searchable-select-popover-left', '0px');
    popover.style.setProperty('--searchable-select-popover-width', `${triggerRect.width}px`);
    const popoverRect = popover.getBoundingClientRect();

    const spaceBelow = Math.max(
      0,
      window.innerHeight - triggerRect.bottom - viewportPadding - popoverGap,
    );
    const spaceAbove = Math.max(
      0,
      triggerRect.top - viewportPadding - popoverGap,
    );
    const placement = popoverRect.height > spaceBelow && spaceAbove > spaceBelow
      ? 'top'
      : 'bottom';
    const availableHeight = placement === 'top' ? spaceAbove : spaceBelow;

    popover.dataset.placement = placement;
    popover.style.setProperty(
      '--searchable-select-popover-max-height',
      `${Math.floor(availableHeight)}px`,
    );
    const renderedHeight = popover.getBoundingClientRect().height;

    const maximumLeft = Math.max(
      viewportPadding,
      window.innerWidth - viewportPadding - popoverRect.width,
    );
    const clampedLeft = Math.min(
      Math.max(triggerRect.left, viewportPadding),
      maximumLeft,
    );
    const requestedTop = placement === 'top'
      ? triggerRect.top - popoverGap - renderedHeight
      : triggerRect.bottom + popoverGap;
    const maximumTop = Math.max(
      viewportPadding,
      window.innerHeight - viewportPadding - renderedHeight,
    );
    const popoverTop = Math.min(
      Math.max(requestedTop, viewportPadding),
      maximumTop,
    );
    popover.style.setProperty('--searchable-select-popover-top', `${Math.round(popoverTop)}px`);
    popover.style.setProperty('--searchable-select-popover-left', `${Math.round(clampedLeft)}px`);
    // Last: the panel only becomes visible with coordinates in hand.
    popover.dataset.positioned = 'true';
  }, [popoverRef, triggerRef]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    positionPopover();
    // The trigger can move without a window resize (the filter bar re-wraps,
    // a banner mounts, the option list re-filters): watch it directly.
    const trigger = triggerRef.current;
    const triggerObserver = typeof ResizeObserver === 'undefined' || !trigger
      ? null
      : new ResizeObserver(positionPopover);
    if (trigger) triggerObserver?.observe(trigger);
    const popover = popoverRef.current;
    const popoverObserver = typeof ResizeObserver === 'undefined' || !popover
      ? null
      : new ResizeObserver(positionPopover);
    if (popover) popoverObserver?.observe(popover);
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      triggerObserver?.disconnect();
      popoverObserver?.disconnect();
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, positionPopover, ...dependencies]);
}
