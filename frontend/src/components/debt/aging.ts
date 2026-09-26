import type { AgingBucket } from '@tingting/shared';

/**
 * Aging-bucket model shared by the AR (DebtDetailPage) and AP
 * (PayableDetailPage) statement pages. Both render the same four ranges,
 * the same bar/grid markup (dd-aging-*), and derive the highlighted bucket
 * the same way — only the statement queries and txn-type metadata differ.
 */

export const AGING_RANGES = [
  { label: '0–30 NGÀY',  dotColor: 'var(--accent)',  index: 0 },
  { label: '31–60 NGÀY', dotColor: 'var(--warning)', index: 1 },
  { label: '61–90 NGÀY', dotColor: 'var(--warning-deep, #914A16)', index: 2 },
  { label: 'TRÊN 90 NGÀY', dotColor: 'var(--danger)', index: 3 },
] as const;

/** Map backend agingBuckets (ordered 0→90+) to a fixed 4-slot amount array. */
export function normalizeAging(buckets: AgingBucket[]): number[] {
  const amounts = [0, 0, 0, 0];
  buckets.forEach((b, i) => {
    if (i < 4) amounts[i] = b.amount;
  });
  return amounts;
}

/**
 * Index of the bucket holding the largest positive amount (first on ties);
 * -1 when nothing is outstanding in any bucket.
 */
export function activeAgingIndex(amounts: number[]): number {
  let max = -1, idx = 0;
  amounts.forEach((a, i) => { if (a > max) { max = a; idx = i; } });
  return max > 0 ? idx : -1;
}
