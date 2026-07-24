import React from 'react';
import { Link } from 'react-router-dom';

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
  label: React.ReactNode;
  /** Router path or href. Absent → treated as the current (last) crumb. */
  to?: string;
  icon?: React.ReactNode;
}

interface BreadcrumbsProps {
  items: Crumb[];
  /** Override the default <Link> renderer (e.g. for non-router contexts). */
  renderLink?: (to: string, children: React.ReactNode) => React.ReactNode;
  className?: string;
}

export function Breadcrumbs({ items, renderLink, className = '' }: BreadcrumbsProps) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={`d-breadcrumbs text-sm ${className}`.trim()}>
      <ul>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const inner = (
            <>
              {item.icon && <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>{item.icon}</span>}
              {item.label}
            </>
          );
          return (
            <li key={idx} className={isLast ? 'text-[var(--ink)] font-semibold' : undefined}>
              {isLast || !item.to ? (
                // Current page: not a link, marked aria-current for AT users.
                <span aria-current="page">{inner}</span>
              ) : renderLink ? (
                renderLink(item.to, inner)
              ) : (
                <Link to={item.to}>{inner}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
