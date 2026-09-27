import type { ReactNode, RefObject } from 'react';
import { Search } from 'lucide-react';
import './FilterBar.css';
import './ListFilterBar.css';

/**
 * ListFilterBar — the one shared filter bar for list pages (card 20260922_38).
 *
 * One layout contract for the filter surfaces pages used to hand-roll (and
 * repeatedly drift): text search, filter controls (selects, segmented date
 * fields, comboboxes), quick filters and right-side actions/reset. The row is
 * one row when space allows and wraps to a consistent second row below; wrap
 * happens only when genuinely out of space (fix family 20260919_48 /
 * 20260920_34). Control chrome comes from the shared design system and the
 * shared `.filter-bar` sheet — pages arrange, they never re-skin.
 */

export interface ListFilterBarSearchProps {
  /** Controlled search text, passed through unmodified (whitespace included). */
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name for the search field. */
  ariaLabel: string;
  /** Focus target for a page-level shortcut (e.g. `/` or ⌘K). */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Extra attributes for the input (title, autocomplete, data-* hooks). */
  inputProps?: Record<string, unknown>;
  /** Validation message rendered under the field (role="alert" when set). */
  error?: string | null;
}

export interface ListFilterBarProps {
  /** Text search slot — the bar owns the icon, chrome and placeholder. */
  search?: ListFilterBarSearchProps;
  /** Filter controls (selects, date fields, comboboxes) — content-sized in row order. */
  children?: ReactNode;
  /** Quick filters (presets/toggles) — one group row that wraps with the bar. */
  quickFilters?: ReactNode;
  /** Accessible name of the quick-filter group (renders `role="group"`). */
  quickFiltersLabel?: string;
  /** Right-side actions (reset, export) — pinned right of the row when it fits. */
  actions?: ReactNode;
}

export function ListFilterBar({ search, children, quickFilters, quickFiltersLabel, actions }: ListFilterBarProps) {
  return (
    <div className="filter-bar list-filter-bar">
      {search && (
        // The cell is a stack: the shell plus the field's own validation line
        // (a bar cell that grows a second row must not become a second cell —
        // the grid would give the message a column of its own).
        <div className="filter-bar__search-cell">
          <div className="filter-bar__search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={search.inputRef}
              type="text"
              aria-label={search.ariaLabel}
              placeholder={search.placeholder}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              {...search.inputProps}
            />
          </div>
          {search.error ? <p className="filter-bar__search-error" role="alert">{search.error}</p> : null}
        </div>
      )}
      {children}
      {quickFilters && (
        <div
          className="list-filter-bar__quick"
          role={quickFiltersLabel ? 'group' : undefined}
          aria-label={quickFiltersLabel}
        >
          {quickFilters}
        </div>
      )}
      {/* Actions are one grid item (auto/-1 + justify-self:end pins the
          cluster at the bar's right edge); multi-element fragments row up
          inside .filter-bar__actions instead of becoming stray grid cells. */}
      {actions && <div className="filter-bar__spacer" />}
      {actions && <div className="filter-bar__actions">{actions}</div>}
    </div>
  );
}
