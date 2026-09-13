/**
 * Authoritative delivery-stage resolution — ONE implementation shared by the
 * three surfaces that tell the driver/CUS where the container comes down:
 * the journey-board card, the driver fulfillment detail, and the CUS
 * container ledger cell.
 *
 * Stage 1 (delivery point, "Hạ" / "Cảng hạ") fallback chain:
 *   1. shipments.deliveryLocation — the dispatcher's deliberate free-text
 *      override for THIS shipment (highest trust; manual intent).
 *   2. the fulfillment site-snapshot's deliverySite name — the structured
 *      per-container record captured when CUS created the shipment.
 *   3. the container's dropoff port name — last resort.
 *
 * Stage 2 (empty-container return depot, "Trả cont rỗng"): the dropoff port
 * resurfaces as its own row ONLY when it names a DIFFERENT place than the
 * stage-1 result — two rows must never both read as "the drop". When the
 * port IS the stage-1 fallback (or they agree) there is nothing new to show.
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

/** Resolve the two delivery-stage labels from the three raw sources. The
 *  chain order is the contract — callers must NOT re-chain locally. */
export function resolveDeliveryStage(
  snapshotSiteName: string | null,
  freeText: string | null,
  portName: string | null,
): DeliveryStage {
  const deliveryName = freeText ?? snapshotSiteName ?? portName ?? null;
  const returnDepotName = portName != null && portName !== deliveryName ? portName : null;
  return { deliveryName, returnDepotName };
}
