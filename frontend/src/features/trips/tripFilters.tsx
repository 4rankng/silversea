import {
  TripStatus,
  type TripDetail,
} from '@tingting/shared';
import { FilterBar, Tabs } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { FilterDropdown } from '../../components/FilterDropdown';

export interface StatusCounts {
  all: number;
  [TripStatus.CREATED]: number;
  [TripStatus.IN_TRANSIT]: number;
  [TripStatus.COMPLETED]: number;
  [TripStatus.CANCELED]: number;
}

export interface TripFiltersBarProps {
  statusCounts: StatusCounts;
  statusFilter: '' | TripStatus;
  onStatusFilter: (s: '' | TripStatus) => void;
  searchQuery: string;
  onSearch: (s: string) => void;
  searching: boolean;
  truckOptions: Array<{ id: number; licensePlate: string }>;
  truckFilter: number | '';
  onTruckFilter: (id: number | '') => void;
  customerOptions: Array<{ id: number; name: string }>;
  customerFilter: number | '';
  onCustomerFilter: (id: number | '') => void;
}

const STATUS_TABS: Array<{ key: '' | TripStatus; label: string }> = [
  { key: '', label: 'Tất cả' },
  { key: TripStatus.CREATED, label: 'Mới tạo' },
  { key: TripStatus.IN_TRANSIT, label: 'Đang chạy' },
  { key: TripStatus.COMPLETED, label: 'Hoàn thành' },
  { key: TripStatus.CANCELED, label: 'Đã hủy' },
];

/**
 * Sổ chuyến đi filter strip (card 20260927_152).
 *
 * The page-local `.filters-card` (two hand-rolled rows, a divider, pill-shaped
 * selects and a 340px search) is gone: the strip is the ONE shared
 * the `FilterBar` band, which owns the layout, the search chrome and every control
 * width, so this surface declares no filter geometry of its own.
 *
 * Which criteria are VISIBLE is measured, not declared (`filter-bar-mode.ts`):
 * while the strip fits two rows the two selects render inline on the bar and
 * only a width that leaves no other choice collapses them behind `Bộ lọc (N)`.
 */
export function TripFiltersBar(props: TripFiltersBarProps) {
  const {
    statusCounts, statusFilter, onStatusFilter,
    searchQuery, onSearch, searching,
    truckOptions, truckFilter, onTruckFilter,
    customerOptions, customerFilter, onCustomerFilter,
  } = props;

  // The two criteria behind `Bộ lọc`: the count feeds the trigger badge and
  // `Đặt lại` clears exactly those two — the status segment and the search
  // are primary and stay on the bar.
  const secondaryCount = (truckFilter ? 1 : 0) + (customerFilter ? 1 : 0);
  const resetSecondary = () => { onTruckFilter(''); onCustomerFilter(''); };

  return (
    <FilterBar
      search={{
        value: searchQuery,
        onChange: onSearch,
        placeholder: 'Tìm theo mã chuyến, KH, biển số, số cont',
        ariaLabel: 'Tìm chuyến đi',
      }}
      // The status segment rides the quick-filter slot: it is the shared
      // `Tabs variant="boxed"` (the app-wide button group), never a bespoke
      // segment, and the slot keeps it beside the search on wide bars.
      quickFilters={(
        <Tabs
          variant="boxed"
          ariaLabel="Lọc theo trạng thái chuyến"
          value={statusFilter === '' ? 'all' : statusFilter}
          onChange={(id) => onStatusFilter(id === 'all' ? '' : id as TripStatus)}
          tabs={STATUS_TABS.map((tab) => ({
            id: tab.key || 'all',
            label: tab.label,
            count: tab.key === '' ? statusCounts.all : statusCounts[tab.key as TripStatus],
          }))}
        />
      )}
      // Search bypasses the month scope, and the note saying so is a status,
      // not a criterion: it rides the bar's status slot so it can never turn
      // into a third row of its own.
      status={searching ? (
        <span
          className="filter-chip filters-search-hint"
          title="Khi tìm kiếm, hệ thống bỏ qua bộ lọc tháng để tìm trên tất cả các tháng."
        >
          Đang tìm trên tất cả tháng
        </span>
      ) : undefined}
    >
      <FilterDropdown
        count={secondaryCount}
        ariaLabel="Bộ lọc"
        dialogLabel="Bộ lọc chuyến đi"
        onReset={resetSecondary}
      >
        <UuiSelectField
          label="Phương tiện"
          wrapperClassName="trip-criterion"
          value={String(truckFilter)}
          onChange={(e) => onTruckFilter(e.target.value ? Number(e.target.value) : '')}
          options={[
            { value: '', label: 'Tất cả xe' },
            ...truckOptions.map((t) => ({ value: String(t.id), label: t.licensePlate })),
          ]}
        />
        <UuiSelectField
          label="Khách hàng"
          wrapperClassName="trip-criterion"
          value={String(customerFilter)}
          onChange={(e) => onCustomerFilter(e.target.value ? Number(e.target.value) : '')}
          options={[
            { value: '', label: 'Tất cả khách hàng' },
            ...customerOptions.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
      </FilterDropdown>
    </FilterBar>
  );
}

export function breakdownPctFromCounts(statusCounts: StatusCounts) {
  const total = statusCounts.all || 0;
  if (total === 0) return { chot: 0, htth: 0, dang: 0, moi: 0, huy: 0 };
  return {
    // "chot" (LOCKED) is gone — COMPLETED is now the terminal state. Kept as 0
    // so the breakdown-bar segment simply renders empty; the type still flows
    // through the hero legend consumer.
    chot: 0,
    htth: (statusCounts[TripStatus.COMPLETED] / total) * 100,
    dang: (statusCounts[TripStatus.IN_TRANSIT] / total) * 100,
    moi: (statusCounts[TripStatus.CREATED] / total) * 100,
    huy: (statusCounts[TripStatus.CANCELED] / total) * 100,
  };
}

export function defaultStatusCounts(): StatusCounts {
  return {
    all: 0,
    [TripStatus.CREATED]: 0,
    [TripStatus.IN_TRANSIT]: 0,
    [TripStatus.COMPLETED]: 0,
    [TripStatus.CANCELED]: 0,
  };
}

// Re-export to give feature consumers a single import point.
export type { TripDetail };
