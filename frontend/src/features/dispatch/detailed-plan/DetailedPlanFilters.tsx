import { useEffect, useState } from 'react';
import type { DetailedPlanFilterState } from './useDispatchDetailPlan';

interface DetailedPlanFiltersProps {
  filters: DetailedPlanFilterState;
  onChange: (patch: Partial<DetailedPlanFilterState>) => void;
  loadDeliveryPointFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
}

const ASSIGNMENT_OPTIONS: { value: DetailedPlanFilterState['assignmentStatus']; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'UNASSIGNED', label: 'Chưa gán Biển số' },
  { value: 'ASSIGNED', label: 'Đã gán Biển số' },
];

/** Filter bar for the dispatch detail plan grid (docx §4). */
export function DetailedPlanFilters({ filters, onChange, loadDeliveryPointFacets }: DetailedPlanFiltersProps) {
  const [facets, setFacets] = useState<Array<{ id: number; name: string }>>([]);
  const [facetSearch, setFacetSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadDeliveryPointFacets(facetSearch || undefined)
      .then((items) => {
        if (!cancelled) setFacets(items);
      })
      .catch(() => {
        if (!cancelled) setFacets([]);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facetSearch]);

  const toggleDeliveryPoint = (id: number) => {
    const next = filters.deliveryPointIds.includes(id)
      ? filters.deliveryPointIds.filter((value) => value !== id)
      : [...filters.deliveryPointIds, id];
    onChange({ deliveryPointIds: next });
  };

  return (
    <div className="detailed-plan-filters">
      <input
        type="search"
        className="detailed-plan-filters__search"
        placeholder="Tìm theo Bill, khách hàng, container…"
        value={filters.q}
        onChange={(event) => onChange({ q: event.target.value })}
        aria-label="Tìm kiếm dòng kế hoạch"
      />
      <input
        type="date"
        className="detailed-plan-filters__date"
        value={filters.date}
        onChange={(event) => onChange({ date: event.target.value })}
        aria-label="Ngày chạy"
      />
      <select
        className="detailed-plan-filters__select"
        value={filters.direction}
        onChange={(event) => onChange({ direction: event.target.value as DetailedPlanFilterState['direction'] })}
        aria-label="Chiều hàng"
      >
        <option value="">Nhập/Xuất</option>
        <option value="IMPORT">Nhập</option>
        <option value="EXPORT">Xuất</option>
      </select>
      <select
        className="detailed-plan-filters__select"
        value={filters.assignmentStatus}
        onChange={(event) => onChange({ assignmentStatus: event.target.value as DetailedPlanFilterState['assignmentStatus'] })}
        aria-label="Trạng thái gán biển số"
      >
        {ASSIGNMENT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <div className="detailed-plan-filters__points" aria-label="Điểm trả hàng">
        <input
          type="search"
          className="detailed-plan-filters__point-search"
          placeholder="Điểm trả…"
          value={facetSearch}
          onChange={(event) => setFacetSearch(event.target.value)}
          aria-label="Tìm điểm trả hàng"
        />
        {filters.deliveryPointIds.length > 0 && (
          <div className="detailed-plan-filters__point-chips">
            {filters.deliveryPointIds.map((id) => {
              const facet = facets.find((item) => item.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  className="detailed-plan-filters__point-chip"
                  onClick={() => toggleDeliveryPoint(id)}
                >
                  {facet?.name ?? `#${id}`} ✕
                </button>
              );
            })}
          </div>
        )}
        <div className="detailed-plan-filters__point-list" role="listbox" aria-label="Danh sách điểm trả hàng">
          {facets.slice(0, 20).map((facet) => {
            const selected = filters.deliveryPointIds.includes(facet.id);
            return (
              <button
                key={facet.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`detailed-plan-filters__point-option${selected ? ' is-selected' : ''}`}
                onClick={() => toggleDeliveryPoint(facet.id)}
              >
                {facet.name}
              </button>
            );
          })}
        </div>
      </div>
      <label className="detailed-plan-filters__hour">
        <span>Giờ</span>
        <input
          type="number"
          min={0}
          max={23}
          placeholder="Từ"
          value={filters.hourFrom}
          onChange={(event) => onChange({ hourFrom: event.target.value === '' ? '' : Number(event.target.value) })}
          aria-label="Giờ từ"
        />
        <span>→</span>
        <input
          type="number"
          min={0}
          max={23}
          placeholder="Đến"
          value={filters.hourTo}
          onChange={(event) => onChange({ hourTo: event.target.value === '' ? '' : Number(event.target.value) })}
          aria-label="Giờ đến"
        />
      </label>
    </div>
  );
}
