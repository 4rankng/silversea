/**
 * Shared shell for the dispatcher resource-catalog views: a command strip
 * (title + status tabs + primary action), then the ONE shared filter plane
 * (`FilterBar`), then the panel-wrapped table. Read-only chrome — mutations
 * live in the views' own modals.
 *
 * The strip used to be a page-local `.dispatch-catalogs__toolbar` flex row with
 * its own search wrapper, counter and reset (card 20260926_57). Card
 * 20260927_152 makes the shared `FilterBar` the only filter plane, so the
 * toolbar IS that bar now: the search rides the bar's own search slot, the
 * view's criteria arrive as bar children (secondary ones behind `Bộ lọc`), the
 * result counter is the `status` node and the conditional reset is the page
 * action in `actions`. The bar owns the row, the wrapping and every control
 * width, so this shell declares no filter layout of its own.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Panel } from '../../../components/UI';
import { FilterBar } from '../../../design-system';

export function CatalogTableShell({
  title,
  tabs,
  actions,
  search,
  onSearchChange,
  searchPlaceholder,
  totalLabel,
  filters,
  onReset,
  hasActiveFilters = false,
  children,
}: {
  /** Row-1 page title (rendered as the h1). Omit when the view keeps its
   * own header above the shell. */
  title?: string;
  /** Row-1 segmented status tabs (counts + one-click filtering). */
  tabs?: ReactNode;
  /** Row-1 primary action, baseline-aligned with the title. */
  actions?: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  totalLabel: string;
  /** Criteria for the bar — a direct bar child, or a `FilterDropdown` when the
   * view has secondary criteria to fold. */
  filters?: ReactNode;
  /** Conditional reset — rendered only when filters are active. */
  onReset?: () => void;
  hasActiveFilters?: boolean;
  children: ReactNode;
}) {
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K focuses the catalog search (badge on the search shell).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dispatch-catalogs">
      {(title || tabs || actions) && (
        <div className="dispatch-catalogs__strip-head">
          {title && <h1 className="dispatch-catalogs__strip-title page-header__title-visible">{title}</h1>}
          {tabs}
          {actions && <div className="dispatch-catalogs__strip-actions">{actions}</div>}
        </div>
      )}
      <FilterBar
        search={{
          value: search,
          onChange: onSearchChange,
          placeholder: searchPlaceholder,
          // The catalog search carries no visible label, so the placeholder IS
          // its accessible name (unchanged by the cutover).
          ariaLabel: searchPlaceholder,
          inputRef: searchRef,
        }}
        status={totalLabel ? <span className="dispatch-catalogs__count">{totalLabel}</span> : undefined}
        actions={onReset && hasActiveFilters ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onReset}
          >
            <RotateCcw size={13} aria-hidden="true" /> Xóa lọc
          </button>
        ) : undefined}
      >
        {filters}
      </FilterBar>
      <Panel flush>{children}</Panel>
    </div>
  );
}
