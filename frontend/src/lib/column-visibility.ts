/**
 * Column visibility for the operational ledgers (card 20260928_193).
 *
 * The card exists because `20260927_67` assumed a "column settings" that hides an
 * empty GHI CHÚ column by default — measured at HEAD, no hide/show mechanism
 * existed on either CUS ledger. The mechanism HAD existed: card `20260917_4`
 * shipped one on `/shipments-detail` and it was QA-passed on 2026-09-18, then
 * deleted by `03d584ec` one day later. This module is the restored core, rebuilt
 * free of the page-local checkbox strip that the 2026-09-27 one-filter-plane law
 * now forbids, plus the rule `_4` never had:
 *
 *   an EMPTY column hides itself by default, and shows the moment it carries
 *   data — while an explicit user choice always wins.
 *
 * Pure functions only: the storage and the rendering live in
 * `hooks/useHiddenColumns.ts` and `components/ColumnPicker.tsx`. The stored
 * payload is a JSON array of hidden column KEYS, which is byte-compatible with
 * the payload `20260917_4` shipped under `cus-containers-hidden-cols`.
 */

export interface LedgerColumn {
  /** Stable key — the storage payload and `hiddenColumns` props use it. */
  key: string;
  /** The table header label, reused verbatim in the picker. */
  label: string;
  /**
   * Never hideable: the row's identity, or the only column carrying its action.
   * Hiding it costs the row its context (card `20260917_4` AC 3) or its only
   * way out, so the pin is enforced here and not merely hidden from the picker.
   */
  pinned?: boolean;
  /**
   * Hidden by DEFAULT while every rendered row's cell is empty — the card's
   * GHI CHÚ rule. A column that carries data is never hidden by this rule.
   */
  autoHideWhenEmpty?: boolean;
}

/** The columns a picker offers, in table order. */
export function hideableColumns(columns: readonly LedgerColumn[]): LedgerColumn[] {
  return columns.filter((column) => !column.pinned);
}

/**
 * Drops keys that are not a hideable column of THIS surface: a stored payload
 * from another surface, a removed column, or a pinned key an operator hand-edited
 * into storage can never hide anything.
 */
export function sanitizeHiddenColumns(
  columns: readonly LedgerColumn[],
  hidden: readonly string[] | null | undefined,
): string[] {
  if (!hidden || hidden.length === 0) return [];
  const hideable = hideableColumns(columns);
  const kept: string[] = [];
  for (const key of hidden) {
    if (typeof key !== 'string' || kept.includes(key)) continue;
    if (!hideable.some((column) => column.key === key)) continue;
    kept.push(key);
  }
  return kept;
}

/**
 * The default set for a surface whose operator has never chosen: the columns
 * that declare `autoHideWhenEmpty` and currently carry NO data. `hasData`
 * answers for the RENDERED rows; an unknown column reads as carrying data, so a
 * column can only disappear once the loaded rows are known to be empty.
 */
export function hiddenByDefault(
  columns: readonly LedgerColumn[],
  hasData: (column: LedgerColumn) => boolean,
): string[] {
  return hideableColumns(columns)
    .filter((column) => column.autoHideWhenEmpty && !hasData(column))
    .map((column) => column.key);
}

/**
 * The hidden set the table must actually render.
 *
 * `choice === null` means "the operator never chose" → the auto default applies.
 * Any stored choice replaces that default wholesale — so hiding one column never
 * resurrects another column the default had hidden, and a column the operator
 * chose to hide STAYS hidden when it later gains data (the override wins).
 */
export function resolveHiddenColumns({
  columns,
  choice,
  hasData,
}: {
  columns: readonly LedgerColumn[];
  choice: readonly string[] | null;
  hasData: (column: LedgerColumn) => boolean;
}): string[] {
  if (choice === null) return hiddenByDefault(columns, hasData);
  return sanitizeHiddenColumns(columns, choice);
}

/**
 * Flips one column's visibility, writing the whole resulting set as the explicit
 * choice (which is why the auto-hidden columns survive the first toggle).
 */
export function toggleHiddenColumn(
  columns: readonly LedgerColumn[],
  hidden: readonly string[],
  key: string,
): string[] {
  const current = sanitizeHiddenColumns(columns, hidden);
  const hideable = hideableColumns(columns);
  if (!hideable.some((column) => column.key === key)) return current;
  if (current.includes(key)) return current.filter((entry) => entry !== key);
  // The whole resulting set becomes the explicit choice, in table order.
  return hideable
    .filter((column) => column.key === key || current.includes(column.key))
    .map((column) => column.key);
}

/** Parses a stored payload. Anything that is not an array of strings is "no choice". */
export function readStoredHiddenColumns(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((entry) => typeof entry === 'string')) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

/** The stored payload for an explicit choice. Sorted so the same set writes one value. */
export function serializeHiddenColumns(hidden: readonly string[]): string {
  return JSON.stringify([...hidden].sort());
}
