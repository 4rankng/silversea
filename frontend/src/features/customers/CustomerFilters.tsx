import type { RefObject } from 'react';
import { Download, Loader2, Plus, RotateCcw } from 'lucide-react';
import { FilterBar, Tabs, type TabItem } from '../../design-system';

/** The status axis of `/customers`; both of its controls write this one value. */
export type CustomerFilterKey = 'all' | 'locked' | 'active' | 'risk';

/**
 * The `/customers` toolbar (SIL-169 consult verdict 24/10): ONE 44px row —
 * segmented status tabs with counts on the left of the actions, the search
 * shell, an icon-only export and the primary add button. The former status
 * select is retired: the tab segment owns the whole status axis (Tất cả /
 * Rủi ro cao / Hoạt động, plus Tạm khoá only while it has rows — a zero tab is
 * dead weight), and the "Bỏ xe công ty" tick stays the band's one folded
 * criterion. The strip's former `n/total` line is retired with it — the tab
 * counts and the pagination carry the same numbers.
 *
 * Still the shared `FilterBar` band underneath (card 20260927_152 + 20260930_
 * 229): this component declares no strip box, no search shell and no control
 * width; only the tab set and the action cluster are this surface's own.
 */
export interface CustomerFiltersProps {
  search: string;
  onSearch: (value: string) => void;
  /** Focus target for the page's ⌘K handler; the bar owns the shell it points into. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  filter: CustomerFilterKey;
  onFilter: (filter: CustomerFilterKey) => void;
  total: number;
  /** Card 071026141610 — whole-dataset per-status census from
   *  GET /customers/status-counts. Pills add up to `total`; stays undefined
   *  while in flight so no pill prints a provisional (wrong) numeral. */
  statusCounts?: { all: number; active: number; locked: number };
  /** SIL-169 — whole-dataset high-risk census from the receivables-aging
   *  projection, so the "Rủi ro cao" tab count matches the header metric.
   *  Undefined while in flight / unavailable → no numeral, never a fake 0. */
  riskCount?: number;
  onExport: () => void;
  /** Card 20261006_391 — while the page's export runs, the icon button
   *  reports busy (spinner + "Đang xuất…") instead of staying clickable. */
  exporting?: boolean;
  onAdd: () => void;
  /** Clears the strip's own criteria (search + status + tick). */
  onReset: () => void;
  hasActiveFilters: boolean;
  /** "Bỏ xe công ty" — ON drops the shipments that ran on a company vehicle.
   *  The figures are recomputed SERVER-SIDE, so the tick maps to the request,
   *  never to a client-side subtraction. */
  excludeOwnFleet: boolean;
  onExcludeOwnFleetChange: (value: boolean) => void;
}

export function CustomerFilters({
  search, onSearch, searchInputRef,
  filter, onFilter,
  total, statusCounts, riskCount,
  onExport, exporting = false, onAdd, onReset, hasActiveFilters,
  excludeOwnFleet, onExcludeOwnFleetChange,
}: CustomerFiltersProps) {
  // SIL-169 tab order per the verdict: Tất cả · Rủi ro cao · Hoạt động, and
  // "Tạm khoá" only while it counts rows — a "· 0" tab is noise the owner
  // called out. While the census is in flight nothing renders a numeral.
  const tabs: TabItem[] = [
    { id: 'all', label: 'Tất cả', count: statusCounts?.all ?? total },
    { id: 'risk', label: 'Rủi ro cao', count: riskCount, countTone: (riskCount ?? 0) > 0 ? 'warning' : undefined },
    { id: 'active', label: 'Hoạt động', count: statusCounts?.active },
  ];
  if ((statusCounts?.locked ?? 0) > 0) {
    tabs.push({ id: 'locked', label: 'Tạm khoá', count: statusCounts?.locked });
  }

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
          tabs={tabs}
          value={filter}
          onChange={(id) => onFilter(id as CustomerFilterKey)}
          ariaLabel="Lọc theo trạng thái khách hàng"
        />
      )}
      actions={(
        <>
          {/* SIL-169 verdict: icon-only 32px ghost export — the accessible
              name carries the label, the title carries the hover hint, and
              the busy state swaps the icon for the spinner + "Đang xuất…". */}
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onExport}
            disabled={exporting}
            aria-label={exporting ? 'Đang xuất…' : 'Xuất Excel'}
            title="Xuất Excel danh sách khách hàng"
          >
            {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={onAdd}>
            <Plus size={14} /> Thêm khách hàng
          </button>
          {hasActiveFilters && (
            <button type="button" className="btn btn--ghost btn--icon" onClick={onReset} aria-label="Xóa lọc" title="Xóa lọc (tìm kiếm, trạng thái, bỏ xe công ty)">
              <RotateCcw size={14} />
            </button>
          )}
        </>
      )}
      fold={{
        criteria: (
          <label className="filter-chip">
            <input
              type="checkbox"
              checked={excludeOwnFleet}
              onChange={(event) => onExcludeOwnFleetChange(event.target.checked)}
            />
            <span>Bỏ xe công ty</span>
          </label>
        ),
        count: excludeOwnFleet ? 1 : 0,
        ariaLabel: 'Bộ lọc',
        dialogLabel: 'Bộ lọc khách hàng',
        // The fold's Đặt lại clears the folded criteria only (the tick); the
        // status axis rides the tabs and search rides its own input.
        onReset: () => onExcludeOwnFleetChange(false),
      }}
    />
  );
}
