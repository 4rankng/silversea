/** Driver card and detail must name the same physical journey stage.
 *
 * Card 091026190530 (FB-082), aligned with the 2026-09-18 delivery-stage
 * ruling: the drop chain — the container's dropoff port, else the
 * dispatcher's deliberate free-text override — is the Hạ point in EVERY
 * direction, and the return-depot stage is dead BE-side (always null).
 * Legacy data that still carries a distinct return depot keeps it ahead of
 * the delivery point for IMPORT; a depot-less IMPORT trip must not fall to a
 * dead "Cảng hạ" row while the same yard renders under the delivery label.
 *
 * Card 121026141020 (FB-082 retest): "Giao hàng" is a DIFFERENT physical
 * stage from "Hạ" — it names the delivery DESTINATION (the factory the goods
 * are handed over to), never the discharge yard. Sourcing it from the drop
 * chain made the two rows read identically ("Cảng hạ: Bãi JJ LOGISTICS /
 * Địa chỉ giao hàng: Bãi JJ LOGISTICS") the moment the dropoff port was
 * recorded, so the delivery stage moved to destination ownership
 * (driverDeliveryDestination) and this mapper no longer emits it. */
export function driverLocationLabels(
  tradeDirection: string | null | undefined,
  delivery: string | null | undefined,
  returnDepot: string | null | undefined,
) {
  const deliveryName = delivery?.trim() || null;
  const depotName = returnDepot?.trim() || null;
  const isImport = tradeDirection === 'IMPORT';
  return {
    drop: isImport ? (depotName ?? deliveryName) : deliveryName,
    returnDepot: !isImport && depotName !== deliveryName ? depotName : null,
  };
}

/** The delivery-destination label: the factory the goods are handed over to,
 *  full name + street address. The Hạ label is a port and never takes the
 *  factory (2026-09-18 ruling); this label is exactly the factory — the two
 *  stages are different places on the journey. Null when no destination data
 *  exists, so callers hide the row instead of echoing the drop point. */
export function driverDeliveryDestination(factory: {
  fullName?: string | null;
  name?: string | null;
  address?: string | null;
}): string | null {
  const name = factory.fullName?.trim() || factory.name?.trim() || null;
  const address = factory.address?.trim() || null;
  if (!name && !address) return null;
  return name && address ? `${name}, ${address}` : (name ?? address);
}

/** REQ-07 (client doc, dispatch-approved): the driver app's ONE trip-code
 *  display formatter. Bill/Booking stays the lead identity (internal-ids law,
 *  CHIEF 26/09) — this labels the code itself wherever a driver surface shows
 *  a trip, in ONE scannable shape instead of each screen inventing its own.
 *
 *  Audit 2026-10-21 (trip-create.service.ts generateTripCode + live rows):
 *  the current generator writes `TRP-<YYYYMM>-<seq padStart 4>` (e.g.
 *  "TRP-202610-0007"); the DB also carries legacy shapes it must never mangle
 *  ("TRP-C12-53-1791212851260-gvr4vb", "CN-…", "BULK-TR-…", bare null).
 *  Canonical codes render spaced — "TRP 2026-10 · 0007"; long sequences keep
 *  every digit; anything else passes through trimmed, and a missing code is
 *  null so callers hide the row (same contract as driverDeliveryDestination). */
export function driverTripCodeLabel(tripCode: string | null | undefined): string | null {
  const raw = tripCode?.trim();
  if (!raw) return null;
  const canonical = raw.match(/^TRP-(\d{4})(\d{2})-(\d+)$/);
  if (!canonical) return raw;
  const [, year, month, sequence] = canonical;
  return `TRP ${year}-${month} · ${sequence.padStart(4, '0')}`;
}
