/**
 * Shared shell for the dispatcher resource-catalog views: header search,
 * row count, panel-wrapped table. Read-only by design — no mutation
 * affordances ever render here.
 */
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Panel } from '../../../components/UI';

export function CatalogTableShell({
  search,
  onSearchChange,
  searchPlaceholder,
  totalLabel,
  children,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  totalLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="dispatch-catalogs">
      <div className="dispatch-catalogs__toolbar">
        <label className="dispatch-catalogs__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </label>
        <span className="dispatch-catalogs__count">{totalLabel}</span>
      </div>
      <Panel flush>{children}</Panel>
    </div>
  );
}
