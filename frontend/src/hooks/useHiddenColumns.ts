/**
 * The persisted column choice for one ledger surface (card 20260928_193).
 *
 * Storage, not the URL. The precedent is this feature's own history: card
 * `20260917_4` shipped the choice in `localStorage` under
 * `cus-containers-hidden-cols` and QA verified on staging that it survived a
 * reload — and the one other piece of DISPLAY state on a sibling shipment
 * surface (the debit screen's open lot, `ShipmentDebitPage.tsx:22`) is stored
 * and restored on mount too. Filters live in the URL because they are shareable
 * QUERY state; a column choice is a per-workstation display preference, and a
 * URL param would leak it into shared links and be wiped by "Xóa bộ lọc".
 *
 * No write happens on mount: the stored payload is written only when the
 * operator actually changes something, so an untouched surface never grows a
 * key and "Mặc định" can mean "there is no stored choice".
 */

import { useCallback, useState } from 'react';
import {
  readStoredHiddenColumns,
  resolveHiddenColumns,
  serializeHiddenColumns,
  toggleHiddenColumn,
  type LedgerColumn,
} from '../lib/column-visibility';

export interface HiddenColumnsApi {
  /** What the table must render hidden: the operator's choice, or the default. */
  hidden: readonly string[];
  isHidden: (key: string) => boolean;
  /** A stored choice exists — the picker's "Mặc định" has something to restore. */
  customized: boolean;
  toggle: (key: string) => void;
  reset: () => void;
}

function readChoice(storageKey: string): string[] | null {
  try {
    return readStoredHiddenColumns(localStorage.getItem(storageKey));
  } catch {
    // Private mode / locked-down context: no stored choice, the default applies.
    return null;
  }
}

function writeChoice(storageKey: string, hidden: readonly string[] | null): void {
  try {
    if (hidden === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, serializeHiddenColumns(hidden));
  } catch {
    // A surface whose preference cannot be stored still works for this session.
  }
}

export function useHiddenColumns({
  storageKey,
  columns,
  hasData,
}: {
  storageKey: string;
  columns: readonly LedgerColumn[];
  /** Whether the column carries data in the RENDERED rows (drives the default). */
  hasData: (column: LedgerColumn) => boolean;
}): HiddenColumnsApi {
  // `null` = the operator never chose, so the auto default applies. Lazy init
  // reads storage once per mount; the key is stable for a surface's lifetime.
  const [choice, setChoice] = useState<string[] | null>(() => readChoice(storageKey));
  const hidden = resolveHiddenColumns({ columns, choice, hasData });

  const toggle = useCallback((key: string) => {
    // The EFFECTIVE set becomes the explicit choice, which is what keeps an
    // auto-hidden column hidden while the operator configures a different one.
    const next = toggleHiddenColumn(columns, hidden, key);
    writeChoice(storageKey, next);
    setChoice(next);
  }, [storageKey, columns, hidden]);

  const reset = useCallback(() => {
    writeChoice(storageKey, null);
    setChoice(null);
  }, [storageKey]);

  return {
    hidden,
    isHidden: (key) => hidden.includes(key),
    customized: choice !== null,
    toggle,
    reset,
  };
}
