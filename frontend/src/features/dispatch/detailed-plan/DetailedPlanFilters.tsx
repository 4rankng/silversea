import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FilterLines } from '@untitledui/icons';
import { Search, RotateCcw } from 'lucide-react';
import { DateRangePopover, InlineLabelSelect, SearchableMultiSelect, SearchableSelect, type DateRangeValue } from '../../../design-system';
import { Drawer } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { businessDateISO } from '../../../lib/format';
import { useTripOptions } from '../../../hooks/useTripOptions';
import { createDefaultDetailedPlanFilters, type DetailedPlanFilterState } from './useDispatchDetailPlan';
import { DispatchTimeFilterField } from './DispatchTimeFilterField';

export interface FacetItem {
  id: number;
  name: string;
}

type FacetLoader = (q?: string) => Promise<FacetItem[]>;

interface DetailedPlanFiltersProps {
  filters: DetailedPlanFilterState;
  onChange: (patch: Partial<DetailedPlanFilterState>) => void;
  loadDeliveryPointFacets: FacetLoader;
  loadPickupPortFacets: FacetLoader;
  loadDropoffPortFacets: FacetLoader;
  /** Active zone taxonomy (code + label) from GET /dispatch-zones. */
  zones: Array<{ code: string; label: string }>;
}

const DIRECTION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'ALL_DIRECTIONS', label: 'Tất cả' },
  { id: 'IMPORT', label: 'Nhập' },
  { id: 'EXPORT', label: 'Xuất' },
];

const ASSIGNMENT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'ALL_ASSIGNMENTS', label: 'Tất cả' },
  { id: 'UNASSIGNED', label: 'Chưa điều xe' },
  { id: 'ASSIGNED', label: 'Đã điều xe' },
];

const DATA_STATUS_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'ALL_DATA_STATUS', label: 'Tất cả' },
  { id: 'COMPLETE', label: 'Đầy đủ' },
  { id: 'MISSING', label: 'Thiếu dữ liệu' },
];

/**
 * Multi-select facet block (spec §2: Điểm Nâng / Hạ / Trả), backed by the
 * shared `SearchableMultiSelect` — portal + flip positioning from the
 * dropdown-flip sweep, so the picker never clips or covers lower controls.
 */
function FacetMultiSelect({
  label,
  selected,
  onSelectionChange,
  loadFacets,
}: {
  label: string;
  selected: number[];
  onSelectionChange: (ids: number[]) => void;
  loadFacets: FacetLoader;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [facets, setFacets] = useState<FacetItem[]>([]);
  const [search, setSearch] = useState('');
  const pickerId = useId();

  useEffect(() => {
    if (!isPickerOpen) return;
    let cancelled = false;
    loadFacets(search || undefined)
      .then((items) => { if (!cancelled) setFacets(items); })
      .catch(() => { if (!cancelled) setFacets([]); });
    return () => { cancelled = true; };
  }, [isPickerOpen, search, loadFacets]);

  return (
    <div className="detailed-plan-filters__points">
      <div className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">{label}</span>
        <SearchableMultiSelect
          id={pickerId}
          values={selected.map(String)}
          onChange={(values) => onSelectionChange(values.map(Number))}
          options={facets.map((facet) => ({ value: String(facet.id), label: facet.name }))}
          placeholder={`Chọn ${label.toLowerCase()}…`}
          searchPlaceholder={`Tìm ${label.toLowerCase()}…`}
          emptyMessage="Không tìm thấy điểm phù hợp."
          selectionLabel={label.toLowerCase()}
          size="sm"
          clearAllLabel="Bỏ chọn tất cả"
          onOpenChange={(open) => {
            setIsPickerOpen(open);
            if (!open) setSearch('');
          }}
          onSearchChange={setSearch}
        />
      </div>
    </div>
  );
}

/**
 * Two-tier 80px header (card 20260926_50, supersedes the _10 filter-block):
 * Row 1 (36px) — page title + Hôm nay/Hôm sau/Tất cả preset segment directly
 * adjacent to a merged dual-calendar date-range trigger (220px, h-8); a
 * preset click updates the trigger value instantly without opening the
 * picker. Row 2 (32px) — one continuous ribbon: search (260px), Khách hàng
 * searchable combobox (w-180, trailing chevron, label integrated), Hướng /
 * Điều xe / Dữ liệu inline-label selects, the advanced-filter drawer trigger
 * (hours/zone/points), and Xóa lọc as a ghost at the tail, disabled until a
 * filter deviates from default. Labels live inside the controls.
 */
export function DetailedPlanFilters({
  filters,
  onChange,
  loadDeliveryPointFacets,
  loadPickupPortFacets,
  loadDropoffPortFacets,
  zones,
}: DetailedPlanFiltersProps) {
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [draftResetKey, setDraftResetKey] = useState(0);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const today = businessDateISO();
  const tomorrow = businessDateISO(new Date(Date.now() + 86_400_000));
  const { customers } = useTripOptions();
  const customerOptions = useMemo(
    () => customers.map((customer) => ({ value: String(customer.id), label: customer.label })),
    [customers],
  );
  const rangeValue: DateRangeValue = {
    from: filters.date || filters.dateFrom,
    to: filters.date || filters.dateTo,
  };

  const activeDrawerFilterCount = [
    filters.zone !== '',
    filters.pickupIds.length > 0,
    filters.dropoffIds.length > 0,
    filters.deliveryPointIds.length > 0,
    filters.hourFrom !== '',
    filters.hourTo !== '',
  ].filter(Boolean).length;
  const hasActiveFilters = activeDrawerFilterCount > 0
    || filters.direction !== ''
    || filters.assignmentStatus !== ''
    || filters.customerId != null
    || filters.dataStatus !== ''
    || Boolean(filters.date || filters.dateFrom || filters.dateTo || filters.q);

  const clearFilters = () => {
    setDraftResetKey((key) => key + 1);
    setIsFilterDrawerOpen(false);
    onChange(createDefaultDetailedPlanFilters());
  };

  const selectDate = (date: string) => {
    // Presets and the range popover replace each other entirely (last writer
    // wins — card 20260922_32 lineage).
    onChange({ date, dateFrom: '', dateTo: '' });
  };

  const applyRange = (next: DateRangeValue) => {
    onChange({ date: '', dateFrom: next.from, dateTo: next.to });
  };

  const clearDrawerFilters = () => {
    setDraftResetKey((key) => key + 1);
    onChange({
      ...createDefaultDetailedPlanFilters(),
      q: filters.q,
      date: filters.date,
    });
  };

  const showResults = () => {
    const invalidInput = filterPanelRef.current?.querySelector<HTMLInputElement>('input:invalid');
    if (invalidInput) {
      invalidInput.focus();
      invalidInput.reportValidity();
      return;
    }
    setIsFilterDrawerOpen(false);
  };

  return (
    <>
      <header className="detailed-plan-header" data-component="detailed-plan-header">
        <h1 className="detailed-plan-header__title">Chi tiết lô hàng</h1>
        <div className="detailed-plan-header__date" role="group" aria-label="Phạm vi ngày vận chuyển">
          <UUIButton
            className={`detailed-plan-header__preset${filters.date === today ? ' is-active' : ''}`}
            size="sm"
            color="secondary"
            onPress={() => selectDate(today)}
            aria-pressed={filters.date === today}
          >
            Hôm nay
          </UUIButton>
          <UUIButton
            className={`detailed-plan-header__preset${filters.date === tomorrow ? ' is-active' : ''}`}
            size="sm"
            color="secondary"
            onPress={() => selectDate(tomorrow)}
            aria-pressed={filters.date === tomorrow}
          >
            Hôm sau
          </UUIButton>
          <UUIButton
            className={`detailed-plan-header__preset${filters.date === '' && rangeValue.from === '' ? ' is-active' : ''}`}
            size="sm"
            color="secondary"
            onPress={() => selectDate('')}
            aria-pressed={filters.date === '' && rangeValue.from === ''}
          >
            Tất cả
          </UUIButton>
        </div>
        <DateRangePopover
          className="detailed-plan-header__range"
          id="detailed-plan-date-range"
          ariaLabel="Khoảng ngày vận chuyển"
          size="sm"
          value={rangeValue}
          onChange={applyRange}
        />
      </header>

      <div className="detailed-plan-ribbon" data-component="detailed-plan-ribbon">
        <div className="detailed-plan-ribbon__search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            aria-label="Tìm nhanh"
            placeholder="Bill, Cont, Tờ khai..."
            value={filters.q}
            onChange={(event) => onChange({ q: event.target.value })}
          />
        </div>
        <SearchableSelect
          id="detailed-plan-customer"
          className="detailed-plan-ribbon__customer"
          value={String(filters.customerId ?? '')}
          onChange={(value) => onChange({ customerId: value === '' ? null : Number(value) })}
          options={customerOptions}
          placeholder="Khách: Tất cả"
          searchPlaceholder="Tìm khách hàng…"
          emptyMessage="Không tìm thấy khách hàng phù hợp."
          clearable
          clearLabel="Khách: Tất cả"
          size="sm"
        />
        <InlineLabelSelect
          id="detailed-plan-direction"
          label="Hướng"
          items={DIRECTION_OPTIONS}
          selectedKey={filters.direction || 'ALL_DIRECTIONS'}
          onSelectionChange={(key) => onChange({ direction: key === 'ALL_DIRECTIONS' ? '' : key as DetailedPlanFilterState['direction'] })}
          ariaLabel="Chiều hàng"
        />
        <InlineLabelSelect
          id="detailed-plan-assignment"
          label="Điều xe"
          items={ASSIGNMENT_OPTIONS}
          selectedKey={filters.assignmentStatus || 'ALL_ASSIGNMENTS'}
          onSelectionChange={(key) => onChange({ assignmentStatus: key === 'ALL_ASSIGNMENTS' ? '' : key as DetailedPlanFilterState['assignmentStatus'] })}
          ariaLabel="Trạng thái điều xe"
        />
        <InlineLabelSelect
          id="detailed-plan-data-status"
          label="Dữ liệu"
          items={DATA_STATUS_OPTIONS}
          selectedKey={filters.dataStatus || 'ALL_DATA_STATUS'}
          onSelectionChange={(key) => onChange({ dataStatus: key === 'ALL_DATA_STATUS' ? '' : key as DetailedPlanFilterState['dataStatus'] })}
          ariaLabel="Trạng thái dữ liệu"
        />
        <UUIButton
          size="sm"
          color="secondary"
          iconLeading={FilterLines}
          onPress={() => setIsFilterDrawerOpen(true)}
          aria-label={activeDrawerFilterCount > 0 ? `Bộ lọc, ${activeDrawerFilterCount} đang áp dụng` : 'Bộ lọc'}
        >
          Bộ lọc
          {activeDrawerFilterCount > 0 && (
            <span className="detailed-plan-filters__count" aria-hidden="true">{activeDrawerFilterCount}</span>
          )}
        </UUIButton>
        <UUIButton
          className={'detailed-plan-filters__clear' + (hasActiveFilters ? '' : ' is-idle')}
          size="sm"
          color="tertiary"
          iconLeading={RotateCcw}
          onPress={clearFilters}
          isDisabled={!hasActiveFilters}
          aria-label="Xóa lọc"
        >
          Xóa lọc
        </UUIButton>
      </div>

      <Drawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        title="Bộ lọc kế hoạch"
        subtitle="Thu hẹp theo giờ chạy, khu vực và điểm giao nhận (Hướng/Điều xe đã dọn về ribbon)."
        className="detailed-plan-filter-drawer"
        footer={
          <>
            <UUIButton size="sm" color="secondary" onPress={clearDrawerFilters}>
              Đặt lại
            </UUIButton>
            <UUIButton size="sm" color="primary" onPress={showResults}>
              Xem kết quả
            </UUIButton>
          </>
        }
      >
        <div ref={filterPanelRef} className="detailed-plan-filter-panel">
          <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-assignment">
            <h3 id="detailed-plan-filter-assignment" className="detailed-plan-filter-panel__title">Giờ chạy và khu vực</h3>
            <div className="detailed-plan-filter-panel__fields">
              <div className="detailed-plan-filters__field detailed-plan-filters__hour">
                <span className="detailed-plan-filters__label">Giờ chạy</span>
                <div className="detailed-plan-filters__hour-inputs">
                  <DispatchTimeFilterField key={`from-${draftResetKey}`} label="Giờ từ" value={filters.hourFrom} onChange={(value) => onChange({ hourFrom: value })} />
                  <span aria-hidden="true">→</span>
                  <DispatchTimeFilterField key={`to-${draftResetKey}`} label="Giờ đến" value={filters.hourTo} onChange={(value) => onChange({ hourTo: value })} />
                </div>
              </div>
              <div className="detailed-plan-filters__field detailed-plan-filters__field--zone">
                <span className="detailed-plan-filters__label">Khu vực</span>
                <UUISelect className="detailed-plan-filters__select" size="sm" aria-label="Khu vực" selectedKey={filters.zone || 'ALL_ZONES'} onSelectionChange={(key) => onChange({ zone: key === 'ALL_ZONES' ? '' : String(key) })} items={[
                  { id: 'ALL_ZONES', label: 'Tất cả khu vực' },
                  ...zones.map((zone) => ({ id: zone.code, label: zone.label })),
                ]}>
                  {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
                </UUISelect>
              </div>
            </div>
          </section>
          <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-points">
            <h3 id="detailed-plan-filter-points" className="detailed-plan-filter-panel__title">Điểm giao nhận</h3>
            <div className="detailed-plan-filter-panel__fields">
              <FacetMultiSelect label="Điểm nâng" selected={filters.pickupIds} onSelectionChange={(ids) => onChange({ pickupIds: ids })} loadFacets={loadPickupPortFacets} />
              <FacetMultiSelect label="Điểm hạ" selected={filters.dropoffIds} onSelectionChange={(ids) => onChange({ dropoffIds: ids })} loadFacets={loadDropoffPortFacets} />
              <FacetMultiSelect label="Điểm trả" selected={filters.deliveryPointIds} onSelectionChange={(ids) => onChange({ deliveryPointIds: ids })} loadFacets={loadDeliveryPointFacets} />
            </div>
          </section>
        </div>
      </Drawer>
    </>
  );
}
