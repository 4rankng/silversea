import type { AgingBucket } from '@tingting/shared';

/**
 * Aging-bucket model shared by the AR (DebtDetailPage) and AP
 * (PayableDetailPage) statement pages. Both render the same four slots,
 * the same bar/grid markup (dd-aging-*), and derive the highlighted bucket
 * the same way — only the statement queries, txn-type metadata and slot
 * LABELS differ:
 * - AR slots are TUỔI NỢ — whole days since the recording date, cut at
 *   30/60/90 (owner ruling 29/10, SIL-580 R3). SIL-599 re-labelled the
 *   bands so they stop reading as due status.
 * - AP keeps the contractual wording ("CHƯA ĐẾN HẠN" / "QUÁ HẠN…") until
 *   its own re-anchor lands (SIL-580 out-of-scope note).
 */

/** SIL-599 — the four AR age cuts (whole days since the recording date,
 *  ruling 29/10): one source for the band and the grid wording (review F3). */
export const AR_AGE_RANGES = ['0–30 ngày', '31–60 ngày', '61–90 ngày', 'trên 90 ngày'] as const;

const AR_DOT_COLORS = ['var(--accent)', 'var(--warning)', 'var(--warning-deep, #914A16)', 'var(--danger)'] as const;

export const AR_AGING_RANGES = AR_AGE_RANGES.map((range, index) => ({
  label: `TUỔI NỢ ${range.toUpperCase()}`,
  dotColor: AR_DOT_COLORS[index],
  index,
}));

export const AGING_RANGES = [
  { label: 'CHƯA ĐẾN HẠN',        dotColor: 'var(--accent)',  index: 0 },
  { label: 'QUÁ HẠN 1–30 NGÀY',   dotColor: 'var(--warning)', index: 1 },
  { label: 'QUÁ HẠN 31–90 NGÀY',  dotColor: 'var(--warning-deep, #914A16)', index: 2 },
  { label: 'QUÁ HẠN TRÊN 90 NGÀY', dotColor: 'var(--danger)', index: 3 },
] as const;

/** SIL-599 C2 — one definition per word, carried by the hover tooltips on
 *  both AR surfaces (list band + detail pill/grid), so "quá hạn" never
 *  silently means "tuổi nợ" again. */
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
