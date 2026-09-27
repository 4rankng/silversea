import type { RefObject } from 'react';
import { Download, Plus, RotateCcw } from 'lucide-react';
import { ListFilterBar } from '../../components/ListFilterBar';
import { Tabs } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { formatCurrency } from '../../lib/format';

/** The status axis of `/customers`; both of its controls write this one value. */
export type CustomerFilterKey = 'all' | 'locked' | 'active' | 'risk';

/** Debt-concentration signal the strip reports beside the result count. */
export interface CustomerConcentration {
  top: Array<{ id: number; name: string; debt: number; share: number }>;
  topShare: number;
  anyDebt: boolean;
}

export interface CustomerFiltersProps {
  search: string;
  onSearch: (value: string) => void;
  /** Focus target for the page's ⌘K handler; the bar owns the shell it points into. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  filter: CustomerFilterKey;
  onFilter: (filter: CustomerFilterKey) => void;
  total: number;
  activeCount: number;
  lockedCount: number;
  /** Rows the current criteria leave — the bar's `n/total khách hàng` count. */
  resultCount: number;
  concentration: CustomerConcentration;
  onExport: () => void;
  onAdd: () => void;
  /** Clears exactly the strip's own criteria (search + status). */
  onReset: () => void;
  hasActiveFilters: boolean;
}

/**
 * The `/customers` filter strip (card 20260927_152), extracted from
 * `CustomersPage` so the page stays inside its line ceiling.
 *
 * The strip itself IS the shared `ListFilterBar`: this component declares no
 * bar markup, no search shell, no spacer and no control width — the page-local
 * strip box, its two rows and its 190px status width are gone with it.
 *
 * The status axis keeps BOTH of its pre-existing controls: the shared boxed
 * `Tabs` segment (with counts) rides the quick-filter slot and the labelled
 * select stays a bar criterion. Each carries its own label/aria name and both
 * write the same `onFilter`, so the move drops no label, control or writer.
 */
export function CustomerFilters({
  search, onSearch, searchInputRef,
  filter, onFilter,
  total, activeCount, lockedCount, resultCount, concentration,
  onExport, onAdd, onReset, hasActiveFilters,
}: CustomerFiltersProps) {
  return (
    <ListFilterBar
      search={{
        value: search,
        onChange: onSearch,
        placeholder: 'Tên, mã, MST, điện thoại...',
        ariaLabel: 'Tìm khách hàng theo tên, mã, MST hoặc điện thoại',
        inputRef: searchInputRef,
        inputProps: { name: 'customerSearch' },
      }}
      quickFilters={(
        <Tabs variant="boxed"
          tabs={[
            { id: 'all', label: 'Tất cả', count: total },
            { id: 'active', label: 'Hoạt động', count: activeCount, countTone: 'accent' },
            { id: 'locked', label: 'Tạm khoá', count: lockedCount, countTone: 'warning' },
          ]}
          value={filter}
          onChange={(id) => onFilter(id as CustomerFilterKey)}
          ariaLabel="Lọc theo trạng thái khách hàng"
        />
      )}
      status={(
        <>
          {concentration.anyDebt && (
            <div className="customers-strip__risk" tabIndex={0}>
              <span aria-hidden="true">⚠️</span> Top 4 KH chiếm {concentration.topShare}% công nợ
              <div className="customers-strip__risk-pop" role="tooltip">
                <strong>Công nợ tập trung — top 4 khách hàng</strong>
                {concentration.top.map((row) => (
                  <div key={row.id} className="customers-strip__risk-row">
                    <span>{row.name}</span>
                    <span className="customers-strip__risk-share">{row.share}% · {formatCurrency(row.debt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <span className="customers-strip__count">{resultCount}/{total} khách hàng</span>
        </>
      )}
      actions={(
        <>
          <button className="btn btn--secondary btn--sm" onClick={onExport}>
            <Download size={14} /> Xuất Excel
          </button>
          <button className="btn btn--primary btn--sm" onClick={onAdd}>
            <Plus size={14} /> Thêm khách hàng
          </button>
          {hasActiveFilters && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
              <RotateCcw size={13} /> Xóa lọc
            </button>
          )}
        </>
      )}
    >
      <UuiSelectField
        label="Trạng thái"
        hideLabel
        ariaLabel="Lọc theo trạng thái"
        value={filter === 'active' ? 'active' : filter === 'locked' ? 'locked' : 'all'}
        onChange={(event) => onFilter(event.target.value as CustomerFilterKey)}
        options={[
          { value: 'all', label: 'Trạng thái: tất cả' },
          { value: 'active', label: 'Trạng thái: hoạt động' },
          { value: 'locked', label: 'Trạng thái: tạm khoá' },
        ]}
      />
    </ListFilterBar>
  );
}
