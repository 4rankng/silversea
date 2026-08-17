import { useEffect, useMemo, useState } from 'react';
import type { CursorPaginatedResponse } from '@tingting/shared';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchDetailPlanRow,
  type DispatchExternalCarrier,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import { SearchableSelect, type SearchableSelectOption } from '../../../design-system';
import './PlateAssignmentCell.css';

const PAGE_LOAD_SIZE = 50;
const OWN_TRUCK_PREFIX = 'truck:';
const EXTERNAL_VEHICLE_PREFIX = 'vehicle:';
const EXTERNAL_CARRIER_PREFIX = 'carrier:';
const OWN_CARRIER_VALUE = 'carrier:own';
const FREE_TEXT_PREFIX = 'free:';
const CURRENT_PLATE_PREFIX = 'current:';

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

interface PlateAssignmentCellProps {
  row: DispatchDetailPlanRow;
  onAssign: (row: DispatchDetailPlanRow, body: { truckId?: number | null; externalCarrierVehicleId?: number | null; plateNumber?: string | null; clear?: boolean }) => Promise<unknown>;
  onAssignCarrier?: (row: DispatchDetailPlanRow, body: { carrierType: 'OWN' | 'EXTERNAL'; externalCarrierId?: number | null }) => Promise<unknown>;
  disabled?: boolean;
}

/** The detailed dispatch cell is the grid's sole inline editor: carrier first, then compatible vehicle. */
export function PlateAssignmentCell({ row, onAssign, onAssignCarrier = async () => undefined, disabled = false }: PlateAssignmentCellProps) {
  const isOwn = row.dispatch.carrierType === 'OWN';
  const [editing, setEditing] = useState<'carrier' | 'vehicle' | null>(null);
  const [vehicleOptions, setVehicleOptions] = useState<SearchableSelectOption[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleCursor, setVehicleCursor] = useState<string | null>(null);
  const [carrierOptions, setCarrierOptions] = useState<SearchableSelectOption[]>([]);
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [carrierSearch, setCarrierSearch] = useState('');
  const [carrierCursor, setCarrierCursor] = useState<string | null>(null);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [savingCarrier, setSavingCarrier] = useState(false);

  const currentPlate = row.dispatch.assignedPlate ?? '';
  const carrierValue = isOwn ? OWN_CARRIER_VALUE : `${EXTERNAL_CARRIER_PREFIX}${row.dispatch.externalCarrierId}`;
  const selectedVehicleValue = useMemo(() => {
    if (!currentPlate) return '';
    return vehicleOptions.find((option) => option.label === currentPlate)?.value ?? `${CURRENT_PLATE_PREFIX}${currentPlate}`;
  }, [currentPlate, vehicleOptions]);
  const selectableVehicleOptions = useMemo(() => (
    currentPlate && !vehicleOptions.some((option) => option.label === currentPlate)
      ? [{ value: `${CURRENT_PLATE_PREFIX}${currentPlate}`, label: currentPlate }, ...vehicleOptions]
      : vehicleOptions
  ), [currentPlate, vehicleOptions]);
  const selectableCarrierOptions = useMemo(() => {
    const options = [{ value: OWN_CARRIER_VALUE, label: 'SilverSea — xe nội bộ' }, ...carrierOptions];
    if (!isOwn && !options.some((option) => option.value === carrierValue)) {
      options.splice(1, 0, { value: carrierValue, label: row.dispatch.carrierName ?? 'Nhà xe đã ngừng hoạt động' });
    }
    return options;
  }, [carrierOptions, carrierValue, isOwn, row.dispatch.carrierName]);

  useEffect(() => {
    if (editing !== 'carrier') return undefined;
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
      .catch(() => { if (!cancelled) { setCarrierOptions([]); setCarrierCursor(null); } })
      .finally(() => { if (!cancelled) setLoadingCarriers(false); });
    return () => { cancelled = true; };
  }, [carrierSearch, editing]);

  useEffect(() => {
    if (editing !== 'vehicle') return undefined;
    let cancelled = false;
    setVehicleOptions([]);
    setVehicleCursor(null);
    setLoadingVehicles(true);
    const request = isOwn
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined, carrierId: row.dispatch.externalCarrierId });
    request.then((response) => {
      if (cancelled) return;
      const mapped = mapFleetResponse(response, isOwn);
      const freeTextOption = !isOwn && vehicleSearch.trim().length >= 4 && !mapped.some((option) => option.label === normalizePlate(vehicleSearch))
        ? [{ value: `${FREE_TEXT_PREFIX}${normalizePlate(vehicleSearch)}`, label: `Dùng biển số: ${normalizePlate(vehicleSearch)}` }]
        : [];
      setVehicleOptions([...freeTextOption, ...mapped]);
      setVehicleCursor(response.nextCursor);
    }).catch(() => { if (!cancelled) { setVehicleOptions([]); setVehicleCursor(null); } })
      .finally(() => { if (!cancelled) setLoadingVehicles(false); });
    return () => { cancelled = true; };
  }, [editing, isOwn, vehicleSearch, row.dispatch.externalCarrierId]);

  const handleCarrierChange = async (value: string) => {
    if (savingCarrier || disabled || value === carrierValue) return;
    setSavingCarrier(true);
    setVehicleOptions([]);
    setVehicleSearch('');
    setVehicleCursor(null);
    try {
      if (value === OWN_CARRIER_VALUE) await onAssignCarrier(row, { carrierType: 'OWN' });
      else if (value.startsWith(EXTERNAL_CARRIER_PREFIX)) await onAssignCarrier(row, { carrierType: 'EXTERNAL', externalCarrierId: Number(value.slice(EXTERNAL_CARRIER_PREFIX.length)) });
      setEditing(null);
    } catch {
      // The parent keeps the operational error visible near the grid.
    } finally {
      setSavingCarrier(false);
    }
  };

  const loadMoreCarriers = () => {
    if (carrierCursor == null || loadingCarriers) return;
    setLoadingCarriers(true);
    listDispatchFleetResources('EXTERNAL_CARRIER', { limit: PAGE_LOAD_SIZE, q: carrierSearch || undefined, cursor: carrierCursor })
      .then((response) => {
        const fresh = (response.items as DispatchExternalCarrier[]).filter((carrier) => carrier.isActive !== false)
          .map((carrier) => ({ value: `${EXTERNAL_CARRIER_PREFIX}${carrier.id}`, label: carrier.name }));
        setCarrierOptions((previous) => [...previous, ...fresh.filter((item) => !previous.some((option) => option.value === item.value))]);
        setCarrierCursor(response.nextCursor);
      }).finally(() => setLoadingCarriers(false));
  };

  const loadMoreVehicles = () => {
    if (vehicleCursor == null || loadingVehicles || savingCarrier) return;
    setLoadingVehicles(true);
    const request = isOwn
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined, cursor: vehicleCursor })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined, carrierId: row.dispatch.externalCarrierId, cursor: vehicleCursor });
    request.then((response) => {
      const mapped = mapFleetResponse(response, isOwn);
      setVehicleOptions((previous) => [...previous, ...mapped.filter((item) => !previous.some((option) => option.value === item.value))]);
      setVehicleCursor(response.nextCursor);
    }).catch(() => setVehicleCursor(null)).finally(() => setLoadingVehicles(false));
  };

  const handleVehicleChange = async (value: string) => {
    if (savingVehicle || savingCarrier || disabled || loadingVehicles) return;
    setSavingVehicle(true);
    try {
      if (value === '') await onAssign(row, { clear: true });
      else if (value.startsWith(OWN_TRUCK_PREFIX)) await onAssign(row, { truckId: Number(value.slice(OWN_TRUCK_PREFIX.length)) });
      else if (value.startsWith(EXTERNAL_VEHICLE_PREFIX)) await onAssign(row, { externalCarrierVehicleId: Number(value.slice(EXTERNAL_VEHICLE_PREFIX.length)) });
      else if (value.startsWith(FREE_TEXT_PREFIX)) await onAssign(row, { plateNumber: value.slice(FREE_TEXT_PREFIX.length) });
      setEditing(null);
    } catch {
      // The parent keeps the operational error visible near the grid.
    } finally {
      setSavingVehicle(false);
    }
  };

  return (
    <div className="plate-assignment">
      {editing === 'carrier' ? (
        <SearchableSelect className="plate-assignment__select" size="sm" id={`carrier-${row.fulfillmentId}`} value={carrierValue} onChange={handleCarrierChange} onOpenChange={(isOpen) => { if (!isOpen) setEditing(null); }} onSearchChange={setCarrierSearch} options={selectableCarrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe…" emptyMessage={loadingCarriers ? 'Đang tải…' : 'Không tìm thấy nhà xe phù hợp.'} disabled={disabled || savingCarrier} hasMore={carrierCursor != null} onLoadMore={loadMoreCarriers} loadingMore={loadingCarriers && carrierOptions.length > 0} />
      ) : (
        <button type="button" className="plate-assignment__value" onClick={() => setEditing('carrier')} disabled={disabled} aria-label={`Chỉnh sửa nhà xe: ${row.dispatch.carrierName ?? 'Chưa phân nhà xe'}`}>
          {row.dispatch.carrierName ?? (isOwn ? 'SilverSea — xe nội bộ' : 'Chưa phân nhà xe')}
        </button>
      )}
      {editing === 'vehicle' ? (
        <SearchableSelect className="plate-assignment__select" size="sm" id={`plate-${row.fulfillmentId}`} value={selectedVehicleValue} onChange={handleVehicleChange} onOpenChange={(isOpen) => { if (!isOpen) setEditing(null); }} onSearchChange={setVehicleSearch} options={selectableVehicleOptions} placeholder={isOwn ? 'Chọn biển số xe' : 'Chọn hoặc nhập biển số'} searchPlaceholder="Tìm biển số xe…" emptyMessage={loadingVehicles ? 'Đang tải…' : 'Không tìm thấy xe phù hợp.'} disabled={disabled || savingCarrier || savingVehicle} clearable clearLabel="Bỏ gán biển số" hasMore={vehicleCursor != null} onLoadMore={loadMoreVehicles} loadingMore={loadingVehicles && vehicleOptions.length > 0} />
      ) : (
        <button type="button" className={`plate-assignment__value plate-assignment__value--plate${currentPlate ? '' : ' is-placeholder'}`} onClick={() => setEditing('vehicle')} disabled={disabled} aria-label={`Chỉnh sửa biển số xe: ${currentPlate || 'Chưa phân xe'}`}>
          {currentPlate || (isOwn ? 'Chưa phân xe' : 'CUS sẽ bổ sung')}
        </button>
      )}
    </div>
  );
}
