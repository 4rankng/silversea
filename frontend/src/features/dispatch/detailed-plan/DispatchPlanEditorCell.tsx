import { useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { CursorPaginatedResponse, DispatchClassification } from '@tingting/shared';
import { DISPATCH_CLASSIFICATIONS, DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchDetailPlanRow,
  type DispatchExternalCarrier,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import { Modal } from '../../../components/UI';
import { SearchableSelect, type SearchableSelectOption } from '../../../design-system';
import './DispatchPlanEditorCell.css';

const PAGE_LOAD_SIZE = 50;
const OWN_TRUCK_PREFIX = 'truck:';
const EXTERNAL_VEHICLE_PREFIX = 'vehicle:';
const EXTERNAL_CARRIER_PREFIX = 'carrier:';
const OWN_CARRIER_VALUE = 'carrier:own';
const FREE_TEXT_PREFIX = 'free:';
const CURRENT_PLATE_PREFIX = 'current:';

// Zone-agnostic wording: suggestions derive from whichever zone the order's
// own ports sit in (not just Lạch Huyện), so the tag must not hard-code "LH".
const SUGGESTION_LABELS: Record<'D-1_DROP' | 'D+1_PICKUP', string> = {
  'D-1_DROP': 'Hạ tại khu vực D-1',
  'D+1_PICKUP': 'Lấy tại khu vực D+1',
};

export interface AtomicPlanSaveResult {
  fulfillmentVersion: number;
  shipmentVersion: number;
  classification: DispatchClassification;
  isCombined: boolean;
  dispatch: {
    carrierType: 'OWN' | 'EXTERNAL';
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
  };
  estimates: { plannedRevenue: string | null; plannedCarrierCost: string | null };
  lotFullyPlated: boolean;
}

interface DispatchPlanEditorCellProps {
  row: DispatchDetailPlanRow;
  onAtomicSave: (
    row: DispatchDetailPlanRow,
    body: {
      carrierType: 'OWN' | 'EXTERNAL';
      externalCarrierId?: number | null;
      truckId?: number | null;
      externalCarrierVehicleId?: number | null;
      plateNumber?: string | null;
      clearVehicle?: boolean;
      plannedRevenue: number | null;
      plannedCarrierCost: number | null;
      classification: DispatchClassification;
      isCombined: boolean;
    },
  ) => Promise<AtomicPlanSaveResult>;
  disabled?: boolean;
}

interface PlanEditorDraft {
  carrierValue: string;
  vehicleValue: string;
  plannedRevenue: string;
  plannedCarrierCost: string;
  classification: DispatchClassification | '';
  isCombined: boolean;
}

function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function carrierValueForRow(row: DispatchDetailPlanRow): string {
  return row.dispatch.carrierType === 'OWN'
    ? OWN_CARRIER_VALUE
    : `${EXTERNAL_CARRIER_PREFIX}${row.dispatch.externalCarrierId}`;
}

function vehicleValueForRow(row: DispatchDetailPlanRow): string {
  if (row.dispatch.externalCarrierVehicleId != null) {
    return `${EXTERNAL_VEHICLE_PREFIX}${row.dispatch.externalCarrierVehicleId}`;
  }
  return row.dispatch.assignedPlate ? `${CURRENT_PLATE_PREFIX}${row.dispatch.assignedPlate}` : '';
}

function draftForRow(row: DispatchDetailPlanRow): PlanEditorDraft {
  return {
    carrierValue: carrierValueForRow(row),
    vehicleValue: vehicleValueForRow(row),
    plannedRevenue: row.estimates.plannedRevenue ?? '',
    plannedCarrierCost: row.estimates.plannedCarrierCost ?? '',
    // Legacy rows created before classification existed carry null — the
    // editor forces an explicit choice before the first save.
    classification: row.classification ?? '',
    isCombined: row.isCombined,
  };
}

function parseCarrier(value: string): { carrierType: 'OWN' | 'EXTERNAL'; externalCarrierId?: number } | null {
  if (value === OWN_CARRIER_VALUE) return { carrierType: 'OWN' };
  if (!value.startsWith(EXTERNAL_CARRIER_PREFIX)) return null;
  const externalCarrierId = Number(value.slice(EXTERNAL_CARRIER_PREFIX.length));
  return Number.isInteger(externalCarrierId) && externalCarrierId > 0
    ? { carrierType: 'EXTERNAL', externalCarrierId }
    : null;
}

function parseVnd(value: string): { valid: true; value: number | null } | { valid: false; value: null } {
  const normalized = value.trim();
  if (!normalized) return { valid: true, value: null };
  const amount = Number(normalized);
  return Number.isInteger(amount) && amount >= 0
    ? { valid: true, value: amount }
    : { valid: false, value: null };
}

function formatVnd(value: string | null): string {
  if (value == null || value === '') return 'Chưa nhập';
  const amount = Number(value);
  return Number.isFinite(amount) ? `${new Intl.NumberFormat('vi-VN').format(amount)} đ` : value;
}

interface VehicleBody {
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clearVehicle?: boolean;
}

/** Vehicle body for the atomic save. '' → explicit clear (Bỏ gán biển số);
 *  CURRENT_PLATE → keep stored columns (the snapshot is the stored value). */
function vehicleBody(value: string): VehicleBody | null {
  if (!value) return { clearVehicle: true };
  if (value.startsWith(OWN_TRUCK_PREFIX)) return { truckId: Number(value.slice(OWN_TRUCK_PREFIX.length)) };
  if (value.startsWith(EXTERNAL_VEHICLE_PREFIX)) return { externalCarrierVehicleId: Number(value.slice(EXTERNAL_VEHICLE_PREFIX.length)) };
  if (value.startsWith(FREE_TEXT_PREFIX)) return { plateNumber: value.slice(FREE_TEXT_PREFIX.length) };
  if (value.startsWith(CURRENT_PLATE_PREFIX)) return {};
  return null;
}

/**
 * One full-cell trigger and one atomic editor for the whole detailed-plan row:
 * carrier, vehicle, estimates, classification and Đóng kết hợp save together
 * through PATCH /dispatch-detail-plan-rows/:id/plan or not at all.
 */
export function DispatchPlanEditorCell({ row, onAtomicSave, disabled = false }: DispatchPlanEditorCellProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PlanEditorDraft>(() => draftForRow(row));
  const [carrierOptions, setCarrierOptions] = useState<SearchableSelectOption[]>([]);
  const [carrierSearch, setCarrierSearch] = useState('');
  const [carrierCursor, setCarrierCursor] = useState<string | null>(null);
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [vehicleOptions, setVehicleOptions] = useState<SearchableSelectOption[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleCursor, setVehicleCursor] = useState<string | null>(null);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ truckId: number; plateNumber: string; reasons: Array<'D-1_DROP' | 'D+1_PICKUP'> }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCarrier = parseCarrier(draft.carrierValue);
  const draftUsesOwnFleet = selectedCarrier?.carrierType === 'OWN';

  useEffect(() => {
    if (!open) setDraft(draftForRow(row));
  }, [open, row]);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoadingCarriers(true);
    listDispatchFleetResources('EXTERNAL_CARRIER', { limit: PAGE_LOAD_SIZE, q: carrierSearch || undefined })
      .then((response) => {
        if (cancelled) return;
        setCarrierOptions((response.items as DispatchExternalCarrier[])
          .filter((carrier) => carrier.isActive !== false)
          .map((carrier) => ({ value: `${EXTERNAL_CARRIER_PREFIX}${carrier.id}`, label: carrier.name })));
        setCarrierCursor(response.nextCursor);
      })
      .catch(() => {
        if (!cancelled) {
          setCarrierOptions([]);
          setCarrierCursor(null);
        }
      })
      .finally(() => { if (!cancelled) setLoadingCarriers(false); });
    return () => { cancelled = true; };
  }, [carrierSearch, open]);

  useEffect(() => {
    if (!open || !selectedCarrier) return undefined;
    let cancelled = false;
    setLoadingVehicles(true);
    // Own-truck loads carry the row context so the backend can pin LH
    // D-1/D+1 suggestions beside the page.
    const request = selectedCarrier.carrierType === 'OWN'
      ? listDispatchFleetResources('TRUCK', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        fulfillmentId: row.fulfillmentId,
      })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        carrierId: selectedCarrier.externalCarrierId,
      });
    request.then((response) => {
      if (cancelled) return;
      const mapped = selectedCarrier.carrierType === 'OWN'
        ? (response.items as DispatchTruck[]).map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: truck.licensePlate }))
        : (response.items as DispatchCarrierVehicle[]).map((vehicle) => ({ value: `${EXTERNAL_VEHICLE_PREFIX}${vehicle.id}`, label: vehicle.licensePlate }));
      const normalizedSearch = normalizePlate(vehicleSearch);
      const freeTextOption = selectedCarrier.carrierType === 'EXTERNAL'
        && normalizedSearch.length >= 4
        && !mapped.some((option) => option.label === normalizedSearch)
        ? [{ value: `${FREE_TEXT_PREFIX}${normalizedSearch}`, label: `Dùng biển số: ${normalizedSearch}` }]
        : [];
      setVehicleOptions([...freeTextOption, ...mapped]);
      setVehicleCursor(response.nextCursor);
      setSuggestions(selectedCarrier.carrierType === 'OWN' ? response.suggestedItems ?? [] : []);
    }).catch(() => {
      if (!cancelled) {
        setVehicleOptions([]);
        setVehicleCursor(null);
        setSuggestions([]);
      }
    }).finally(() => { if (!cancelled) setLoadingVehicles(false); });
    return () => { cancelled = true; };
  }, [open, row.fulfillmentId, selectedCarrier?.carrierType, selectedCarrier?.externalCarrierId, vehicleSearch]);

  const selectableCarrierOptions = useMemo(() => {
    const options = [{ value: OWN_CARRIER_VALUE, label: 'SilverSea — xe nội bộ' }, ...carrierOptions];
    if (!options.some((option) => option.value === draft.carrierValue)) {
      options.splice(1, 0, { value: draft.carrierValue, label: row.dispatch.carrierName ?? 'Nhà xe đã ngừng hoạt động' });
    }
    return options;
  }, [carrierOptions, draft.carrierValue, row.dispatch.carrierName]);

  // Pinned LH suggestions render ahead of the page's trucks, deduped by option
  // value; reason tags travel in the label so screen readers get the same
  // signal as sighted users.
  const selectableVehicleOptions = useMemo(() => {
    const suggestionOptions: SearchableSelectOption[] = suggestions
      .filter((suggestion) => vehicleOptions.some((option) => option.value === `${OWN_TRUCK_PREFIX}${suggestion.truckId}`))
      .map((suggestion) => {
        const tags = suggestion.reasons.map((reason) => SUGGESTION_LABELS[reason]).join(' · ');
        return {
          value: `${OWN_TRUCK_PREFIX}${suggestion.truckId}`,
          label: `${suggestion.plateNumber} — ${tags}`,
        };
      });
    const merged: SearchableSelectOption[] = [];
    for (const option of [...suggestionOptions, ...vehicleOptions]) {
      if (!merged.some((existing) => existing.value === option.value)) merged.push(option);
    }
    if (!draft.vehicleValue || merged.some((option) => option.value === draft.vehicleValue)) return merged;
    const label = draft.vehicleValue.startsWith(CURRENT_PLATE_PREFIX)
      ? draft.vehicleValue.slice(CURRENT_PLATE_PREFIX.length)
      : row.dispatch.assignedPlate ?? 'Biển số hiện tại';
    return [{ value: draft.vehicleValue, label }, ...merged];
  }, [draft.vehicleValue, row.dispatch.assignedPlate, suggestions, vehicleOptions]);

  function openEditor() {
    if (disabled) return;
    setDraft(draftForRow(row));
    setCarrierSearch('');
    setVehicleSearch('');
    setError(null);
    setOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    restoreFocusRef.current = true;
    setError(null);
    setOpen(false);
  }

  function updateCarrier(value: string) {
    setDraft((current) => ({
      ...current,
      carrierValue: value,
      vehicleValue: value === current.carrierValue ? current.vehicleValue : '',
    }));
    setVehicleOptions([]);
    setVehicleCursor(null);
    setVehicleSearch('');
    setSuggestions([]);
    setError(null);
  }

  function loadMoreCarriers() {
    if (carrierCursor == null || loadingCarriers) return;
    setLoadingCarriers(true);
    listDispatchFleetResources('EXTERNAL_CARRIER', {
      limit: PAGE_LOAD_SIZE,
      q: carrierSearch || undefined,
      cursor: carrierCursor,
    }).then((response) => {
      const fresh = (response.items as DispatchExternalCarrier[])
        .filter((carrier) => carrier.isActive !== false)
        .map((carrier) => ({ value: `${EXTERNAL_CARRIER_PREFIX}${carrier.id}`, label: carrier.name }));
      setCarrierOptions((previous) => [...previous, ...fresh.filter((item) => !previous.some((option) => option.value === item.value))]);
      setCarrierCursor(response.nextCursor);
    }).catch(() => setCarrierCursor(null)).finally(() => setLoadingCarriers(false));
  }

  function loadMoreVehicles() {
    if (vehicleCursor == null || loadingVehicles || !selectedCarrier) return;
    setLoadingVehicles(true);
    const request = selectedCarrier.carrierType === 'OWN'
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined, cursor: vehicleCursor, fulfillmentId: row.fulfillmentId })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        carrierId: selectedCarrier.externalCarrierId,
        cursor: vehicleCursor,
      });
    request.then((response) => {
      const mapped = selectedCarrier.carrierType === 'OWN'
        ? (response.items as DispatchTruck[]).map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: truck.licensePlate }))
        : (response.items as DispatchCarrierVehicle[]).map((vehicle) => ({ value: `${EXTERNAL_VEHICLE_PREFIX}${vehicle.id}`, label: vehicle.licensePlate }));
      setVehicleOptions((previous) => [...previous, ...mapped.filter((item) => !previous.some((option) => option.value === item.value))]);
      setVehicleCursor(response.nextCursor);
    }).catch(() => setVehicleCursor(null)).finally(() => setLoadingVehicles(false));
  }

  async function save() {
    if (saving) return;
    const carrier = parseCarrier(draft.carrierValue);
    const revenue = parseVnd(draft.plannedRevenue);
    const carrierCost = parseVnd(draft.plannedCarrierCost);
    if (!carrier) {
      setError('Chọn nhà xe trước khi lưu.');
      return;
    }
    if (!revenue.valid || !carrierCost.valid) {
      setError('Cước dự kiến phải là số nguyên không âm.');
      return;
    }
    if (!draft.classification) {
      setError('Chọn phân loại trước khi lưu.');
      return;
    }
    const body = vehicleBody(draft.vehicleValue);
    if (body == null) {
      setError('Biển số đã chọn không hợp lệ.');
      return;
    }
    const carrierSwitched = draft.carrierValue !== carrierValueForRow(row);
    const vehicleTouched = carrierSwitched
      ? draft.vehicleValue !== ''
      : draft.vehicleValue !== vehicleValueForRow(row);

    setSaving(true);
    setError(null);
    try {
      await onAtomicSave(row, {
        carrierType: carrier.carrierType,
        externalCarrierId: carrier.carrierType === 'EXTERNAL' ? carrier.externalCarrierId ?? null : null,
        // Send the vehicle block only when the editor actually touches it —
        // an estimates/classification-only save must not disturb stored columns.
        ...(vehicleTouched ? body : {}),
        plannedRevenue: revenue.value,
        plannedCarrierCost: carrierCost.value,
        classification: draft.classification,
        isCombined: draft.isCombined,
      });
      restoreFocusRef.current = true;
      setOpen(false);
    } catch {
      // Keep the modal and draft open — the caller surfaced the banner error.
      setError('Không thể lưu kế hoạch. Kiểm tra thông báo của bảng và thử lại.');
    } finally {
      setSaving(false);
    }
  }

  const identity = row.container.containerNumber || row.docs.billNumber || row.shipmentCode || `dòng ${row.fulfillmentId}`;
  const currentPlate = row.dispatch.assignedPlate;
  const classificationLabel = row.classification
    ? DISPATCH_CLASSIFICATION_LABELS[row.classification]
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dispatch-assignment-cell__trigger"
        data-cell-label="Điều phối"
        onClick={openEditor}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={`Sửa ô điều phối ${identity}`}
      >
        <span className="dispatch-assignment-cell__carrier">{row.dispatch.carrierName ?? 'Chưa phân nhà xe'}</span>
        <span className={`dispatch-assignment-cell__plate${currentPlate ? '' : ' is-placeholder'}`}>
          {currentPlate || (row.dispatch.carrierType === 'OWN' ? 'Chưa phân xe' : 'CUS sẽ bổ sung')}
        </span>
        <span className={`dispatch-assignment-cell__estimate${row.estimates.plannedRevenue == null ? ' is-placeholder' : ''}`}>
          Thu: {formatVnd(row.estimates.plannedRevenue)}
        </span>
        <span className={`dispatch-assignment-cell__estimate${row.estimates.plannedCarrierCost == null ? ' is-placeholder' : ''}`}>
          Trả: {formatVnd(row.estimates.plannedCarrierCost)}
        </span>
        {row.lotFullyPlated && !currentPlate && (
          <span className="detailed-plan-grid__lot-flag">Đã phân xe</span>
        )}
      </button>

      <Modal
        isOpen={open}
        title="Chỉnh sửa điều phối"
        onClose={closeEditor}
        maxWidth={560}
        footer={(
          <>
            <button type="button" className="btn btn--secondary" onClick={closeEditor} disabled={saving}>Hủy</button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving}>
              <Save size={16} aria-hidden="true" />
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </>
        )}
      >
        <form className="dispatch-assignment-dialog" aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <p className="dispatch-assignment-dialog__context">{identity}</p>
          <div className="dispatch-assignment-dialog__fields">
            <label htmlFor={`dispatch-carrier-${row.fulfillmentId}`}>
              <span>Nhà xe</span>
              <SearchableSelect
                id={`dispatch-carrier-${row.fulfillmentId}`}
                value={draft.carrierValue}
                onChange={updateCarrier}
                onSearchChange={setCarrierSearch}
                options={selectableCarrierOptions}
                placeholder="Chọn nhà xe"
                searchPlaceholder="Tìm nhà xe…"
                emptyMessage={loadingCarriers ? 'Đang tải…' : 'Không tìm thấy nhà xe phù hợp.'}
                disabled={saving}
                required
                hasMore={carrierCursor != null}
                onLoadMore={loadMoreCarriers}
                loadingMore={loadingCarriers && carrierOptions.length > 0}
              />
            </label>
            <label htmlFor={`dispatch-vehicle-${row.fulfillmentId}`}>
              <span>Xe / biển số</span>
              <SearchableSelect
                id={`dispatch-vehicle-${row.fulfillmentId}`}
                value={draft.vehicleValue}
                onChange={(value) => { setDraft((current) => ({ ...current, vehicleValue: value })); setError(null); }}
                onSearchChange={setVehicleSearch}
                options={selectableVehicleOptions}
                placeholder={draftUsesOwnFleet ? 'Chọn biển số xe' : 'Chọn hoặc nhập biển số'}
                searchPlaceholder="Tìm biển số xe…"
                emptyMessage={loadingVehicles ? 'Đang tải…' : 'Không tìm thấy xe phù hợp.'}
                disabled={saving || !selectedCarrier}
                clearable
                clearLabel="Bỏ gán biển số"
                hasMore={vehicleCursor != null}
                onLoadMore={loadMoreVehicles}
                loadingMore={loadingVehicles && vehicleOptions.length > 0}
              />
            </label>
            <label htmlFor={`dispatch-classification-${row.fulfillmentId}`}>
              <span>Phân loại</span>
              <select
                id={`dispatch-classification-${row.fulfillmentId}`}
                className="input"
                value={draft.classification}
                onChange={(event) => {
                  const value = event.target.value as DispatchClassification | '';
                  setDraft((current) => ({ ...current, classification: value }));
                  setError(null);
                }}
                disabled={saving}
                required
                aria-required="true"
              >
                <option value="" disabled>Chọn phân loại…</option>
                {DISPATCH_CLASSIFICATIONS.map((value) => (
                  <option key={value} value={value}>{DISPATCH_CLASSIFICATION_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label htmlFor={`dispatch-combined-${row.fulfillmentId}`} className="dispatch-assignment-dialog__check">
              <input
                id={`dispatch-combined-${row.fulfillmentId}`}
                type="checkbox"
                checked={draft.isCombined}
                onChange={(event) => setDraft((current) => ({ ...current, isCombined: event.target.checked }))}
                disabled={saving}
              />
              <span>Đóng kết hợp (kẹp chuyến)</span>
            </label>
            <label htmlFor={`dispatch-revenue-${row.fulfillmentId}`}>
              <span>Cước thu dự kiến</span>
              <input id={`dispatch-revenue-${row.fulfillmentId}`} inputMode="numeric" type="number" min="0" step="1" value={draft.plannedRevenue} onChange={(event) => { setDraft((current) => ({ ...current, plannedRevenue: event.target.value })); setError(null); }} disabled={saving} />
            </label>
            <label htmlFor={`dispatch-cost-${row.fulfillmentId}`}>
              <span>Cước trả dự kiến</span>
              <input id={`dispatch-cost-${row.fulfillmentId}`} inputMode="numeric" type="number" min="0" step="1" value={draft.plannedCarrierCost} onChange={(event) => { setDraft((current) => ({ ...current, plannedCarrierCost: event.target.value })); setError(null); }} disabled={saving} />
            </label>
          </div>
          {error && <p className="dispatch-assignment-dialog__error" role="alert">{error}</p>}
        </form>
      </Modal>
    </>
  );
}
