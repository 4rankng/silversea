// Card _64 Phase B — Bảng 2.2 dedicated routing columns + the bảng kê note
// aggregation. Headers come from the customer's own fee names (verbatim
// data — port-names-are-data); the routing keys travel opaque.
import { defaultFeeRouting } from '@tingting/shared';
import type { QuotationFeeRow } from '../../../api/quotationClient';

export interface DedicatedColumn { key: string; label: string; routing: 'DEDICATED_CUSTOMS' | 'DEDICATED_DEPOT'; }

/** One column per distinct catalog fee name, in the catalog's own
 *  (sortOrder, id) order; headers are the customer's fee names verbatim —
 *  data, never identifiers. */
export function dedicatedColumns(feeCatalog: QuotationFeeRow[]): DedicatedColumn[] {
  return feeCatalog
    .filter((fee) => fee.routing === 'DEDICATED_CUSTOMS' || fee.routing === 'DEDICATED_DEPOT')
    .map((fee) => ({ key: `fee-${fee.id}`, label: fee.feeName, routing: fee.routing as DedicatedColumn['routing'] }));
}

/** A lot fee joins a dedicated column when its name matches the catalog
 *  name (exact, case-insensitive) or the catalog name is contained in the
 *  lot fee name; otherwise a fee whose classified routing matches rides
 *  the mode's first column. Deterministic; everything else stays in
 *  Phí khác. */
export function matchDedicatedColumn(name: string, columns: DedicatedColumn[]): DedicatedColumn | null {
  if (columns.length === 0) return null;
  const lower = name.toLowerCase();
  const exact = columns.find((col) => col.label.toLowerCase() === lower);
  if (exact) return exact;
  const contained = columns.find((col) => lower.includes(col.label.toLowerCase()));
  if (contained) return contained;
  const routing = defaultFeeRouting(name);
  return columns.find((col) => col.routing === routing) ?? null;
}

/** Card _64 AC4 — the bảng kê note aggregation: the container's other-costs
 *  fee names append to the user's note, deterministically in stored order.
 *  '—' only when both parts are absent. */
export function buildDebitNote(psActualNote: string | null, otherFeeNames: string[]): string {
  const autoSegment = otherFeeNames.length > 0 ? `Phí khác: ${otherFeeNames.join(', ')}` : null;
  return [psActualNote ?? null, autoSegment].filter((part): part is string => part != null && part !== '').join(' · ') || '—';
}
