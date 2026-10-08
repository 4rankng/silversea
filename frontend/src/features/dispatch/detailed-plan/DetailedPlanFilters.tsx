import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RotateCcw } from 'lucide-react';
import { useCoarsePointer } from '../useCoarsePointer';
import { DateRangeFields, FilterBar, InlineLabelSelect, SearchableSelect, Tabs, type DateRangeValue, type FilterBarResetScope } from '../../../design-system';
import type { TabItem } from '../../../design-system';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { businessDateISO } from '../../../lib/format';
import { useMonth } from '../../../hooks/useMonth';
import { useTripOptions } from '../../../hooks/useTripOptions';
import { createDefaultDetailedPlanFilters, type DetailedPlanFilterState } from './useDispatchDetailPlan';
import type { DispatchDetailPlanAssignmentCounts } from '../../../api/dispatchPlanningClient';
import { DispatchTimeFilterField } from './DispatchTimeFilterField';
import { useVehicleRouteOptions, VehicleDriverSelect, FleetFilterFields } from './DetailedPlanVehicleFilters';

export interface FacetItem {
  id: number;
  name: string;
}

export type FacetLoader = (q?: string) => Promise<FacetItem[]>;

interface DetailedPlanFiltersProps {
  filters: DetailedPlanFilterState;
  onChange: (patch: Partial<DetailedPlanFilterState>) => void;
  loadDeliveryPointFacets: FacetLoader;
  loadPickupPortFacets: FacetLoader;
  loadDropoffPortFacets: FacetLoader;
  /** Active zone taxonomy (code + label) from GET /dispatch-zones. */
  zones: Array<{ code: string; label: string }>;
  /** Card 20261008_3 — the two assignment chips' counts from the grid query's
   *  `assignmentStatusCounts` (full-set over the union of both branches). */
  assignmentCounts?: DispatchDetailPlanAssignmentCounts;
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

/**
 * Quick assignment scope of the strip (card 20261002_274, A07): the
 * dispatcher's most-used sweep — Tất cả / Chưa gán xe / Đã gán xe — rides the
 * band's `quickFilters` slot as the shared boxed group (law §263). It drives
 * the SAME `assignmentStatus` state as the Điều xe select inside `Bộ lọc`
 * (the presets-and-fields precedent: one state, a quick control on the bar
 * and the full select in the dialog).
 */
const ASSIGNMENT_QUICK_TABS: Array<TabItem & { countKey?: 'UNASSIGNED' | 'ASSIGNED' }> = [
  { id: 'ALL', label: 'Tất cả' },
  // Counts (card 20261008_3): full-set over the UNION of both grid branches,
  // each equal to the total clicking the chip returns. Status-tab count
  // convention (ShipmentsPage precedent) — tone rides the count: warning =
  // còn phải gán, accent = đã gán xong. '0' renders as 0, never blank.
  { id: 'UNASSIGNED', label: 'Chưa gán xe', countKey: 'UNASSIGNED', countTone: 'warning' },
  { id: 'ASSIGNED', label: 'Đã gán xe', countKey: 'ASSIGNED', countTone: 'accent' },
];

const DATA_STATUS_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'ALL_DATA_STATUS', label: 'Tất cả' },
  { id: 'COMPLETE', label: 'Đầy đủ' },
  { id: 'MISSING', label: 'Thiếu dữ liệu' },
];
import { FacetMultiSelect } from './DetailedPlanFacetMultiSelect';

/**
 * Quick day scope of the strip: Hôm nay / Hôm sau / Tất cả.
 *
 * Operator ruling 2026-09-27: the fleet-vehicle status group is THE button
 * group, so the scope uses the shared `Tabs variant="boxed"` and the app keeps
 * exactly one segmented-control shape. It sets the same day the from/to fields
 * set (`filters.date`), so it rides the bar's `presets` slot — the slot the bar
 * gives the quick ranges beside the dates they set.
 */
const DATE_SCOPE_TABS: TabItem[] = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'tomorrow', label: 'Hôm sau' },
  { id: 'all', label: 'Tất cả' },
];

/**
 * The filter plane of /dispatch-detail — an option adapter over the `FilterBar`
 * band (cards 20260927_152 / 20260930_229).
 *
 * The band's `search` slot carries the quick search, the criteria every list
 * shares (the ONE `DateRangeFields` from/to group, the quick day scope) are its
 * items, and the page's own actions — Gán xe and Xóa lọc — ride its `actions`.
 * Every criterion that is NOT shared (Khách hàng, Hướng, Điều xe, Dữ liệu,
 * Xe/Tài xế, giờ chạy, khu vực, the three điểm facet pickers, đội xe/rơ-moóc/
 * tuyến) is handed to the band's `fold` slot, which owns the `Bộ lọc` trigger,
 * the applied count and the reset — the panel the drawer used to hold, now the
 * band's dialog body.
 *
 * `neverInline` is set because this surface mints fifteen criteria plus three
 * searchable facet pickers: the set can never hold the bar's two-row budget at
 * any width. Xuất / Nhập is the fold's `primary` criterion (card 20261002_282,
 * R17): on the bar while it has room, inside the dialog once it folds.
 *
 * The page therefore declares NO filter layout of its own: one wrapping line,
 * the search the only grower, every other control as wide as the value it
 * holds, and the fold measured by the band's own engine. Behaviour is frozen —
 * same state and URL params, same Vietnamese labels and placeholders, same
 * accessible names, same reset semantics.
 */
export function DetailedPlanFilters({
  filters,
  onChange,
  loadDeliveryPointFacets,
  loadPickupPortFacets,
  loadDropoffPortFacets,
  zones,
  assignmentCounts,
}: DetailedPlanFiltersProps) {
  const [draftResetKey, setDraftResetKey] = useState(0);
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
  // range, not a preset, is then the scope's source of truth).
  const activeDateScope = filters.date === today
    ? 'today'
    : filters.date === tomorrow
      ? 'tomorrow'
      : (filters.date === '' && rangeValue.from === '' ? 'all' : '');

  // The badge is the only place a collapsed criterion announces itself, so it
  // counts every criterion behind `Bộ lọc`; the quick search and the date scope
  // are bar controls and are not part of the count (unchanged contract).
  const secondaryCount = [
    filters.zone !== '',
    filters.pickupIds.length > 0,
    filters.dropoffIds.length > 0,
    filters.deliveryPointIds.length > 0,
    filters.hourFrom !== '',
    filters.hourTo !== '',
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
  const hasActiveFilters = secondaryCount > 0
    || Boolean(filters.date || filters.dateFrom || filters.dateTo || filters.q);

  const clearFilters = () => {
    setDraftResetKey((key) => key + 1);
    onChange(createDefaultDetailedPlanFilters());
  };
  // Sweep (card 20261008_1): the reset used to disable silently when the
  // filter set was already idle — aria-described explanation.
  const clearDisabledReason = hasActiveFilters ? null : 'Không có bộ lọc nào đang áp dụng.';

  const selectDate = (date: string) => {
    // Presets and the from/to fields replace each other entirely (last writer
    // wins — card 20260922_32 lineage).
    onChange({ date, dateFrom: '', dateTo: '' });
  };

  const applyRange = (next: DateRangeValue) => {
    onChange({ date: '', dateFrom: next.from, dateTo: next.to });
  };

  /** `Đặt lại` of `Bộ lọc`: clears exactly the criteria in the dialog. The
   *  search and the date scope are bar controls and stay (`Xóa lọc` clears
   *  everything, including them).
   *
   *  Card 20261002_285 AC1: the date scope has TWO representations — the
   *  `date` preset and the `dateFrom`/`dateTo` range — and `selectDate` /
   *  `applyRange` are last-writer-wins between them. Preserving only `date`
   *  meant a preset survived the dialog reset while an identically-scoped
   *  custom range was silently wiped by it. Both now ride through. */
  const clearSecondaryFilters = (scope: FilterBarResetScope) => {
    setDraftResetKey((key) => key + 1);
    onChange({
      ...createDefaultDetailedPlanFilters(),
      q: filters.q,
      date: filters.date,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      // Card 20261002_282: while Xuất / Nhập rides the bar the dialog does not
      // show it, so its `Đặt lại` leaves it alone.
      ...(scope === 'folded' ? { direction: filters.direction } : {}),
    });
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

  const dateScope = (
    <Tabs
      tabs={DATE_SCOPE_TABS}
      value={activeDateScope}
      onChange={(id) => selectDate(id === 'today' ? today : id === 'tomorrow' ? tomorrow : '')}
      variant="boxed"
      ariaLabel="Phạm vi ngày vận chuyển"
    />
  );

  const rangeFieldsOnCoarsePointer = useCoarsePointer();

  const rangeFields = (
    <DateRangeFields
      id="detailed-plan-date-range"
      ariaLabel="Khoảng ngày vận chuyển"
      size="sm"
      from={rangeValue.from}
      to={rangeValue.to}
      onChange={applyRange}
    />
  );

  return (

    <>
      {/* Page chrome above the strip: the visible title. The filter plane below
          it is the shared bar, which owns the row layout, the control widths
          and the fold. */}
      <header className="detailed-plan-header" data-component="detailed-plan-header">
        <h1 className="detailed-plan-header__title">Kế hoạch Chi tiết Xe</h1>
      </header>

      <FilterBar
        search={{
          value: filters.q,
          onChange: (value) => onChange({ q: value }),
          placeholder: 'Bill, Cont, Tờ khai...',
          ariaLabel: 'Tìm nhanh',
          inputRef: searchInputRef,
        }}
        quickFiltersLabel="Lọc nhanh gán xe"
        quickFilters={(
          <Tabs
            tabs={ASSIGNMENT_QUICK_TABS.map(({ countKey, ...tab }) => (countKey
              ? { ...tab, count: assignmentCounts?.[countKey] ?? 0 }
              : tab))}
            value={filters.assignmentStatus || 'ALL'}
            onChange={(id) => onChange({ assignmentStatus: id === 'ALL' ? '' : id as DetailedPlanFilterState['assignmentStatus'] })}
            variant="boxed"
            ariaLabel="Lọc nhanh gán xe"
          />
        )}
        presets={dateScope}
        actions={(
          <>
            <UUIButton size="sm" color="primary" iconLeading={Plus} onPress={goAssign}>
              Gán xe
            </UUIButton>
            <DisabledActionTip id="detailed-plan-clear-filters" reason={clearDisabledReason}>
              <UUIButton
                className={'detailed-plan-filters__clear' + (hasActiveFilters ? '' : ' is-idle')}
                size="sm"
                color="tertiary"
                iconLeading={RotateCcw}
                onPress={() => { if (!hasActiveFilters) return; clearFilters(); }}
                aria-disabled={!hasActiveFilters || undefined}
                aria-label="Xóa lọc"
              >
                Xóa lọc
              </UUIButton>
            </DisabledActionTip>
          </>
        )}
        fold={{
          // Card 20261002_282 (R17): direction is a basic criterion — on the
          // bar while it has room (status rides the quick tabs, dates the
          // from/to group), inside the dialog once the width folds it.
          primary: (
            <InlineLabelSelect
              id="detailed-plan-direction"
              label="Xuất / Nhập"
              items={DIRECTION_OPTIONS}
              selectedKey={filters.direction || 'ALL_DIRECTIONS'}
              onSelectionChange={(key) => onChange({ direction: key === 'ALL_DIRECTIONS' ? '' : key as DetailedPlanFilterState['direction'] })}
              ariaLabel="Xuất / Nhập"
            />
          ),
          primaryCount: filters.direction !== '' ? 1 : 0,
          criteria: (
            <div className="detailed-plan-filter-panel">
            {/* The four quick facets live HERE, not on the bar (operator,
                2026-09-27: "why don't we group them in bộ lọc"). Four stacked
                dropdowns measured 176px of chrome above the list at 390px and
                five full-width rows in the header at every narrow width; the
                dialog keeps one home per filter at every device size. */}
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
                <div className="detailed-plan-filters__field">
                  <span className="detailed-plan-filters__label">Giờ chạy</span>
                  <div className="detailed-plan-filters__hour-inputs">
                    <DispatchTimeFilterField key={`from-${draftResetKey}`} label="Giờ từ" value={filters.hourFrom} onChange={(value) => onChange({ hourFrom: value })} />
                    <span aria-hidden="true">→</span>
                    <DispatchTimeFilterField key={`to-${draftResetKey}`} label="Giờ đến" value={filters.hourTo} onChange={(value) => onChange({ hourTo: value })} />
                  </div>
                </div>
                <div className="detailed-plan-filters__field">
                  <span className="detailed-plan-filters__label">Khu vực</span>
                  <UUISelect size="sm" aria-label="Khu vực" selectedKey={filters.zone || 'ALL_ZONES'} onSelectionChange={(key) => onChange({ zone: key === 'ALL_ZONES' ? '' : String(key) })} items={[
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
            {rangeFieldsOnCoarsePointer ? (
              <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-range">
                <h3 id="detailed-plan-filter-range" className="detailed-plan-filter-panel__title">Khoảng ngày vận chuyển</h3>
                <div className="detailed-plan-filter-panel__fields">{rangeFields}</div>
              </section>
            ) : null}
          </div>
          ),
          count: secondaryCount,
          ariaLabel: 'Bộ lọc',
          dialogLabel: 'Bộ lọc kế hoạch',
          onReset: clearSecondaryFilters,
          neverInline: true,
        }}
      >
        {!rangeFieldsOnCoarsePointer ? rangeFields : null}
      </FilterBar>
    </>
  );
}
