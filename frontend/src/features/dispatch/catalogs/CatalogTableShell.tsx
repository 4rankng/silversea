/**
 * Shared shell for the dispatcher resource-catalog views: a two-row command
 * strip (title + tabs + action / search + filters + docked count + reset),
 * then the panel-wrapped table. Read-only chrome — mutations live in the
 * views' own modals.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { SearchSm } from '@untitledui/icons';
import { RotateCcw } from 'lucide-react';
import { Panel } from '../../../components/UI';
import { Input } from '../../../components/untitled-ui/base/input/input';

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
          {title && <h1 className="dispatch-catalogs__strip-title">{title}</h1>}
          {tabs}
          {actions && <div className="dispatch-catalogs__strip-actions">{actions}</div>}
        </div>
      )}
      <div className="dispatch-catalogs__toolbar">
        <div className="dispatch-catalogs__search-wrap">
          <Input
            ref={searchRef}
            aria-label={searchPlaceholder}
            className="dispatch-catalogs__search"
            size="sm"
            value={search}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            icon={SearchSm}
            inputProps={{ type: 'search' }}
          />
          <kbd className="dispatch-catalogs__kbd">⌘K</kbd>
        </div>
        {filters}
        <span className="dispatch-catalogs__count">{totalLabel}</span>
        {onReset && hasActiveFilters && (
          <button
            type="button"
            className="btn btn--ghost btn--sm dispatch-catalogs__reset"
            onClick={onReset}
          >
            <RotateCcw size={13} /> Xóa lọc
          </button>
        )}
      </div>
      <Panel flush>{children}</Panel>
    </div>
  );
}
