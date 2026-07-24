import React from 'react';

/* ─── Tooltip ──────────────────────────────────────────────────────────────
 * Hover/focus hint over any wrapped element. Wraps daisyUI's `.d-tooltip`
 * (prefixed to avoid colliding with this project's existing classes).
 *
 * Uses daisyUI's native `data-tip` attribute + CSS hover/focus behavior, so
 * there is no JS state and no portal cost. Accessible: focus on the wrapped
 * control also reveals the tip.
 *
 * Use it around icon-only buttons so mouse users get a hint that keyboard
 * users already get via `aria-label`.
 * -------------------------------------------------------------------------- */

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** Text shown on hover/focus. Empty/undefined renders children without a tip. */
  label?: React.ReactNode;
  /** Which side the tip pops on. Default 'top'. */
  side?: TooltipSide;
  /** Force the tip open (e.g. for onboarding). Default: hover/focus driven. */
  open?: boolean;
  /** Optional className passthrough on the wrapper. */
  className?: string;
  /** Inline style passthrough on the wrapper. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const SIDE_CLASS: Record<TooltipSide, string> = {
  top: 'd-tooltip-top',
  bottom: 'd-tooltip-bottom',
  left: 'd-tooltip-left',
  right: 'd-tooltip-right',
};

export function Tooltip({ label, side = 'top', open, className = '', style, children }: TooltipProps) {
  // No label → render children untouched. Lets callers gate the hint cheaply
  // (`<Tooltip label={maybeTip}>`) without branching the JSX themselves.
  if (!label) return <>{children}</>;

  return (
    <div
      className={`d-tooltip ${SIDE_CLASS[side]} ${open ? 'd-tooltip-open' : ''} ${className}`.trim()}
      data-tip={typeof label === 'string' ? label : undefined}
      style={style}
    >
      {children}
      {/* Non-string labels (e.g. an icon + text) can't ride data-tip; render
          them inside the daisyUI content slot instead. */}
      {typeof label !== 'string' && <span className="d-tooltip-content">{label}</span>}
    </div>
  );
}
