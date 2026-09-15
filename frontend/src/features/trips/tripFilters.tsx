import { Search } from 'lucide-react';
import {
  TripStatus, TRIP_STATUS_COLORS,
  type TripDetail,
} from '@tingting/shared';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

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

const CHEVRON = (
  <svg className="filter-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const STATUS_TABS: Array<{ key: '' | TripStatus; label: string }> = [
  { key: '', label: 'Tất cả' },
  { key: TripStatus.CREATED, label: 'Mới tạo' },
  { key: TripStatus.IN_TRANSIT, label: 'Đang chạy' },
  { key: TripStatus.COMPLETED, label: 'Hoàn thành' },
  { key: TripStatus.CANCELED, label: 'Đã hủy' },
];

export function TripFiltersBar(props: TripFiltersBarProps) {
  const {
    statusCounts, statusFilter, onStatusFilter,
    searchQuery, onSearch, searching,
    truckOptions, truckFilter, onTruckFilter,
    customerOptions, customerFilter, onCustomerFilter,
  } = props;

  return (
    <div className="filters-card">
      <div className="filters-row-top">
        <div className="status-tabs">
          {STATUS_TABS.map((tab) => {
            const isAll = tab.key === '';
            const colorVar = isAll ? '#0F1A14' : TRIP_STATUS_COLORS[tab.key as TripStatus];
            const count = isAll ? statusCounts.all : statusCounts[tab.key as TripStatus];
            const isActive = statusFilter === tab.key;
            const isZero = count === 0;
            return (
              <button
                key={tab.key || 'all'}
                className={`stab-pill${isActive ? ' active' : ''}${isZero ? ' zero' : ''}`}
                onClick={() => onStatusFilter(tab.key)}
              >
                <span className="stab-dot" style={{ '--dot': colorVar } as React.CSSProperties} />
                {tab.label}
                <span className="stab-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="filters-divider" />

      <div className="filters-row-bottom">
        <div className="filters-search">
          <Search size={18} />
          <input
            type="text"
            aria-label="Tìm chuyến đi"
            placeholder="Tìm theo mã chuyến, KH, biển số, số cont"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        {searching && (
          <span className="filters-search-hint" title="Khi tìm kiếm, hệ thống bỏ qua bộ lọc tháng để tìm trên tất cả các tháng.">
            Đang tìm trên tất cả tháng
          </span>
        )}
        <label className={`filter-pill${truckFilter ? ' has-value' : ''}`}>
          <div className="filter-lbl-wrap">
            <span className="filter-lbl-cap">Phương tiện</span>
            <UuiSelectField
              label="Phương tiện"
              hideLabel
              value={truckFilter === null || truckFilter === undefined ? '' : String(truckFilter)}
              onChange={(e) => onTruckFilter(e.target.value ? Number(e.target.value) : '')}
              options={[
                { value: '', label: 'Tất cả xe' },
                ...truckOptions.map((t) => ({ value: String(t.id), label: t.licensePlate })),
              ]}
              inline
            />
          </div>
          {CHEVRON}
        </label>

        <label className={`filter-pill${customerFilter ? ' has-value' : ''}`}>
          <div className="filter-lbl-wrap">
            <span className="filter-lbl-cap">Khách hàng</span>
            <UuiSelectField
              label="Khách hàng"
              hideLabel
              value={customerFilter === null || customerFilter === undefined ? '' : String(customerFilter)}
              onChange={(e) => onCustomerFilter(e.target.value ? Number(e.target.value) : '')}
              options={[
                { value: '', label: 'Tất cả khách hàng' },
                ...customerOptions.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
              inline
            />
          </div>
          {CHEVRON}
        </label>
      </div>
    </div>
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
