/**
 * Shared positioning logic for the searchable-select popover — used by both
 * the single-select `SearchableSelect` and the multi-select
 * `SearchableMultiSelect`. Kept in its own hook so the two view components
 * stay under the frontend structure-guard ceilings.
 *
 * Behaviour (matches the original inline implementation):
 *   - Measures the trigger's viewport rect and walks its ancestors to detect
 *     any scroll container whose clip rect excludes the trigger (the dropdown
 *     would be visually clipped too). On clip-out, the picker auto-closes.
 *   - Flips placement to `top` when the natural popover height exceeds the
 *     viewport space below the trigger AND there is more space above.
 *   - Repositions on `resize` and `scroll` (capture phase so scroll-into-
 *     view containers update before paint).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface PositionArgs {
  isOpen: boolean;
  isMobile: boolean;
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
  if (triggerRect.width === 0 && triggerRect.height === 0) return true;
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
  isMobile,
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
    if (!trigger || !popover || isMobile) return;

    const viewportPadding = 16;
    const popoverGap = 6;
    const triggerRect = trigger.getBoundingClientRect();
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
  }, [isMobile, popoverRef, triggerRef]);

  useLayoutEffect(() => {
    if (!isOpen || isMobile) return;
    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isMobile, positionPopover, ...dependencies]);
}
