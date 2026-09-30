import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { ShipmentAllocationFilter } from '../../../api/shipmentClient';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { DateRangeFields, FilterBar, SearchableMultiSelect, type DateRangeValue } from '../../../design-system';
import { listZonePortFacets } from '../../../api/shipmentClient';
import { configClient } from '../../../api/configClient';
import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import type { MasterPlanFilters as FilterState } from './useDispatchMasterPlan';
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

/* Card 20260925_5 (PM/customer, lead ruling): "Đang phân xe" is dropped —
   partially-allocated lots wait in "Chờ phân xe"; "Chờ phân nhà xe" carries
   date-locked lots with zero carriers. Buckets are mutually exclusive (one
   lot, one bucket) so counts match grid rows exactly. */
const ALLOCATION_OPTIONS: { id: ShipmentAllocationFilter | 'ALL_ALLOCATIONS'; label: string }[] = [
  { id: 'ALL_ALLOCATIONS', label: 'Tất cả trạng thái' },
  { id: 'NOT_ALLOCATED', label: 'Chờ phân xe' },
  { id: 'PENDING_CARRIER', label: 'Chờ phân nhà xe' },
  { id: 'FULLY_ALLOCATED', label: 'Đã phân xong' },
];

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
  // Every zone picker reads and writes the ONE shared `portIds` array, so the
  // ids this zone has listed are the only way to tell its own ports from
  // another zone's. A search narrows `facets` to a subset, so the known set
  // must accumulate across loads instead of tracking the current list.
  const [knownIds, setKnownIds] = useState<ReadonlySet<number>>(() => new Set());
  const pickerId = useId();

  const applyFacets = useCallback((items: FacetItem[]) => {
    setFacets(items);
    setKnownIds((current) => {
      const next = new Set(current);
      for (const item of items) next.add(item.id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isPickerOpen) return;
    let cancelled = false;
    loadFacets()
      .then((items) => { if (!cancelled) applyFacets(items); })
      .catch(() => { if (!cancelled) setFacets([]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen, applyFacets]);

  const handleSearch = useCallback((query: string) => {
    loadFacets(query || undefined)
      .then(applyFacets)
      .catch(() => setFacets([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFacets]);

  // The zone's own slice of the shared selection, and the merge that writes it
  // back: every id this zone does not own belongs to a sibling picker and is
  // carried through untouched, so one zone's edit can never clear another's.
  const zoneValues = selected.filter((id) => knownIds.has(id)).map(String);
  const handleChange = (values: string[]) => {
    const foreign = selected.filter((id) => !knownIds.has(id));
    onSelectionChange([...new Set([...foreign, ...values.map(Number)])]);
  };

  return (
    <div className="master-plan-filters__facet">
      <span className="master-plan-filters__label">{label}</span>
      <SearchableMultiSelect
        id={pickerId}
        values={zoneValues}
        onChange={handleChange}
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

/** Filter bar for the dispatch master-plan grid (docx §2). Port facets are
 *  zone-scoped: one block per active zone in the DB taxonomy (label included).
 *
 *  An option adapter over the `FilterBar` band (card 20260930_229): the strip
 *  carries the criteria every list shares — search, the from/to date group, the
 *  page's own action — and every master-plan criterion beyond them (Xuất/Nhập,
 *  Phân xe, the zone facets, Nhà xe) is handed to the band's `fold` slot, which
 *  owns the `Bộ lọc` trigger, the applied count it reports and the reset. The
 *  criteria never render inline here (`neverInline`): this surface mints one
 *  facet per active dispatch zone, so the set can never hold the bar's two-row
 *  budget at any width. */
export function MasterPlanFilters({ filters, onChange, action }: MasterPlanFiltersProps) {
  const [zones, setZones] = useState<Array<{ code: string; label: string; showPortFacet?: boolean }>>([]);
  const [zonesError, setZonesError] = useState(false);
  const rangeValue: DateRangeValue = {
    from: filters.deliveryDateFrom,
    to: filters.deliveryDateTo,
  };
  const applyRange = (next: DateRangeValue) => {
    onChange({ deliveryDateFrom: next.from, deliveryDateTo: next.to });
  };
  // The criteria behind `Bộ lọc`: the count feeds the trigger badge and `Đặt
  // lại` clears exactly these. The delivery dates are NOT among them — they are
  // the bar's own control now, and the field itself clears its value.
  const secondaryCount = [
    filters.tradeDirection !== '',
    filters.allocationStatus !== '',
    filters.portIds.length > 0,
    filters.carrierKeys.length > 0,
  ].filter(Boolean).length;

  const clearSecondaryFilters = () => {
    onChange({
      tradeDirection: '',
      allocationStatus: '',
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

  const visibleZones = zones.filter((zone) => zone.showPortFacet !== false);

  return (
    <FilterBar
      search={{
        value: filters.q,
        onChange: (value) => onChange({ q: value }),
        placeholder: 'Tìm theo B/L, Booking, khách hàng…',
        ariaLabel: 'Tìm kiếm lô hàng',
      }}
      actions={action}
      fold={{
        criteria: (
          <>
            <UUISelect
              size="sm"
              label="Xuất / Nhập"
              selectedKey={filters.tradeDirection || 'ALL_DIRECTIONS'}
              onSelectionChange={(key) => onChange({
                tradeDirection: key === 'ALL_DIRECTIONS' ? '' : key as FilterState['tradeDirection'],
              })}
              items={TRADE_DIRECTION_OPTIONS}
            >
              {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
            </UUISelect>
            <UUISelect
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
            <CarrierFacetMultiSelect
              selected={filters.carrierKeys}
              onSelectionChange={(keys) => onChange({ carrierKeys: keys })}
              loadExternalCarriers={() => listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 }).then((r) => r.items)}
            />
            {zonesError && (
              <span className="master-plan-filters__zones-error" role="status">
                Không tải được khu vực cảng — thử lại sau.
              </span>
            )}
          </>
        ),
        count: secondaryCount,
        ariaLabel: 'Bộ lọc',
        dialogLabel: 'Bộ lọc kế hoạch tổng quát',
        onReset: clearSecondaryFilters,
        neverInline: true,
      }}
    >
      <DateRangeFields
        className="master-plan-filters__date-range"
        id="master-plan-delivery-date-range"
        ariaLabel="Khoảng ngày giao"
        size="sm"
        from={rangeValue.from}
        to={rangeValue.to}
        onChange={applyRange}
      />
    </FilterBar>
  );
}
