import { DispatchIssueStatusChip, deriveDispatchIssueStatus } from '../components/DispatchIssueStatus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Send } from 'lucide-react';
import type { DispatchClassification } from '@tingting/shared';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchDetailPlanRow,
  type DispatchExternalCarrier,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { Modal } from '../../../components/UI';
import { SearchableSelect, TextField, type SearchableSelectOption } from '../../../design-system';
import { DispatchTaskTagEditor } from './DispatchTaskTagEditor';
import { formatMoneyInput, normalizeMoneyInput } from '../../../lib/moneyInput';
import { IssueOrderFields } from './IssueOrderFields';
import { QuickIssueOrderDialog } from './QuickIssueOrderDialog';
import { useIssueOrder } from './useIssueOrder';
import './DispatchPlanEditorCell.css';

export type IssueOrderResult = DispatchShipmentResponse;

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
  /** Stored driver-facing note after the save. */
  operationalNotes: string | null;
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
      operationalNotes?: string | null;
    },
  ) => Promise<AtomicPlanSaveResult>;
  /** Opens the governed trip reassignment flow after an order is issued. */
  onOpenTripReassign: (tripId: number) => void;
  /** "Phát lệnh" — issues the order for the already-saved plan (carrier +
   *  vehicle), creating the live trip and notifying the driver. */
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => Promise<IssueOrderResult>;
  disabled?: boolean;
}

interface PlanEditorDraft {
  carrierValue: string;
  vehicleValue: string;
  plannedRevenue: string;
  plannedCarrierCost: string;
  /** Composed driver note (tags + manual text) — see DispatchTaskTagEditor. */
  operationalNotes: string | null;
}

/** Plate alone doesn't tell a dispatcher which driver they're assigning —
 *  pair it with the driver name so the picker is recognizable. */
function ownTruckLabel(truck: DispatchTruck): string {
  return `${truck.licensePlate} — ${truck.assignedDriverName ?? 'Chưa gán tài xế'}`;
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

/** Resolves any vehicle-select value to its plate for comparison. The row's
 *  own-fleet placeholder (`current:{plate}`) and the same truck's fetched
 *  option (`truck:{id}`) are two different value strings for one vehicle —
 *  without this, re-selecting the already-assigned truck (or just opening
 *  the picker) registers as an unsaved change and the fetched list shows the
 *  same plate twice. */
function vehiclePlateKey(value: string, options: SearchableSelectOption[]): string {
  if (!value) return '';
  if (value.startsWith(CURRENT_PLATE_PREFIX)) return normalizePlate(value.slice(CURRENT_PLATE_PREFIX.length));
  if (value.startsWith(FREE_TEXT_PREFIX)) return normalizePlate(value.slice(FREE_TEXT_PREFIX.length));
  const label = options.find((option) => option.value === value)?.label;
  return label ? normalizePlate(label.split(' — ')[0]) : value;
}

export function isCombinableContainer(label?: string | null): boolean {
  if (!label) return false;
  const upper = label.trim().toUpperCase();
  return upper.includes('20') && !upper.includes('40') && !upper.includes('45');
}

function draftForRow(row: DispatchDetailPlanRow): PlanEditorDraft {
  return {
    carrierValue: carrierValueForRow(row),
    vehicleValue: vehicleValueForRow(row),
    plannedRevenue: row.estimates.plannedRevenue ?? '',
    plannedCarrierCost: row.estimates.plannedCarrierCost ?? '',
    operationalNotes: row.notes.vehicleNote,
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
export function DispatchPlanEditorCell({ row, onAtomicSave, onOpenTripReassign, onIssueOrder, disabled = false }: DispatchPlanEditorCellProps) {
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

  const [quickIssueOpen, setQuickIssueOpen] = useState(false);
  const quickIssueTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreQuickFocusRef = useRef(false);

  const selectedCarrier = parseCarrier(draft.carrierValue);
  const draftUsesOwnFleet = selectedCarrier?.carrierType === 'OWN';

  const issueStatus = deriveDispatchIssueStatus({
    vehicleAssigned: row.dispatch.assignedPlate != null,
    issued: row.taskStatus === 'DISPATCHED' && row.dispatch.tripId != null,
  });
  // Issuing acts on the saved plan, not unsaved draft edits — block it while
  // the dialog has pending carrier/vehicle changes so it can't fire against
  // stale assignment data the user hasn't saved yet.
  const carrierSwitched = draft.carrierValue !== carrierValueForRow(row);
  const vehicleChanged = carrierSwitched
    ? draft.vehicleValue !== ''
    : vehiclePlateKey(draft.vehicleValue, vehicleOptions) !== vehiclePlateKey(vehicleValueForRow(row), vehicleOptions);
  const planDirty = carrierSwitched || vehicleChanged;
  const canIssue = issueStatus === 'PLATED_NOT_ISSUED' && !planDirty;

  const {
    ownTruck,
    loadingOwnTruck,
    issueDraft,
    setIssueDraft,
    issuing,
    issueError,
    setIssueError,
    issue,
  } = useIssueOrder({
    row,
    open,
    canIssue,
    onIssueOrder,
    onIssued: () => { restoreFocusRef.current = true; setOpen(false); },
  });

  useEffect(() => {
    if (!open) setDraft(draftForRow(row));
  }, [open, row]);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (quickIssueOpen || !restoreQuickFocusRef.current) return;
    restoreQuickFocusRef.current = false;
    quickIssueTriggerRef.current?.focus({ preventScroll: true });
  }, [quickIssueOpen]);

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
        ? (response.items as DispatchTruck[]).map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: ownTruckLabel(truck) }))
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
    // The row's own-fleet placeholder (`current:{plate}`) is the same truck as
    // its fetched `truck:{id}` option — fold them into one entry (keeping the
    // fetched option's driver-name label) instead of listing the plate twice.
    const currentPlateKey = vehiclePlateKey(draft.vehicleValue, vehicleOptions);
    const matchIndex = merged.findIndex((option) => vehiclePlateKey(option.value, vehicleOptions) === currentPlateKey);
    const label = matchIndex !== -1
      ? merged[matchIndex].label
      : (draft.vehicleValue.startsWith(CURRENT_PLATE_PREFIX)
        ? draft.vehicleValue.slice(CURRENT_PLATE_PREFIX.length)
        : row.dispatch.assignedPlate ?? 'Biển số hiện tại');
    const withoutDuplicate = matchIndex !== -1 ? merged.filter((_, index) => index !== matchIndex) : merged;
    return [{ value: draft.vehicleValue, label }, ...withoutDuplicate];
  }, [draft.vehicleValue, row.dispatch.assignedPlate, suggestions, vehicleOptions]);

  function openEditor() {
    if (disabled) return;
    // An issued order owns a live trip. Its vehicle must be changed through
    // the trip reassignment flow so the driver/vehicle state stays coherent.
    if (row.taskStatus === 'DISPATCHED'
      && row.dispatch.tripId != null
      && row.dispatch.tripStatus === 'CREATED') {
      onOpenTripReassign(row.dispatch.tripId);
      return;
    }
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
        ? (response.items as DispatchTruck[]).map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: ownTruckLabel(truck) }))
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
    const body = vehicleBody(draft.vehicleValue);
    if (body == null) {
      setError('Biển số đã chọn không hợp lệ.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onAtomicSave(row, {
        carrierType: carrier.carrierType,
        externalCarrierId: carrier.carrierType === 'EXTERNAL' ? carrier.externalCarrierId ?? null : null,
        // Send the vehicle block only when the editor actually touches it —
        // an estimates/classification-only save must not disturb stored columns.
        ...(vehicleChanged ? body : {}),
        plannedRevenue: revenue.value,
        plannedCarrierCost: carrierCost.value,
        operationalNotes: draft.operationalNotes,
      });
      // Stay open — saving carrier/vehicle here is usually step one of
      // "xếp xe rồi phát lệnh" in one sitting; closing would force a
      // re-open just to reach the Phát lệnh action below.
      // Re-anchor the draft to the saved state: the picker's option value
      // (truck:{id}) never string-matches the row-derived current:{plate},
      // so without this reset planDirty stays true and Phát lệnh remains
      // blocked right after the save that was supposed to enable it.
      setDraft({
        carrierValue: result.dispatch.carrierType === 'OWN'
          ? OWN_CARRIER_VALUE
          : `${EXTERNAL_CARRIER_PREFIX}${result.dispatch.externalCarrierId}`,
        vehicleValue: result.dispatch.externalCarrierVehicleId != null
          ? `${EXTERNAL_VEHICLE_PREFIX}${result.dispatch.externalCarrierVehicleId}`
          : result.dispatch.assignedPlate ? `${CURRENT_PLATE_PREFIX}${result.dispatch.assignedPlate}` : '',
        plannedRevenue: result.estimates.plannedRevenue ?? '',
        plannedCarrierCost: result.estimates.plannedCarrierCost ?? '',
        operationalNotes: result.operationalNotes,
      });
    } catch {
      setError('Không thể lưu kế hoạch. Kiểm tra thông báo của bảng và thử lại.');
    } finally {
      setSaving(false);
    }
  }

  function openQuickIssue() {
    if (disabled) return;
    setQuickIssueOpen(true);
  }

  function closeQuickIssue() {
    restoreQuickFocusRef.current = true;
    setQuickIssueOpen(false);
  }

  const identity = row.container.containerNumber || row.docs.billNumber || row.shipmentCode || `dòng ${row.fulfillmentId}`;
  const currentPlate = row.dispatch.assignedPlate;
  const canReassignIssuedTrip = row.taskStatus === 'DISPATCHED'
    && row.dispatch.tripId != null
    && row.dispatch.tripStatus === 'CREATED';

  return (
    <div className="dispatch-assignment-cell">
      <button
        ref={triggerRef}
        type="button"
        className={`dispatch-assignment-cell__trigger${issueStatus === 'PLATED_NOT_ISSUED' ? ' dispatch-assignment-cell__trigger--has-quick-issue' : ''}`}
        data-cell-label="Điều phối"
        onClick={openEditor}
        disabled={disabled}
        aria-haspopup={canReassignIssuedTrip ? undefined : 'dialog'}
        aria-label={canReassignIssuedTrip ? `Phân xe lại ${identity}` : `Sửa ô điều phối ${identity}`}
        title={canReassignIssuedTrip ? 'Phân xe lại trước khi chuyến xuất phát' : `Chỉnh sửa điều phối · ${identity}`}
      >
        <span className="dispatch-assignment-cell__carrier">{row.dispatch.carrierName ?? 'Chưa phân nhà xe'}</span>
        <span className={`dispatch-assignment-cell__plate${currentPlate ? '' : ' is-placeholder'}`}>
          {currentPlate || (row.dispatch.carrierType === 'OWN' ? 'Chưa phân xe' : 'CUS sẽ bổ sung')}
        </span>
        <DispatchIssueStatusChip status={issueStatus} />
        {/* Cước thu/trả temporarily hidden from the grid cell per customer
            request (docx T2.3); the editor dialog still shows and saves both. */}
        {row.lotFullyPlated && !currentPlate && (
          <span className="detailed-plan-grid__lot-flag">Đã phân xe</span>
        )}
      </button>

      {issueStatus === 'PLATED_NOT_ISSUED' && (
        <button
          ref={quickIssueTriggerRef}
          type="button"
          className="dispatch-assignment-cell__quick-issue"
          onClick={openQuickIssue}
          disabled={disabled}
          aria-label={`Phát lệnh nhanh · ${identity}`}
          title="Phát lệnh nhanh — không cần mở ô điều phối"
        >
          <Send size={13} aria-hidden="true" />
        </button>
      )}

      <QuickIssueOrderDialog
        row={row}
        open={quickIssueOpen}
        onClose={closeQuickIssue}
        onIssueOrder={onIssueOrder}
      />

      <Modal
        isOpen={open}
        title={`Chỉnh sửa điều phối · ${identity}`}
        onClose={closeEditor}
        maxWidth={560}
        footer={(
          <>
            <button type="button" className="btn btn--secondary" onClick={closeEditor} disabled={saving || issuing}>Hủy</button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving || issuing}>
              <Save size={16} aria-hidden="true" />
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
            {issueStatus === 'PLATED_NOT_ISSUED' && (
              <button
                type="button"
                className="btn btn--primary dispatch-assignment-dialog__issue-btn"
                onClick={() => void issue()}
                disabled={!canIssue || issuing || saving}
                title={planDirty ? 'Lưu thay đổi điều phối trước khi phát lệnh' : undefined}
              >
                <Send size={16} aria-hidden="true" />
                {issuing ? 'Đang phát lệnh…' : 'Phát lệnh'}
              </button>
            )}
          </>
        )}
      >
        <form className="dispatch-assignment-dialog" aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="dispatch-assignment-dialog__fields">
            <label htmlFor={`dispatch-carrier-${row.fulfillmentId}`} className="dispatch-assignment-dialog__carrier">
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
                size="sm"
              />
            </label>
            <label htmlFor={`dispatch-vehicle-${row.fulfillmentId}`} className="dispatch-assignment-dialog__vehicle">
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
                size="sm"
              />
            </label>
            <TextField
              id={`dispatch-revenue-${row.fulfillmentId}`}
              className="dispatch-assignment-dialog__money dispatch-assignment-dialog__revenue"
              label="Cước thu dự kiến"
              inputMode="numeric"
              autoComplete="off"
              value={formatMoneyInput(draft.plannedRevenue)}
              suffix="đ"
              onChange={(event) => { setDraft((current) => ({ ...current, plannedRevenue: normalizeMoneyInput(event.target.value) })); setError(null); }}
              disabled={saving}
            />
            <TextField
              id={`dispatch-cost-${row.fulfillmentId}`}
              className="dispatch-assignment-dialog__money dispatch-assignment-dialog__cost"
              label="Cước trả dự kiến"
              inputMode="numeric"
              autoComplete="off"
              value={formatMoneyInput(draft.plannedCarrierCost)}
              suffix="đ"
              onChange={(event) => { setDraft((current) => ({ ...current, plannedCarrierCost: normalizeMoneyInput(event.target.value) })); setError(null); }}
              disabled={saving}
            />
          </div>
          <DispatchTaskTagEditor
            value={draft.operationalNotes}
            onChange={(next) => setDraft((current) => ({ ...current, operationalNotes: next }))}
            disabled={saving}
          />
          {error && <p className="dispatch-assignment-dialog__error" role="alert">{error}</p>}

          {issueStatus === 'PLATED_NOT_ISSUED' && (
            <fieldset className="dispatch-assignment-dialog__issue" disabled={issuing}>
              <legend>Phát lệnh cho tài xế</legend>
              {planDirty ? (
                <p className="dispatch-assignment-dialog__issue-hint">
                  Lưu thay đổi điều phối ở trên trước khi phát lệnh.
                </p>
              ) : (
                <IssueOrderFields
                  row={row}
                  ownTruck={ownTruck}
                  loadingOwnTruck={loadingOwnTruck}
                  issueDraft={issueDraft}
                  setIssueDraft={setIssueDraft}
                  onFieldTouched={() => setIssueError(null)}
                />
              )}
              {issueError && <p className="dispatch-assignment-dialog__error" role="alert">{issueError}</p>}
            </fieldset>
          )}
        </form>
      </Modal>
    </div>
  );
}
