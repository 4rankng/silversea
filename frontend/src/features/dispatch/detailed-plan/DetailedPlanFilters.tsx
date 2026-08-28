import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, FilterLines, SearchLg, XClose } from '@untitledui/icons';
import { Drawer } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { BufferedUuiDateInput } from '../../../design-system/forms/BufferedUuiDateInput';
import { businessDateISO } from '../../../lib/format';
import { createDefaultDetailedPlanFilters, type DetailedPlanFilterState } from './useDispatchDetailPlan';

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

const DIRECTION_OPTIONS = [
  { id: 'ALL_DIRECTIONS', label: 'Nhập/Xuất' },
  { id: 'IMPORT', label: 'Nhập' },
  { id: 'EXPORT', label: 'Xuất' },
];

const ASSIGNMENT_OPTIONS = [
  { id: 'ALL_ASSIGNMENTS', label: 'Tất cả' },
  { id: 'UNASSIGNED', label: 'Chưa gán Biển số' },
  { id: 'ASSIGNED', label: 'Đã gán Biển số' },
];

/**
 * Searchable multi-select facet block (spec §2: Điểm Nâng / Hạ / Trả).
 *
 * Renders a dropdown trigger button. The popover holds a search input, a
 * scrollable checkbox list of options fetched lazily from `loadFacets`, and
 * a footer summary with a "clear all" action. Selected items live only in
 * the popover — nothing renders on the page below the trigger.
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

  return (
    <div className="detailed-plan-filters__points" ref={containerRef}>
      <div className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">{label}</span>
        <button
          ref={triggerRef}
          type="button"
          className={`detailed-plan-filters__multi-trigger${selected.length > 0 ? ' has-selection' : ''}`}
          onClick={() => setIsPickerOpen((isOpen) => !isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isPickerOpen}
          aria-controls={isPickerOpen ? listboxId : undefined}
        >
          <span className="detailed-plan-filters__multi-trigger-value">
            {selected.length === 0
              ? `Chọn ${labelLower}…`
              : selected.length === 1
                ? `Đã chọn 1 ${labelLower}`
                : `Đã chọn ${selected.length} ${labelLower}`}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`detailed-plan-filters__multi-trigger-icon${isPickerOpen ? ' is-open' : ''}`}
          />
        </button>
      </div>
      {isPickerOpen && (
        <div className="detailed-plan-filters__point-picker" role="presentation">
          <div className="detailed-plan-filters__multi-search">
            <SearchLg aria-hidden="true" className="detailed-plan-filters__multi-search-icon" />
            <input
              ref={searchInputRef}
              type="search"
              className="detailed-plan-filters__multi-search-input"
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
                className="detailed-plan-filters__multi-search-clear"
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
            className="detailed-plan-filters__point-list"
            role="listbox"
            aria-label={`Danh sách ${labelLower}`}
            aria-multiselectable="true"
            aria-busy={isLoadingFacets}
          >
            {isLoadingFacets && facets.length === 0 && (
              <span className="detailed-plan-filters__point-feedback" role="status">Đang tìm điểm…</span>
            )}
            {!isLoadingFacets && facets.length === 0 && (
              <span className="detailed-plan-filters__point-feedback" role="status">Không tìm thấy điểm phù hợp.</span>
            )}
            {facets.map((facet) => {
              const isSelected = selected.includes(facet.id);
              return (
                <label
                  key={facet.id}
                  className={`detailed-plan-filters__point-option${isSelected ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="detailed-plan-filters__point-option-checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(facet.id)}
                    aria-label={facet.name}
                  />
                  <span className="detailed-plan-filters__point-option-label">{facet.name}</span>
                  {isSelected && (
                    <Check aria-hidden="true" className="detailed-plan-filters__point-option-check" />
                  )}
                </label>
              );
            })}
          </div>
          <div className="detailed-plan-filters__point-footer">
            <span className="detailed-plan-filters__point-footer-text">
              {selected.length > 0
                ? `Đã chọn ${selected.length}`
                : 'Chưa chọn điểm nào'}
            </span>
            {selected.length > 0 && (
              <button
                type="button"
                className="detailed-plan-filters__point-footer-clear"
                onClick={clearSelection}
              >
                Bỏ chọn tất cả
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

/** Filter bar for the dispatch detail plan grid (docx §4). */
export function DetailedPlanFilters({
  filters,
  onChange,
  loadDeliveryPointFacets,
  loadPickupPortFacets,
  loadDropoffPortFacets,
  zones,
}: DetailedPlanFiltersProps) {
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const today = businessDateISO();
  const tomorrow = businessDateISO(new Date(Date.now() + 86_400_000));
  const activeDrawerFilterCount = [
    filters.direction,
    filters.assignmentStatus,
    filters.zone !== '',
    filters.pickupIds.length > 0,
    filters.dropoffIds.length > 0,
    filters.deliveryPointIds.length > 0,
    filters.hourFrom !== '',
    filters.hourTo !== '',
  ].filter(Boolean).length;
  const activeFilterCount = activeDrawerFilterCount
    + (filters.date !== '' ? 1 : 0)
    + (filters.q.trim() !== '' ? 1 : 0);

  const clearFilters = () => {
    setIsFilterDrawerOpen(false);
    onChange(createDefaultDetailedPlanFilters());
  };

  const clearDrawerFilters = () => {
    onChange({
      ...createDefaultDetailedPlanFilters(),
      q: filters.q,
      date: filters.date,
    });
  };

  return (
    <section className="detailed-plan-filters" aria-label="Bộ lọc kế hoạch chi tiết">
      <span className="detailed-plan-filters__status" aria-live="polite">
        {activeFilterCount > 0 ? `Đang lọc ${activeFilterCount} điều kiện` : 'Chưa áp dụng bộ lọc'}
      </span>
      <label className="detailed-plan-filters__field detailed-plan-filters__field--search">
        <span className="detailed-plan-filters__label">Tìm nhanh</span>
        <UUIInput
          type="search"
          className="detailed-plan-filters__search"
          placeholder="Bill, khách hàng, container…"
          value={filters.q}
          onChange={(value) => onChange({ q: value })}
          size="sm"
          aria-label="Tìm nhanh"
        />
      </label>
      <div className="detailed-plan-filters__date-scope">
        <span className="detailed-plan-filters__label">Ngày vận chuyển</span>
        <div className="detailed-plan-filters__date-scope-controls">
          <BufferedUuiDateInput
            className="detailed-plan-filters__date"
            value={filters.date}
            onChange={(value) => onChange({ date: value })}
            size="sm"
            aria-label="Ngày vận chuyển"
          />
          <div className="detailed-plan-filters__date-mode" role="group" aria-label="Phạm vi ngày vận chuyển">
            <UUIButton
              className={`detailed-plan-filters__date-shortcut${filters.date === today ? ' is-active' : ''}`}
              size="sm"
              color="secondary"
              onPress={() => onChange({ date: today })}
              aria-label="Hôm nay"
              aria-pressed={filters.date === today}
              iconLeading={filters.date === today ? <Check aria-hidden="true" /> : undefined}
            >
              Hôm nay
            </UUIButton>
            <UUIButton
              className={`detailed-plan-filters__date-shortcut${filters.date === tomorrow ? ' is-active' : ''}`}
              size="sm"
              color="secondary"
              onPress={() => onChange({ date: tomorrow })}
              aria-label="Hôm sau"
              aria-pressed={filters.date === tomorrow}
              iconLeading={filters.date === tomorrow ? <Check aria-hidden="true" /> : undefined}
            >
              Hôm sau
            </UUIButton>
            <UUIButton
              className={`detailed-plan-filters__date-shortcut${filters.date === '' ? ' is-active' : ''}`}
              size="sm"
              color="secondary"
              onPress={() => onChange({ date: '' })}
              aria-label="Tất cả ngày"
              aria-pressed={filters.date === ''}
              iconLeading={filters.date === '' ? <Check aria-hidden="true" /> : undefined}
            >
              Tất cả ngày
            </UUIButton>
          </div>
        </div>
      </div>
      <div className="detailed-plan-filters__toolbar-actions">
        <UUIButton
          className="detailed-plan-filters__drawer-trigger"
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
        {activeFilterCount > 0 && (
          <UUIButton
            className="detailed-plan-filters__clear"
            size="xs"
            color="tertiary"
            iconLeading={XClose}
            onPress={clearFilters}
          >
            Xóa tất cả
          </UUIButton>
        )}
      </div>
      <Drawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        title="Bộ lọc kế hoạch"
        subtitle="Thu hẹp danh sách theo phân xe và điểm giao nhận."
        className="detailed-plan-filter-drawer"
        footer={
          <>
            <UUIButton
              size="sm"
              color="secondary"
              onPress={clearDrawerFilters}
              isDisabled={activeDrawerFilterCount === 0}
            >
              Đặt lại
            </UUIButton>
            <UUIButton size="sm" color="primary" onPress={() => setIsFilterDrawerOpen(false)}>
              Xem kết quả
            </UUIButton>
          </>
        }
      >
        <div className="detailed-plan-filter-panel">
          <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-assignment">
            <h3 id="detailed-plan-filter-assignment" className="detailed-plan-filter-panel__title">Phân xe và giờ chạy</h3>
            <div className="detailed-plan-filter-panel__fields">
              <div className="detailed-plan-filters__field detailed-plan-filters__field--direction">
                <span className="detailed-plan-filters__label">Chiều hàng</span>
                <UUISelect className="detailed-plan-filters__select" size="sm" aria-label="Chiều hàng" selectedKey={filters.direction || 'ALL_DIRECTIONS'} onSelectionChange={(key) => onChange({ direction: key === 'ALL_DIRECTIONS' ? '' : key as DetailedPlanFilterState['direction'] })} items={DIRECTION_OPTIONS}>
                  {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
                </UUISelect>
              </div>
              <div className="detailed-plan-filters__field detailed-plan-filters__field--assignment">
                <span className="detailed-plan-filters__label">Phân xe</span>
                <UUISelect className="detailed-plan-filters__select" size="sm" aria-label="Phân xe" selectedKey={filters.assignmentStatus || 'ALL_ASSIGNMENTS'} onSelectionChange={(key) => onChange({ assignmentStatus: key === 'ALL_ASSIGNMENTS' ? '' : key as DetailedPlanFilterState['assignmentStatus'] })} items={ASSIGNMENT_OPTIONS}>
                  {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
                </UUISelect>
              </div>
              <div className="detailed-plan-filters__field detailed-plan-filters__hour">
                <span className="detailed-plan-filters__label">Giờ chạy</span>
                <div className="detailed-plan-filters__hour-inputs">
                  <UUIInput type="time" className="detailed-plan-filters__hour-control" value={filters.hourFrom} onChange={(value) => onChange({ hourFrom: value })} size="sm" aria-label="Giờ từ" inputProps={{ step: 60 }} />
                  <span aria-hidden="true">→</span>
                  <UUIInput type="time" className="detailed-plan-filters__hour-control" value={filters.hourTo} onChange={(value) => onChange({ hourTo: value })} size="sm" aria-label="Giờ đến" inputProps={{ step: 60 }} />
                </div>
              </div>
              <div className="detailed-plan-filters__field detailed-plan-filters__field--zone">
                <span className="detailed-plan-filters__label">Khu vực</span>
                <UUISelect
                  className="detailed-plan-filters__select"
                  size="sm"
                  aria-label="Khu vực"
                  selectedKey={filters.zone || 'ALL_ZONES'}
                  onSelectionChange={(key) => onChange({ zone: key === 'ALL_ZONES' ? '' : String(key) })}
                  items={[
                    { id: 'ALL_ZONES', label: 'Tất cả khu vực' },
                    ...zones.map((zone) => ({ id: zone.code, label: zone.label })),
                  ]}
                >
                  {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
                </UUISelect>
              </div>
            </div>
          </section>
          <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-points">
            <h3 id="detailed-plan-filter-points" className="detailed-plan-filter-panel__title">Điểm giao nhận</h3>
            <div className="detailed-plan-filter-panel__fields">
              <FacetMultiSelect label="Điểm nâng" selected={filters.pickupIds} onToggle={(id) => onChange({ pickupIds: toggleId(filters.pickupIds, id) })} loadFacets={loadPickupPortFacets} />
              <FacetMultiSelect label="Điểm hạ" selected={filters.dropoffIds} onToggle={(id) => onChange({ dropoffIds: toggleId(filters.dropoffIds, id) })} loadFacets={loadDropoffPortFacets} />
              <FacetMultiSelect label="Điểm trả" selected={filters.deliveryPointIds} onToggle={(id) => onChange({ deliveryPointIds: toggleId(filters.deliveryPointIds, id) })} loadFacets={loadDeliveryPointFacets} />
            </div>
          </section>
        </div>
      </Drawer>
    </section>
  );
}
