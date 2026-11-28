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
  /** Σ AUTO fuel surcharge (freight-snapshot surcharge grain) when computed,
   *  else null — QA 28/11 (SIL-855 finding 01): the receivable law must count
   *  the same customer money the chốt board's Phụ ps cell shows. */
  psAutoKnownTotal?: number | null;
  /** Σ Lạch Huyện charge (ops ZONE_SURCHARGE negotiated charge + the
   *  port-zone config fallback) when known, else null — same reconciliation:
   *  the chốt board sums it into Tổng thu (spec ch6 §Tổng thu). */
  zoneChargeKnownTotal?: number | null;
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
    || (input.opsChargeKnownTotal != null && input.opsChargeKnownTotal !== 0)
    || (input.psAutoKnownTotal != null && input.psAutoKnownTotal !== 0)
    || (input.zoneChargeKnownTotal != null && input.zoneChargeKnownTotal !== 0);
}

/** Lạch Huyện's expense-type code (shared by the merge board and the chốt
 *  board's ops-charge sides). Its `amount` is the điều vận cost — never
 *  billed through the ops-charge channel; only its negotiated charge may
 *  join the receivable (each board's thu seam). */
export const ZONE_SURCHARGE_CODE = 'ZONE_SURCHARGE';

/** One ops row's contribution to the receivable's ops-charge side (Tổng TC /
 *  Tổng thu). A negotiated charge joins as-is (negative included — existing
 *  semantics); an UN-negotiated fee rides the receivableForCost identity the
 *  chi-hộ cell money already uses: charge ?? paid, so the receivable counts
 *  the same fee money the fee cells show. Round 11 (QA build 2530c955): the
 *  advances writer stores **0 — not NULL** — when no customer charge was
 *  entered, so `charge != null` answered 0 and pending GN fees dropped out of
 *  Tổng TC. On this wire 0 IS the un-negotiated sentinel, so 0 falls through
 *  to the amount side. Lạch Huyện never falls back (its amount is the điều
 *  vận cost, never billed here), and a negative un-negotiated amount is
 *  absent (the builders' drop law). Returns null = the row contributes
 *  nothing and does not arm the side.
 *
 *  Moved here (db-free) from debit-merge.service so the chốt board
 *  (accounting-debit-close.service) reads the ONE rule with no
 *  service→service import cycle — QA 28/11 finding 01: the chốt đợt and the
 *  frozen lock must sum the same ops-charge money or the Debit Note can
 *  never reconcile against the đợt. */
export function opsChargeReceivableContribution(row: {
  expenseTypeCode: string | null;
  charge: string | null;
  amount: string | null;
}): number | null {
  const charge = row.charge == null ? null : Number(row.charge);
  if (charge != null && Number.isFinite(charge) && charge !== 0) return charge;
  if (row.expenseTypeCode === ZONE_SURCHARGE_CODE) return null;
  const amount = row.amount == null ? null : Number(row.amount);
  return amount != null && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** SIL-1226 (K5.5) — whether an Ops ZONE_SURCHARGE row may bill the Lạch
 *  Huyện cells (thu + trả) on the merge board and the chốt board. A row saved
 *  by Ops waits for Kế toán duyệt (confirmedAt null): until then it is only a
 *  named red line in the group-5 no-invoice family (SIL-1072 display law) and
 *  must leave the auto config cells untouched — the QA repro (28/11, lô
 *  LG28-FCL-01/02) had a pending 1.500.000₫ "Phí nâng/hạ theo vùng" zero the
 *  thu cell (its un-negotiated charge 0 answered `charge != null` as a
 *  negotiated 0, so the config fallback never ran) and overwrite the trả cell
 *  with its cost. An APPROVED zone fee bills the cells (the Ops override
 *  wins) — unchanged. One rule for both boards so their cells can never
 *  disagree (same reconciliation law as opsChargeReceivableContribution). */
export function zoneFeeBillsLachHuyenCells(confirmedAt: Date | string | null): boolean {
  return confirmedAt != null;
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

/** SIL-814 (id 942) — which freight knowledge a receivable cell may trust.
 *  Unlocked rows judge by the live channel (SIL-731 r4 law, unchanged). A
 *  LOCKED row's frozen figure was computed with the freeze-time freight, so
 *  its zero cell stays only while the frozen freight is present and still
 *  agrees with the live channel:
 *    - frozen freight missing (pre-SIL-693 locks) → the freeze never priced
 *      the lot → the frozen 0 was never computed → not known;
 *    - frozen freight ≠ live freight (R3M-KR1 id 772: the 06/11 freeze baked
 *      freightAuto 0 / receivableTotal 0 from snapshot 703 while the channel
 *      now reads snapshots 839/840 = 3.952.000) → the frozen zero predates
 *      pricing → not known, ô TRỐNG per the 24/10 law;
 *    - frozen freight = live freight → a legitimately computed zero (D02)
 *      keeps rendering 0.
 *  Non-zero frozen figures never reach this gate's zero branch and pass
 *  through untouched (freeze law, card _19). Merged lots are exempt at the
 *  display gate regardless (lô ghép renders 0 by design). */
export function receivableCellFreightKnown(input: {
  locked: boolean;
  frozenFreight: number | null;
  liveFreight: number | null;
}): boolean {
  if (!input.locked) return input.liveFreight != null;
  return input.frozenFreight != null && input.frozenFreight === input.liveFreight;
}

/** SIL-820 (id 949) — the value-based half of the 24/10 law for the sell
 *  split columns (TỔNG CHI HỘ - CÓ HĐ / TỔNG DỊCH VỤ - KHÔNG HĐ, the
 *  CUS settlement board). A 0 renders only as a COMPUTED COMPONENT of a
 *  determined total: the caller passes `totalDetermined` = the displayed
 *  receivableTotal is non-null (locked rows already passed the SIL-814
 *  frozen-vs-live gate upstream, so a legit D02 zero keeps its split zeros
 *  and a stale frozen zero goes TRỐNG together with its total). An
 *  undetermined lot's split zeros are fabricated (R3Q-680-B / QBOBD39C /
 *  100GX19033 / 339IVN0130626 — open lots, AUTO + TỔNG blank) → ô TRỐNG.
 *  Non-zero components are real entered money and always pass, and a 0
 *  inside a determined total stays (MATS8322408000's DỊCH VỤ 0 within
 *  5.682.000; EHPH26114592's CHI HỘ 0 within 3.978.000). */
export function sellSplitDisplayValue(input: {
  value: number | null;
  totalDetermined: boolean;
}): number | null {
  if (input.value === 0 && !input.totalDetermined) return null;
  return input.value;
}
