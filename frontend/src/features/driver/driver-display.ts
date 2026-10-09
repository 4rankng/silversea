/** Driver card and detail must name the same physical journey stage.
 *
 * Card 091026190530 (FB-082), aligned with the 2026-09-18 delivery-stage
 * ruling: the drop chain — the container's dropoff port, else the
 * dispatcher's deliberate free-text override — is the Hạ point in EVERY
 * direction, and the return-depot stage is dead BE-side (always null).
 * Legacy data that still carries a distinct return depot keeps it ahead of
 * the delivery point for IMPORT; a depot-less IMPORT trip must not fall to a
 * dead "Cảng hạ" row while the same yard renders under the delivery label. */
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
    delivery: isImport ? deliveryName : null,
    returnDepot: !isImport && depotName !== deliveryName ? depotName : null,
  };
}
