/** SIL-870 — shared Số-hóa-đơn law for every Ops expense surface (leaf module:
 *  pure, no imports — ops-expenses.service and the legacy history service both
 *  sit on opposite sides of a runtime edge, so the classifier cannot live in
 *  either without a cycle).
 *
 *  A stored "Số hóa đơn" without a single digit is not an invoice reference.
 *  It is placeholder text ('unc', 'chưa có', 'x'…) typed into the optional
 *  field when no invoice existed (SIL-834 made the field optional; earlier
 *  required-era rows carry the junk). Every real hóa đơn on the accountant
 *  board carries its mandatory numeric sequence, so digitless values classify
 *  as NO invoice: the read paths map them to null so the SỐ HĐ cell renders
 *  the agreed 'X' for every fee without an invoice, and the write paths store
 *  null instead of laundering the placeholder forward. */

export function effectiveOpsInvoiceNumber(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/\d/.test(trimmed)) return null;
  return trimmed;
}

/** SIL-1101 — the case/space-insensitive identity fold for a stored Số hóa
 *  đơn (' TD-001 ' ≡ 'td-001'). Shared leaf so the per-lô gate and the
 *  cross-lot conflict lookup compare with ONE key. */
export function normalizeOpsInvoiceNumber(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}
