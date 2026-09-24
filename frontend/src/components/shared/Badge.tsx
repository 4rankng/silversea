// Card 20260924_21 (BATCH A — systemic UX purge).
// The shared Badge component used to render a coloured rounded box
// (borderRadius 4 + background fill + 1px border) — the pill-bubble
// anti-pattern that design law §1 bans. It now delegates to StatusText,
// the canonical text+dot treatment. The legacy `<Badge variant="…">`
// API is preserved so the three existing callers (DriverTripsPage,
// DebtListPage, CustomersPage) automatically pick up the new treatment
// without per-page edits — the purge happens at the SHARED layer.

import React from 'react';
import { StatusText, type StatusVariant } from './StatusText';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'outline';

// `outline` is a legacy alias for `neutral`; the new contract has no
// bordered variant (the §1 rule bans decorative borders on data cells).
const LEGACY_VARIANT_MAP: Record<BadgeVariant, StatusVariant> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
  outline: 'neutral',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Legacy semantic badge — now the text+dot SHARED treatment (card
 * 20260924_21). Plain text in the house compact style + a single house
 * color-dot. NO pill bubble, NO rounded background fill, NO border.
 *
 * @example
 *   <Badge variant="success">2 chiều</Badge>
 *   <Badge variant="warning">Đang mở</Badge>
 */
export function Badge({ variant = 'neutral', children, style, className }: BadgeProps) {
  return (
    <StatusText
      variant={LEGACY_VARIANT_MAP[variant]}
      className={className}
      style={style}
    >
      {children}
    </StatusText>
  );
}