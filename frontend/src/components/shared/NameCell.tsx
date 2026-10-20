import { useEffect, useRef, useState } from 'react';
import './NameCell.css';

/**
 * The one shared name cell for the data grids (card 191026181942 — "tên ngắn
 * toàn bảng"): customer, route and carrier names render through this so every
 * table treats a name the same way.
 *
 * Two house contracts shape it:
 *
 * - Design law §4 (no-truncation doctrine, enforced by
 *   `styles/table-no-truncation.styles.test.ts`): a data cell NEVER clips —
 *   `text-overflow: ellipsis` / clipping `overflow: hidden` are banned. A name
 *   wraps (`overflow-wrap: anywhere`), so the full value is always on screen.
 * - Card 191026181942 (accessible full name): the complete name stays
 *   reachable even when it spans lines — a native `title` hover hint, an
 *   `aria-label`, and a FOCUSABLE reveal (tab stop) only on long names, where
 *   the operator actually needs the tooltip; short names skip the extra tab
 *   stop to keep keyboard flow through a row cheap.
 *
 * Short names themselves are a backend concern already settled: every grid's
 * projection reads `operationalName(shortName, name)`, so the wire carries the
 * configured tên ngắn and this cell never re-derives it.
 */
export function NameCell({ name, as: Tag = 'span', className }: {
  /** The display name — already the operational (short) name from the wire. */
  name: string | null | undefined;
  /** Element to render; `em`/`strong`/`small` keep a cell's existing semantics. */
  as?: 'span' | 'strong' | 'em' | 'small';
  className?: string;
}) {
  const full = name?.trim() ?? '';
  const ref = useRef<HTMLElement>(null);
  // Long names are the only ones that can span enough lines to justify a tab
  // stop: 60 chars cannot fit one dense 12px grid line, so the reveal (and
  // with it the tooltip affordance keyboard users rely on) kicks in exactly
  // there and never on short, fully-visible names.
  const [focusable, setFocusable] = useState(full.length > 60);
  useEffect(() => { setFocusable(full.length > 60); }, [full]);
  if (!full) return null;
  return (
    <Tag
      ref={ref as never}
      className={`name-cell${className ? ` ${className}` : ''}`}
      title={full}
      aria-label={full}
      tabIndex={focusable ? 0 : undefined}
    >
      {full}
    </Tag>
  );
}
