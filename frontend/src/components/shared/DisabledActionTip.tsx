import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import './DisabledActionTip.css';

interface DisabledActionTipProps {
  /** Why the wrapped action is disabled — null means the action is enabled
   *  and the wrapper adds nothing to the DOM. */
  reason: string | null;
  /** Stable id prefix; the injected description id is `${id}-disabled-reason`. */
  id: string;
  children: ReactNode;
}

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
  if (reason == null) return <>{children}</>;
  const reasonId = `${id}-disabled-reason`;
  return (
    <span className="disabled-action-tip">
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': reasonId })
        : children}
      <span id={reasonId} className="sr-only">{reason}</span>
      <span className="disabled-action-tip__bubble" aria-hidden="true">{reason}</span>
    </span>
  );
}
