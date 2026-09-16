import { FilterLines, SearchLg } from '@untitledui/icons';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ShipmentAllocationStatus } from '../../../api/shipmentClient';
import { Drawer } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { BufferedUuiDateInput } from '../../../design-system/forms/BufferedUuiDateInput';
import { SearchableMultiSelect } from '../../../design-system';
import { listZonePortFacets } from '../../../api/shipmentClient';
import { configClient } from '../../../api/configClient';
import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import type { MasterPlanFilters as FilterState } from './useDispatchMasterPlan';
import { businessDateISO } from '../../../lib/format';
import './MasterPlanGrid.css';

interface MasterPlanFiltersProps {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  /** Page-level action kept in the same operational toolbar as the filters. */
  action?: ReactNode;
}

export interface FacetItem {
  id: number;
  name: string;
}

type FacetLoader = (q?: string) => Promise<FacetItem[]>;

interface CarrierFacetItem extends FacetItem {
  isActive?: boolean;
}

const TRADE_DIRECTION_OPTIONS = [
  { id: 'ALL_DIRECTIONS', label: 'Tất cả' },
  { id: 'IMPORT', label: 'Nhập' },
  { id: 'EXPORT', label: 'Xuất' },
];

const ALLOCATION_OPTIONS: { id: ShipmentAllocationStatus | 'ALL_ALLOCATIONS'; label: string }[] = [
  { id: 'ALL_ALLOCATIONS', label: 'Tất cả trạng thái' },
  { id: 'NOT_ALLOCATED', label: 'Chờ phân xe' },
  { id: 'PARTIALLY_ALLOCATED', label: 'Đang phân xe' },
  { id: 'FULLY_ALLOCATED', label: 'Đã phân xong' },
];

function toISODate(d: Date): string {
  // Pin the business timezone — "Hôm nay/Hôm sau" must follow the Vietnam
  // calendar day the CUS-entered delivery dates compare against, not the
  // viewer machine's day.
  return businessDateISO(d);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + n);
  return result;
}

function QuickDateActions({ filters, onChange }: Pick<MasterPlanFiltersProps, 'filters' | 'onChange'>) {
  const now = new Date();
  const today = toISODate(now);
  const tomorrow = toISODate(addDays(now, 1));
  const isAllDates = !filters.deliveryDateFrom && !filters.deliveryDateTo;
  const isToday = filters.deliveryDateFrom === today && filters.deliveryDateTo === today;
  const isTomorrow = filters.deliveryDateFrom === tomorrow && filters.deliveryDateTo === tomorrow;

  return (
    <div className="master-plan-filters__date-actions">
      <UUIButton
        className={`master-plan-filters__date-action${isAllDates ? ' is-active' : ''}`}
        size="sm"
        color="secondary"
        onPress={() => onChange({ deliveryDateFrom: '', deliveryDateTo: '' })}
        aria-pressed={isAllDates}
      >
        Tất cả các ngày
      </UUIButton>
      <UUIButton
        className={`master-plan-filters__date-action${isToday ? ' is-active' : ''}`}
        size="sm"
        color="secondary"
        onPress={() => {
          onChange({ deliveryDateFrom: today, deliveryDateTo: today });
        }}
        aria-pressed={isToday}
      >
        Hôm nay
      </UUIButton>
      <UUIButton
        className={`master-plan-filters__date-action${isTomorrow ? ' is-active' : ''}`}
        size="sm"
        color="secondary"
        onPress={() => {
          onChange({ deliveryDateFrom: tomorrow, deliveryDateTo: tomorrow });
        }}
        aria-pressed={isTomorrow}
      >
        Hôm sau
      </UUIButton>
    </div>
  );
}

/**
 * Searchable multi-select facet picker backed by the shared
 * `SearchableMultiSelect` (portal + flip positioning from the dropdown-flip
 * sweep, so a bottom-of-screen picker can never cover lower controls).
 *
 * Facets lazy-load once per popover open; the picker's search input
 * refetches server-side (debounced) and filters the returned rows locally.
 * The trigger's accessible name stays exactly the zone label — the contract
 * the grid tests assert.
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
  const pickerId = useId();

  useEffect(() => {
    if (!isPickerOpen) return;
    let cancelled = false;
    loadFacets()
      .then((items) => { if (!cancelled) setFacets(items); })
      .catch(() => { if (!cancelled) setFacets([]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen]);

  const handleSearch = useCallback((query: string) => {
    loadFacets(query || undefined)
      .then((items) => setFacets(items))
      .catch(() => setFacets([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="master-plan-filters__facet">
      <span className="master-plan-filters__label">{label}</span>
      <SearchableMultiSelect
        id={pickerId}
        values={selected.map(String)}
        onChange={(values) => onSelectionChange(values.map(Number))}
        options={facets.map((facet) => ({ value: String(facet.id), label: facet.name }))}
        placeholder={label}
        searchPlaceholder={`Tìm ${label.toLowerCase()}…`}
        emptyMessage="Không tìm thấy kết quả phù hợp."
        size="sm"
        clearAllLabel="Bỏ chọn"
        onOpenChange={setIsPickerOpen}
        onSearchChange={handleSearch}
      />
    </div>
  );
}

/**
 * Carrier multi-select (fixed OWN/UNASSIGNED options + async external
 * carriers), backed by `SearchableMultiSelect` like the port facets.
 */
function CarrierFacetMultiSelect({
  selected,
  onSelectionChange,
  loadExternalCarriers,
}: {
  selected: string[];
  onSelectionChange: (keys: string[]) => void;
  loadExternalCarriers: () => Promise<CarrierFacetItem[]>;
}) {
  const FIXED_OPTIONS = [
    { key: 'OWN', label: 'Xe SilverSea' },
    { key: 'UNASSIGNED', label: 'Chờ phân xe' },
  ] as const;

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [externalCarriers, setExternalCarriers] = useState<CarrierFacetItem[]>([]);
  const pickerId = useId();

  // Load external carriers once per popover open; the picker's search
  // filters the loaded list locally.
  useEffect(() => {
    if (!isPickerOpen) return;
    let cancelled = false;
    loadExternalCarriers()
      .then((items) => { if (!cancelled) setExternalCarriers(items); })
      .catch(() => { if (!cancelled) setExternalCarriers([]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen]);

  const options = [
    ...FIXED_OPTIONS.map((option) => ({ value: option.key, label: option.label })),
    ...externalCarriers.map((carrier) => ({ value: `EXTERNAL:${carrier.id}`, label: carrier.name })),
  ];

  return (
    <div className="master-plan-filters__facet">
      <span className="master-plan-filters__label">Nhà xe</span>
      <SearchableMultiSelect
        id={pickerId}
        values={selected}
        onChange={onSelectionChange}
        options={options}
        placeholder="Nhà xe"
        searchPlaceholder="Tìm nhà xe…"
        emptyMessage="Không tìm thấy nhà xe phù hợp."
        size="sm"
        clearAllLabel="Bỏ chọn"
        onOpenChange={setIsPickerOpen}
      />
    </div>
  );
}

function portZoneFacetLabel(zoneLabel: string): string {
  return /^cảng/iu.test(zoneLabel.normalize('NFC')) ? zoneLabel : `Cảng ${zoneLabel}`;
}

// Awaiting customer confirmation: these two broad zone facets belong on the
// detail screen instead of the master-plan filter toolbar. Match the rendered
// label so equivalent Unicode forms from the database stay hidden together.
const TEMPORARILY_HIDDEN_PORT_ZONE_FACETS = new Set(['Cảng Lạch Huyện', 'Cảng Hải Phòng']);

function isTemporarilyHiddenPortZoneFacet(zoneLabel: string): boolean {
  return TEMPORARILY_HIDDEN_PORT_ZONE_FACETS.has(portZoneFacetLabel(zoneLabel).normalize('NFC'));
}

/** Filter bar for the dispatch master-plan grid (docx §2). Port facets are
 *  zone-scoped: one block per active zone in the DB taxonomy (label included). */
export function MasterPlanFilters({ filters, onChange, action }: MasterPlanFiltersProps) {
  const [zones, setZones] = useState<Array<{ code: string; label: string }>>([]);
  const [zonesError, setZonesError] = useState(false);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const drawerContentRef = useRef<HTMLDivElement>(null);
  const [dateResetKey, setDateResetKey] = useState(0);
  const applyDrawerFilters = () => {
    const invalid = drawerContentRef.current?.querySelector<HTMLInputElement>('input:invalid');
    if (invalid) {
      invalid.focus();
      invalid.reportValidity();
      return;
    }
    setIsFilterDrawerOpen(false);
  };
  const changeDatePreset = (patch: Partial<FilterState>) => {
    setDateResetKey((key) => key + 1);
    onChange(patch);
  };
  const activeDrawerFilterCount = [
    filters.allocationStatus,
    filters.deliveryDateFrom,
    filters.deliveryDateTo,
    filters.portIds.length > 0,
    filters.carrierKeys.length > 0,
  ].filter(Boolean).length;

  const clearDrawerFilters = () => {
    setDateResetKey((key) => key + 1);
    onChange({
      allocationStatus: '',
      deliveryDateFrom: '',
      deliveryDateTo: '',
      portIds: [],
      carrierKeys: [],
    });
  };

  useEffect(() => {
    let cancelled = false;
    configClient.getDispatchZones()
      .then((res) => { if (!cancelled) { setZones(res.items); setZonesError(false); } })
      .catch(() => {
        // No zone blocks on failure, but say so — a silent drop would read as
        // "feature disappeared" instead of a load error.
        if (!cancelled) setZonesError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const visibleZones = zones.filter((zone) => !isTemporarilyHiddenPortZoneFacet(zone.label));

  return (
    <>
      <div className="master-plan-filters">
        <UUIInput
          className="master-plan-filters__field master-plan-filters__search"
          inputClassName="master-plan-filters__control"
          type="search"
          size="sm"
          icon={SearchLg}
          label="Tìm kiếm"
          placeholder="Tìm theo B/L, Booking, khách hàng…"
          value={filters.q}
          onChange={(value) => onChange({ q: value })}
          aria-label="Tìm kiếm lô hàng"
        />
        <UUISelect
          className="master-plan-filters__field master-plan-filters__select master-plan-filters__direction"
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
        <div className="master-plan-filters__advanced-fields">
          <UUISelect
            className="master-plan-filters__field master-plan-filters__select master-plan-filters__allocation"
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
          {visibleZones.map((zone) => (
            <FacetMultiSelect
              key={zone.code}
              label={portZoneFacetLabel(zone.label)}
              selected={filters.portIds}
              onSelectionChange={(ids) => onChange({ portIds: ids })}
              loadFacets={(q) => listZonePortFacets(zone.code, q).then((r) => r.items)}
            />
          ))}
          {zonesError && (
            <span className="master-plan-filters__zones-error" role="status">
              Không tải được khu vực cảng — thử lại sau.
            </span>
          )}
          <CarrierFacetMultiSelect
            selected={filters.carrierKeys}
            onSelectionChange={(keys) => onChange({ carrierKeys: keys })}
            loadExternalCarriers={() => listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 }).then((r) => r.items)}
          />
          <div className="master-plan-filters__date-range master-plan-filters__field" role="group" aria-label="Khoảng ngày giao">
            <span className="master-plan-filters__label">Ngày giao</span>
            <div className="master-plan-filters__date-inputs">
              <BufferedUuiDateInput
                className="master-plan-filters__date-input"
                inputClassName="master-plan-filters__control"
                size="sm"
                key={`from-${dateResetKey}`} max={filters.deliveryDateTo || undefined} value={filters.deliveryDateFrom}
                onChange={(value) => onChange({ deliveryDateFrom: value })}
                inputProps={{ 'aria-label': 'Từ ngày giao' }}
              />
              <span className="master-plan-filters__date-sep" aria-hidden="true">→</span>
              <BufferedUuiDateInput
                className="master-plan-filters__date-input"
                inputClassName="master-plan-filters__control"
                size="sm"
                key={`to-${dateResetKey}`} min={filters.deliveryDateFrom || undefined} value={filters.deliveryDateTo}
                onChange={(value) => onChange({ deliveryDateTo: value })}
                inputProps={{ 'aria-label': 'Đến ngày giao' }}
              />
            </div>
            <QuickDateActions filters={filters} onChange={changeDatePreset} />
          </div>
        </div>
        <UUIButton
          className="master-plan-filters__advanced-trigger"
          size="sm"
          color="secondary"
          iconLeading={FilterLines}
          onPress={() => setIsFilterDrawerOpen(true)}
          aria-label={activeDrawerFilterCount > 0 ? `Bộ lọc, ${activeDrawerFilterCount} đang áp dụng` : 'Bộ lọc'}
        >
          Bộ lọc
          {activeDrawerFilterCount > 0 && <span className="master-plan-filters__count" aria-hidden="true">{activeDrawerFilterCount}</span>}
        </UUIButton>
        {action && <div className="master-plan-filters__actions">{action}</div>}
      </div>

      <Drawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        title="Bộ lọc kế hoạch tổng quát"
        subtitle={activeDrawerFilterCount > 0 ? `${activeDrawerFilterCount} điều kiện đang áp dụng` : `Lọc theo trạng thái, ngày giao${visibleZones.length ? ', cảng' : ''} và nhà xe`}
        className="master-plan-filters__drawer"
        footer={(
          <>
            <UUIButton size="sm" color="secondary" onPress={clearDrawerFilters}>Đặt lại</UUIButton>
            <UUIButton size="sm" color="primary" onPress={applyDrawerFilters}>Xem kết quả</UUIButton>
          </>
        )}
      >
        <div ref={drawerContentRef} className="master-plan-filters__drawer-content">
          <section className="master-plan-filters__drawer-group" aria-labelledby="master-plan-filter-allocation">
            <h3 id="master-plan-filter-allocation" className="master-plan-filters__drawer-title">Phân xe và ngày giao</h3>
            <div className="master-plan-filters__drawer-fields">
              <UUISelect
                className="master-plan-filters__field master-plan-filters__select master-plan-filters__allocation"
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
                  <BufferedUuiDateInput className="master-plan-filters__date-input" inputClassName="master-plan-filters__control" size="sm" key={`from-${dateResetKey}`} max={filters.deliveryDateTo || undefined} value={filters.deliveryDateFrom} onChange={(value) => onChange({ deliveryDateFrom: value })} inputProps={{ 'aria-label': 'Từ ngày giao' }} />
                  <span className="master-plan-filters__date-sep" aria-hidden="true">→</span>
                  <BufferedUuiDateInput className="master-plan-filters__date-input" inputClassName="master-plan-filters__control" size="sm" key={`to-${dateResetKey}`} min={filters.deliveryDateFrom || undefined} value={filters.deliveryDateTo} onChange={(value) => onChange({ deliveryDateTo: value })} inputProps={{ 'aria-label': 'Đến ngày giao' }} />
                </div>
                <QuickDateActions filters={filters} onChange={changeDatePreset} />
              </div>
            </div>
          </section>
          <section className="master-plan-filters__drawer-group" aria-labelledby="master-plan-filter-location">
            <h3 id="master-plan-filter-location" className="master-plan-filters__drawer-title">{visibleZones.length ? 'Cảng và nhà xe' : 'Nhà xe'}</h3>
            <div className="master-plan-filters__drawer-fields">
              {visibleZones.map((zone) => (
                <FacetMultiSelect key={zone.code} label={portZoneFacetLabel(zone.label)} selected={filters.portIds} onSelectionChange={(ids) => onChange({ portIds: ids })} loadFacets={(q) => listZonePortFacets(zone.code, q).then((r) => r.items)} />
              ))}
              <CarrierFacetMultiSelect selected={filters.carrierKeys} onSelectionChange={(keys) => onChange({ carrierKeys: keys })} loadExternalCarriers={() => listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 }).then((r) => r.items)} />
              {zonesError && <span className="master-plan-filters__zones-error" role="status">Không tải được khu vực cảng — thử lại sau.</span>}
            </div>
          </section>
        </div>
      </Drawer>
    </>
  );
}
