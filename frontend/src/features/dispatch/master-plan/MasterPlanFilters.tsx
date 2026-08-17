import { Search } from 'lucide-react';
import type { ShipmentAllocationStatus } from '../../../api/shipmentClient';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { BufferedUuiDateInput } from '../../../design-system/forms/BufferedUuiDateInput';
import type { MasterPlanFilters as FilterState } from './useDispatchMasterPlan';
import './MasterPlanGrid.css';

interface MasterPlanFiltersProps {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
}

const TRADE_DIRECTION_OPTIONS = [
  { id: 'ALL_DIRECTIONS', label: 'Tất cả' },
  { id: 'IMPORT', label: 'Nhập' },
  { id: 'EXPORT', label: 'Xuất' },
];

const ALLOCATION_OPTIONS: { id: ShipmentAllocationStatus | 'ALL_ALLOCATIONS'; label: string }[] = [
  { id: 'ALL_ALLOCATIONS', label: 'Tất cả trạng thái' },
  { id: 'NOT_ALLOCATED', label: 'Chưa phân xe' },
  { id: 'PARTIALLY_ALLOCATED', label: 'Đang phân xe' },
  { id: 'FULLY_ALLOCATED', label: 'Đã phân xong' },
];

/** Filter bar for the dispatch master-plan grid (docx §2). */
export function MasterPlanFilters({ filters, onChange }: MasterPlanFiltersProps) {
  return (
    <div className="master-plan-filters">
      <UUIInput
        className="master-plan-filters__field master-plan-filters__search"
        inputClassName="master-plan-filters__control"
        type="search"
        size="sm"
        icon={Search}
        label="Tìm kiếm"
        placeholder="Tìm theo B/L, Booking, khách hàng…"
        value={filters.q}
        onChange={(value) => onChange({ q: value })}
        aria-label="Tìm kiếm lô hàng"
      />
      <UUISelect
        className="master-plan-filters__field master-plan-filters__select"
        size="sm"
        label="Chiều hàng"
        selectedKey={filters.tradeDirection || 'ALL_DIRECTIONS'}
        onSelectionChange={(key) => onChange({
          tradeDirection: key === 'ALL_DIRECTIONS' ? '' : key as FilterState['tradeDirection'],
        })}
        items={TRADE_DIRECTION_OPTIONS}
      >
        {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
      </UUISelect>
      <UUISelect
        className="master-plan-filters__field master-plan-filters__select"
        size="sm"
        label="Phân xe"
        selectedKey={filters.allocationStatus || 'ALL_ALLOCATIONS'}
        onSelectionChange={(key) => onChange({
          allocationStatus: key === 'ALL_ALLOCATIONS' ? '' : key as FilterState['allocationStatus'],
        })}
        items={ALLOCATION_OPTIONS}
      >
        {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
      </UUISelect>
      <div className="master-plan-filters__date-range master-plan-filters__field" role="group" aria-label="Khoảng ngày giao">
        <span className="master-plan-filters__label">Ngày giao</span>
        <div className="master-plan-filters__date-inputs">
          <BufferedUuiDateInput
            className="master-plan-filters__date-input"
            inputClassName="master-plan-filters__control"
            size="sm"
            value={filters.deliveryDateFrom}
            onChange={(value) => onChange({ deliveryDateFrom: value })}
            inputProps={{ 'aria-label': 'Từ ngày giao' }}
          />
          <span className="master-plan-filters__date-sep" aria-hidden="true">→</span>
          <BufferedUuiDateInput
            className="master-plan-filters__date-input"
            inputClassName="master-plan-filters__control"
            size="sm"
            value={filters.deliveryDateTo}
            onChange={(value) => onChange({ deliveryDateTo: value })}
            inputProps={{ 'aria-label': 'Đến ngày giao' }}
          />
        </div>
      </div>
    </div>
  );
}
