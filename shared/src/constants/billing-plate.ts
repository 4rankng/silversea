/**
 * BKS báo khách — the effective plate a customer-facing document reports
 * (spec 23/10 / 261023110000 §4.1: "Nếu CUS để trống ô này ➔ Hệ thống mặc
 * định lấy BKS thực (do Điều vận đã gán) để báo khách và in lên Debit Note").
 *
 * One rule, one implementation: the Debit Note draft render and the
 * accounting freeze (which materializes the reported plate into the frozen
 * lot record) derive the reported plate through here; the FE wave reuses the
 * same rule for the CUS grid's BKS column.
 *
 * Boundary (deliberate): the fallback applies to LCL lots — the spec's gộp
 * hàng lẻ flow, where ĐV assigns the real plate via "Gán xe nhóm". Non-LCL
 * rows keep the standing GAP-3 law: an explicit billing plate or NOTHING —
 * the physical plate must never reach the customer by accident.
 */

export interface BillingPlateFacts {
  /** BKS báo khách ("xe ảo") — CUS's own text; blank/null = not reported. */
  billingTruckNo?: string | null;
  /** BKS thực (ĐV-assigned, runs the lane). */
  actualTruckNo?: string | null;
  /** shipments.cargoMode — 'LCL' enables the spec's fallback. */
  cargoMode?: string | null;
}

/** The plate printed/reported as "BKS báo khách". */
export function effectiveBillingPlate(facts: BillingPlateFacts): string | null {
  const billing = facts.billingTruckNo?.trim();
  if (billing) return billing;
  if (facts.cargoMode !== 'LCL') return null;
  const actual = facts.actualTruckNo?.trim();
  return actual ? actual : null;
}
