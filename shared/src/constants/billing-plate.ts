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
 * SIL-1093 (KB §3.6.5 K3.87, §9.5 K9.14, §8.1.3 K8.16): the substitution is
 * the law for EVERY lot, not only LCL — CUS để trống BKS báo khách ⇒ Debit
 * Note in BKS thực do Điều vận gán; có nhập thì lấy của CUS; chỉ khi cả hai
 * đều không có mới để trống (K6.32: không đoán biển số). This retires the
 * old GAP-3 boundary (non-LCL: explicit billing or nothing).
 */

export interface BillingPlateFacts {
  /** BKS báo khách ("xe ảo") — CUS's own text; blank/null = not reported. */
  billingTruckNo?: string | null;
  /** BKS thực (ĐV-assigned, runs the lane). */
  actualTruckNo?: string | null;
  /** shipments.cargoMode — carried by the lot rows that feed the law; the
   *  SIL-1093 substitution itself is mode-free. */
  cargoMode?: string | null;
}

/** The plate printed/reported as "BKS báo khách": CUS's own value when
 *  present, else the ĐV-assigned BKS thực, else blank — never a guess. */
export function effectiveBillingPlate(facts: BillingPlateFacts): string | null {
  const billing = facts.billingTruckNo?.trim();
  if (billing) return billing;
  const actual = facts.actualTruckNo?.trim();
  return actual ? actual : null;
}
