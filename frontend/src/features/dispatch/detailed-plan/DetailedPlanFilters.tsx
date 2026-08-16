import { useEffect, useId, useState } from 'react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { NativeSelect as UUINativeSelect } from '../../../components/untitled-ui/base/select/select-native';
import { businessDateISO } from '../../../lib/format';
import type { DetailedPlanFilterState } from './useDispatchDetailPlan';

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
}

const ASSIGNMENT_OPTIONS: { value: DetailedPlanFilterState['assignmentStatus']; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'UNASSIGNED', label: 'Chưa gán Biển số' },
  { value: 'ASSIGNED', label: 'Đã gán Biển số' },
];

/** Searchable multi-select facet block (spec §2: Điểm Nâng / Hạ / Trả). */
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
  const [facets, setFacets] = useState<FacetItem[]>([]);
  const [facetSearch, setFacetSearch] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isLoadingFacets, setIsLoadingFacets] = useState(false);
  const [activeFacetIndex, setActiveFacetIndex] = useState<number | null>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();
  const visibleFacets = facets.slice(0, 20);

  const closePicker = () => {
    setIsPickerOpen(false);
    setActiveFacetIndex(null);
  };

  const selectFacet = (id: number) => {
    onToggle(id);
    closePicker();
  };

  useEffect(() => {
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
  }, [facetSearch]);

  return (
    <div className="detailed-plan-filters__points">
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">{label}</span>
        <UUIInput
          type="search"
          className="detailed-plan-filters__point-search"
          placeholder="Tìm điểm…"
          value={facetSearch}
          onChange={(value) => {
            setFacetSearch(value);
            setIsLoadingFacets(true);
            setActiveFacetIndex(null);
          }}
          aria-label={`Tìm ${label.toLowerCase()}`}
          inputProps={{
            onFocus: () => setIsPickerOpen(true),
            onBlur: closePicker,
            onKeyDown: (event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIsPickerOpen(true);
                setActiveFacetIndex((current) => !isLoadingFacets && visibleFacets.length > 0
                  ? Math.min((current ?? -1) + 1, visibleFacets.length - 1)
                  : null);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIsPickerOpen(true);
                setActiveFacetIndex((current) => !isLoadingFacets && visibleFacets.length > 0
                  ? Math.max((current ?? visibleFacets.length) - 1, 0)
                  : null);
              }
              if (event.key === 'Enter' && !isLoadingFacets && activeFacetIndex != null) {
                const activeFacet = visibleFacets[activeFacetIndex];
                if (activeFacet) {
                  event.preventDefault();
                  selectFacet(activeFacet.id);
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closePicker();
              }
            },
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-controls': isPickerOpen ? listboxId : undefined,
            'aria-activedescendant': isPickerOpen && !isLoadingFacets && activeFacetIndex != null ? `${optionIdPrefix}-${visibleFacets[activeFacetIndex]?.id}` : undefined,
            'aria-expanded': isPickerOpen,
            'aria-haspopup': 'listbox',
          }}
          size="sm"
        />
      </label>
      {selected.length > 0 && (
        <div className="detailed-plan-filters__point-chips">
          {selected.map((id) => {
            const facet = facets.find((item) => item.id === id);
            return (
              <button
                key={id}
                type="button"
                className="detailed-plan-filters__point-chip"
                onClick={() => onToggle(id)}
              >
                {facet?.name ?? `#${id}`} ✕
              </button>
            );
          })}
        </div>
      )}
      {isPickerOpen && (
        <div className="detailed-plan-filters__point-picker">
          <div id={listboxId} className="detailed-plan-filters__point-list" role="listbox" aria-label={`Danh sách ${label.toLowerCase()}`} aria-busy={isLoadingFacets}>
            {!isLoadingFacets && visibleFacets.map((facet, index) => {
            const isSelected = selected.includes(facet.id);
            return (
              <div
                key={facet.id}
                id={`${optionIdPrefix}-${facet.id}`}
                role="option"
                aria-selected={isSelected}
                className={`detailed-plan-filters__point-option${isSelected ? ' is-selected' : ''}${activeFacetIndex === index ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveFacetIndex(index)}
                onClick={() => selectFacet(facet.id)}
              >
                {facet.name}
              </div>
            );
            })}
          </div>
          {(isLoadingFacets || visibleFacets.length === 0) && (
            <span className="detailed-plan-filters__point-feedback" role="status">
              {isLoadingFacets ? 'Đang tìm điểm…' : 'Không tìm thấy điểm phù hợp.'}
            </span>
          )}
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
}: DetailedPlanFiltersProps) {
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const advancedFiltersId = useId();
  const today = businessDateISO();
  const activeAdvancedFilterCount = [
    filters.date,
    filters.direction,
    filters.assignmentStatus,
    filters.pickupIds.length > 0,
    filters.dropoffIds.length > 0,
    filters.deliveryPointIds.length > 0,
    filters.hourFrom !== '',
    filters.hourTo !== '',
  ].filter(Boolean).length;

  return (
    <section className="detailed-plan-filters" aria-label="Bộ lọc kế hoạch chi tiết">
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
      <button
        type="button"
        className="detailed-plan-filters__advanced-toggle"
        aria-expanded={isAdvancedFiltersOpen}
        aria-controls={advancedFiltersId}
        onClick={() => setIsAdvancedFiltersOpen((isOpen) => !isOpen)}
      >
        {isAdvancedFiltersOpen ? 'Ẩn bộ lọc' : activeAdvancedFilterCount > 0 ? `Bộ lọc (${activeAdvancedFilterCount})` : 'Thêm bộ lọc'}
      </button>
      <div id={advancedFiltersId} className={`detailed-plan-filters__advanced${isAdvancedFiltersOpen ? ' is-open' : ''}`}>
        <div className="detailed-plan-filters__date-group">
          <label className="detailed-plan-filters__field">
            <span className="detailed-plan-filters__label">Ngày vận chuyển</span>
            <UUIInput
              type="date"
              className="detailed-plan-filters__date"
              value={filters.date}
              onChange={(value) => onChange({ date: value })}
              size="sm"
              aria-label="Ngày vận chuyển"
            />
          </label>
          {filters.date !== today && (
            <UUIButton
              className="detailed-plan-filters__today"
              size="xs"
              color="secondary"
              onPress={() => onChange({ date: today })}
            >
              Về hôm nay
            </UUIButton>
          )}
        </div>
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">Chiều hàng</span>
        <UUINativeSelect
          className="detailed-plan-filters__select"
          value={filters.direction}
          onChange={(event) => onChange({ direction: event.target.value as DetailedPlanFilterState['direction'] })}
          size="sm"
          aria-label="Chiều hàng"
          options={[
            { value: '', label: 'Nhập/Xuất' },
            { value: 'IMPORT', label: 'Nhập' },
            { value: 'EXPORT', label: 'Xuất' },
          ]}
        />
      </label>
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">Phân xe</span>
        <UUINativeSelect
          className="detailed-plan-filters__select"
          value={filters.assignmentStatus}
          onChange={(event) => onChange({ assignmentStatus: event.target.value as DetailedPlanFilterState['assignmentStatus'] })}
          size="sm"
          aria-label="Phân xe"
          options={ASSIGNMENT_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
        />
      </label>
      <FacetMultiSelect
        label="Điểm nâng"
        selected={filters.pickupIds}
        onToggle={(id) => onChange({ pickupIds: toggleId(filters.pickupIds, id) })}
        loadFacets={loadPickupPortFacets}
      />
      <FacetMultiSelect
        label="Điểm hạ"
        selected={filters.dropoffIds}
        onToggle={(id) => onChange({ dropoffIds: toggleId(filters.dropoffIds, id) })}
        loadFacets={loadDropoffPortFacets}
      />
      <FacetMultiSelect
        label="Điểm trả"
        selected={filters.deliveryPointIds}
        onToggle={(id) => onChange({ deliveryPointIds: toggleId(filters.deliveryPointIds, id) })}
        loadFacets={loadDeliveryPointFacets}
      />
      <div className="detailed-plan-filters__field detailed-plan-filters__hour">
        <span className="detailed-plan-filters__label">Giờ chạy</span>
        <div className="detailed-plan-filters__hour-inputs">
          <UUIInput
            type="number"
            className="detailed-plan-filters__hour-control"
            placeholder="Từ"
            value={String(filters.hourFrom)}
            onChange={(value) => onChange({ hourFrom: value === '' ? '' : Number(value) })}
            size="sm"
            aria-label="Giờ từ"
            inputProps={{ min: 0, max: 23 }}
          />
          <span aria-hidden="true">→</span>
          <UUIInput
            type="number"
            className="detailed-plan-filters__hour-control"
            placeholder="Đến"
            value={String(filters.hourTo)}
            onChange={(value) => onChange({ hourTo: value === '' ? '' : Number(value) })}
            size="sm"
            aria-label="Giờ đến"
            inputProps={{ min: 0, max: 23 }}
          />
        </div>
      </div>
      </div>
    </section>
  );
}
