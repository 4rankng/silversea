import { useEffect, useId, useState } from 'react';
import { SearchableMultiSelect } from '../../../design-system';
import type { FacetItem, FacetLoader } from './DetailedPlanFilters';

/**
 * Multi-select facet block (spec §2: Điểm Nâng / Hạ / Trả), backed by the
 * shared `SearchableMultiSelect` — portal + flip positioning from the
 * dropdown-flip sweep, so the picker never clips or covers lower controls.
 *
 * Split out of the filters module so the filter composition stays readable: the
 * band adapter is the thing that should read top to bottom, not a reusable
 * picker wedged in the middle of it.
 */
export function FacetMultiSelect({
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