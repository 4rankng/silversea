import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

/* ─── Tooltip ──────────────────────────────────────────────────────────────
 * Hover/focus hint over any wrapped element. Wraps daisyUI's `.d-tooltip`
 * (prefixed to avoid colliding with this project's existing classes).
 *
 * The bubble is a real `.tooltip-content` span (not the `data-tip` pseudo) so
 * it can be MEASURED: SIL-1258 — a trigger docked near a screen edge (the
 * /shipments drawer's [Khóa lô] at x≈1288/1440) centered its bubble past the
 * right edge and clipped the sentence mid-word. On hover/focus the wrapper
 * measures bubble-vs-viewport and shifts `--tt-trans` (daisyUI's own translate
 * hook) just enough to keep the whole bubble on screen; the tail override in
 * tokens.css keeps the arrow on the trigger while the bubble slides. Same
 * clamp law as DisabledActionTip (SIL-1118). Top/bottom sides only — the
 * left/right sides center on the other axis.
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
  /** Force the tip open regardless of hover/focus. Default: hover/focus driven. */
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  // SIL-1258 — clamp the bubble inside the viewport. daisyUI centers it with
  // `translateX(var(--tt-trans, -50%))`; composing `calc(-50% + Npx)` slides
  // the bubble without touching its layout. N keeps the bubble's box within
  // 12px of each screen edge; a bubble wider than the space pins its left
  // edge (the sentence start stays readable).
  const updateShift = useCallback(() => {
    if (side !== 'top' && side !== 'bottom') return;
    const wrapper = wrapperRef.current;
    const bubble = bubbleRef.current;
    if (!wrapper || !bubble) return;
    const w = wrapper.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    if (b.width === 0) return; // nothing laid out (jsdom / detached) — stays centered
    const center = w.left + w.width / 2;
    const half = b.width / 2;
    const minShift = 12 - (center - half);
    const maxShift = window.innerWidth - 12 - (center + half);
    const next = maxShift < minShift ? minShift : Math.min(Math.max(0, minShift), maxShift);
    setShift((current) => (current === next ? current : next));
  }, [side]);

  useLayoutEffect(() => { updateShift(); }, [updateShift, label, open]);

  // No label → render children untouched. Lets callers gate the hint cheaply
  // (`<Tooltip label={maybeTip}>`) without branching the JSX themselves.
  if (!label) return <>{children}</>;

  return (
    <div
      ref={wrapperRef}
      className={`d-tooltip ${SIDE_CLASS[side]} ${open ? 'd-tooltip-open' : ''} ${className}`.trim()}
      style={{
        ...style,
        ...(shift !== 0
          ? { '--tt-trans': shift > 0 ? `calc(-50% + ${shift}px)` : `calc(-50% - ${-shift}px)` }
          : null),
      } as React.CSSProperties}
      onMouseEnter={updateShift}
      onFocus={updateShift}
    >
      {children}
      {/* daisyUI styles `> .tooltip-content` exactly like the data-tip pseudo,
          so the bubble looks unchanged while staying measurable. aria-hidden:
          the control's own aria-label carries the accessible name. */}
      <span ref={bubbleRef} className="d-tooltip-content" aria-hidden="true">{label}</span>
    </div>
  );
}
