import { useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { CursorPaginatedResponse } from '@tingting/shared';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchDetailPlanRow,
  type DispatchExternalCarrier,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import { Modal } from '../../../components/UI';
import { SearchableSelect, type SearchableSelectOption } from '../../../design-system';
import './PlateAssignmentCell.css';

const PAGE_LOAD_SIZE = 50;
const OWN_TRUCK_PREFIX = 'truck:';
const EXTERNAL_VEHICLE_PREFIX = 'vehicle:';
const EXTERNAL_CARRIER_PREFIX = 'carrier:';
const OWN_CARRIER_VALUE = 'carrier:own';
const FREE_TEXT_PREFIX = 'free:';
const CURRENT_PLATE_PREFIX = 'current:';

export interface CarrierMutationResult {
  version: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName: string;
  lotFullyPlated: boolean;
}

export interface PlateMutationResult {
  version: number;
  assignedPlate: string | null;
  lotFullyPlated: boolean;
}

export interface EstimateMutationResult {
  version: number;
  plannedRevenue: string | null;
  plannedCarrierCost: string | null;
}

interface PlateAssignmentCellProps {
  row: DispatchDetailPlanRow;
  onAssign: (
    row: DispatchDetailPlanRow,
    body: { truckId?: number | null; externalCarrierVehicleId?: number | null; plateNumber?: string | null; clear?: boolean },
  ) => Promise<PlateMutationResult>;
  onAssignCarrier: (
    row: DispatchDetailPlanRow,
    body: { carrierType: 'OWN' | 'EXTERNAL'; externalCarrierId?: number | null },
  ) => Promise<CarrierMutationResult>;
  onSaveEstimates: (
    row: DispatchDetailPlanRow,
    estimates: { plannedRevenue: number | null; plannedCarrierCost: number | null },
  ) => Promise<EstimateMutationResult>;
  disabled?: boolean;
}

interface DispatchCellDraft {
  carrierValue: string;
  vehicleValue: string;
  plannedRevenue: string;
  plannedCarrierCost: string;
}

function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function mapFleetResponse(
  response: CursorPaginatedResponse<DispatchTruck> | CursorPaginatedResponse<DispatchCarrierVehicle>,
  isOwn: boolean,
): SearchableSelectOption[] {
  return isOwn
    ? (response.items as DispatchTruck[]).map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: truck.licensePlate }))
    : (response.items as DispatchCarrierVehicle[]).map((vehicle) => ({ value: `${EXTERNAL_VEHICLE_PREFIX}${vehicle.id}`, label: vehicle.licensePlate }));
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

function draftForRow(row: DispatchDetailPlanRow): DispatchCellDraft {
  return {
    carrierValue: carrierValueForRow(row),
    vehicleValue: vehicleValueForRow(row),
    plannedRevenue: row.estimates.plannedRevenue ?? '',
    plannedCarrierCost: row.estimates.plannedCarrierCost ?? '',
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

function plateBody(value: string) {
  if (!value) return { clear: true };
  if (value.startsWith(OWN_TRUCK_PREFIX)) return { truckId: Number(value.slice(OWN_TRUCK_PREFIX.length)) };
  if (value.startsWith(EXTERNAL_VEHICLE_PREFIX)) return { externalCarrierVehicleId: Number(value.slice(EXTERNAL_VEHICLE_PREFIX.length)) };
  if (value.startsWith(FREE_TEXT_PREFIX)) return { plateNumber: value.slice(FREE_TEXT_PREFIX.length) };
  return null;
}

/** One full-cell trigger and one four-field editor, matching the /shipments cell contract. */
export function PlateAssignmentCell({ row, onAssign, onAssignCarrier, onSaveEstimates, disabled = false }: PlateAssignmentCellProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DispatchCellDraft>(() => draftForRow(row));
  const [carrierOptions, setCarrierOptions] = useState<SearchableSelectOption[]>([]);
  const [carrierSearch, setCarrierSearch] = useState('');
  const [carrierCursor, setCarrierCursor] = useState<string | null>(null);
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [vehicleOptions, setVehicleOptions] = useState<SearchableSelectOption[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleCursor, setVehicleCursor] = useState<string | null>(null);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCarrier = parseCarrier(draft.carrierValue);
  const draftUsesOwnFleet = selectedCarrier?.carrierType === 'OWN';
  const currentCarrierValue = carrierValueForRow(row);
  const currentVehicleValue = vehicleValueForRow(row);

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
    const request = selectedCarrier.carrierType === 'OWN'
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        carrierId: selectedCarrier.externalCarrierId,
      });
    request.then((response) => {
      if (cancelled) return;
      const mapped = mapFleetResponse(response, selectedCarrier.carrierType === 'OWN');
      const normalizedSearch = normalizePlate(vehicleSearch);
      const freeTextOption = selectedCarrier.carrierType === 'EXTERNAL'
        && normalizedSearch.length >= 4
        && !mapped.some((option) => option.label === normalizedSearch)
        ? [{ value: `${FREE_TEXT_PREFIX}${normalizedSearch}`, label: `Dùng biển số: ${normalizedSearch}` }]
        : [];
      setVehicleOptions([...freeTextOption, ...mapped]);
      setVehicleCursor(response.nextCursor);
    }).catch(() => {
      if (!cancelled) {
        setVehicleOptions([]);
        setVehicleCursor(null);
      }
    }).finally(() => { if (!cancelled) setLoadingVehicles(false); });
    return () => { cancelled = true; };
  }, [open, selectedCarrier?.carrierType, selectedCarrier?.externalCarrierId, vehicleSearch]);

  const selectableCarrierOptions = useMemo(() => {
    const options = [{ value: OWN_CARRIER_VALUE, label: 'SilverSea — xe nội bộ' }, ...carrierOptions];
    if (!options.some((option) => option.value === draft.carrierValue)) {
      options.splice(1, 0, { value: draft.carrierValue, label: row.dispatch.carrierName ?? 'Nhà xe đã ngừng hoạt động' });
    }
    return options;
  }, [carrierOptions, draft.carrierValue, row.dispatch.carrierName]);

  const selectableVehicleOptions = useMemo(() => {
    if (!draft.vehicleValue || vehicleOptions.some((option) => option.value === draft.vehicleValue)) return vehicleOptions;
    const label = draft.vehicleValue.startsWith(CURRENT_PLATE_PREFIX)
      ? draft.vehicleValue.slice(CURRENT_PLATE_PREFIX.length)
      : row.dispatch.assignedPlate ?? 'Biển số hiện tại';
    return [{ value: draft.vehicleValue, label }, ...vehicleOptions];
  }, [draft.vehicleValue, row.dispatch.assignedPlate, vehicleOptions]);

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
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined, cursor: vehicleCursor })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        carrierId: selectedCarrier.externalCarrierId,
        cursor: vehicleCursor,
      });
    request.then((response) => {
      const mapped = mapFleetResponse(response, selectedCarrier.carrierType === 'OWN');
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

    const carrierChanged = draft.carrierValue !== currentCarrierValue;
    // A carrier change already clears the old vehicle in the backend. Only
    // issue a second write when the dialog assigns a replacement vehicle.
    const vehicleChanged = carrierChanged
      ? draft.vehicleValue !== ''
      : draft.vehicleValue !== currentVehicleValue;
    const estimatesChanged = draft.plannedRevenue !== (row.estimates.plannedRevenue ?? '')
      || draft.plannedCarrierCost !== (row.estimates.plannedCarrierCost ?? '');
    if (!carrierChanged && !vehicleChanged && !estimatesChanged) {
      closeEditor();
      return;
    }

    setSaving(true);
    setError(null);
    let workingRow = row;
    try {
      if (carrierChanged) {
        const result = await onAssignCarrier(workingRow, carrier);
        workingRow = {
          ...workingRow,
          version: result.version,
          lotFullyPlated: result.lotFullyPlated,
          dispatch: {
            ...workingRow.dispatch,
            carrierType: result.carrierType,
            carrierName: result.carrierName,
            externalCarrierId: result.externalCarrierId,
            externalCarrierVehicleId: null,
            assignedPlate: null,
          },
        };
      }

      if (vehicleChanged) {
        const body = plateBody(draft.vehicleValue);
        if (!body) throw new Error('Biển số đã chọn không hợp lệ.');
        const result = await onAssign(workingRow, body);
        workingRow = {
          ...workingRow,
          version: result.version,
          lotFullyPlated: result.lotFullyPlated,
          dispatch: { ...workingRow.dispatch, assignedPlate: result.assignedPlate },
        };
      }

      if (estimatesChanged) {
        await onSaveEstimates(workingRow, {
          plannedRevenue: revenue.value,
          plannedCarrierCost: carrierCost.value,
        });
      }

      restoreFocusRef.current = true;
      setOpen(false);
    } catch {
      setError('Không thể lưu đủ dữ liệu điều phối. Kiểm tra thông báo của bảng và thử lại.');
    } finally {
      setSaving(false);
    }
  }

  const identity = row.container.containerNumber || row.docs.billNumber || row.shipmentCode || `dòng ${row.fulfillmentId}`;
  const currentPlate = row.dispatch.assignedPlate;

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
