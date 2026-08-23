import React from 'react';
import './SummaryRail.css';

export type SummaryRailTone = 'warning' | 'info';

export interface SummaryRailItem {
  /** dt label, e.g. "Chờ điều xe". */
  label: string;
  /** Rendered value; numbers localize vi-VN the way the workboard counts do. */
  value: string | number;
  /** Semantic tone — colors the number only, per the status-signal contract. */
  tone?: SummaryRailTone;
}

/**
 * The workboard summary rail — the app-wide standard for operational list
 * summaries (docs/design-guidelines.md §"Workboard table & summary rail").
 * A ruled decision strip, not cards: labels left, values right on a shared
 * baseline, tones color the number only. Distilled from the /shipments
 * workboard summary; hero-KPI surfaces keep the separate hero contract.
 */
export function SummaryRail({ items, ariaLabel }: { items: SummaryRailItem[]; ariaLabel: string }) {
  return (
    <section className="summary-rail" aria-label={ariaLabel}>
      <dl>
        {items.map((item) => (
          <div
            key={item.label}
            className={`summary-rail__item${item.tone ? ` summary-rail__item--${item.tone}` : ''}`}
          >
            <dt>{item.label}</dt>
            <dd>{typeof item.value === 'number' ? item.value.toLocaleString('vi-VN') : item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
