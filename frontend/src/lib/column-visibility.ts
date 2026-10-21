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
  /**
   * Card 191026181942 (chốt debit) — this column belongs to the surface's
   * ESSENTIAL set: on a surface whose default is `defaultVisible:
   * 'essential'`, only essential columns (pinned ones are always essential)
   * show before the operator ever chooses. A surface keeps the auto-hide
   * default until it opts in, so CUS ledgers are unaffected.
   */
  essential?: boolean;
  /**
   * Card 211026024348 (FB-093 re-verify) — under the `essential` default this
   * column still SHOWS ITSELF once it carries data. It hosts a required group
   * action/state (the "Tách nhóm" control next to "Ghép cùng Bill X"), not a
   * redundant money breakdown: hiding it on a fresh workstation would hide the
   * action with it. The column-visibility law ("absence is not data — a column
   * shows the moment it carries something") decides via `hasData`; the default
   * may still hide it while it is empty, but a STORED choice may not hide it
   * at all (FB-093 lan 3 — see `hideableColumns`). If both flags were ever
   * combined, `essential` wins (the column never hides — by default or choice).
   */
  essentialWhenHasData?: boolean;
}

/**
 * The columns a stored CHOICE may hide: not the row's identity/only action
 * (`pinned`), not the surface's required money set (`essential`), not a column
 * hosting a required action (`essentialWhenHasData`).
 *
 * FB-093 (lan 3): a choice written BEFORE a column joined the required set
 * kept it buried on old workstations — the QA build showed no "Tách nhóm"
 * because stale `localStorage` under the surface's key still named the action
 * column. One predicate guards every consumer: `toggleHiddenColumn` refuses
 * the key, `sanitizeHiddenColumns` drops it from storage on every read
 * (idempotent — a filter at read time, no one-time migration), and the picker
 * panel renders a required column LOCKED (disabled, truth-checked — see
 * `ColumnPickerPanel`), so no offered action pretends a choice could hide it.
 * KT4 (card 191026181942) still lists the column: the rollups read as
 * "there, checked", the breakdowns as "one toggle away".
 */
export function hideableColumns(columns: readonly LedgerColumn[]): LedgerColumn[] {
  return columns.filter((column) => !column.pinned && !column.essential && !column.essentialWhenHasData);
}

/**
 * Drops keys that cannot be part of a valid choice for THIS surface: a stored
 * payload from another surface, a removed column, or a key an operator (or an
 * older build — FB-093 lan 3) wrote for a column that is pinned, essential,
 * or essentialWhenHasData can never hide anything.
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
 * The default set for a surface whose operator has never chosen.
 *
 * Iterates the NON-PINNED columns directly — not `hideableColumns`: a choice
 * may never hide a required column, but the DEFAULT still may (an empty
 * essentialWhenHasData column waits off-board, FB-093 re-verify).
 *
 * `auto` (every surface until it opts in): the columns that declare
 * `autoHideWhenEmpty` and currently carry NO data. `hasData` answers for the
 * RENDERED rows; an unknown column reads as carrying data, so a column can
 * only disappear once the loaded rows are known to be empty.
 *
 * `essential` (card 191026181942, chốt debit): the board opens on its
 * essential set only — a money matrix with every breakdown visible is
 * unreadable and QA had to hide columns by hand. Pinned columns are always
 * essential (they cannot hide at all); `essential: true` marks the rest of
 * the set. An explicit choice still replaces this default wholesale — minus
 * the required columns, which no choice can hide (FB-093 lan 3).
 */
export function hiddenByDefault(
  columns: readonly LedgerColumn[],
  hasData: (column: LedgerColumn) => boolean,
  defaultVisible: 'auto' | 'essential' = 'auto',
): string[] {
  if (defaultVisible === 'essential') {
    return columns
      .filter((column) => !column.pinned && !column.essential
        // FB-093 re-verify (card 211026024348): a column that carries a
        // required action shows itself once it has data — the essential
        // default exists to keep the MONEY matrix readable, not to bury an
        // action cell.
        && !(column.essentialWhenHasData && hasData(column)))
      .map((column) => column.key);
  }
  return columns
    .filter((column) => !column.pinned && column.autoHideWhenEmpty && !hasData(column))
    .map((column) => column.key);
}

/**
 * The hidden set the table must actually render.
 *
 * `choice === null` means "the operator never chose" → the default applies.
 * Any stored choice replaces that default wholesale — so hiding one column never
 * resurrects another column the default had hidden, and a column the operator
 * chose to hide STAYS hidden when it later gains data (the override wins) —
 * except a required column: `sanitizeHiddenColumns` drops its key from every
 * choice, old or new (FB-093 lan 3).
 */
export function resolveHiddenColumns({
  columns,
  choice,
  hasData,
  defaultVisible = 'auto',
}: {
  columns: readonly LedgerColumn[];
  choice: readonly string[] | null;
  hasData: (column: LedgerColumn) => boolean;
  defaultVisible?: 'auto' | 'essential';
}): string[] {
  if (choice === null) return hiddenByDefault(columns, hasData, defaultVisible);
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

/**
 * FB-093 (lan 3) — the READ-side repair of a stored choice. Parses the payload,
 * then drops every key no choice may carry (`sanitizeHiddenColumns`). The
 * caller writes the result back when it differs, so a stale workstation
 * converges on first load and every later read is a clean no-op. Absent or
 * corrupt payloads stay "no choice" and never trigger a write.
 */
export function loadStoredHiddenColumns(
  columns: readonly LedgerColumn[],
  raw: string | null | undefined,
): { choice: string[] | null; changed: boolean } {
  const parsed = readStoredHiddenColumns(raw);
  if (parsed === null) return { choice: null, changed: false };
  const kept = sanitizeHiddenColumns(columns, parsed);
  return { choice: kept, changed: kept.length !== parsed.length };
}
