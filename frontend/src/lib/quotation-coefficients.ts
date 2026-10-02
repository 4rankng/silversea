import type { QuotationCellView } from '@tingting/shared';

type CoefficientCell = Pick<QuotationCellView, 'routeId' | 'vehicleSizeClassCode' | 'heSo'>;

/** A route editor supplies a subset; the quotation update replaces all cells. */
export function mergeQuotationCoefficients(
  current: readonly CoefficientCell[],
  changes: readonly CoefficientCell[],
): CoefficientCell[] {
  const key = (cell: CoefficientCell) => `${cell.routeId}:${cell.vehicleSizeClassCode}`;
  const byKey = new Map(changes.map(cell => [key(cell), cell]));
  return current.map(cell => ({
    routeId: cell.routeId,
    vehicleSizeClassCode: cell.vehicleSizeClassCode,
    heSo: byKey.get(key(cell))?.heSo ?? cell.heSo,
  }));
}
