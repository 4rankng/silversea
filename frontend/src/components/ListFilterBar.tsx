import { useRef, type ReactNode, type RefObject } from 'react';
import { Search } from 'lucide-react';
import { FilterBarModeProvider, useFilterBarFit } from './filter-bar-mode';
import './FilterBar.css';
import './ListFilterBar.css';

/**
 * ListFilterBar — the one shared filter bar for list pages (card 20260922_38).
 *
 * One layout contract for the filter surfaces pages used to hand-roll (and
 * repeatedly drift): the strip is ONE wrapping line inside ONE toolbar card,
 * and it packs to as few rows as the width allows — two is the rule of thumb at
 * every device size (operator 2026-09-27).
 *
 * DOM order IS the reading order: search cell → children (the criteria, with
 * `Bộ lọc` last) → presets → quick filters → spacer → actions.
 *
 * Which criteria are VISIBLE is measured, not declared: `useFilterBarFit` counts
 * the rendered rows and tells every `FilterDropdown` whether its criteria still
 * fit inline. While they do, no `Bộ lọc` trigger renders at all — everything is
 * a chip on the bar. When the width leaves no other choice they collapse behind
 * the trigger, and only then.
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
  /** Criteria in row order. Put the `Bộ lọc` trigger LAST: it is the item that
   *  arrives and leaves as the width changes. */
  children?: ReactNode;
  /** Quick ranges (the shared segmented group), beside the dates they set. */
  presets?: ReactNode;
  /** Quick filters (toggles/chips) — after the presets. */
  quickFilters?: ReactNode;
  /** Accessible name of the quick-filter group (renders `role="group"`). */
  quickFiltersLabel?: string;
  /** Applied-count line, right-aligned ahead of the actions. */
  status?: ReactNode;
  /** Right-side actions (reset, export) — pinned to the right end. */
  actions?: ReactNode;
}

export function ListFilterBar({ search, children, presets, quickFilters, quickFiltersLabel, status, actions }: ListFilterBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // Keep every criterion inline while the strip still fits two rows; fold them
  // into `Bộ lọc` only when the width leaves no other choice.
  const mode = useFilterBarFit(barRef);
  return (
    <FilterBarModeProvider value={mode}>
      <div className="filter-bar filter-bar--card list-filter-bar" ref={barRef}>
        {search && (
          // The cell is a stack: the shell plus the field's own validation line
          // (a cell that grows a second row must stay one bar item).
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
        {presets && <div className="filter-bar__presets">{presets}</div>}
        {quickFilters && (
          <div
            className="list-filter-bar__quick"
            role={quickFiltersLabel ? 'group' : undefined}
            aria-label={quickFiltersLabel}
          >
            {quickFilters}
          </div>
        )}
        {/* The applied-count and the reset are ONE cluster at the right end of
            the line they land on; the spacer's `margin-left:auto` pins it. */}
        {(status || actions) && <div className="filter-bar__spacer" />}
        {(status || actions) && (
          <div className="filter-bar__actions">
            {status}
            {actions}
          </div>
        )}
      </div>
    </FilterBarModeProvider>
  );
}
