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
  /** Optional Σ revenue rows (otherSell + derived). */
  revenueRowsTotal?: number | null;
}

/** The side checks are SUM-based: a side "arms" when its Σ ≠ 0. Mixed-sign
 *  rows summing to 0 are pathological data (intake rejects negatives on the
 *  cost sides) and read as not-armed — the Σ wording of the 24/10 law. */
export function receivableDetermined(input: ReceivableArmingInput): boolean {
  const revenueArmed = input.revenueRowsTotal !== undefined
    ? (input.revenueRowsTotal != null && input.revenueRowsTotal !== 0)
    : input.hasRevenueRows;
  return revenueArmed
    || input.freightKnown
    || (input.psKnownTotal != null && input.psKnownTotal !== 0)
    || (input.opsChargeKnownTotal != null && input.opsChargeKnownTotal !== 0);
}

export interface ReceivableDisplayInput {
  /** The pre-rule cell value: the frozen snapshot figure (locked lot) or the
   *  live rollup. null = chưa xác định (missing snapshot key) — passes through. */
  value: number | null;
  /** The effective freight figure is traced (number, 0 included). */
  freightKnown: boolean;
  /** The lot rides an LCL revenue-merge group (revGroupId != null). */
  merged: boolean;
}

/** SIL-731 r4 — the cell-level half of the 24/10 law. A '0' renders ONLY when
 *  the rollup is actually determined (= 0 computed, D02) or the lot rides a
 *  merge group. A COST-LOCKED lot is NOT an exemption: its snapshot froze '0'
 *  while the freight was never traced, so the figure is still 'chưa chốt' and
 *  the cell stays BLANK (QA verdict 08/11 build e6db602f: R3Q-680-B,
 *  R4B-693-001 — both 'Đã khóa', freightAuto null, receivableTotal "0"). */
export function receivableDisplayValue(input: ReceivableDisplayInput): number | null {
  if (input.value === 0 && !input.freightKnown && !input.merged) return null;
  return input.value;
}
