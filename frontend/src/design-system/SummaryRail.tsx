import React from 'react';
import { Link } from 'react-router-dom';
import './SummaryRail.css';

export type SummaryRailTone = 'warning' | 'info';

export interface SummaryRailItem {
  /** dt label, e.g. "Chờ điều xe". */
  label: string;
  /** Rendered value; numbers localize vi-VN the way the workboard counts do. */
  value: string | number;
  /** Semantic tone — colors the number only, per the status-signal contract. */
  tone?: SummaryRailTone;
  /**
   * Makes the item an interactive filter (card _37): renders as a button with
   * aria-pressed so a KPI card can drive the list below it.
   */
  onClick?: () => void;
  /** Pairs with onClick for the pressed look on filter cards. */
  pressed?: boolean;
  /**
   * Drill-down destination (card 051026231511). When present the item renders
   * as a real link into the list that owns the count, using the same
   * query-string convention the due-group cards deep-link with. Omit it — or
   * omit it while the count is still loading — and the item stays inert text,
   * so a placeholder value never presents as a working destination.
   */
  href?: string;
}

/**
 * The workboard summary rail — the app-wide standard for operational list
 * summaries (docs/design-guidelines.md §"Workboard table & summary rail").
 * A ruled decision strip, not cards: labels left, values right on a shared
 * baseline, tones color the number only. Distilled from the /shipments
 * workboard summary; hero-KPI surfaces keep the separate hero contract.
 * An item may stay inert text, act as an in-place filter (`onClick`), or
 * drill down into the list that owns its count (`href`) — never more than one
 * mode at a time.
 */
export function SummaryRail({ items, ariaLabel }: { items: SummaryRailItem[]; ariaLabel: string }) {
  return (
    <section className="summary-rail" aria-label={ariaLabel}>
      <dl>
        {items.map((item) => {
          const content = (
            <>
              <dt>{item.label}</dt>
              <dd>{typeof item.value === 'number' ? item.value.toLocaleString('vi-VN') : item.value}</dd>
            </>
          );
          if (item.onClick) {
            return (
              <button
                key={item.label}
                type="button"
                className={`summary-rail__item${item.tone ? ` summary-rail__item--${item.tone}` : ''}`}
                onClick={item.onClick}
                aria-pressed={item.pressed}
              >
                {content}
              </button>
            );
          }
          if (item.href) {
            return (
              <Link
                key={item.label}
                to={item.href}
                className={`summary-rail__item summary-rail__item--link${item.tone ? ` summary-rail__item--${item.tone}` : ''}`}
              >
                {content}
              </Link>
            );
          }
          return (
            <div
              key={item.label}
              className={`summary-rail__item${item.tone ? ` summary-rail__item--${item.tone}` : ''}`}
            >
              {content}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
