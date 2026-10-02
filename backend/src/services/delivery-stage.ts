/**
 * Authoritative delivery-stage resolution — ONE implementation shared by the
 * three surfaces that tell the driver/CUS where the container comes down:
 * the journey-board card, the driver fulfillment detail, and the CUS
 * container ledger cell.
 *
 * Ruling 2026-09-18 (MasterDataNhaMay 2.2): the HẠ label is ALWAYS a
 * port/drop point, in EVERY direction — the factory has its own card block
 * and never takes this label. The site snapshot carries the factory, so it
 * is excluded from the drop chain everywhere; the dispatcher's free-text
 * drop override still carries when no port is recorded. The distinct-place
 * Trả-rỗng row is dead: once HẠ is the port, a second row naming the same
 * place is the redundancy the user already rejected.
 *
 * Stage 1 (drop point, "Hạ" / "Cảng hạ"):
 *   1. the container's dropoff port name — canonical cảng hạ / trả-vỏ point.
 *   2. shipments.deliveryLocation — the dispatcher's deliberate free-text
 *      override for THIS shipment, when no port is recorded.
 *   The site snapshot is deliberately EXCLUDED in all directions: borrowing
 *   it is what made cards read "Hạ NEWEB-1" (a factory).
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
  // IMPORT and unknown directions follow the same port-only rule (ruling
  // 2026-09-18, MasterDataNhaMay 2.2): the HA label is ALWAYS a port/drop
  // point - the factory has its own card block, so the site snapshot never
  // takes this label. The dispatcher free-text drop override still carries
  // when no port is recorded.
  void snapshotSiteName;
  const deliveryName = portName?.trim() || freeText?.trim() || null;
  const returnDepotName = portName != null && portName !== deliveryName ? portName : null;
  return { deliveryName, returnDepotName };
}
