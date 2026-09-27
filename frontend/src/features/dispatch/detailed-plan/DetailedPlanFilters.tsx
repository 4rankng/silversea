import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilterLines } from '@untitledui/icons';
import { Plus, Search, RotateCcw } from 'lucide-react';
import { DateRangeFields, InlineLabelSelect, SearchableMultiSelect, SearchableSelect, Tabs, type DateRangeValue } from '../../../design-system';
import type { TabItem } from '../../../design-system';
import { Drawer } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { businessDateISO } from '../../../lib/format';
import { useMonth } from '../../../hooks/useMonth';
import { useTripOptions } from '../../../hooks/useTripOptions';
import { createDefaultDetailedPlanFilters, type DetailedPlanFilterState } from './useDispatchDetailPlan';
import { DispatchTimeFilterField } from './DispatchTimeFilterField';
import { useVehicleRouteOptions, VehicleDriverSelect, FleetFilterFields } from './DetailedPlanVehicleFilters';

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
const DATE_SCOPE_TABS: TabItem[] = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'tomorrow', label: 'Hôm sau' },
  { id: 'all', label: 'Tất cả' },
];

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { setMonthYear } = useMonth();
  const today = businessDateISO();
  const tomorrow = businessDateISO(new Date(Date.now() + 86_400_000));
  const { customers } = useTripOptions();
  const customerOptions = useMemo(
    () => customers.map((customer) => ({ value: String(customer.id), label: customer.label })),
    [customers],
  );

  const { fleetOptions, routeOptions } = useVehicleRouteOptions();
  const rangeValue: DateRangeValue = {
    from: filters.date || filters.dateFrom,
    to: filters.date || filters.dateTo,
  };
  // The group renders no active cell while a custom range is in force (the
  // range trigger, not a preset, is then the scope's source of truth).
  const activeDateScope = filters.date === today
    ? 'today'
    : filters.date === tomorrow
      ? 'tomorrow'
      : (filters.date === '' && rangeValue.from === '' ? 'all' : '');

  const activeDrawerFilterCount = [
    filters.zone !== '',
    filters.pickupIds.length > 0,
    filters.dropoffIds.length > 0,
    filters.deliveryPointIds.length > 0,
    filters.hourFrom !== '',
    filters.hourTo !== '',
  ].filter(Boolean).length;
  // The badge is the only place a collapsed filter announces itself, so it
  // counts the four quick facets too — they live in the same drawer now.
  const activeQuickFacetCount = [
    filters.customerId != null,
    filters.direction !== '',
    filters.assignmentStatus !== '',
    filters.dataStatus !== '',
    filters.truckPlate !== '',
    filters.driverId != null,
    filters.carrierClass !== '',
    filters.trailerType !== '',
    filters.routeId != null,
  ].filter(Boolean).length;
  const appliedFilterCount = activeDrawerFilterCount + activeQuickFacetCount;
  const hasActiveFilters = activeDrawerFilterCount > 0
    || filters.truckPlate !== ''
    || filters.driverId != null
    || filters.carrierClass !== ''
    || filters.trailerType !== ''
    || filters.routeId != null
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

  // ⌘K / Ctrl+K focuses the quick search (card 20260926_55).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // + Gán xe (card 20260926_55): plate assignment lives on the master plan —
  // the dispatcher lands there pre-scoped to the active date's month.
  const goAssign = () => {
    const scope = filters.date || filters.dateFrom || today;
    const [year, month] = scope.slice(0, 10).split('-').map(Number);
    if (Number.isFinite(month) && Number.isFinite(year)) setMonthYear(month, year);
    navigate('/dispatch');
  };

  return (
    <>
      <header className="detailed-plan-header" data-component="detailed-plan-header">
        {/* Two wrapper rows, `display: contents` at desk width so the four
            controls still form ONE 36px row: a single CSS grid cannot give
            row 2 its own track split — the preset group's 181px track starved
            the range trigger below it and ellipsized its mask (§4 violation,
            found by design-lock at 390px). */}
        <div className="detailed-plan-header__row">
          <h1 className="detailed-plan-header__title">Kế hoạch Chi tiết Xe</h1>
        {/* Operator ruling 2026-09-27: the fleet-vehicle status group is THE
            button group — this date scope uses the shared primitive, so the
            app has exactly one segmented-control shape. */}
        <div className="detailed-plan-header__date">
          <Tabs
            tabs={DATE_SCOPE_TABS}
            value={activeDateScope}
            onChange={(id) => selectDate(id === 'today' ? today : id === 'tomorrow' ? tomorrow : '')}
            variant="boxed"
            ariaLabel="Phạm vi ngày vận chuyển"
          />
          </div>
        </div>
        <div className="detailed-plan-header__row">
        <DateRangeFields
          className="detailed-plan-header__range"
          id="detailed-plan-date-range"
          ariaLabel="Khoảng ngày vận chuyển"
          size="sm"
          from={rangeValue.from}
          to={rangeValue.to}
          onChange={applyRange}
        />
        <UUIButton
          className="detailed-plan-header__assign"
          size="sm"
          color="primary"
          iconLeading={Plus}
          onPress={goAssign}
        >
          Gán xe
        </UUIButton>
        </div>
      </header>

      <div className="detailed-plan-ribbon" data-component="detailed-plan-ribbon">
        <div className="detailed-plan-ribbon__search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Tìm nhanh"
            placeholder="Bill, Cont, Tờ khai..."
            value={filters.q}
            onChange={(event) => onChange({ q: event.target.value })}
          />
        </div>
        <div className="detailed-plan-ribbon__actions">
          <UUIButton
            size="sm"
            color="secondary"
            iconLeading={FilterLines}
            onPress={() => setIsFilterDrawerOpen(true)}
            aria-label={appliedFilterCount > 0 ? `Bộ lọc, ${appliedFilterCount} đang áp dụng` : 'Bộ lọc'}
          >
            Bộ lọc
            {appliedFilterCount > 0 && (
              <span className="detailed-plan-filters__count" aria-hidden="true">{appliedFilterCount}</span>
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
      </div>

      <Drawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        title="Bộ lọc kế hoạch"
        subtitle="Khách, hướng, điều xe, dữ liệu, giờ chạy, khu vực và điểm giao nhận — mọi bộ lọc nằm ở đây."
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
          {/* The four quick facets live HERE, not on the ribbon (operator,
              2026-09-27: "why don't we group them in bộ lọc"). Four stacked
              dropdowns measured 176px of chrome above the list at 390px and
              five full-width rows in the header at every narrow width; the
              drawer keeps one home per filter at every device size. */}
          <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-quick">
            <h3 id="detailed-plan-filter-quick" className="detailed-plan-filter-panel__title">Bộ lọc nhanh</h3>
            <div className="detailed-plan-filter-panel__quick">
              <VehicleDriverSelect filters={filters} fleetOptions={fleetOptions} onChange={onChange} />
              <SearchableSelect
                id="detailed-plan-customer"
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
                label="Xuất / Nhập"
                items={DIRECTION_OPTIONS}
                selectedKey={filters.direction || 'ALL_DIRECTIONS'}
                onSelectionChange={(key) => onChange({ direction: key === 'ALL_DIRECTIONS' ? '' : key as DetailedPlanFilterState['direction'] })}
                ariaLabel="Xuất / Nhập"
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
            </div>
          </section>
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
          <FleetFilterFields filters={filters} routeOptions={routeOptions} onChange={onChange} />
        </div>
      </Drawer>
    </>
  );
}
