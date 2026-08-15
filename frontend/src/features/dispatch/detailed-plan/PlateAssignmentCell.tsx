import { useEffect, useMemo, useState } from 'react';
import type { CursorPaginatedResponse } from '@tingting/shared';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchTruck,
  type DispatchDetailPlanRow,
} from '../../../api/dispatchPlanningClient';
import { SearchableSelect, type SearchableSelectOption } from '../../../design-system';
import './PlateAssignmentCell.css';

const PAGE_LOAD_SIZE = 50;

// Same display normalization the backend applies to free-text plates.
function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function mapFleetResponse(
  response: CursorPaginatedResponse<DispatchTruck> | CursorPaginatedResponse<DispatchCarrierVehicle>,
  isOwn: boolean,
): SearchableSelectOption[] {
  return isOwn
    ? (response.items as DispatchTruck[]).map<SearchableSelectOption>((truck) => ({
      value: `${OWN_TRUCK_PREFIX}${truck.id}`,
      label: truck.licensePlate,
    }))
    : (response.items as DispatchCarrierVehicle[]).map<SearchableSelectOption>((vehicle) => ({
      value: `${EXTERNAL_VEHICLE_PREFIX}${vehicle.id}`,
      label: vehicle.licensePlate,
    }));
}

const OWN_TRUCK_PREFIX = 'truck:';
const EXTERNAL_VEHICLE_PREFIX = 'vehicle:';
const FREE_TEXT_PREFIX = 'free:';

interface PlateAssignmentCellProps {
  row: DispatchDetailPlanRow;
  onAssign: (
    row: DispatchDetailPlanRow,
    body: { truckId?: number | null; externalCarrierVehicleId?: number | null; plateNumber?: string | null; clear?: boolean },
  ) => Promise<unknown>;
  disabled?: boolean;
}

/**
 * In-grid plate assignment control (docx §5 col 6): OWN rows pick from the
 * company truck fleet; EXTERNAL rows pick from the vendor's vehicle catalog
 * OR type a free-text plate OR leave empty ("CUS sẽ bổ sung").
 */
export function PlateAssignmentCell({ row, onAssign, disabled = false }: PlateAssignmentCellProps) {
  const isOwn = row.dispatch.carrierType === 'OWN';
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [nextPageCursor, setNextPageCursor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currentValue = row.dispatch.assignedPlate ?? '';

  // Resolve the current value to the matching catalog option so the select
  // shows the check state correctly.
  const selectedValue = useMemo(() => {
    if (!currentValue) return '';
    if (isOwn) {
      const truckOption = options.find((option) => option.label === currentValue);
      return truckOption?.value ?? '';
    }
    if (row.dispatch.externalCarrierVehicleId != null) {
      return `${EXTERNAL_VEHICLE_PREFIX}${row.dispatch.externalCarrierVehicleId}`;
    }
    return `${FREE_TEXT_PREFIX}${currentValue}`;
  }, [currentValue, isOwn, options, row.dispatch.externalCarrierVehicleId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingOptions(true);
    const request = isOwn
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: searchQuery || undefined })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: searchQuery || undefined,
        carrierId: row.dispatch.externalCarrierId,
      });
    request
      .then((response) => {
        if (cancelled) return;
        const mapped = mapFleetResponse(response, isOwn);
        // Free-text affordance for EXTERNAL rows: typing something not in the
        // catalog offers to use it verbatim.
        const freeTextOption = !isOwn && searchQuery.trim().length >= 4 && !mapped.some((option) => option.label === normalizePlate(searchQuery))
          ? [{ value: `${FREE_TEXT_PREFIX}${normalizePlate(searchQuery)}`, label: `Dùng biển số: ${normalizePlate(searchQuery)}` }]
          : [];
        setOptions([...freeTextOption, ...mapped]);
        setNextPageCursor(response.nextCursor);
        setLoadingOptions(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
        setNextPageCursor(null);
        setLoadingOptions(false);
      });
    return () => { cancelled = true; };
  }, [isOwn, searchQuery, row.dispatch.externalCarrierId]);

  const loadMoreOptions = () => {
    if (nextPageCursor == null || loadingOptions) return;
    setLoadingOptions(true);
    const request = isOwn
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: searchQuery || undefined, cursor: nextPageCursor })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: searchQuery || undefined,
        carrierId: row.dispatch.externalCarrierId,
        cursor: nextPageCursor,
      });
    request
      .then((response) => {
        const mapped = mapFleetResponse(response, isOwn);
        // Keep any free-text option pinned at the top; append the new page.
        // Re-check the pin: if the loaded page contains the exact plate, the
        // free-text duplicate is dropped in favor of the catalog option.
        setOptions((prev) => {
          const withoutFreeText = prev.filter((option) => !option.value.startsWith(FREE_TEXT_PREFIX));
          const existing = new Set(withoutFreeText.map((option) => option.value));
          const fresh = mapped.filter((option) => !existing.has(option.value));
          const combined = [...withoutFreeText, ...fresh];
          const prevFreeText = prev.filter((option) => option.value.startsWith(FREE_TEXT_PREFIX))
            .filter((option) => !combined.some((option2) => option2.label === option.label.replace('Dùng biển số: ', '')));
          return [...prevFreeText, ...combined];
        });
        setNextPageCursor(response.nextCursor);
        setLoadingOptions(false);
      })
      .catch(() => {
        setNextPageCursor(null);
        setLoadingOptions(false);
      });
  };

  const handleChange = async (value: string) => {
    if (saving || disabled) return;
    if (value === '') {
      // Clear
      setSaving(true);
      try {
        await onAssign(row, { clear: true });
      } catch {
        /* error surfaced by parent */
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    try {
      if (value.startsWith(OWN_TRUCK_PREFIX)) {
        await onAssign(row, { truckId: Number(value.slice(OWN_TRUCK_PREFIX.length)) });
      } else if (value.startsWith(EXTERNAL_VEHICLE_PREFIX)) {
        await onAssign(row, { externalCarrierVehicleId: Number(value.slice(EXTERNAL_VEHICLE_PREFIX.length)) });
      } else if (value.startsWith(FREE_TEXT_PREFIX)) {
        await onAssign(row, { plateNumber: value.slice(FREE_TEXT_PREFIX.length) });
      }
    } catch {
      /* error surfaced by parent */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="plate-assignment">
      <div className="plate-assignment__carrier">{row.dispatch.carrierName ?? '—'}</div>
      <SearchableSelect
        className="plate-assignment__select"
        id={`plate-${row.fulfillmentId}`}
        value={selectedValue}
        onChange={handleChange}
        onSearchChange={setSearchQuery}
        options={options}
        placeholder={isOwn ? 'Chọn biển số xe' : 'Chọn hoặc nhập biển số'}
        searchPlaceholder="Tìm biển số xe…"
        emptyMessage={loadingOptions ? 'Đang tải…' : 'Không tìm thấy xe phù hợp.'}
        disabled={disabled || saving}
        clearable
        clearLabel="Bỏ gán biển số"
        hasMore={nextPageCursor != null}
        onLoadMore={loadMoreOptions}
        loadingMore={loadingOptions && options.length > 0}
      />
      {!isOwn && !currentValue && (
        <div className="plate-assignment__hint">CUS sẽ bổ sung</div>
      )}
    </div>
  );
}
