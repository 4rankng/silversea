import React from 'react';

/** Semantic status colors used across entity lists (users, suppliers, customers). */
export const STATUS_COLORS = {
  active: '#177448',
  inactive: '#A0444E',
} as const;

/** Resolve status string to color. ACTIVE → emerald, anything else → red. */
 
export function getStatusColor(status: string): string {
  return status === 'ACTIVE' ? STATUS_COLORS.active : STATUS_COLORS.inactive;
}

/**
 * Absolute-positioned short status marker on the left edge of a table cell or card.
 * Parent must have `position: 'relative'`. This is intentionally NOT full-height.
 * Uses the canonical centered 3x20px Vantai status strip (see
 * docs/design-guidelines.md and `--status-strip-*` tokens).
 * Pass `color` for custom status palettes; omit to use ACTIVE/INACTIVE defaults.
 */
export function StatusStrip({ status, color }: { status?: string; color?: string }) {
  const bg = color || (status ? getStatusColor(status) : '#999');
  return (
    <span style={{
      position: 'absolute',
      left: 0,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 'var(--status-strip-width, 3px)',
      height: 'var(--status-strip-height, 20px)',
      borderRadius: 'var(--status-strip-radius, 0 999px 999px 0)',
      background: bg,
      pointerEvents: 'none',
    }} />
  );
}

/**
 * Small colored dot for filter tabs and legends.
 * `size` defaults to 7 (filter tabs) — use 4 for legend swatches.
 * Pass `color` for custom status palettes; omit to use ACTIVE/INACTIVE defaults.
 */
export function StatusDot({ status, size = 7, color, style }: { status?: string; size?: number; color?: string; style?: React.CSSProperties }) {
  const bg = color || (status ? getStatusColor(status) : '#999');
  return (
    <span style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: bg,
      display: 'inline-block',
      ...style,
    }} />
  );
}

/**
 * Small vertical strip swatch for inline legends.
 * Thinner/shorter than StatusStrip — designed for flex rows, not table cells.
 * Pass `color` for custom status palettes; omit to use ACTIVE/INACTIVE defaults.
 */
export function StatusSwatch({ status, color }: { status?: string; color?: string }) {
  const bg = color || (status ? getStatusColor(status) : '#999');
  return (
    <span style={{
      width: 'var(--status-strip-width, 3px)',
      height: 'var(--status-strip-height, 20px)',
      borderRadius: 'var(--status-strip-radius, 0 4px 4px 0)',
      background: bg,
      display: 'inline-block',
    }} />
  );
}
