/** Demand-count formatting and parsing for the allocation day groups
 *  (split from allocationDayHelpers for the file-ceiling guard). */

/** {count20, count40} → "1×20' + 2×40'" — zero parts dropped, "0" when empty.
 *  lô LCL (20260916_5): lclCount renders as "N lô". */
export function formatContainerCounts(counts: { count20: number; count40: number; lclCount?: number }): string {
  const parts = [
    counts.count20 !== 0 ? `${counts.count20}×20'` : null,
    counts.count40 !== 0 ? `${counts.count40}×40'` : null,
    counts.lclCount ? `${counts.lclCount} lô` : null,
  ].filter(Boolean).join(' + ');
  return parts || '0';
}

export function parseContainerSummaryDemand(summary: string | null | undefined): { count20: number; count40: number } {
  if (!summary) return { count20: 0, count40: 0 };
  let count20 = 0;
  let count40 = 0;
  for (const part of summary.split(' + ')) {
    const match = part.trim().match(/^(\d+)\s*(?:\*|×|x)\s*(.*)$/i);
    if (!match) continue;
    const count = Number(match[1]) || 0;
    const type = match[2]?.trim() || '';
    if (/^20(?:\D|$)/i.test(type)) count20 += count;
    else if (/^40(?:\D|$)/i.test(type)) count40 += count;
  }
  return { count20, count40 };
}
