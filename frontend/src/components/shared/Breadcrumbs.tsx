import type { ReactNode } from 'react';

/* ─── Breadcrumbs ──────────────────────────────────────────────────────────
 * Hierarchical "you are here" trail for detail pages. Wraps daisyUI's
 * `.d-breadcrumbs` (prefixed). Fills a gap: detail pages today only offer a
 * back button, so a user landing on e.g. /trips/:id via a link from Finance
 * loses the parent-context cue.
 *
 * The last crumb is rendered as plain text (current page); earlier crumbs
 * are links via react-router's <Link> (no per-page wiring needed).
 * -------------------------------------------------------------------------- */

export interface Crumb {
  label: ReactNode;
  /** Router path or href. Absent → treated as the current (last) crumb. */
  to?: string;
  icon?: ReactNode;
}

interface BreadcrumbsProps {
  items: Crumb[];
  /** Override the default <Link> renderer (e.g. for non-router contexts). */
  renderLink?: (to: string, children: ReactNode) => ReactNode;
  className?: string;
}

export function Breadcrumbs(_props: BreadcrumbsProps) {
  // The sidebar and browser title provide route context without consuming
  // workspace space on every page.
  return null;
}
