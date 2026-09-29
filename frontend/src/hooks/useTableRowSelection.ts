import { useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

/**
 * Card 20260929_207 — one selection model for every table that used to carry a
 * checkbox column.
 *
 * The checkbox column is gone app-wide (PM directive 2026-09-29): a row is
 * selected by clicking it, and the selection is carried by `data-selected` so
 * it is both visible and readable by assistive tech. A row is also reachable
 * and toggleable from the keyboard, so dropping the checkbox never drops
 * keyboard access.
 *
 * The SHAPE is the one already shipped on /shipments-debit (card
 * 20260929_202) — this hook only lifts it into one place so a table does not
 * re-implement the Set dance. `ShipmentDebitPage` keeps its own copy until it
 * is migrated; the two behave identically.
 *
 * Interaction rules, because "click a row" is ambiguous in a dense table:
 *   - a click on an interactive child (button, link, input, select, textarea)
 *     runs THAT control and never toggles the row — a cell that opens a detail
 *     must not also select the row;
 *   - a modifier-click (meta/ctrl/shift) is left to the browser, so text
 *     selection and open-in-new-tab still work;
 *   - `selectable` decides whether a row can be picked at all; a row that
 *     cannot is inert rather than silently "selected".
 */

const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], [role="checkbox"], [contenteditable="true"]';

export interface RowSelection<T> {
  /** Ids currently selected. */
  selected: ReadonlySet<T>;
  /** True when the row is selected — bind to `data-selected` / `aria-selected`. */
  isSelected: (id: T) => boolean;
  /** Click handler for the row. Returns the props to spread on the `<tr>`. */
  rowProps: (id: T, options?: { selectable?: boolean }) => {
    onClick: (event: MouseEvent<HTMLTableRowElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => void;
  };
  /** Click a row in code (used by the "select all" button and by tests). */
  toggle: (id: T) => void;
  /** Replace the whole selection — the "select every row on this page" button. */
  selectAll: (ids: readonly T[]) => void;
  clear: () => void;
  /** Ids of `candidates` that are selected, in candidate order. */
  selectedAmong: <I extends T>(candidates: readonly I[]) => I[];
  /** How many of `candidates` are selected — the bulk-action count. */
  countAmong: <I extends T>(candidates: readonly I[]) => number;
  /** True when every candidate is selected (and there is at least one). */
  allOfSelected: <I extends T>(candidates: readonly I[]) => boolean;
}

export function useTableRowSelection<T>(initial: Iterable<T> = []): RowSelection<T> {
  const [selected, setSelected] = useState<Set<T>>(() => new Set(initial));

  const toggle = useCallback((id: T) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: readonly T[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: T) => selected.has(id), [selected]);

  const rowProps = useCallback(
    (id: T, options?: { selectable?: boolean }) => ({
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (options?.selectable === false) return;
        // A press that lands on a control belongs to that control.
        if ((event.target as Element).closest(INTERACTIVE)) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        toggle(id);
      },
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (options?.selectable === false) return;
        if (event.key !== ' ' && event.key !== 'Enter') return;
        if ((event.target as Element).closest(INTERACTIVE)) return;
        event.preventDefault();
        toggle(id);
      },
    }),
    [toggle],
  );

  const selectedAmong = useCallback(
    <I extends T>(candidates: readonly I[]) => candidates.filter((id) => selected.has(id)),
    [selected],
  );
  const countAmong = useCallback(<I extends T>(candidates: readonly I[]) => selectedAmong(candidates).length, [selectedAmong]);
  const allOfSelected = useCallback(
    <I extends T>(candidates: readonly I[]) => candidates.length > 0 && countAmong(candidates) === candidates.length,
    [countAmong],
  );

  return useMemo(
    () => ({ selected, isSelected, rowProps, toggle, selectAll, clear, selectedAmong, countAmong, allOfSelected }),
    [selected, isSelected, rowProps, toggle, selectAll, clear, selectedAmong, countAmong, allOfSelected],
  );
}
