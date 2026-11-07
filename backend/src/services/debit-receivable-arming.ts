// SIL-731 r2 — DOANH THU arming law for the L1 debit summary (QA verdict
// 07/11, lô 100GX19033 id 121). Db-free unit seam (2026-10-19 owner ruling):
// the service imports this, the unit test imports ONLY this.
//
// An entered-but-zero side amount (PS thực tế 0, phí phát sinh với charge
// khách 0) is NOT revenue in itself. The 24/10 DOANH THU law keeps the cell
// BLANK until the rollup is actually determined — freight traced or real
// revenue rows exist. A computed zero stays a zero (D02, card 20261002_293)
// once the rollup IS determined, e.g. freight traced 0 with nothing else.

export interface ReceivableArmingInput {
  /** Any live tripExpenses revenue rows on the lot (OTHER sells + pass-through). */
  hasRevenueRows: boolean;
  /** The effective freight figure is traced (number, 0 included). */
  freightKnown: boolean;
  /** Σ PS thực tế when any container carries the amount, else null. */
  psKnownTotal: number | null;
  /** Σ negotiated ops customer charge when any entry carries it, else null. */
  opsChargeKnownTotal: number | null;
}

/** The side checks are SUM-based: a side "arms" when its Σ ≠ 0. Mixed-sign
 *  rows summing to 0 are pathological data (intake rejects negatives on the
 *  cost sides) and read as not-armed — the Σ wording of the 24/10 law. */
export function receivableDetermined(input: ReceivableArmingInput): boolean {
  return input.hasRevenueRows
    || input.freightKnown
    || (input.psKnownTotal != null && input.psKnownTotal !== 0)
    || (input.opsChargeKnownTotal != null && input.opsChargeKnownTotal !== 0);
}
