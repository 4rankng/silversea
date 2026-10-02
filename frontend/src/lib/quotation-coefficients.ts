/** The stored cell datum the update payload carries (quotationCellSchema). */
interface QuotationCellRow {
  routeId: number;
  vehicleSizeClassCode: string;
  heSo: number;
}

/**
 * Merge edited hệ số rows back into the full live-view cell set before a
 * replace-all update.
 *
 * The update endpoint is replace-all on `cells`: sending only the rows a
 * single route block edited would wipe every other route's hệ số. This keeps
 * the server-assembled view cells (the complete grid) and overrides each
 * matching cell's `heSo` — keyed by `(routeId, vehicleSizeClassCode)` — with
 * the edited value. Update rows without a matching view cell are dropped: a
 * cell only exists if the detail route assembled it.
 */
export function mergeQuotationCoefficients(
  cells: ReadonlyArray<QuotationCellRow>,
  updates: ReadonlyArray<QuotationCellRow>,
): QuotationCellRow[] {
  const edited = new Map(
    updates.map((update) => [`${update.routeId}\u0000${update.vehicleSizeClassCode}`, update.heSo]),
  );
  return cells.map((cell) => {
    const heSo = edited.get(`${cell.routeId}\u0000${cell.vehicleSizeClassCode}`);
    return heSo === undefined
      ? { routeId: cell.routeId, vehicleSizeClassCode: cell.vehicleSizeClassCode, heSo: cell.heSo }
      : { routeId: cell.routeId, vehicleSizeClassCode: cell.vehicleSizeClassCode, heSo };
  });
}
