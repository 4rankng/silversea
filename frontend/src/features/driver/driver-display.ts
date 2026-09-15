/** Driver card and detail must name the same physical journey stage. */
export function driverLocationLabels(
  tradeDirection: string | null | undefined,
  delivery: string | null | undefined,
  returnDepot: string | null | undefined,
) {
  const deliveryName = delivery?.trim() || null;
  const depotName = returnDepot?.trim() || null;
  const isImport = tradeDirection === 'IMPORT';
  return {
    drop: isImport ? depotName : deliveryName,
    delivery: isImport ? deliveryName : null,
    returnDepot: !isImport && depotName !== deliveryName ? depotName : null,
  };
}
