import { Search } from 'lucide-react';
import type { ShipmentAllocationStatus } from '../../../api/shipmentClient';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { NativeSelect as UUINativeSelect } from '../../../components/untitled-ui/base/select/select-native';
import type { MasterPlanFilters as FilterState } from './useDispatchMasterPlan';
import './MasterPlanGrid.css';

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
      <UUIInput
        className="master-plan-filters__search"
        inputClassName="master-plan-filters__control"
        type="search"
        size="sm"
        icon={Search}
        placeholder="Tìm theo B/L, Booking, khách hàng…"
        value={filters.q}
        onChange={(value) => onChange({ q: value })}
        aria-label="Tìm kiếm lô hàng"
      />
      <UUINativeSelect
        className="master-plan-filters__select"
        selectClassName="master-plan-filters__control"
        size="sm"
        value={filters.tradeDirection}
        onChange={(event) => onChange({ tradeDirection: event.target.value as FilterState['tradeDirection'] })}
        aria-label="Chiều hàng"
        options={[
          { label: 'Tất cả', value: '' },
          { label: 'Nhập', value: 'IMPORT' },
          { label: 'Xuất', value: 'EXPORT' },
        ]}
      />
      <UUINativeSelect
        className="master-plan-filters__select"
        selectClassName="master-plan-filters__control"
        size="sm"
        value={filters.allocationStatus}
        onChange={(event) => onChange({ allocationStatus: event.target.value as FilterState['allocationStatus'] })}
        aria-label="Trạng thái phân bổ"
        options={ALLOCATION_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
      />
      <div className="master-plan-filters__date-range" role="group" aria-label="Khoảng ngày giao">
        <span className="master-plan-filters__date-label">Ngày giao</span>
        <UUIInput
          className="master-plan-filters__date-input"
          inputClassName="master-plan-filters__control"
          type="date"
          size="sm"
          value={filters.deliveryDateFrom}
          onChange={(value) => onChange({ deliveryDateFrom: value })}
          aria-label="Ngày giao từ"
        />
        <span className="master-plan-filters__date-sep" aria-hidden="true">→</span>
        <UUIInput
          className="master-plan-filters__date-input"
          inputClassName="master-plan-filters__control"
          type="date"
          size="sm"
          value={filters.deliveryDateTo}
          onChange={(value) => onChange({ deliveryDateTo: value })}
          aria-label="Ngày giao đến"
        />
      </div>
    </div>
  );
}
