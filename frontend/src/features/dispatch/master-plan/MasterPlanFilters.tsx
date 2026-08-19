import { Check, ChevronDown, SearchLg, XClose } from '@untitledui/icons';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ShipmentAllocationStatus } from '../../../api/shipmentClient';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { BufferedUuiDateInput } from '../../../design-system/forms/BufferedUuiDateInput';
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

const ALLOCATION_OPTIONS: { id: ShipmentAllocationStatus | 'ALL_ALLOCATIONS'; label: string }[] = [
  { id: 'ALL_ALLOCATIONS', label: 'Tất cả trạng thái' },
  { id: 'NOT_ALLOCATED', label: 'Chưa phân xe' },
  { id: 'PARTIALLY_ALLOCATED', label: 'Đang phân xe' },
  { id: 'FULLY_ALLOCATED', label: 'Đã phân xong' },
];

/**
 * Searchable multi-select facet block for a zone's ports.
 *
 * Renders a dropdown trigger button. The popover holds a search input, a
 * scrollable checkbox list of options fetched lazily from `loadFacets`, and
 * a footer summary with a "clear all" action.
 */
function FacetMultiSelect({
  label,
  selected,
  onToggle,
  loadFacets,
}: {
  label: string;
  selected: number[];
  onToggle: (id: number) => void;
  loadFacets: FacetLoader;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [facetSearch, setFacetSearch] = useState('');
  const [facets, setFacets] = useState<FacetItem[]>([]);
  const [isLoadingFacets, setIsLoadingFacets] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const labelLower = label.toLowerCase();

  const closePicker = () => {
    setIsPickerOpen(false);
    setFacetSearch('');
  };

  // Lazy-load facets whenever the popover opens or the search term changes.
  useEffect(() => {
    if (!isPickerOpen) return;
    let cancelled = false;
    setIsLoadingFacets(true);
    loadFacets(facetSearch || undefined)
      .then((items) => {
        if (!cancelled) setFacets(items);
      })
      .catch(() => {
        if (!cancelled) setFacets([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFacets(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen, facetSearch]);

  // Close on outside click or Escape; restore focus to the trigger.
  useEffect(() => {
    if (!isPickerOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen]);

  const clearSelection = () => {
    selected.forEach((id) => onToggle(id));
  };

  const selectedCount = selected.length;

  return (
    <div className="master-plan-filters__facet" ref={containerRef}>
      <span className="master-plan-filters__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={`master-plan-filters__facet-trigger${selectedCount > 0 ? ' has-selection' : ''}`}
        onClick={() => setIsPickerOpen((isOpen) => !isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isPickerOpen}
        aria-controls={isPickerOpen ? listboxId : undefined}
        aria-label={`${label}${selectedCount > 0 ? ` (${selectedCount} đã chọn)` : ''}`}
      >
        <span className="master-plan-filters__facet-trigger-value">
          {selectedCount === 0
            ? `Chọn ${labelLower}…`
            : selectedCount === 1
              ? `${label} (1)`
              : `${label} (${selectedCount})`}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`master-plan-filters__facet-trigger-icon${isPickerOpen ? ' is-open' : ''}`}
        />
      </button>
      {isPickerOpen && (
        <div className="master-plan-filters__facet-picker" role="presentation">
          <div className="master-plan-filters__facet-search">
            <SearchLg aria-hidden="true" className="master-plan-filters__facet-search-icon" />
            <input
              ref={searchInputRef}
              type="search"
              className="master-plan-filters__facet-search-input"
              placeholder={`Tìm ${labelLower}…`}
              value={facetSearch}
              onChange={(event) => setFacetSearch(event.target.value)}
              aria-label={`Tìm ${labelLower}`}
              autoComplete="off"
              autoFocus
            />
            {facetSearch && (
              <button
                type="button"
                className="master-plan-filters__facet-search-clear"
                onClick={() => {
                  setFacetSearch('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Xóa tìm kiếm"
                tabIndex={-1}
              >
                <XClose aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            id={listboxId}
            className="master-plan-filters__facet-list"
            role="listbox"
            aria-label={`Danh sách ${labelLower}`}
            aria-multiselectable="true"
            aria-busy={isLoadingFacets}
          >
            {isLoadingFacets && facets.length === 0 && (
              <span className="master-plan-filters__facet-feedback" role="status">Đang tìm…</span>
            )}
            {!isLoadingFacets && facets.length === 0 && (
              <span className="master-plan-filters__facet-feedback" role="status">Không tìm thấy kết quả phù hợp.</span>
            )}
            {facets.map((facet) => {
              const isSelected = selected.includes(facet.id);
              return (
                <label
                  key={facet.id}
                  className={`master-plan-filters__facet-option${isSelected ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="master-plan-filters__facet-option-checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(facet.id)}
                    aria-label={facet.name}
                  />
                  <span className="master-plan-filters__facet-option-label">{facet.name}</span>
                  {isSelected && (
                    <Check aria-hidden="true" className="master-plan-filters__facet-option-check" />
                  )}
                </label>
              );
            })}
          </div>
          <div className="master-plan-filters__facet-footer">
            <span className="master-plan-filters__facet-footer-text">
              {selectedCount > 0
                ? `Đã chọn ${selectedCount}`
                : 'Chưa chọn'}
            </span>
            {selectedCount > 0 && (
              <button
                type="button"
                className="master-plan-filters__facet-footer-clear"
                onClick={clearSelection}
              >
                Bỏ chọn
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Carrier multi-select with fixed options (OWN, UNASSIGNED) plus async external carriers.
 */
function CarrierFacetMultiSelect({
  selected,
  onToggle,
  loadExternalCarriers,
}: {
  selected: string[];
  onToggle: (key: string) => void;
  loadExternalCarriers: () => Promise<CarrierFacetItem[]>;
}) {
  const FIXED_OPTIONS = [
    { key: 'OWN', label: 'Xe SilverSea' },
    { key: 'UNASSIGNED', label: 'Chưa điều xe' },
  ] as const;

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [facetSearch, setFacetSearch] = useState('');
  const [externalCarriers, setExternalCarriers] = useState<CarrierFacetItem[]>([]);
  const [isLoadingExternal, setIsLoadingExternal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const closePicker = () => {
    setIsPickerOpen(false);
    setFacetSearch('');
  };

  // Load external carriers when popover opens.
  useEffect(() => {
    if (!isPickerOpen) return;
    let cancelled = false;
    setIsLoadingExternal(true);
    loadExternalCarriers()
      .then((items) => {
        if (!cancelled) setExternalCarriers(items);
      })
      .catch(() => {
        if (!cancelled) setExternalCarriers([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingExternal(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isPickerOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickerOpen]);

  const clearSelection = () => {
    selected.forEach((key) => onToggle(key));
  };

  // Filter external carriers by search
  const filteredExternals = externalCarriers.filter((carrier) =>
    carrier.name.toLowerCase().includes(facetSearch.toLowerCase())
  );

  // Check if a fixed option matches search
  const matchingFixed = FIXED_OPTIONS.filter((opt) =>
    opt.label.toLowerCase().includes(facetSearch.toLowerCase())
  );

  const selectedCount = selected.length;

  return (
    <div className="master-plan-filters__facet" ref={containerRef}>
      <span className="master-plan-filters__label">Nhà xe</span>
      <button
        ref={triggerRef}
        type="button"
        className={`master-plan-filters__facet-trigger${selectedCount > 0 ? ' has-selection' : ''}`}
        onClick={() => setIsPickerOpen((isOpen) => !isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isPickerOpen}
        aria-controls={isPickerOpen ? listboxId : undefined}
        aria-label={`Nhà xe${selectedCount > 0 ? ` (${selectedCount} đã chọn)` : ''}`}
      >
        <span className="master-plan-filters__facet-trigger-value">
          {selectedCount === 0
            ? 'Chọn nhà xe…'
            : selectedCount === 1
              ? 'Nhà xe (1)'
              : `Nhà xe (${selectedCount})`}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`master-plan-filters__facet-trigger-icon${isPickerOpen ? ' is-open' : ''}`}
        />
      </button>
      {isPickerOpen && (
        <div className="master-plan-filters__facet-picker" role="presentation">
          <div className="master-plan-filters__facet-search">
            <SearchLg aria-hidden="true" className="master-plan-filters__facet-search-icon" />
            <input
              ref={searchInputRef}
              type="search"
              className="master-plan-filters__facet-search-input"
              placeholder="Tìm nhà xe…"
              value={facetSearch}
              onChange={(event) => setFacetSearch(event.target.value)}
              aria-label="Tìm nhà xe"
              autoComplete="off"
              autoFocus
            />
            {facetSearch && (
              <button
                type="button"
                className="master-plan-filters__facet-search-clear"
                onClick={() => {
                  setFacetSearch('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Xóa tìm kiếm"
                tabIndex={-1}
              >
                <XClose aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            id={listboxId}
            className="master-plan-filters__facet-list"
            role="listbox"
            aria-label="Danh sách nhà xe"
            aria-multiselectable="true"
            aria-busy={isLoadingExternal}
          >
            {facetSearch === '' || matchingFixed.length > 0 ? (
              FIXED_OPTIONS.map((option) => {
                const isSelected = selected.includes(option.key);
                return (
                  <label
                    key={option.key}
                    className={`master-plan-filters__facet-option${isSelected ? ' is-selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="master-plan-filters__facet-option-checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(option.key)}
                      aria-label={option.label}
                    />
                    <span className="master-plan-filters__facet-option-label">{option.label}</span>
                    {isSelected && (
                      <Check aria-hidden="true" className="master-plan-filters__facet-option-check" />
                    )}
                  </label>
                );
              })
            ) : null}
            {isLoadingExternal && filteredExternals.length === 0 && (
              <span className="master-plan-filters__facet-feedback" role="status">Đang tải nhà xe…</span>
            )}
            {!isLoadingExternal && facetSearch !== '' && matchingFixed.length === 0 && filteredExternals.length === 0 && (
              <span className="master-plan-filters__facet-feedback" role="status">Không tìm thấy nhà xe phù hợp.</span>
            )}
            {filteredExternals.map((carrier) => {
              const carrierKey = `EXTERNAL:${carrier.id}`;
              const isSelected = selected.includes(carrierKey);
              return (
                <label
                  key={carrier.id}
                  className={`master-plan-filters__facet-option${isSelected ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="master-plan-filters__facet-option-checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(carrierKey)}
                    aria-label={carrier.name}
                  />
                  <span className="master-plan-filters__facet-option-label">{carrier.name}</span>
                  {isSelected && (
                    <Check aria-hidden="true" className="master-plan-filters__facet-option-check" />
                  )}
                </label>
              );
            })}
          </div>
          <div className="master-plan-filters__facet-footer">
            <span className="master-plan-filters__facet-footer-text">
              {selectedCount > 0
                ? `Đã chọn ${selectedCount}`
                : 'Chưa chọn'}
            </span>
            {selectedCount > 0 && (
              <button
                type="button"
                className="master-plan-filters__facet-footer-clear"
                onClick={clearSelection}
              >
                Bỏ chọn
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toggleId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
}

function toggleKey(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((value) => value !== key) : [...list, key];
}

/** Filter bar for the dispatch master-plan grid (docx §2). Port facets are
 *  zone-scoped: one block per active zone in the DB taxonomy (label included). */
export function MasterPlanFilters({ filters, onChange, action }: MasterPlanFiltersProps) {
  const [zones, setZones] = useState<Array<{ code: string; label: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    configClient.getDispatchZones()
      .then((res) => { if (!cancelled) setZones(res.items); })
      .catch(() => { /* no zones configured → no port facet blocks */ });
    return () => { cancelled = true; };
  }, []);

  return (
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
      {zones.map((zone) => (
        <FacetMultiSelect
          key={zone.code}
          label={`Cảng ${zone.label}`}
          selected={filters.portIds}
          onToggle={(id) => onChange({ portIds: toggleId(filters.portIds, id) })}
          loadFacets={(q) => listZonePortFacets(zone.code, q).then((r) => r.items)}
        />
      ))}
      <CarrierFacetMultiSelect
        selected={filters.carrierKeys}
        onToggle={(key) => onChange({ carrierKeys: toggleKey(filters.carrierKeys, key) })}
        loadExternalCarriers={() => listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 }).then((r) => r.items)}
      />
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
      {action && <div className="master-plan-filters__actions">{action}</div>}
    </div>
  );
}
