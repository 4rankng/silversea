/**
 * Trip run shape, pure (KEP / KET_HOP / LAY_LE / DON).
 *
 * The house vocabulary for "what shape did this run have": kẹp (two
 * containers, one trip), kết hợp (a paired out-and-back run), lẻ (a
 * hand-ful-lot run) and đơn (a single run). It feeds BOTH the fleet
 * productivity report and the timesheet grid symbol, so the classifier lives
 * here — db-free and dependency-free — instead of inside a service that drags
 * ExcelJS and a pool into every caller.
 */
import type { FleetProductivityClassification } from '@tingting/shared';

/** Classify a trip into one of the four operational productivity categories. */
export function classifyTripRun(row: {
  pairKind?: string | null;
  dispatchClassification?: string | null;
  fulfillmentType?: string | null;
}): FleetProductivityClassification {
  if (row.pairKind === 'KEP' || row.dispatchClassification === 'DOUBLE') {
    return 'KEP';
  }
  if (row.pairKind === 'KET_HOP' || row.dispatchClassification === 'COMBINED') {
    return 'KET_HOP';
  }
  if (
    row.dispatchClassification === 'LCL' ||
    row.dispatchClassification === 'LCL_PICKUP' ||
    row.fulfillmentType === 'LCL_SHIPMENT'
  ) {
    return 'LAY_LE';
  }
  return 'DON';
}
