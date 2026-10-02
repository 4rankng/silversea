import { describe, expect, it } from 'vitest';
import {
  hiddenByDefault,
  hideableColumns,
  readStoredHiddenColumns,
  resolveHiddenColumns,
  sanitizeHiddenColumns,
  serializeHiddenColumns,
  toggleHiddenColumn,
  type LedgerColumn,
} from './column-visibility';

// The card's own column set: identity + the row's action pinned, GHI CHÚ the one
// column whose default depends on data (card 20260928_193).
const COLUMNS: readonly LedgerColumn[] = [
  { key: 'customer', label: 'Khách hàng', pinned: true },
  { key: 'documents', label: 'Chứng từ' },
  { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
  { key: 'status', label: 'Trạng thái', pinned: true },
];

const emptyNotes = () => false;
const filledNotes = () => true;

describe('column visibility — the default hides an EMPTY column only', () => {
  it('hides GHI CHÚ while every rendered row is empty', () => {
    expect(hiddenByDefault(COLUMNS, emptyNotes)).toEqual(['notes']);
  });

  it('shows GHI CHÚ the moment one row carries a note', () => {
    // Hiding a column that has data loses information — the card calls that a
    // worse defect than the whitespace the rule removes.
    expect(hiddenByDefault(COLUMNS, filledNotes)).toEqual([]);
  });

  it('never hides a pinned identity column, even when it is declared auto-hideable', () => {
    const columns: readonly LedgerColumn[] = [{ key: 'customer', label: 'Khách hàng', pinned: true, autoHideWhenEmpty: true }];
    expect(hiddenByDefault(columns, emptyNotes)).toEqual([]);
  });

  it('offers only the unpinned columns to a picker', () => {
    expect(hideableColumns(COLUMNS).map((column) => column.key)).toEqual(['documents', 'notes']);
  });
});

describe('column visibility — the stored choice', () => {
  it('applies the default while the operator has never chosen', () => {
    expect(resolveHiddenColumns({ columns: COLUMNS, choice: null, hasData: emptyNotes })).toEqual(['notes']);
  });

  it('lets an explicit choice replace the default wholesale', () => {
    // Hiding Chứng từ must NOT resurrect the empty Ghi chú the default hides:
    // the choice carries the whole set, not one key.
    expect(resolveHiddenColumns({ columns: COLUMNS, choice: ['notes', 'documents'], hasData: emptyNotes }))
      .toEqual(['notes', 'documents']);
  });

  it('keeps a column hidden after it gains data when the operator hid it on purpose', () => {
    // "Người dùng tự ghi đè được": the override wins over the auto rule.
    expect(resolveHiddenColumns({ columns: COLUMNS, choice: ['notes'], hasData: filledNotes })).toEqual(['notes']);
  });

  it('drops a pinned key an operator hand-edited into storage', () => {
    expect(sanitizeHiddenColumns(COLUMNS, ['customer', 'status'])).toEqual([]);
  });

  it('drops keys that belong to another surface, duplicates and junk', () => {
    expect(sanitizeHiddenColumns(COLUMNS, ['vehicle', 'documents', 'documents', 'nope'])).toEqual(['documents']);
  });

  it('toggles one column and carries the rest of the effective set with it', () => {
    // The auto-hidden Ghi chú survives the first explicit toggle.
    expect(toggleHiddenColumn(COLUMNS, ['notes'], 'documents')).toEqual(['documents', 'notes']);
    expect(toggleHiddenColumn(COLUMNS, ['documents', 'notes'], 'documents')).toEqual(['notes']);
    // A pinned key cannot be toggled.
    expect(toggleHiddenColumn(COLUMNS, [], 'customer')).toEqual([]);
  });
});

describe('column visibility — the stored payload', () => {
  it('round-trips an explicit choice', () => {
    expect(readStoredHiddenColumns(serializeHiddenColumns(['notes', 'documents']))).toEqual(['documents', 'notes']);
  });

  it('reads "no choice" from an absent, non-array or non-string payload', () => {
    expect(readStoredHiddenColumns(null)).toBeNull();
    expect(readStoredHiddenColumns('')).toBeNull();
    expect(readStoredHiddenColumns('{"notes":true}')).toBeNull();
    expect(readStoredHiddenColumns('[1,2]')).toBeNull();
    expect(readStoredHiddenColumns('not json')).toBeNull();
  });
});
