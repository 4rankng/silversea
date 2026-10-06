import type { RefObject } from 'react';
import { Download, Plus, RotateCcw } from 'lucide-react';
import { FilterBar, Tabs } from '../../design-system';
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
  /** Rows the current criteria leave — the bar's `n/total khách hàng` count. */
  resultCount: number;
  concentration: CustomerConcentration;
  onExport: () => void;
  /** Card 20261006_391 — while the page's export runs, the strip's export
   *  button reports busy ("Đang xuất…") instead of staying clickable. */
  exporting?: boolean;
  onAdd: () => void;
  /** Clears exactly the strip's own criteria (search + status + tick). */
  onReset: () => void;
  hasActiveFilters: boolean;
  /** "Bỏ xe công ty" — ON drops the shipments that ran on a company vehicle.
   *  The figures are recomputed SERVER-SIDE, so the tick maps to the request,
   *  never to a client-side subtraction. */
  excludeOwnFleet: boolean;
  onExcludeOwnFleetChange: (value: boolean) => void;
}

/**
 * The `/customers` filter strip (card 20260927_152), extracted from
 * `CustomersPage` so the page stays inside its line ceiling — an option
 * adapter over the `FilterBar` band since card 20260930_229.
 *
 * The band owns the strip: this component declares no bar markup, no search
 * shell, no spacer and no control width — the page-local strip box, its two
 * rows and its 190px status width are gone with it.
 *
 * The status axis keeps BOTH of its pre-existing controls: the shared boxed
 * `Tabs` segment (with counts) rides the quick-filter slot and the labelled
 * select is handed to the band's `fold` slot. While the strip holds two rows
 * the select renders inline exactly as before; past the budget it is the bar
 * that folds it behind `Bộ lọc` — /customers@640 used to be the one surface
 * the audit could only EXEMPT from the two-row law because it had no fold
 * affordance at all. Each control carries its own label/aria name and both
 * write the same `onFilter`, so the move drops no label, control or writer.
 */
export function CustomerFilters({
  search, onSearch, searchInputRef,
  filter, onFilter,
  total, resultCount, concentration,
  onExport, exporting = false, onAdd, onReset, hasActiveFilters,
  excludeOwnFleet, onExcludeOwnFleetChange,
}: CustomerFiltersProps) {
  return (
    <FilterBar
      search={{
        value: search,
        onChange: onSearch,
        placeholder: 'Tên, mã, MST, điện thoại...',
        ariaLabel: 'Tìm khách hàng theo tên, mã, MST hoặc điện thoại',
        inputRef: searchInputRef,
        inputProps: { name: 'customerSearch' },
      }}
      quickFiltersLabel="Lọc nhanh khách hàng"
      quickFilters={(
        <Tabs variant="boxed"
          tabs={[
            { id: 'all', label: 'Tất cả', count: total },
            { id: 'active', label: 'Hoạt động' },
            { id: 'locked', label: 'Tạm khoá' },
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
          <button className="btn btn--secondary btn--sm" onClick={onExport} disabled={exporting}>
            <Download size={14} /> {exporting ? 'Đang xuất…' : 'Xuất Excel'}
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
      fold={{
        criteria: (
          <>
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
            {/* Card 20260928_177 — "Bỏ xe công ty": the accounting vocabulary
                for the own fleet is CarrierType.OWN ("Xe nhà"). Ticking it
                drops the shipment lines that ran on a company vehicle from
                each customer's freight figures; the numbers are recomputed
                SERVER-SIDE (the `excludeOwnFleet` request param), never by
                subtracting here, so the exported sheet shows the same figure.
                Card 20260930_236 ruling: the tick is a boolean CRITERION, not
                a one-click lens — per law §255 it lives in the `Bộ lọc` fold
                (inline on the bar while the strip holds two rows, behind the
                trigger when it does not), beside the status select it
                complements. Control shape unchanged: the shared `.filter-chip`
                labelled checkbox (Tailkit `a-c-form-elements-04` original
                reference, `a-c-tables-14`; Untitled UI `base/checkbox`). */}
            <label className="filter-chip">
              <input
                type="checkbox"
                checked={excludeOwnFleet}
                onChange={(event) => onExcludeOwnFleetChange(event.target.checked)}
              />
              <span>Bỏ xe công ty</span>
            </label>
          </>
        ),
        count: (filter !== 'all' ? 1 : 0) + (excludeOwnFleet ? 1 : 0),
        ariaLabel: 'Bộ lọc',
        dialogLabel: 'Bộ lọc khách hàng',
        // Đặt lại clears exactly the folded criteria (status axis + the tick);
        // the strip's own reset ("Xóa lọc") keeps clearing search + status +
        // tick unchanged.
        onReset: () => {
          onFilter('all');
          onExcludeOwnFleetChange(false);
        },
      }}
    />
  );
}
