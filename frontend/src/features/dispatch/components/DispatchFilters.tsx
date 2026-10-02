import { Tabs, type TabItem } from '../../../design-system';
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

/**
 * Status buckets for the dispatch board. The colour rides the count numeral's
 * tone — the same vocabulary `FleetVehiclesView` uses for its status group
 * (accent = healthy, info = ready to load, warning = downtime), so the meaning
 * is carried by the shared primitive instead of a bespoke per-tab dot.
 */
const FILTER_TABS: { key: FleetFilter; label: string; countTone?: TabItem['countTone'] }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'running', label: 'Đang chạy', countTone: 'accent' },
  { key: 'ready', label: 'Sẵn sàng', countTone: 'info' },
  { key: 'noassign', label: 'Chưa giao lái xe' },
  { key: 'maint', label: 'Bảo dưỡng', countTone: 'warning' },
];

/**
 * The dispatch board's status group.
 *
 * It used to be a bespoke `.filter-tabs` row of `<button className="tab">`
 * items carrying a coloured `.tab-dot` — classes no stylesheet ever defined.
 * The app-wide ruling of 2026-09-27 makes a segmented status group the shared
 * `Tabs variant="boxed"` primitive, so the group IS that primitive now: same
 * ids, same labels, same counts, same `onFilterChange` writer. The component
 * declares no layout of its own — the tablist is the container.
 */
export function DispatchFilters({ fleetFilter, fleetCounts, onFilterChange }: DispatchFiltersProps) {
  return (
    <Tabs
      tabs={FILTER_TABS.map(({ key, label, countTone }) => ({
        id: key,
        label,
        count: fleetCounts[key],
        countTone,
      }))}
      value={fleetFilter}
      onChange={(id) => onFilterChange(id as FleetFilter)}
      variant="boxed"
      ariaLabel="Lọc theo trạng thái xe"
    />
  );
}
