import { DispatchIssueStatusChip, deriveDispatchIssueStatus } from '../components/DispatchIssueStatus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { DispatchClassification } from '@tingting/shared';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchDetailPlanRow,
  type DispatchExternalCarrier,
  type DispatchTruck,
} from '../../../api/dispatchPlanningClient';
import { api } from '../../../lib/api';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { Modal } from '../../../components/UI';
import { SearchableSelect, TextField, type SearchableSelectOption } from '../../../design-system';
import {
  CURRENT_PLATE_PREFIX,
  EXTERNAL_VEHICLE_PREFIX,
  EXTERNAL_CARRIER_PREFIX,
  FREE_TEXT_PREFIX,
  OWN_CARRIER_VALUE,
  SUGGESTION_LABELS,
  carrierValueForRow,
  classificationOptionsForRow,
  normalizePlate,
  parseCarrier,
  plateCompareKey,
  vehiclePlateKey,
  vehicleValueForRow,
} from './DispatchPlanCellValues';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { DispatchTaskTagEditor } from './DispatchTaskTagEditor';
import { formatMoneyInput, normalizeMoneyInput } from '../../../lib/moneyInput';
import { IssueOrderFields } from './IssueOrderFields';
import { useIssueOrder } from './useIssueOrder';
import { ownTruckLabel, requiredTrailerTypeForContainer, trailerFitRank, trailerMismatchSuffix } from './trailerFit';
import './DispatchPlanEditorCell.css';

export type IssueOrderResult = DispatchShipmentResponse;

const PAGE_LOAD_SIZE = 50;
const OWN_TRUCK_PREFIX = 'truck:';

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
    assignedDriverName?: string | null;
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
      operationalNotes?: string | null;
    },
  ) => Promise<AtomicPlanSaveResult>;
  /** Opens the governed trip reassignment flow after an order is issued. */
  onOpenTripReassign: (tripId: number) => void;
  /** Staff close for external-carrier trips: opens the confirm dialog so
   *  dispatch/CUS can complete the trip the external driver can't (no app). */
  onCompleteExternalTrip: (row: DispatchDetailPlanRow) => void;
  /** Fulfillment-less branch rows must decompose before the editor can open;
   *  resolves to the fresh (fulfilled) row, or null when the write fails. */
  onEnsureFulfillment?: (row: DispatchDetailPlanRow) => Promise<DispatchDetailPlanRow | null>;
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
  classification: DispatchClassification;
  /** Composed driver note (tags + manual text) — see DispatchTaskTagEditor. */
  operationalNotes: string | null;
}


function draftForRow(row: DispatchDetailPlanRow): PlanEditorDraft {
  return {
    carrierValue: carrierValueForRow(row),
    vehicleValue: vehicleValueForRow(row),
    plannedRevenue: row.estimates.plannedRevenue ?? '',
    plannedCarrierCost: row.estimates.plannedCarrierCost ?? '',
    classification: row.classification,
    operationalNotes: row.notes.vehicleNote,
  };
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
 * carrier, vehicle, estimates and Phân loại (Đơn/Kẹp/Kết hợp — the dispatcher's
 * call since 2026-09-08) save together through PATCH
 * /dispatch-detail-plan-rows/:id/plan or not at all. The lot-level Đóng kết
 * hợp flag is CUS-owned and has no control here — the checkbox was removed as
 * redundant with the Kết hợp classification.
 */
export function DispatchPlanEditorCell({ row, onAtomicSave, onOpenTripReassign, onCompleteExternalTrip, onIssueOrder, onEnsureFulfillment, disabled = false }: DispatchPlanEditorCellProps) {
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
  // Trailer type per loaded truck id — lets the pinned D±1 suggestion labels
  // carry the same mismatch warning as the page list without re-fetching.
  const truckTrailerTypesRef = useRef(new Map<number, string | null>());
  // Truck fleet-page carrier links (id → link) from the loaded pages — the
  // own-truck promotion reads this so an explicit link wins over the generic
  // internal default.
  const truckCarrierLinksRef = useRef(new Map<number, { plate: string; carrierId: number; carrierName: string }>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fleet fetches must never masquerade as "no data": a failed list load
  // renders a retry affordance instead of the misleading empty message
  // (debug order #2 — QA's combobox evidence came from this swallow).
  const [carrierError, setCarrierError] = useState(false);
  const [vehicleError, setVehicleError] = useState(false);
  const [fleetRetryNonce, setFleetRetryNonce] = useState(0);
  // Branch-row decompose in flight (fulfillment-less rows must decompose
  // before the editor can target a fulfillment identity).
  const [ensuring, setEnsuring] = useState(false);

  const selectedCarrier = parseCarrier(draft.carrierValue);
  const draftUsesOwnFleet = selectedCarrier?.carrierType === 'OWN';

  const issueStatus = deriveDispatchIssueStatus({
    vehicleAssigned: row.dispatch.assignedPlate != null,
    issued: row.taskStatus === 'DISPATCHED' && row.dispatch.tripId != null,
    completed: row.taskStatus === 'COMPLETED',
    driverAccepted: row.dispatch.driverAccepted === true,
  });
  // Issuing acts on the saved plan, not unsaved draft edits — block it while
  // any plan field is edited, including costs and driver-facing notes.
  // Otherwise releasing would close the dialog and silently discard edits.
  const carrierSwitched = draft.carrierValue !== carrierValueForRow(row);
  const vehicleChanged = carrierSwitched
    ? draft.vehicleValue !== ''
    : vehiclePlateKey(draft.vehicleValue, vehicleOptions) !== vehiclePlateKey(vehicleValueForRow(row), vehicleOptions);
  const revenue = parseVnd(draft.plannedRevenue);
  const carrierCost = parseVnd(draft.plannedCarrierCost);
  const storedRevenue = parseVnd(row.estimates.plannedRevenue ?? '');
  const storedCarrierCost = parseVnd(row.estimates.plannedCarrierCost ?? '');
  const planDirty = carrierSwitched || vehicleChanged
    || draft.classification !== row.classification
    || (draft.operationalNotes ?? '') !== (row.notes.vehicleNote ?? '')
    || !revenue.valid || !carrierCost.valid
    || revenue.value !== storedRevenue.value
    || carrierCost.value !== storedCarrierCost.value;
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
        setCarrierError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCarrierOptions([]);
          setCarrierCursor(null);
          setCarrierError(true);
        }
      })
      .finally(() => { if (!cancelled) setLoadingCarriers(false); });
    return () => { cancelled = true; };
  }, [carrierSearch, open, fleetRetryNonce]);

  // A carrier-less row (dispatch.carrierType null) has no carrier option to
  // pick first, so waiting for one would leave the vehicle combobox empty
  // forever — auto-load the own-fleet TRUCK list instead; picking a truck
  // below promotes it to the OWN carrier (ticket 8afc13a9, Option B).
  const rowIsCarrierLess = row.dispatch.carrierType == null;
  useEffect(() => {
    if (!open) return undefined;
    if (!selectedCarrier && !rowIsCarrierLess) return undefined;
    let cancelled = false;
    setLoadingVehicles(true);
    // OWN once picked; carrier-less with nothing picked yet defaults to the
    // own-fleet TRUCK list; an EXTERNAL pick always wins over the row's
    // carrier-less origin.
    const isOwnFleet = selectedCarrier?.carrierType === 'OWN' || (rowIsCarrierLess && selectedCarrier == null);
    // Own-truck loads carry the row context so the backend can pin LH
    // D-1/D+1 suggestions beside the page.
    const request = isOwnFleet
      ? listDispatchFleetResources('TRUCK', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        fulfillmentId: row.fulfillmentId,
      })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        carrierId: selectedCarrier!.externalCarrierId,
      });
    request.then((response) => {
      if (cancelled) return;
      let mapped: SearchableSelectOption[];
      if (isOwnFleet) {
        const trucks = response.items as DispatchTruck[];
        truckTrailerTypesRef.current = new Map(trucks.map((truck) => [truck.id, truck.trailerType]));
        truckCarrierLinksRef.current = new Map(trucks
          .filter((truck) => truck.carrierId != null)
          .map((truck) => [truck.id, { plate: truck.licensePlate, carrierId: truck.carrierId!, carrierName: truck.carrierName ?? '' }]));
        const requiredTrailerType = requiredTrailerTypeForContainer(row.container.containerTypeLabel, draft.classification);
        // Stable sort (ES2019+): fits first, unknowns keep page order, mismatches sink.
        const ranked = requiredTrailerType != null
          ? [...trucks].sort((a, b) => trailerFitRank(a.trailerType, requiredTrailerType) - trailerFitRank(b.trailerType, requiredTrailerType))
          : trucks;
        mapped = ranked.map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: ownTruckLabel(truck, requiredTrailerType) }));
      } else {
        mapped = (response.items as DispatchCarrierVehicle[]).map((vehicle) => ({ value: `${EXTERNAL_VEHICLE_PREFIX}${vehicle.id}`, label: vehicle.licensePlate }));
      }
      const normalizedSearch = normalizePlate(vehicleSearch);
      // Free-text entry must also exist on a carrier-less row: the plate→
      // carrier autofill only fires when NO carrier is selected, and the
      // carrier-less default list is own-fleet — without this the operator
      // could never reach the free-text option that triggers the lookup.
      const freeTextOption = (!isOwnFleet || rowIsCarrierLess)
        && normalizedSearch.length >= 4
        && !mapped.some((option) => option.label === normalizedSearch)
        ? [{ value: `${FREE_TEXT_PREFIX}${normalizedSearch}`, label: `Dùng biển số: ${normalizedSearch}` }]
        : [];
      setVehicleOptions([...freeTextOption, ...mapped]);
      setVehicleCursor(response.nextCursor);
      setSuggestions(isOwnFleet ? response.suggestedItems ?? [] : []);
      setVehicleError(false);
    }).catch(() => {
      if (!cancelled) {
        setVehicleOptions([]);
        setVehicleCursor(null);
        setSuggestions([]);
        setVehicleError(true);
      }
    }).finally(() => { if (!cancelled) setLoadingVehicles(false); });
    return () => { cancelled = true; };
    // `selectedCarrier` is a fresh object every render (parseCarrier of the
    // draft); the effect keys on the two primitives it actually consumes so
    // the vehicle list doesn't reload on every keystroke elsewhere.
  }, [open, row.fulfillmentId, selectedCarrier?.carrierType, selectedCarrier?.externalCarrierId, vehicleSearch, rowIsCarrierLess, fleetRetryNonce, draft.classification]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectableCarrierOptions = useMemo(() => {
    const options = [{ value: OWN_CARRIER_VALUE, label: 'SilverSea — xe nội bộ' }, ...carrierOptions];
    // Fallback option only for a real selection — '' (unassigned) keeps the
    // placeholder. A carrier promoted from a truck link resolves its name
    // from the link before falling back to the row's saved carrier.
    if (draft.carrierValue && !options.some((option) => option.value === draft.carrierValue)) {
      const promotedId = draft.carrierValue.startsWith(EXTERNAL_CARRIER_PREFIX)
        ? Number(draft.carrierValue.slice(EXTERNAL_CARRIER_PREFIX.length))
        : null;
      const promotedName = promotedId != null
        ? [...truckCarrierLinksRef.current.values()].find((link) => link.carrierId === promotedId)?.carrierName
        : null;
      options.splice(1, 0, { value: draft.carrierValue, label: promotedName ?? row.dispatch.carrierName ?? 'Nhà xe đã ngừng hoạt động' });
    }
    return options;
  }, [carrierOptions, draft.carrierValue, row.dispatch.carrierName]);

  // Pinned LH suggestions render ahead of the page's trucks, deduped by option
  // value; reason tags travel in the label so screen readers get the same
  // signal as sighted users, and a trailer mismatch warns there too.
  const selectableVehicleOptions = useMemo(() => {
    const requiredTrailerType = requiredTrailerTypeForContainer(row.container.containerTypeLabel, draft.classification);
    const suggestionOptions: SearchableSelectOption[] = suggestions
      .filter((suggestion) => vehicleOptions.some((option) => option.value === `${OWN_TRUCK_PREFIX}${suggestion.truckId}`))
      .map((suggestion) => {
        const tags = suggestion.reasons.map((reason) => SUGGESTION_LABELS[reason]).join(' · ');
        const warning = trailerMismatchSuffix(truckTrailerTypesRef.current.get(suggestion.truckId) ?? null, requiredTrailerType);
        return {
          value: `${OWN_TRUCK_PREFIX}${suggestion.truckId}`,
          label: `${suggestion.plateNumber} — ${tags}${warning}`,
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
  }, [draft.vehicleValue, draft.classification, row.dispatch.assignedPlate, row.container.containerTypeLabel, suggestions, vehicleOptions]);

  async function openEditor() {
    if (disabled) return;
    // An issued order owns a trip. While it runs, its vehicle must be changed
    // through the trip reassignment flow so the driver/vehicle state stays
    // coherent. Once it completes, the plan is frozen history — the backend's
    // live-trip guard rejects any plan save, so the editor must never open.
    if (row.dispatch.tripId != null
      && row.taskStatus === 'DISPATCHED'
      && (row.dispatch.tripStatus === 'CREATED' || row.dispatch.tripStatus === 'IN_TRANSIT')) {
      onOpenTripReassign(row.dispatch.tripId);
      return;
    }
    if (row.taskStatus === 'COMPLETED') return;
    // Fulfillment-less branch row: the editor needs a fulfillment identity,
    // so decompose the container first and reopen on the fresh row (the
    // parent patches items, making props.row the created fulfillment).
    if (row.fulfillmentId == null) {
      if (!onEnsureFulfillment) return;
      setEnsuring(true);
      let ensured = false;
      try {
        ensured = (await onEnsureFulfillment(row)) != null;
      } finally {
        setEnsuring(false);
      }
      if (!ensured) return;
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
    if (vehicleCursor == null || loadingVehicles) return;
    setLoadingVehicles(true);
    const isOwnFleet = selectedCarrier?.carrierType === 'OWN' || (rowIsCarrierLess && selectedCarrier == null);
    const request = isOwnFleet
      ? listDispatchFleetResources('TRUCK', { limit: PAGE_LOAD_SIZE, q: vehicleSearch || undefined, cursor: vehicleCursor, fulfillmentId: row.fulfillmentId })
      : listDispatchFleetResources('EXTERNAL_VEHICLE', {
        limit: PAGE_LOAD_SIZE,
        q: vehicleSearch || undefined,
        carrierId: selectedCarrier!.externalCarrierId,
        cursor: vehicleCursor,
      });
    request.then((response) => {
      let mapped: SearchableSelectOption[];
      if (isOwnFleet) {
        const trucks = response.items as DispatchTruck[];
        for (const truck of trucks) {
          truckTrailerTypesRef.current.set(truck.id, truck.trailerType);
          if (truck.carrierId != null) {
            truckCarrierLinksRef.current.set(truck.id, { plate: truck.licensePlate, carrierId: truck.carrierId, carrierName: truck.carrierName ?? '' });
          }
        }
        const requiredTrailerType = requiredTrailerTypeForContainer(row.container.containerTypeLabel, draft.classification);
        const ranked = requiredTrailerType != null
          ? [...trucks].sort((a, b) => trailerFitRank(a.trailerType, requiredTrailerType) - trailerFitRank(b.trailerType, requiredTrailerType))
          : trucks;
        mapped = ranked.map((truck) => ({ value: `${OWN_TRUCK_PREFIX}${truck.id}`, label: ownTruckLabel(truck, requiredTrailerType) }));
      } else {
        mapped = (response.items as DispatchCarrierVehicle[]).map((vehicle) => ({ value: `${EXTERNAL_VEHICLE_PREFIX}${vehicle.id}`, label: vehicle.licensePlate }));
      }
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
      await onAtomicSave(row, {
        carrierType: carrier.carrierType,
        externalCarrierId: carrier.carrierType === 'EXTERNAL' ? carrier.externalCarrierId ?? null : null,
        // Send the vehicle block only when the editor actually touches it —
        // an estimates/classification-only save must not disturb stored columns.
        ...(vehicleChanged ? body : {}),
        plannedRevenue: revenue.value,
        plannedCarrierCost: carrierCost.value,
        classification: draft.classification,
        operationalNotes: draft.operationalNotes,
      });
      restoreFocusRef.current = true;
      setOpen(false);
    } catch (saveError) {
      // The grid-level banner renders behind this modal, so the dialog must
      // speak for itself: show the backend's specific 409 reason (version
      // conflict, live-trip guard) inline instead of a generic retry hint.
      const err = saveError as { status?: number; message?: string };
      setError(err.status === 409 && err.message
        ? err.message
        : 'Không thể lưu kế hoạch. Kiểm tra thông báo của bảng và thử lại.');
    } finally {
      setSaving(false);
    }
  }

  const identity = row.container.containerNumber || row.docs.billNumber || row.shipmentCode || `dòng ${row.fulfillmentId}`;
  const currentPlate = row.dispatch.assignedPlate;
  // Completed rows are frozen history (the backend rejects plan saves), so the
  // trigger locks with an explanation instead of opening a doomed editor.
  const planFrozen = row.taskStatus === 'COMPLETED';
  const canReassignIssuedTrip = row.taskStatus === 'DISPATCHED'
    && row.dispatch.tripId != null
    && (row.dispatch.tripStatus === 'CREATED' || row.dispatch.tripStatus === 'IN_TRANSIT');

  return (
    <div className="dispatch-assignment-cell">
      <button
        ref={triggerRef}
        type="button"
        className="dispatch-assignment-cell__trigger"
        data-cell-label="Điều phối"
        onClick={openEditor}
        disabled={disabled || planFrozen || ensuring}
        aria-haspopup={canReassignIssuedTrip ? undefined : 'dialog'}
        aria-label={canReassignIssuedTrip ? `Phân xe lại ${identity}` : `Sửa ô điều phối ${identity}`}
        title={planFrozen
          ? 'Chuyến đã hoàn thành — kế hoạch điều phối đã chốt'
          : canReassignIssuedTrip
            ? 'Phân xe lại trước khi chuyến xuất phát'
            : `Chỉnh sửa điều phối · ${identity}`}
      >
        <span className="dispatch-assignment-cell__carrier">{row.dispatch.carrierName ?? 'Chưa phân nhà xe'}</span>
        <span className={`dispatch-assignment-cell__plate${currentPlate ? '' : ' is-placeholder'}`}>
          {currentPlate || (row.dispatch.carrierType === 'OWN' ? 'Chưa phân xe' : 'CUS sẽ bổ sung')}
        </span>
        {currentPlate && (row.dispatch.assignedDriverName || row.dispatch.carrierType === 'OWN') && (
          <span className={`dispatch-assignment-cell__driver${row.dispatch.assignedDriverName ? '' : ' is-placeholder'}`} title={row.dispatch.assignedDriverName || undefined}>
            {row.dispatch.assignedDriverName || 'Chưa có tài xế'}
          </span>
        )}
        <DispatchIssueStatusChip status={issueStatus} />
        {/* Cước thu/trả temporarily hidden from the grid cell per customer
            request (docx T2.3); the editor dialog still shows and saves both. */}
        {row.lotFullyPlated && !currentPlate && (
          <span className="detailed-plan-grid__lot-flag">Đã phân xe</span>
        )}
      </button>

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
                {issuing ? 'Đang phát lệnh…' : 'Phát lệnh'}
              </button>
            )}
            {row.dispatch.carrierType === 'EXTERNAL' && row.dispatch.tripId != null && row.taskStatus === 'DISPATCHED' && (
              <button
                type="button"
                className="btn btn--primary dispatch-assignment-dialog__complete-btn"
                onClick={() => {
                  closeEditor();
                  onCompleteExternalTrip(row);
                }}
                disabled={saving || issuing}
              >
                Hoàn thành chuyến
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
            {carrierError ? (
              <p className="dispatch-assignment-dialog__error" role="status">
                Không tải được danh sách nhà xe.{' '}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFleetRetryNonce((n) => n + 1)}>
                  Thử lại
                </button>
              </p>
            ) : null}
            <label htmlFor={`dispatch-vehicle-${row.fulfillmentId}`} className="dispatch-assignment-dialog__vehicle">
              <span>Xe / biển số</span>
              <SearchableSelect
                id={`dispatch-vehicle-${row.fulfillmentId}`}
                value={draft.vehicleValue}
                onChange={(value) => {
                  // Explicit fleet carrier link wins over the generic internal
                  // default: picking a subcontracted tractor on a carrier-less
                  // row fills its owning nhà xe and rides as that carrier's
                  // plate. Unlinked trucks keep the OWN promotion (Option B)
                  // so save still passes its carrier check.
                  const truckId = value.startsWith(OWN_TRUCK_PREFIX) ? Number(value.slice(OWN_TRUCK_PREFIX.length)) : null;
                  const linkedCarrier = truckId != null ? truckCarrierLinksRef.current.get(truckId) : undefined;
                  setDraft((current) => {
                    if (truckId == null || current.carrierValue) {
                      return { ...current, vehicleValue: value };
                    }
                    return linkedCarrier
                      ? {
                        ...current,
                        vehicleValue: `${FREE_TEXT_PREFIX}${linkedCarrier.plate}`,
                        carrierValue: `${EXTERNAL_CARRIER_PREFIX}${linkedCarrier.carrierId}`,
                      }
                      : { ...current, vehicleValue: value, carrierValue: OWN_CARRIER_VALUE };
                  });
                  setError(null);
                  // KP-047: When a free-text plate is entered, resolve the
                  // carrier consistently — same result whether the user picks
                  // the truck from the dropdown or types its plate. First
                  // check the loaded vehicle options for a matching truck;
                  // only fall back to the API call when no local match exists.
                  if (value.startsWith(FREE_TEXT_PREFIX)) {
                    const typedPlate = value.slice(FREE_TEXT_PREFIX.length);
                    const typedKey = plateCompareKey(typedPlate);
                    const matchedOption = vehicleOptions.find((option) => {
                      if (!option.value.startsWith(OWN_TRUCK_PREFIX)) return false;
                      return plateCompareKey(option.label.split(' — ')[0]) === typedKey;
                    });
                    if (matchedOption) {
                      // Local match: promote to the truck option and set
                      // carrier (same path as picking from the dropdown).
                      const matchedTruckId = Number(matchedOption.value.slice(OWN_TRUCK_PREFIX.length));
                      const matchedLink = truckCarrierLinksRef.current.get(matchedTruckId);
                      setDraft((current) => {
                        if (current.carrierValue) return { ...current, vehicleValue: matchedOption.value };
                        return matchedLink
                          ? { ...current, vehicleValue: matchedOption.value, carrierValue: `${EXTERNAL_CARRIER_PREFIX}${matchedLink.carrierId}` }
                          : { ...current, vehicleValue: matchedOption.value, carrierValue: OWN_CARRIER_VALUE };
                      });
                    } else if (!draft.carrierValue) {
                      // No local match and no carrier selected: resolve via API.
                      api.get<{ carrierId: number | null }>(`/shipments/carrier-fleet-vehicles/resolve-carrier?plate=${encodeURIComponent(typedPlate)}`).then(({ carrierId }) => {
                        if (carrierId) {
                          setDraft((current) => ({
                            ...current,
                            carrierValue: current.carrierValue || `${EXTERNAL_CARRIER_PREFIX}${carrierId}`,
                          }));
                        }
                      }).catch(() => { /* best-effort */ });
                    }
                  }
                }}
                onSearchChange={setVehicleSearch}
                options={selectableVehicleOptions}
                placeholder={draftUsesOwnFleet || rowIsCarrierLess ? 'Chọn biển số xe' : 'Chọn hoặc nhập biển số'}
                searchPlaceholder="Tìm biển số xe…"
                emptyMessage={loadingVehicles ? 'Đang tải…' : 'Không tìm thấy xe phù hợp.'}
                disabled={saving || (!selectedCarrier && !rowIsCarrierLess)}
                clearable
                clearLabel="Bỏ gán biển số"
                hasMore={vehicleCursor != null}
                onLoadMore={loadMoreVehicles}
                loadingMore={loadingVehicles && vehicleOptions.length > 0}
                size="sm"
              />
            </label>
            {vehicleError ? (
              <p className="dispatch-assignment-dialog__error" role="status">
                Không tải được danh sách xe.{' '}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFleetRetryNonce((n) => n + 1)}>
                  Thử lại
                </button>
              </p>
            ) : null}
            <UuiSelectField
              label="Phân loại"
              width="content"
              wrapperClassName="dispatch-assignment-dialog__classification"
              value={draft.classification}
              options={classificationOptionsForRow(row.classification)}
              onChange={(event) => {
                setDraft((current) => ({ ...current, classification: event.target.value as DispatchClassification }));
                setError(null);
              }}
              disabled={saving || row.classification === 'LCL'}
              hint={row.classification === 'LCL' ? 'Hàng lẻ giữ phân loại Lẻ — gắn với hình thức lô hàng' : undefined}
            />
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
