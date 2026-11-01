/**
 * SIL-638 (id 742) TC5 — the CUS per-container intake classification law.
 *
 * Db-free leaf (BE unit-only ruling 2026-10-19): the quick-create / intake
 * schema accepts `containers[].classification` (Đơn/Kẹp/Kết hợp) and every
 * fulfillment-creation site stamps the result onto the lot's dispatch rows.
 * An undeclared container keeps the legacy lot law: a CUS-flagged combined
 * lot decomposes COMBINED, everything else SINGLE.
 */

export type ContainerIntakeClassification = 'SINGLE' | 'DOUBLE' | 'COMBINED';

/**
 * The dispatch classification a container's fulfillment carries. The CUS
 * choice wins verbatim when declared (Kẹp/Kết hợp); an explicit or absent
 * SINGLE falls through to the lot flag — bit-for-bit the pre-TC5 behavior.
 * SIL-643 (id 748, owner 01/11): the create form no longer offers the pick
 * and always sends 'SINGLE' explicitly, which reads identically here —
 * the only writers of a non-SINGLE column are the dispatch flow and the
 * reconcile passthrough, never the intake form.
 */
export function containerClassificationToFulfillment(
  containerClassification: string | null | undefined,
  lotIsCombined: boolean,
): ContainerIntakeClassification {
  if (containerClassification === 'DOUBLE' || containerClassification === 'COMBINED') {
    return containerClassification;
  }
  return lotIsCombined ? 'COMBINED' : 'SINGLE';
}
