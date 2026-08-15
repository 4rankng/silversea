import type { ShipmentAllocationStatus } from '../../../api/shipmentClient';
import type { MasterPlanFilters as FilterState } from './useDispatchMasterPlan';

interface MasterPlanFiltersProps {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
}

const ALLOCATION_OPTIONS: { value: ShipmentAllocationStatus | ''; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'NOT_ALLOCATED', label: 'Chưa phân xe' },
  { value: 'PARTIALLY_ALLOCATED', label: 'Đang phân xe' },
  { value: 'FULLY_ALLOCATED', label: 'Đã phân xong' },
];

/** Filter bar for the dispatch master-plan grid (docx §2). */
export function MasterPlanFilters({ filters, onChange }: MasterPlanFiltersProps) {
  return (
    <div className="master-plan-filters">
      <input
        type="search"
        className="master-plan-filters__search"
        placeholder="Tìm theo B/L, Booking, khách hàng…"
        value={filters.q}
        onChange={(event) => onChange({ q: event.target.value })}
        aria-label="Tìm kiếm lô hàng"
      />
      <select
        className="master-plan-filters__select"
        value={filters.tradeDirection}
        onChange={(event) => onChange({ tradeDirection: event.target.value as FilterState['tradeDirection'] })}
        aria-label="Chiều hàng"
      >
        <option value="">Tất cả</option>
        <option value="IMPORT">Nhập</option>
        <option value="EXPORT">Xuất</option>
      </select>
      <select
        className="master-plan-filters__select"
        value={filters.allocationStatus}
        onChange={(event) => onChange({ allocationStatus: event.target.value as FilterState['allocationStatus'] })}
        aria-label="Trạng thái phân bổ"
      >
        {ALLOCATION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <label className="master-plan-filters__date">
        <span>Ngày giao</span>
        <input
          type="date"
          value={filters.deliveryDateFrom}
          onChange={(event) => onChange({ deliveryDateFrom: event.target.value })}
          aria-label="Ngày giao từ"
        />
      </label>
      <span className="master-plan-filters__date-sep">→</span>
      <label className="master-plan-filters__date">
        <span>đến</span>
        <input
          type="date"
          value={filters.deliveryDateTo}
          onChange={(event) => onChange({ deliveryDateTo: event.target.value })}
          aria-label="Ngày giao đến"
        />
      </label>
    </div>
  );
}
