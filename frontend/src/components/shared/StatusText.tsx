// Card 20260924_21 (BATCH A — systemic UX purge).
// Canonical replacement for pill-shaped status badges.
// Design law §1: data cells are text-only + house color-dot — no pill bubbles,
// no rounded background fills, no decorative icons. The legacy shared Badge
// component was a colored rounded box (borderRadius 4 + background fill);
// this file defines the SHARED text+dot treatment that the surface-level
// per-page code stops authoring locally.
//
// The legacy <Badge variant="…"> API is preserved by `shared/Badge.tsx`,
// which now delegates here so the three existing callers
// (DriverTripsPage, DebtListPage, CustomersPage) pick up the new treatment
// without per-page edits — i.e. the purge happens at the SHARED layer, not
// per-page, exactly as the card specifies.

import React from 'react';

export type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const VARIANT_TOKENS: Record<StatusVariant, { color: string; dot: string }> = {
  success: { color: 'var(--success-text, #155B39)', dot: 'var(--success, #177448)' },
  warning: { color: 'var(--warning-text, #6F3C10)', dot: 'var(--warning, #A45D1C)' },
  danger:  { color: 'var(--danger-text, #7F2D37)',  dot: 'var(--danger, #A0444E)'  },
  info:    { color: 'var(--info-text, #25574F)',    dot: 'var(--info, #2E675E)'    },
  neutral: { color: 'var(--ink-2, #4D5852)',        dot: 'var(--ink-3, #5F6872)'   },
};

interface StatusTextProps {
  variant?: StatusVariant;
  children: React.ReactNode;
  /** Render with the color dot. Default true. Set false for plain coloured
   *  text only — useful when a sibling visual (e.g. cus-workflow-badge)
   *  already encodes the colour. */
  dot?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Optional aria-label override; defaults to the rendered text. */
  'aria-label'?: string;
}

/**
 * Canonical status text+dot — the SHARED Badge component (card 20260924_21).
 * Plain text in the house compact style + a single house color-dot. NO pill
 * bubble, NO rounded background fill, NO border. Colors ride the existing
 * semantic triads (success/warning/danger/info/neutral); spacing/font ride
 * the new `--status-text-*` tokens (see tokens.css).
 *
 * @example
 *   <StatusText variant="success">2 chiều</StatusText>
 *   <StatusText variant="warning" dot={false}>Đang mở</StatusText>
 */
export function StatusText({
  variant = 'neutral',
  dot = true,
  children,
  className,
  style,
  'aria-label': ariaLabel,
}: StatusTextProps) {
  const tokens = VARIANT_TOKENS[variant];
  const text = typeof children === 'string' ? children : undefined;
  return (
    <span
      className={className}
      aria-label={ariaLabel ?? text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--status-text-gap, 6px)',
        fontSize: 'var(--status-text-font-size, var(--text-caption-size, 12px))',
        fontWeight: 'var(--status-text-weight, 700)',
        letterSpacing: 'var(--status-text-letter-spacing, 0.02em)',
        lineHeight: 'var(--status-text-line-height, 1.35)',
        color: tokens.color,
        background: 'transparent',
        border: 'none',
        borderRadius: 0,
        padding: 0,
        textTransform: 'none',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 'var(--status-text-dot-size, 7px)',
            height: 'var(--status-text-dot-size, 7px)',
            borderRadius: '50%',
            background: tokens.dot,
            flexShrink: 0,
          }}
        />
      )}
      <span>{children}</span>
    </span>
  );
}