// SIL-1039 (KB K5.18) — pure law for which quotation cell supplies a leg's
// Hệ số (the phụ phí dầu multiplier, cards _59/_60). Db-free unit seam, the
// same precedent as pricing-table-selection + lcl-effective-freight: the
// engine (freight-pricing-engine.service) imports this, the unit test
// imports ONLY this.
//
// The bug this pins: quotation import keys split columns CONT20.LIGHT/.HEAVY
// (quotation-import.service classCodeFromLabel), but the engine's candidate
// family never queried the .HEAVY cell — a heavy container leg (dispatch
// prices it as vehicleSizeClassCode CONT20 + priceVehicleSizeClassCode
// CONT20.HEAVY) silently priced its surcharge on the plain/LIGHT cell.
import { quotationBaseClassCode } from '@tingting/shared';

export type HeSoCellSource = 'EXACT' | 'HEAVY' | 'LIGHT' | 'BASE' | 'DEFAULT';

export interface HeSoCellRow {
  code: string;
  heSo: number | string;
}

/** The cell family an ask may inherit its Hệ số from, in priority order: the
 *  exact code → the base's HEAVY split → the base's LIGHT split (the K5.18
 *  inheritance — a heavy leg falling here is 'kế thừa hạng nhẹ / giá tạm')
 *  → the base code. Deduped: asking a split directly collapses onto its own
 *  entry (CONT20.HEAVY asks list the .HEAVY cell once, as EXACT). */
export function quotationHeSoFamily(code: string): Array<{ code: string; source: Exclude<HeSoCellSource, 'DEFAULT'> }> {
  const base = quotationBaseClassCode(code);
  return [
    { code, source: 'EXACT' as const },
    { code: `${base}.HEAVY`, source: 'HEAVY' as const },
    { code: `${base}.LIGHT`, source: 'LIGHT' as const },
    { code: base, source: 'BASE' as const },
  ].filter((cell, index, all) => all.findIndex((other) => other.code === cell.code) === index);
}

/** First family cell present in the sheet wins; no hit ⇒ the ruling-5/7
 *  deterministic default (multiplier 1 — pre-card behavior intact). */
export function pickHeSoCell(code: string, cells: ReadonlyArray<HeSoCellRow>): { heSo: number; source: HeSoCellSource } {
  for (const candidate of quotationHeSoFamily(code)) {
    const hit = cells.find((cell) => cell.code === candidate.code);
    if (hit) return { heSo: Number(hit.heSo), source: candidate.source };
  }
  return { heSo: 1, source: 'DEFAULT' };
}

/** K5.18 — the LIGHT-cell inheritance is provisional on a heavy leg: the
 *  formula carries the 'kế thừa hạng nhẹ / giá tạm' note and the resolved
 *  rate flags it (heSoInheritedFromLight) for FE tagging. A non-heavy ask
 *  reading the .LIGHT cell is its own column's law — never flagged. */
export function heSoInheritsLightOnHeavy(code: string, priceClassCode: string, source: HeSoCellSource): boolean {
  return source === 'LIGHT' && (priceClassCode.endsWith('.HEAVY') || code.endsWith('.HEAVY'));
}
