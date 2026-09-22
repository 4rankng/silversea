import React from 'react';
import { resolveEmptyIllustration, type EmptyContext } from '../../lib/emptyIllustrations';

interface EmptyIllustrationProps {
  /** Typed empty-state context key resolved via lib/emptyIllustrations (preferred). */
  context?: EmptyContext;
  /** Legacy illustration key — e.g. "empty-trucks" or a full asset path.
   *  Prefer `context`; kept for legacy string callers. */
  name?: string;
  /** Pixel width. Pass together with `height` for inline-sized illustrations. */
  width?: number;
  /** Pixel height. Pass together with `width` for inline-sized illustrations. */
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Decorative empty-state illustration. Rendered with `alt=""` + `aria-hidden`
 * (the surrounding text label carries the meaning) and a self-hiding `onError`,
 * so a missing or broken asset never shows a broken-image icon.
 *
 * Prefer the shared `<EmptyState context=… />` for titled empty states; use
 * this only for decorative-only illustrations inside custom layouts such as
 * table cells, dropdowns, and inline banners. When `width`/`height` are
 * omitted, no inline sizing is applied, so a parent CSS class can drive the
 * dimensions.
 */
export function EmptyIllustration({ context, name, width, height, className, style }: EmptyIllustrationProps) {
  const sizing = width != null || height != null
    ? { width, height, objectFit: 'contain' as const }
    : {};
  return (
    <img
      src={resolveEmptyIllustration(context ?? name)}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ ...sizing, ...style }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
    />
  );
}
