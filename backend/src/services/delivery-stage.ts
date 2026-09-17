/**
 * Authoritative delivery-stage resolution — ONE implementation shared by the
 * three surfaces that tell the driver/CUS where the container comes down:
 * the journey-board card, the driver fulfillment detail, and the CUS
 * container ledger cell.
 *
 * The two directions run opposite journeys, so the labels are NOT symmetric:
 *
 *   IMPORT — lift the laden box at the port, deliver the goods at the factory,
 *            return the empty to a depot. "Hạ" is the delivery point and the
 *            depot is a genuine second stage.
 *   EXPORT — lift an EMPTY box at a depot, stuff it at the factory, set the
 *            LADEN box down at the PORT. The factory is a loading stop, never
 *            the drop, and there is no empty-return leg to show at all.
 *
 * Stage 1 (delivery point, "Hạ" / "Cảng hạ"):
 *   IMPORT / unknown direction — fallback chain:
 *     1. shipments.deliveryLocation — the dispatcher's deliberate free-text
 *        override for THIS shipment (highest trust; manual intent).
 *     2. the fulfillment site-snapshot's deliverySite name — the structured
 *        per-container record captured when CUS created the shipment.
 *     3. the container's dropoff port name — last resort.
 *   EXPORT — the dropoff port, else the dispatcher free text. The site
 *     snapshot is deliberately EXCLUDED: it holds the stuffing factory, and
 *     borrowing it here is what made an export card read "Hạ NEWEB-1".
 *
 * Stage 2 (empty-container return depot, "Trả cont rỗng"): import only. The
 * dropoff port resurfaces as its own row ONLY when it names a DIFFERENT place
 * than the stage-1 result — two rows must never both read as "the drop". An
 * export has no such leg, so stage 2 is always null there.
 *
 * Callers pass the shipment's tradeDirection. An absent/unknown direction
 * keeps the legacy chain so partially-populated rows behave as before.
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
  tradeDirection?: string | null,
): DeliveryStage {
  if (tradeDirection === 'EXPORT') {
    // The laden box comes down at the port. Never fall back to the site
    // snapshot: that names the stuffing factory, not a drop.
    const exportDrop = portName?.trim() || freeText?.trim() || null;
    return { deliveryName: exportDrop, returnDepotName: null };
  }
  const deliveryName = freeText ?? snapshotSiteName ?? portName ?? null;
  const returnDepotName = portName != null && portName !== deliveryName ? portName : null;
  return { deliveryName, returnDepotName };
}
