/**
 * Authoritative delivery-stage resolution — ONE implementation shared by the
 * three surfaces that tell the driver/CUS where the container comes down:
 * the journey-board card, the driver fulfillment detail, and the CUS
 * container ledger cell.
 *
 * Ruling 2026-09-18 (MasterDataNhaMay 2.2): the HẠ label is ALWAYS a
 * port/drop point, in EVERY direction — the factory has its own card block
 * and never takes this label. The site snapshot therefore never substitutes
 * for a recorded drop point; the dispatcher's free-text drop override still
 * carries when no port is recorded. The distinct-place Trả-rỗng row is
 * dead: once HẠ is the port, a second row naming the same place is the
 * redundancy the user already rejected.
 *
 * Stage 1 (drop point, "Hạ" / "Cảng hạ"):
 *   1. the container's dropoff port name — canonical cảng hạ / trả-vỏ point.
 *   2. shipments.deliveryLocation — the dispatcher's deliberate free-text
 *      override for THIS shipment, when no port is recorded.
 *   3. the fulfillment snapshot's deliverySite name — the job's recorded
 *      return point (dữ liệu điều vận), ONLY when neither port nor override
 *      exists; it names the same place the delivery block carries, never a
 *      substitute for a separate drop point.
 *
 * Card 171026205400 (FB-020, R21 verify-fail 2026-10-17): a portless IMPORT
 * job fell to "Chưa có cảng hạ" while its delivery row named the factory —
 * the driver lost the discharge point entirely. PRD ManHinhLaiXe §2.3
 * (restated 2026-10-09, 1a1a227e) closes the gap: "khi hai điểm là cùng một
 * nơi thì hai hàng cùng tên" — when no port and no dispatcher override is
 * recorded, the job's own delivery-site record (the fulfillment snapshot,
 * written at decompose from the container's operational site) IS the
 * discharge point and closes the chain, mirroring the 2026-10-17 user
 * directive for LCL (IMPORT: Hạ = Nhà máy — liftDropPoints.ts). The
 * 2026-09-18 exclusion survives: the snapshot never overrides a recorded
 * port/free-text, and EXPORT never takes the factory (an export drops at
 * the port, 1f1133ae) — borrowing the snapshot ahead of a recorded port is
 * what once made cards read "Hạ NEWEB-1" (a factory).
 *
 * Stage 2 (empty-container return depot, "Trả cont rỗng"): dead by the same
 * ruling — always null. The interface field stays because callers still read
 * it; a future removal is a contract change across the three surfaces.
 *
 * Callers pass the shipment's tradeDirection. EXPORT keeps its dedicated
 * branch (same output, kept for the documented history); other directions
 * share the port-first chain.
 */


export interface DeliveryStage {
  /** Stage 1 — where the laden container comes down (Hạ / Cảng hạ). */
  deliveryName: string | null;
  /** Stage 2 — distinct empty-container return depot, null when same/absent. */
  returnDepotName: string | null;
}

/** Read the site-snapshot's deliverySite display name (object-shape check,
 *  same rule the CUS builders apply — never trusts a non-object or a
 *  non-string name). */
export function readSnapshotDeliverySiteName(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const site = snapshot.deliverySite;
  if (typeof site !== 'object' || site === null) return null;
  const name = (site as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** Resolve the delivery-stage labels from the three raw sources. The chain
 *  order is the contract — callers must NOT re-chain locally. */
export function resolveDeliveryStage(
  snapshotSiteName: string | null,
  freeText: string | null,
  portName: string | null,
  tradeDirection?: string | null,
): DeliveryStage {
  if (tradeDirection === 'EXPORT') {
    // cites the original export rule; unchanged
    const exportDrop = portName?.trim() || freeText?.trim() || null;
    return { deliveryName: exportDrop, returnDepotName: null };
  }
  // IMPORT and unknown directions follow the port-first rule (ruling
  // 2026-09-18, MasterDataNhaMay 2.2): the HA label is ALWAYS a port/drop
  // point - the factory has its own card block, so the site snapshot never
  // SUBSTITUTES for a recorded port/override. FB-020 (card 171026205400):
  // when neither the port nor the dispatcher free-text override is recorded,
  // the job's delivery-site record (the fulfillment snapshot) IS the
  // discharge point — "khi hai điểm là cùng một nơi thì hai hàng cùng tên"
  // (PRD ManHinhLaiXe §2.3) — so it closes the chain instead of leaving the
  // Hạ row empty beside a delivery row naming the same place.
  const deliveryName = portName?.trim() || freeText?.trim() || snapshotSiteName?.trim() || null;
  const returnDepotName = portName != null && portName !== deliveryName ? portName : null;
  return { deliveryName, returnDepotName };
}
