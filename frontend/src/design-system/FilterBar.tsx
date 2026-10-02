import { useId, useRef, type ReactNode, type RefObject, type InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { ColumnPicker } from '../components/ColumnPicker';
import { FilterDropdown } from '../components/FilterDropdown';
import {
  FilterBarModeProvider,
  FilterBarViewControlsProvider,
  useFilterBarFit,
} from './filter-bar-mode';
import type { LedgerColumn } from '../lib/column-visibility';
import '../components/FilterBar.css';
import '../components/ListFilterBar.css';

/**
 * FilterBar — the ONE band that owns the filter law (card 20260930_229).
 *
 * The law (operator rulings 2026-09-27, law book §250-§255): a filter plane is
 * ONE wrapping line inside ONE toolbar card, at most TWO visual rows at every
 * width, every control as wide as the value it holds, and secondary criteria
 * fold behind one `Bộ lọc` trigger only when the width leaves no other choice.
 * Until this band existed the law was enforced forensically — an audit script
 * grepped the rendered DOM after the fact (`ui-filter-audit-20260927.mjs`) and
 * a contract test pinned the script's regexes. Here it is structural:
 *
 *   - the ROW BUDGET is the band's own measurement — `useFilterBarFit` counts
 *     the rendered rows and no consumer can opt out of the count;
 *   - the FOLD is the band's own `fold` slot — a consumer hands it criteria and
 *     the band mounts the `Bộ lọc` affordance itself (`FilterDropdown`), so a
 *     bar whose content exceeds two rows ALWAYS has something to fold into. A
 *     page cannot build the "three rows and no trigger" shape the audit used to
 *     exempt (`rowExempt`, /customers@640 was the one case).
 *
 * Consumers hand it controls; the band owns the chrome: the search shell, the
 * wrapping line, the spacer pin, the action cluster, the column picker's
 * measured placement, and the fold. DOM order IS the reading order:
 * search cell → `children` (always-inline bar items) → `fold` criteria →
 * `presets` → `quickFilters` → column picker → spacer → actions.
 *
 * `ListFilterBar` (`components/ListFilterBar.tsx`) is this component under its
 * former name — a compat alias for the surfaces this cutover has not reached
 * yet; they compose their own `FilterDropdown` as a child and keep working on
 * the same measured mode context.
 */

export interface FilterBarSearchProps {
  /** Controlled search text, passed through unmodified (whitespace included). */
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name for the search field. */
  ariaLabel: string;
  /** Focus target for a page-level shortcut (e.g. `/` or ⌘K). */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Extra attributes for the input (title, autocomplete, data-* hooks). */
  inputProps?: InputHTMLAttributes<HTMLInputElement> & Record<string, unknown>;
  /** Accessible validation popover, outside toolbar layout (role="alert"). */
  error?: string | null;
}

export interface FilterBarFoldProps {
  /**
   * The criteria the band owns. They render inline on the bar while the strip
   * still fits two rows, and collapse behind the `Bộ lọc` trigger when it does
   * not — ONE copy of each criterion exists at any moment.
   */
  criteria: ReactNode;
  /** How many of the criteria are currently applied (0 hides the badge). */
  count: number;
  /** Clear every folded criterion (`Đặt lại` in the dialog). */
  onReset: () => void;
  /** Accessible name of the trigger. */
  ariaLabel: string;
  /** Accessible name of the dialog. */
  dialogLabel?: string;
  /** Trigger text. */
  label?: string;
  /**
   * The criteria can never hold the two-row budget at any width — a surface
   * that mints one facet per zone, for instance — so the trigger is always the
   * shape and the criteria never render inline.
   */
  neverInline?: boolean;
}

export interface FilterBarProps {
  /** Text search slot — the bar owns the icon, chrome and placeholder. */
  search?: FilterBarSearchProps;
  /**
   * Bar items the strip always carries inline (the shared from/to group, a
   * status segment). Items here never fold — anything that may leave the bar
   * belongs in `fold.criteria` instead.
   */
  children?: ReactNode;
  /** The fold the band owns: criteria in, `Bộ lọc` trigger + dialog out. */
  fold?: FilterBarFoldProps;
  /**
   * Column visibility for the list this bar filters (card 20260928_193). The bar
   * hosts the picker but does not own the choice: the page resolves it (an
   * explicit user choice, else the default that hides a column only while it is
   * empty) and passes it in. Placement is the bar's own measured decision — a bar
   * item while the strip is `inline`, inside `Bộ lọc` once the width folds the
   * criteria away — so a frozen surface can never be pushed onto a third row.
   */
  columns?: FilterBarColumns;
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

export interface FilterBarColumns {
  /** The surface's columns in table order (pinned ones are not offered). */
  items: readonly LedgerColumn[];
  /** The effective hidden keys the table is rendering now. */
  hidden: readonly string[];
  /** A stored user choice exists — "Mặc định" has a default to restore. */
  customized: boolean;
  onToggle: (key: string) => void;
  onReset: () => void;
}

export function FilterBar({ search, children, fold, columns, presets, quickFilters, quickFiltersLabel, status, actions }: FilterBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const searchErrorId = useId();
  // Keep every criterion inline while the strip still fits two rows; fold them
  // into `Bộ lọc` only when the width leaves no other choice.
  const mode = useFilterBarFit(barRef);
  // The picker is ONE node in TWO possible homes: rendered here while the strip
  // is inline, and published to `FilterDropdown` (which renders it in the dialog
  // panel) once the width folds the criteria there. Exactly one instance exists
  // at any moment, so its ids and its query surface stay unambiguous.
  const columnPicker = columns ? (
    <ColumnPicker
      columns={columns.items}
      hidden={columns.hidden}
      customized={columns.customized}
      onToggle={columns.onToggle}
      onReset={columns.onReset}
    />
  ) : null;
  return (
    <FilterBarModeProvider value={mode}>
      <FilterBarViewControlsProvider value={mode === 'inline' ? null : columnPicker}>
      <div className="filter-bar filter-bar--card list-filter-bar" ref={barRef}>
        {search && (
          // Validation stays associated with this input but floats outside layout.
          <div className="filter-bar__search-cell">
            <div className="filter-bar__search" data-uui-control="input">
              <Search size={14} aria-hidden="true" />
              <input
                ref={search.inputRef}
                type="text"
                aria-label={search.ariaLabel}
                placeholder={search.placeholder}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                {...search.inputProps}
                aria-invalid={search.error ? true : search.inputProps?.['aria-invalid']}
                aria-describedby={[search.inputProps?.['aria-describedby'], search.error ? searchErrorId : undefined].filter(Boolean).join(' ') || undefined}
              />
            </div>
            {search.error ? <p id={searchErrorId} className="filter-bar__search-error" role="alert">{search.error}</p> : null}
          </div>
        )}
        {children}
        {/* THE fold (card 20260930_229): the band mounts the affordance itself,
            so a bar that exceeds its two-row budget by construction always has
            a `Bộ lọc` trigger to fold into. `FilterDropdown` renders the
            criteria as direct bar children while the measured mode is `inline`
            (or the trigger + dialog once it is not) — the consumer never
            re-derives that wiring. `neverInline` is the documented escape for a
            criterion set that cannot fit two rows at ANY width. */}
        {fold && (
          <FilterDropdown
            count={fold.count}
            label={fold.label}
            ariaLabel={fold.ariaLabel}
            dialogLabel={fold.dialogLabel}
            onReset={fold.onReset}
            inlineWhenRoom={!fold.neverInline}
          >
            {fold.criteria}
          </FilterDropdown>
        )}
        {/* The ranges ride the bar until even the folded criteria cannot hold
            two rows; then they join the criteria inside `Bộ lọc` (one copy
            either way — the page passes the same node to the dialog). */}
        {presets && mode !== 'dialog-presets' && <div className="filter-bar__presets">{presets}</div>}
        {quickFilters && (
          <div
            className="list-filter-bar__quick"
            role={quickFiltersLabel ? 'group' : undefined}
            aria-label={quickFiltersLabel}
          >
            {quickFilters}
          </div>
        )}
        {/* The column picker (card 20260928_193) is the last content item while
            the strip has room for it; once the width folds the criteria into
            `Bộ lọc` the SAME node renders in that dialog instead (published
            above), so it never becomes the item that costs a third row. */}
        {mode === 'inline' && columnPicker}
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
      </FilterBarViewControlsProvider>
    </FilterBarModeProvider>
  );
}
