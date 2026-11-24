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

/**
 * The visible trip key on reporting screens is the business reference — the
 * Bill/Booking dispatch issuance persisted on `trips.customer_reference` —
 * never the internal `TRP-*` code (KB §1.4.3 / V25). A trip without a
 * reference says so instead of inventing a fallback token; the wording
 * mirrors the frontend `billBookingReference` law in lib/business-reference.ts.
 */
export function tripBusinessReference(customerReference: string | null | undefined): string {
  return customerReference?.trim() || 'Chưa có số Bill/Booking';
}

/** One chip per distinct reference: paired runs of one Bill collapse to a
 * single chip, insertion order preserved (the run counts stay in the numeric
 * columns — dedupe is display-only). */
export function distinctTripReferences<T>(rows: T[], referenceOf: (row: T) => string): string[] {
  const seen = new Set<string>();
  const references: string[] = [];
  for (const row of rows) {
    const reference = referenceOf(row);
    if (!seen.has(reference)) {
      seen.add(reference);
      references.push(reference);
    }
  }
  return references;
}
