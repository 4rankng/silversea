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
// R30b regression on top: the engine asked the family with the BASE code
// instead of the priced split, so with BOTH splits priced the LIGHT leg
// read the .HEAVY cell first (heSo 1.25 → phụ phí dầu on every light
// trip). The ask is now the price class, and .LIGHT asks never fall back
// to .HEAVY.
import { quotationBaseClassCode } from '@tingting/shared';

export type HeSoCellSource = 'EXACT' | 'HEAVY' | 'LIGHT' | 'BASE' | 'DEFAULT';

export interface HeSoCellRow {
  code: string;
  heSo: number | string;
}

/** The cell family an ask may inherit its Hệ số from. A .HEAVY or plain
 *  base ask: the exact code → the base's HEAVY split → the base's LIGHT
 *  split (the K5.18 inheritance — a heavy leg falling here is 'kế thừa
 *  hạng nhẹ / giá tạm') → the base code. A .LIGHT ask never falls back to
 *  .HEAVY (r30b): its family is exact → base. Deduped: asking a split
 *  directly collapses onto its own entry (CONT20.HEAVY asks list the
 *  .HEAVY cell once, as EXACT). */
export function quotationHeSoFamily(code: string): Array<{ code: string; source: Exclude<HeSoCellSource, 'DEFAULT'> }> {
  const base = quotationBaseClassCode(code);
  // SIL-1039 r30b: a .LIGHT ask NEVER falls back to .HEAVY — with both
  // splits priced, a light leg would otherwise read the heavy multiplier
  // (heSo 1.25 → phụ phí dầu on every light trip). Its family is exact →
  // base. .HEAVY and plain base asks keep the K5.18 chain below (heavy
  // legs inherit the light cell — 'hạng nặng kế thừa hạng nhẹ').
  if (code.endsWith('.LIGHT')) {
    return [
      { code, source: 'EXACT' as const },
      { code: base, source: 'BASE' as const },
    ];
  }
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
