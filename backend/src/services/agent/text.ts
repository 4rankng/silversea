// Shared Vietnamese text normalization for the agent layer.
//
// Folds a query to a diacritic-insensitive comparable form: NFD-decompose,
// strip Latin combining marks, đ/Đ -> d, then lowercase. Used by page-search
// (tools/ui.ts), tour-search (tools/tours.ts), and the tour-intent net
// (orchestrator.ts) so identical queries match identically everywhere.
//
// Behavior is byte-identical to the three local copies it replaced: the
// orchestrator's Đ -> 'D' vs 'd' elsewhere both collapse to 'd' under the final
// toLowerCase. Diacritic-insensitive MATCHING only — never feed DB-bound or
// user-facing values through this.
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}
