import { useCallback, useEffect, useId, useState } from 'react';
import { Check, FilterLines, XClose } from '@untitledui/icons';
import { SearchableMultiSelect } from '../../../design-system';
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
 * Multi-select facet block (spec §2: Điểm Nâng / Hạ / Trả), backed by the
 * shared `SearchableMultiSelect` — portal + flip positioning from the
 * dropdown-flip sweep, so the picker never clips or covers lower controls.
 *
 * Facets lazy-load once per popover open; the picker's search input filters
 * the loaded list locally (facet catalogs are bounded, ≤100 rows).
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

  // The picker's search refetches from the server (debounced by the picker),
  // preserving the original per-keystroke facet query contract.
  const handleSearch = useCallback((query: string) => {
    let cancelled = false;
    loadFacets(query || undefined)
      .then((items) => { if (!cancelled) setFacets(items); })
      .catch(() => { if (!cancelled) setFacets([]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          onOpenChange={setIsPickerOpen}
          onSearchChange={handleSearch}
        />
      </div>
    </div>
  );
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
              aria-label="Tất cả"
              aria-pressed={filters.date === ''}
              iconLeading={filters.date === '' ? <Check aria-hidden="true" /> : undefined}
            >
              Tất cả
            </UUIButton>
          </div>
          <UUIButton
            className="detailed-plan-filters__clear"
            size="sm"
            color="tertiary"
            iconLeading={XClose}
            onPress={clearFilters}
            isDisabled={activeFilterCount === 0}
            aria-label="Xóa lọc"
          >
            Xóa lọc
          </UUIButton>
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
              <FacetMultiSelect label="Điểm nâng" selected={filters.pickupIds} onSelectionChange={(ids) => onChange({ pickupIds: ids })} loadFacets={loadPickupPortFacets} />
              <FacetMultiSelect label="Điểm hạ" selected={filters.dropoffIds} onSelectionChange={(ids) => onChange({ dropoffIds: ids })} loadFacets={loadDropoffPortFacets} />
              <FacetMultiSelect label="Điểm trả" selected={filters.deliveryPointIds} onSelectionChange={(ids) => onChange({ deliveryPointIds: ids })} loadFacets={loadDeliveryPointFacets} />
            </div>
          </section>
        </div>
      </Drawer>
    </section>
  );
}
