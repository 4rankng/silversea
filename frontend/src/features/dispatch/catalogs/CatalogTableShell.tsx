/**
 * Shared shell for the dispatcher resource-catalog views: header search,
 * row count, panel-wrapped table. Read-only by design — no mutation
 * affordances ever render here.
 */
import type { ReactNode } from 'react';
import { SearchSm } from '@untitledui/icons';
import { Panel } from '../../../components/UI';
import { Input } from '../../../components/untitled-ui/base/input/input';

export function CatalogTableShell({
  search,
  onSearchChange,
  searchPlaceholder,
  totalLabel,
  filters,
  children,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  totalLabel: string;
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dispatch-catalogs">
      <div className="dispatch-catalogs__toolbar">
        <Input
          aria-label={searchPlaceholder}
          className="dispatch-catalogs__search"
          size="sm"
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          icon={SearchSm}
          inputProps={{ type: 'search' }}
        />
        {filters}
        <span className="dispatch-catalogs__count">{totalLabel}</span>
      </div>
      <Panel flush>{children}</Panel>
    </div>
  );
}
