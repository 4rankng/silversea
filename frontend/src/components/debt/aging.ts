import type { AgingBucket } from '@tingting/shared';

/**
 * Aging-bucket model shared by the AR (DebtDetailPage) and AP
 * (PayableDetailPage) statement pages. Both render the same four-slot
 * bar/grid markup (dd-aging-*) and derive the highlighted bucket the same
 * way — but since ruling 29/10 (SIL-580) the two sides measure DIFFERENT
 * things and carry their own label set (SIL-599):
 *
 * - AR (`AR_AGING_RANGES`): the buckets are TUỔI NỢ — days since the
 *   recording date of each open amount (computeFifoAging cuts 0–30 /
 *   31–60 / 61–90 / trên 90). Labeling these "quá hạn" was the SIL-599 bug.
 *   The cut wording is single-sourced in `AR_AGE_RANGES` below (review F3).
 * - AP (`AP_AGING_RANGES`): the buckets stay contractual due-status bands
 *   (ap-aging.service.ts — days past the effective due date, cut at 0/30/90,
 *   card 061026221213). Re-anchoring AP to recording date needs its own
 *   ticket (SIL-580 out-of-scope note).
 *
 * "Quá hạn" is reserved for the contractual overdue span everywhere
 * (card 061026221213); "tuổi nợ" names the age. The two rule tooltips below
 * are the single definition shown on both faces.
 */

export const AP_AGING_RANGES = [
  { label: 'CHƯA ĐẾN HẠN',        dotColor: 'var(--accent)',  index: 0 },
  { label: 'QUÁ HẠN 1–30 NGÀY',   dotColor: 'var(--warning)', index: 1 },
  { label: 'QUÁ HẠN 31–90 NGÀY',  dotColor: 'var(--warning-deep, #914A16)', index: 2 },
  { label: 'QUÁ HẠN TRÊN 90 NGÀY', dotColor: 'var(--danger)', index: 3 },
] as const;

/** SIL-599 — the four AR age cuts (whole days since the recording date,
 *  ruling 29/10): one source for the band and the grid wording (review F3). */
export const AR_AGE_RANGES = ['0–30 ngày', '31–60 ngày', '61–90 ngày', 'trên 90 ngày'] as const;

const AR_DOT_COLORS = ['var(--accent)', 'var(--warning)', 'var(--warning-deep, #914A16)', 'var(--danger)'] as const;

export const AR_AGING_RANGES = AR_AGE_RANGES.map((range, index) => ({
  label: `TUỔI NỢ ${range.toUpperCase()}`,
  dotColor: AR_DOT_COLORS[index],
  index,
}));

/** SIL-599 rule tooltips — one definition per word, on both debt faces. */
export const AGE_RULE_TIP =
  'Tuổi nợ: số ngày từ ngày ghi nhận khoản đến hôm nay — bốn băng 0–30 / 31–60 / 61–90 / trên 90 ngày.';
export const OVERDUE_RULE_TIP =
  'Quá hạn hợp đồng: số ngày vượt hạn thanh toán (hạn xử lý, hạn gốc; không có hạn thì đến hạn tại ngày ghi nhận).';

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
