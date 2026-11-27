import { cloneElement, isValidElement, useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';
import './DisabledActionTip.css';

interface DisabledActionTipProps {
  /** Why the wrapped action is disabled — null means the action is enabled
   *  and the wrapper adds nothing to the DOM. */
  reason: string | null;
  /** Stable id prefix; the injected description id is `${id}-disabled-reason`. */
  id: string;
  children: ReactNode;
}

type BubbleAlign = 'center' | 'start' | 'end';

/**
 * Disabled actions explain themselves (card 081026093510 — /dispatch export
 * button sat disabled with no tooltip while /shipments' equivalent was live).
 *
 * Pattern: aria-described + aria-disabled. The action keeps `aria-disabled`
 * (NEVER the `disabled` attribute) so it stays in the tab order and receives
 * mouse events — a natively disabled control can be neither focused nor
 * hovered, which makes any explanation unreachable (the exact defect this
 * card fixes). This wrapper then:
 *  - injects `aria-describedby` on the child pointing at the reason, so
 *    focusing the action announces why it is unavailable;
 *  - renders the reason twice: sr-only for assistive tech, and a tooltip
 *    bubble that CSS reveals on wrapper `:hover` / `:focus-within`.
 *
 * The consumer MUST guard the handler (`if (reason) return;`) — aria-disabled
 * does not block clicks the way `disabled` does.
 */
export function DisabledActionTip({ reason, id, children }: DisabledActionTipProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [align, setAlign] = useState<BubbleAlign>('center');

  // SIL-1118 — clamp tooltip alignment to the visible main content pane so
  // left-edge controls (e.g. [Khóa lô] beside the sidebar) never clip their
  // centered bubble under the sidebar or off-viewport.
  const updateAlign = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const container = el.closest('main, .app-body');
    const bounds = container?.getBoundingClientRect();
    const minLeft = (bounds ? Math.max(bounds.left, 0) : 0) + 12;
    const maxRight = (bounds ? Math.min(bounds.right, window.innerWidth) : window.innerWidth) - 12;
    const halfBubble = Math.min(180, (window.innerWidth - 24) / 2);
    const center = rect.left + rect.width / 2;
    if (center - halfBubble < minLeft) {
      setAlign('start');
    } else if (center + halfBubble > maxRight) {
      setAlign('end');
    } else {
      setAlign('center');
    }
  }, []);

  if (reason == null) return <>{children}</>;
  const reasonId = `${id}-disabled-reason`;
  return (
    <span
      ref={wrapperRef}
      className="disabled-action-tip"
      data-align={align}
      onMouseEnter={updateAlign}
      onFocusCapture={updateAlign}
    >
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': reasonId })
        : children}
      <span id={reasonId} className="sr-only">{reason}</span>
      <span className="disabled-action-tip__bubble" aria-hidden="true">{reason}</span>
    </span>
  );
}
