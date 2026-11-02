// SIL-655 (id 762) — the trip_container → shipment_container link law.
//
// The SIL-653 identity bridge is keyed on trip_containers.source_shipment_container_id:
// an unlinked row is a silent no-op, so a number typed on it never reaches
// the lot. This module decides — for a NUMBERED write on an unlinked row of a
// shipment-linked trip — whether the number resolves to the lot's container
// (LINK, set the link) or must be refused. Pure by design (the 2026-10-19
// unit-only ruling): the db-bound context loader and throw mapping live with
// the trip-container write paths in forwarder-container.service.ts.
//
// Documented boundary (invariant vacuous): a trip with no shipment
// (trips.shipment_id IS NULL) has no lot to resolve against — numbers there
// stay trip-local (NO_SHIPMENT). Numberless rows need no link (NUMBERLESS).
import { normalizeContainerNumber } from '@tingting/shared';

export interface TripContainerLinkLotContainer {
  id: number;
  containerNumber: string | null;
}

export interface TripContainerLinkTripRow {
  id: number;
  sourceShipmentContainerId: number | null;
  containerNumber: string | null;
}

export interface TripContainerLinkContext {
  /** The trip's lot (trips.shipment_id) — null means the vacuous boundary. */
  tripShipmentId: number | null;
  /** The lot's shipment_containers rows. */
  lotContainers: ReadonlyArray<TripContainerLinkLotContainer>;
  /** The trip's existing trip_containers rows (the duplicate law). */
  tripRows: ReadonlyArray<TripContainerLinkTripRow>;
}

export type TripContainerLinkDecision =
  | { kind: 'NO_SHIPMENT' }
  | { kind: 'NUMBERLESS' }
  | { kind: 'LINK'; sourceShipmentContainerId: number }
  | { kind: 'REJECT_UNDECLARED' }
  | { kind: 'REJECT_DUPLICATE_ON_TRIP' };

/**
 * Decide where a numbered write on an unlinked row must land. Matching is by
 * normalizeContainerNumber on both sides; the lowest-id lot container wins on
 * historical duplicate numbers. `selfRowId` exempts the row being updated
 * from the duplicate law; `reservedLotContainerIds` holds lot containers
 * already assigned earlier in the same batch (the batch is not yet visible in
 * tripRows at decision time).
 */
export function decideTripContainerNumberLink(
  ctx: TripContainerLinkContext,
  containerNumber: string | null | undefined,
  selfRowId: number | null = null,
  reservedLotContainerIds?: ReadonlySet<number>,
): TripContainerLinkDecision {
  const number = containerNumber?.trim() ? normalizeContainerNumber(containerNumber) : null;
  if (!number) return { kind: 'NUMBERLESS' };
  if (ctx.tripShipmentId == null) return { kind: 'NO_SHIPMENT' };

  const matches = ctx.lotContainers
    .filter((c) => c.containerNumber != null && normalizeContainerNumber(c.containerNumber) === number)
    .sort((a, b) => a.id - b.id);
  if (matches.length === 0) return { kind: 'REJECT_UNDECLARED' };
  const lot = matches[0];
  if (reservedLotContainerIds?.has(lot.id)) return { kind: 'REJECT_DUPLICATE_ON_TRIP' };

  for (const row of ctx.tripRows) {
    if (row.id === selfRowId) continue;
    if (row.sourceShipmentContainerId === lot.id) return { kind: 'REJECT_DUPLICATE_ON_TRIP' };
    if (row.containerNumber != null && normalizeContainerNumber(row.containerNumber) === number) {
      return { kind: 'REJECT_DUPLICATE_ON_TRIP' };
    }
  }
  return { kind: 'LINK', sourceShipmentContainerId: lot.id };
}
