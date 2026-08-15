import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    loadFacets(facetSearch || undefined)
      .then((items) => {
        if (!cancelled) setFacets(items);
      })
      .catch(() => {
        if (!cancelled) setFacets([]);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facetSearch]);

  return (
    <div className="detailed-plan-filters__points">
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">{label}</span>
        <input
          type="search"
          className="detailed-plan-filters__point-search"
          placeholder="Tìm điểm…"
          value={facetSearch}
          onChange={(event) => setFacetSearch(event.target.value)}
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
      <div className="detailed-plan-filters__point-list" role="listbox" aria-label={`Danh sách ${label.toLowerCase()}`}>
        {facets.slice(0, 20).map((facet) => {
          const isSelected = selected.includes(facet.id);
          return (
            <button
              key={facet.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`detailed-plan-filters__point-option${isSelected ? ' is-selected' : ''}`}
              onClick={() => onToggle(facet.id)}
            >
              {facet.name}
            </button>
          );
        })}
      </div>
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
  return (
    <section className="detailed-plan-filters" aria-label="Bộ lọc kế hoạch chi tiết">
      <label className="detailed-plan-filters__field detailed-plan-filters__field--search">
        <span className="detailed-plan-filters__label">Tìm nhanh</span>
        <input
          type="search"
          className="detailed-plan-filters__search"
          placeholder="Bill, khách hàng, container…"
          value={filters.q}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </label>
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">Ngày chạy</span>
        <input
          type="date"
          className="detailed-plan-filters__date"
          value={filters.date}
          onChange={(event) => onChange({ date: event.target.value })}
        />
      </label>
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">Chiều hàng</span>
        <select
          className="detailed-plan-filters__select"
          value={filters.direction}
          onChange={(event) => onChange({ direction: event.target.value as DetailedPlanFilterState['direction'] })}
        >
          <option value="">Nhập/Xuất</option>
          <option value="IMPORT">Nhập</option>
          <option value="EXPORT">Xuất</option>
        </select>
      </label>
      <label className="detailed-plan-filters__field">
        <span className="detailed-plan-filters__label">Phân xe</span>
        <select
          className="detailed-plan-filters__select"
          value={filters.assignmentStatus}
          onChange={(event) => onChange({ assignmentStatus: event.target.value as DetailedPlanFilterState['assignmentStatus'] })}
        >
          {ASSIGNMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
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
          <label>
            <span className="sr-only">Giờ từ</span>
            <input
              type="number"
              min={0}
              max={23}
              placeholder="Từ"
              value={filters.hourFrom}
              onChange={(event) => onChange({ hourFrom: event.target.value === '' ? '' : Number(event.target.value) })}
            />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            <span className="sr-only">Giờ đến</span>
            <input
              type="number"
              min={0}
              max={23}
              placeholder="Đến"
              value={filters.hourTo}
              onChange={(event) => onChange({ hourTo: event.target.value === '' ? '' : Number(event.target.value) })}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
