export interface FifoAgingInput {
  timestamp: string | null;
  debit: string | number;
  credit: string | number;
  /**
   * Effective payment due date (YYYY-MM-DD) — the payment-term authority's
   * `processingDueDate ?? originalDueDate`, or absent/null for legacy rows that
   * froze neither (then the entry is due at its issue date, the house fallback).
   * Feeds the contractual `overdueDays` KPI only; the aging buckets never read
   * it (owner ruling 29/10: aging counts from the recording date).
   */
  dueDate?: string | null;
}

export interface AgingBuckets {
  /** Recorded within the last 30 days (0–30 days since the recording date). */
  current: number;
  /** Recorded 31–60 days ago — the "quá hạn 30–60" band. */
  d30: number;
  /** Recorded 61–90 days ago — the "quá hạn 60–90" band. */
  d60: number;
  /** Recorded more than 90 days ago. */
  over90: number;
}

export interface OpenInvoice {
  ts: string;
  open: number;
  /** Effective due date carried from the source entry (null = due at issue). */
  dueDate: string | null;
  /**
   * Contractual overdue span (card 061026221213): whole calendar days past the
   * effective due date at the reference date; 0 = not yet due. Feeds the
   * "Quá hạn" KPI only — the aging buckets count from the recording date
   * instead (owner ruling 29/10), never from this span.
   */
  overdueDays: number;
}

/** Day index of a YYYY-MM-DD (or ISO timestamp) date, UTC calendar. */
function utcDayNumber(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  ) / 86_400_000;
}

/** Calendar days past `dueDate` at `referenceDate`; 0 while not yet due. */
export function calendarDaysPastDue(dueDate: string | null, issueTs: string, referenceDate: Date): number {
  const due = dueDate ?? issueTs.slice(0, 10);
  const asOf = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ) / 86_400_000;
  return Math.max(0, Math.floor(asOf - utcDayNumber(due)));
}

/** Largest contractual overdue span among open invoices; 0 = nobody past due. */
export function maxOverdueDaysOf(openInvoices: OpenInvoice[]): number {
  let max = 0;
  for (const inv of openInvoices) {
    if (inv.open > 0 && inv.overdueDays > max) max = inv.overdueDays;
  }
  return max;
}

export function computeFifoAging(
  entries: FifoAgingInput[],
  referenceDate: Date = new Date(),
): { aging: AgingBuckets; openInvoices: OpenInvoice[] } {
  const chronological = [...entries].sort((a, b) => {
    const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return at - bt;
  });

  const openInvoices: OpenInvoice[] = [];
  let unappliedCredit = 0;

  for (const entry of chronological) {
    const debit = typeof entry.debit === 'number' ? entry.debit : parseFloat(entry.debit || '0');
    const credit = typeof entry.credit === 'number' ? entry.credit : parseFloat(entry.credit || '0');

    // Previously a missing timestamp dropped the debit on the floor —
    // it still showed up in the running balance but never made it into
    // an aging bucket, so totals didn't reconcile. Fall back to "now"
    // (the reference date) so the debt lands in the current bucket and
    // sum-of-buckets matches total outstanding.
    if (debit > 0) {
      let debitRemaining = debit;
      if (unappliedCredit > 0) {
        const apply = Math.min(unappliedCredit, debitRemaining);
        unappliedCredit -= apply;
        debitRemaining -= apply;
      }
      if (debitRemaining > 0) {
        const ts = entry.timestamp ?? referenceDate.toISOString();
        openInvoices.push({
          ts,
          open: debitRemaining,
          dueDate: entry.dueDate ?? null,
          overdueDays: calendarDaysPastDue(entry.dueDate ?? null, ts, referenceDate),
        });
      }
    }

    if (credit > 0) {
      let remaining = credit;
      for (const inv of openInvoices) {
        if (remaining <= 0) break;
        if (inv.open <= 0) continue;
        const apply = Math.min(inv.open, remaining);
        inv.open -= apply;
        remaining -= apply;
      }
      if (remaining > 0) {
        unappliedCredit += remaining;
      }
    }
  }

  const aging: AgingBuckets = { current: 0, d30: 0, d60: 0, over90: 0 };

  // Owner ruling 29/10: the bands are AGE bands counted from the recording
  // date (entry timestamp — ngày phát sinh phải thu/trả trên chứng từ) to the
  // reference date, cut at 30/60/90 — `current` = 0–30 days recorded, `d30` =
  // 31–60, `d60` = 61–90, `over90` = beyond 90. A frozen dueDate never moves a
  // bucket; it only feeds the contractual overdueDays KPI (card 061026221213).
  for (const inv of openInvoices) {
    if (inv.open <= 0) continue;
    const ageDays = (referenceDate.getTime() - new Date(inv.ts).getTime()) / (1000 * 60 * 60 * 24);
    // Round each bucket addition to avoid floating-point drift across hundreds of entries.
    if (ageDays <= 30) aging.current += Math.round(inv.open);
    else if (ageDays <= 60) aging.d30 += Math.round(inv.open);
    else if (ageDays <= 90) aging.d60 += Math.round(inv.open);
    else aging.over90 += Math.round(inv.open);
  }

  return { aging, openInvoices };
}
