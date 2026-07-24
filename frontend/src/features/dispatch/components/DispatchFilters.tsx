import type { FleetFilter } from '../utils';

interface FleetCounts {
  all: number;
  running: number;
  ready: number;
  noassign: number;
  maint: number;
}

interface DispatchFiltersProps {
  fleetFilter: FleetFilter;
  fleetCounts: FleetCounts;
  onFilterChange: (filter: FleetFilter) => void;
}

/** Strip colors — shared with FleetGrid, keyed by filter */
const FILTER_COLORS: Partial<Record<FleetFilter, string>> = {
  running:  '#22C55E',
  ready:    '#3B82F6',
  maint:    '#F59E0B',
  noassign: '#94A3B8',
};

const FILTER_TABS: { key: FleetFilter; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'running', label: 'Đang chạy' },
  { key: 'ready', label: 'Sẵn sàng' },
  { key: 'noassign', label: 'Chưa giao lái xe' },
  { key: 'maint', label: 'Bảo dưỡng' },
];

export function DispatchFilters({ fleetFilter, fleetCounts, onFilterChange }: DispatchFiltersProps) {
  return (
    <div className="filter-tabs">
      {FILTER_TABS.map(({ key, label }) => {
        const dotColor = FILTER_COLORS[key];
        return (
          <button
            key={key}
            type="button"
            className={`tab${fleetFilter === key ? ' active' : ''}`}
            onClick={() => onFilterChange(key)}
          >
            {dotColor && <span className="tab-dot" style={{ background: dotColor }} />}
            {label} <span className="tc">{fleetCounts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}
