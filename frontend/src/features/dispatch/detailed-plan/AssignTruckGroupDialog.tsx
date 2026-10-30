// FB-092 — "Gán xe nhóm" dialog (Kế hoạch Chi tiết Xe).
//
// Assigns ONE truck to the dispatcher's selected LCL lots: a cost group whose
// Lô 1 carries 100% of the cước trả ĐV (members 2..N drop to 0₫ — the service
// owns that money jump).
//
// Spec 23/10 (261023110000 §3): the popup carries EXACTLY 4 cost-side fields —
// Loại xe tính cước trả ĐV · Nhà xe · BKS thực · Cước trả ĐVVC. BKS báo khách
// ("xe ảo") is a CUS OUTPUT (spec §1: "không nhập BKS báo khách tại màn hình
// Điều vận") and no longer renders here, neither as a group field nor as the
// old per-lot cluster.
//
// Field 2 (161026232309) — "Chọn Nhà xe & Biển số xe thực tế": the group's
// vehicle source is chosen first, and it decides the plate list.
//   • truck-tonnage class (FB-090 rule: 100% xe ngoài) ⇒ only Nhà thầu
//     (Xe ngoài); the internal fleet is neither listed nor accepted;
//   • container class ⇒ Đội xe nội bộ SilverSea OR a Nhà thầu.
// The chosen source persists with the group (the lot's "phân bổ xe" channel),
// so reopening a grouped lot redisplays the nhà xe it was assigned to.
//
// Field 4 (161026232319) — Cước trả ĐVVC of Lô 1: left empty the server traces
// the bảng giá cước trả nhà xe (tuyến × loại xe × nhà xe); a value typed here
// is the "Điều vận nhập tay" price and always wins.
//
// UI provenance: house Modal (design-system/Modal) + Untitled UI PRO v8
// components (catalog ids: base `button`, base `select`/`combobox` via
// USearchableField, base `checkbox` in the grid) — vendored locally at
// components/untitled-ui (never re-add via CLI).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/UI';
import { NumberField } from '../../../design-system';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { USearchableField } from '../../shipments/create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { useTrucksAndDrivers, useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { carrierOptionKey } from '../../../components/shipment/CarrierAllocationSummary';
import { useCarrierAllocationOptions } from '../master-plan/useCarrierAllocationOptions';
import {
  assignLclCostGroup,
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
  type DispatchDetailPlanRow,
} from '../../../api/dispatchPlanningClient';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { lclVehicleSourcingRule, LclVehicleSourcing, LCL_VEHICLE_SOURCING_LABELS, assessLclCargoFit } from '@tingting/shared';
import { vehicleClassSectionedOptions } from '../../../lib/vehicle-class-options';
import { billBookingReference } from '../../../lib/business-reference';
import { formatVolumeCbm, formatWeight } from '../../../lib/format';
import { QuickAddVehicleDialog } from './QuickAddVehicleDialog';
import { QuickAddButton } from '../../../components/shared/QuickAddButton';
import './AssignTruckGroupDialog.css';

const OWN_CARRIER_KEY = carrierOptionKey('OWN', null);
// Same own-fleet label the dispatch editor's quick-add shows (card
// 101026043010) so the dialog context reads identically across surfaces.
const OWN_CARRIER_LABEL = 'SilverSea — xe nội bộ';

/**
 * The group dialog's own row contract. Both Kế hoạch screens feed it — the
 * master plan (shipment rows) and the detailed plan (fulfillment rows) —
 * through the adapters below, so the dialog never reads surface-specific
 * shapes.
 */
export interface LclGroupDialogRow {
  shipmentId: number;
  /** Số Bill / Số Booking display key. */
  reference: string;
  customerName: string | null;
  /** REQ-19 (2026-10-21) — the lot's own cargo facts, for the tải-trọng fit
   *  advisory next to the class picker (kg keys the fit; CBM rides along for
   *  the container-class eyeball). */
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
  /** Stored cost-group identity (null when the lot is ungrouped). */
  group: {
    groupId: string;
    vehicleClassCode: string | null;
    actualTruckNo: string | null;
  } | null;
  carrierType: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId: number | null;
}

/** Kế hoạch Chi tiết Xe row → dialog row. */
export function lclGroupRowFromDetail(row: DispatchDetailPlanRow): LclGroupDialogRow {
  return {
    shipmentId: row.shipmentId,
    reference: billBookingReference(row.docs.billNumber),
    customerName: row.customerRoute.customerName,
    cargoWeightKg: row.container.cargoWeightKg ?? null,
    cargoVolumeCbm: row.lcl?.cargoVolumeCbm ?? null,
    group: row.lcl?.group ?? null,
    carrierType: row.dispatch.carrierType,
    externalCarrierId: row.dispatch.externalCarrierId,
  };
}

/** Kế hoạch Tổng quát shipment row → dialog row. */
export function lclGroupRowFromMasterPlan(item: ShipmentListItem): LclGroupDialogRow {
  return {
    shipmentId: item.id,
    reference: billBookingReference(item.blNumber, item.bookingRef),
    customerName: item.customerName,
    cargoWeightKg: item.cargoWeightKg != null ? String(item.cargoWeightKg) : null,
    cargoVolumeCbm: item.cargoVolumeCbm != null ? String(item.cargoVolumeCbm) : null,
    group: item.costGroupId
      ? {
        groupId: item.costGroupId,
        vehicleClassCode: item.costVehicleClassCode ?? null,
        actualTruckNo: item.actualTruckNo ?? null,
      }
      : null,
    carrierType: null,
    externalCarrierId: null,
  };
}

export interface AssignTruckGroupDialogProps {
  /** Selected LCL rows in the operator's click order (index 0 = Lô 1). */
  rows: LclGroupDialogRow[];
  onClose: () => void;
  /** SIL-577: opener captured at interaction time — focus returns here on
   *  close. */
  openerRef?: { current: HTMLElement | null };
  /** Called after a successful assignment (the page refreshes the grid). */
  onAssigned: () => void;
  /**
   * Card _171026133000: this popup unmounts on close, so the loại xe / nhà xe
   * picks are held by the page and handed back here through these two seeds —
   * a "Hủy" without assigning no longer costs the operator both picks.
   */
  initialVehicleClassId?: string;
  initialCarrierKey?: string;
  /** Reports the two picks upward so the page can carry them across a reopen. */
  onDraftChange?: (draft: { vehicleClassId: string; carrierKey: string }) => void;
}

export function AssignTruckGroupDialog({
  rows,
  onClose,
  openerRef,
  onAssigned,
  initialVehicleClassId,
  initialCarrierKey,
  onDraftChange,
}: AssignTruckGroupDialogProps) {
  const { toast } = useToast();
  const vehicleClasses = useVehicleSizeClasses();
  const trucksAndDrivers = useTrucksAndDrivers({ enabled: rows.length > 0 });
  const carrierCatalog = useCarrierAllocationOptions();

  const [vehicleClassId, setVehicleClassId] = useState(initialVehicleClassId ?? '');
  const [carrierKey, setCarrierKey] = useState(initialCarrierKey ?? '');
  const [actualTruckNo, setActualTruckNo] = useState('');
  const [manualFreightCost, setManualFreightCost] = useState<number | ''>('');
  const [carrierVehicles, setCarrierVehicles] = useState<DispatchCarrierVehicle[]>([]);
  // FB-066 — quick-add a plate from the "BKS thực" picker. The nonce re-runs
  // the carrier-fleet fetch so a just-registered plate joins the option list
  // (the typed value is set directly, so it shows even before the refetch).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [fleetNonce, setFleetNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report the two picks so the page can seed them back on the next open. The
  // callback rides in a ref: an inline prop would otherwise re-fire this effect
  // every render and spin the page's draft state.
  const draftChangeRef = useRef(onDraftChange);
  draftChangeRef.current = onDraftChange;
  useEffect(() => {
    draftChangeRef.current?.({ vehicleClassId, carrierKey });
  }, [vehicleClassId, carrierKey]);

  const selectedClass = vehicleClasses.data?.find((vc) => String(vc.id) === vehicleClassId);
  const sourcingRule = selectedClass ? lclVehicleSourcingRule(selectedClass.isContainer) : null;

  // REQ-19 (2026-10-21) — tải trọng advisory: the consolidated group's Σ cargo
  // against the class the dispatcher just picked. Pure display of the shared
  // assessor (the same one the BE stamps on the assign result + audit); it
  // never blocks and never reprices — the money law stays the spec's board
  // price (Lô 1 = 100%, members 0₫).
  const cargoFit = useMemo(() => {
    if (!selectedClass) return null;
    return assessLclCargoFit({
      isContainer: selectedClass.isContainer,
      vehicleClassCode: selectedClass.code,
      cargoWeightKg: rows.map((row) => {
        const kg = row.cargoWeightKg == null || row.cargoWeightKg === '' ? NaN : Number(row.cargoWeightKg);
        return Number.isFinite(kg) ? kg : null;
      }),
    });
  }, [selectedClass, rows]);
  const totalCbm = useMemo(
    () => rows.reduce((sum, row) => {
      const cbm = row.cargoVolumeCbm == null || row.cargoVolumeCbm === '' ? NaN : Number(row.cargoVolumeCbm);
      return Number.isFinite(cbm) ? sum + cbm : sum;
    }, 0),
    [rows],
  );
  const fitLine = (() => {
    if (cargoFit == null || selectedClass == null) return null;
    const totals = `Tổng ${rows.length} lô: ${cargoFit.totalWeightKg != null ? `${formatWeight(String(cargoFit.totalWeightKg))} · ` : ''}${totalCbm > 0 ? formatVolumeCbm(String(totalCbm)) : '— CBM'}`;
    switch (cargoFit.status) {
      case 'FITS':
        return `${totals} — ${selectedClass.name}: vừa tải (${formatWeight(String(cargoFit.tonnageKg!))})`;
      case 'OVER':
        return `${totals} — VƯỢT TẢI TRỌNG ${selectedClass.name} (${formatWeight(String(cargoFit.tonnageKg!))})`;
      case 'NO_WEIGHT':
        return `Chưa có kg của lô nào để đối chiếu tải trọng ${selectedClass.code} — nhập trọng lượng từng lô trước khi quyết định loại xe.`;
      case 'CONTAINER_CLASS':
        return `${totals} — loại cont ${selectedClass.code} tính giá theo vỏ cont, đối chiếu tổng CBM với dung tích vỏ.`;
      case 'UNKNOWN_CLASS':
        return `${totals} — không đọc được tải trọng từ mã loại xe ${selectedClass.code}.`;
    }
  })();

  const externalCarrierId = useMemo(() => {
    if (!carrierKey.startsWith('EXTERNAL:')) return null;
    const raw = carrierKey.slice('EXTERNAL:'.length);
    return /^\d+$/.test(raw) ? Number(raw) : null;
  }, [carrierKey]);
  const ownFleet = carrierKey === OWN_CARRIER_KEY;

  // FB-138 (design direction 24/10, owner-approved) — switching the class to
  // a truck-tonnage rung while the form still holds the internal fleet (a
  // CONT-era pick) must RESET the nhà xe, never keep a dead OWN id that the
  // filtered list no longer offers (the QA "mồ côi" complaint): the plate
  // follows its source, and a warning tells the dispatcher to re-pick. An
  // outside nhà xe survives the flip (it is legal for both sourcing rules).
  const [carrierResetWarning, setCarrierResetWarning] = useState<string | null>(null);
  useEffect(() => {
    if (sourcingRule !== LclVehicleSourcing.EXTERNAL_ONLY) return;
    if (carrierKey === '' || carrierKey === OWN_CARRIER_KEY) {
      if (carrierKey === OWN_CARRIER_KEY) {
        setCarrierKey('');
        setActualTruckNo('');
        setCarrierResetWarning('Loại xe tải 100% xe ngoài — đã bỏ lựa chọn Đội xe nội bộ. Chọn lại Nhà xe.');
      }
      return;
    }
    setCarrierResetWarning(null);
  }, [sourcingRule, carrierKey]);

  // Reopen a grouped lot with its stored identity in the form: loại xe, BKS
  // thực and the persisted vehicle source (nhà xe / đội xe nội bộ). Guarded by
  // the anchor's group id so a background re-render never clobbers edits.
  // (Spec 23/10 §3: BKS báo khách is no longer a ĐV field, so only the cost
  // facts reseed.)
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    const anchor = rows[0];
    const group = rows.find((row) => row.group != null)?.group ?? null;
    if (anchor == null || group == null) return;
    if (seededForRef.current === group.groupId) return;
    seededForRef.current = group.groupId;
    const storedClass = (vehicleClasses.data ?? []).find((vc) => vc.code === group.vehicleClassCode);
    if (storedClass) setVehicleClassId(String(storedClass.id));
    if (group.actualTruckNo) setActualTruckNo(group.actualTruckNo);
    if (anchor.carrierType === 'OWN') setCarrierKey(OWN_CARRIER_KEY);
    else if (anchor.externalCarrierId != null) {
      setCarrierKey(carrierOptionKey('EXTERNAL', anchor.externalCarrierId));
    }
  }, [rows, vehicleClasses.data]);

  // The selected nhà xe's fleet — the plate list for an outside truck
  // (round-19 pattern, shared with TripReassignDialog: first page, free text
  // covers a longer fleet).
  useEffect(() => {
    if (externalCarrierId == null) {
      setCarrierVehicles([]);
      return undefined;
    }
    let cancelled = false;
    listDispatchFleetResources('EXTERNAL_VEHICLE', { carrierId: externalCarrierId, limit: 50 })
      .then((response) => { if (!cancelled) setCarrierVehicles(response.items as DispatchCarrierVehicle[]); })
      .catch(() => { if (!cancelled) setCarrierVehicles([]); });
    return () => { cancelled = true; };
  }, [externalCarrierId, fleetNonce]);

  // FB-066 — the own-fleet quick-add lands a TRUCK, so refetch the catalog
  // list that feeds `internalPlates` after a create (same nonce contract).
  const { refetch: refetchTrucks } = trucksAndDrivers;

  const internalPlates = useMemo(
    () => new Set((trucksAndDrivers.data?.trucks ?? []).map((truck) => truck.licensePlate?.trim()).filter(Boolean) as string[]),
    [trucksAndDrivers.data],
  );

  const carrierOptions = useMemo(() => {
    // Truck-tonnage classes are 100% xe ngoài: the internal fleet is not even
    // listed, so a dispatcher cannot pick what the server would refuse.
    const pickable = carrierCatalog.options.filter(
      (option) => option.carrierType === 'EXTERNAL' || sourcingRule !== LclVehicleSourcing.EXTERNAL_ONLY,
    );
    return pickable.map((option) => ({
      value: option.key,
      label: option.carrierType === 'OWN' ? option.label : `${option.label} — xe ngoài`,
      searchText: option.label,
    }));
  }, [carrierCatalog.options, sourcingRule]);

  const plateOptions = useMemo(() => {
    const plates = ownFleet
      ? [...internalPlates]
      : carrierVehicles.map((vehicle) => vehicle.licensePlate?.trim()).filter(Boolean) as string[];
    return [...new Set(plates)].map((plate) => ({ value: plate, label: plate, searchText: plate }));
  }, [ownFleet, internalPlates, carrierVehicles]);

  // FB-066 — the quick-add dialog's context line names the chosen source
  // (own fleet label, else the picked nhà xe), mirroring the dispatch editor.
  const quickAddCarrierName = ownFleet
    ? OWN_CARRIER_LABEL
    : carrierCatalog.options.find((option) => option.key === carrierKey)?.label ?? '';

  // FB-066 — preselect the just-registered plate and fold it into the options
  // (external list re-fetches via the nonce; own fleet refetches the catalog).
  const handleVehicleCreated = (_vehicleId: number, licensePlate: string) => {
    setActualTruckNo(licensePlate);
    setFleetNonce((nonce) => nonce + 1);
    if (ownFleet) void refetchTrucks();
    setQuickAddOpen(false);
  };

  async function submit() {
    setError(null);
    if (!selectedClass) {
      setError('Chọn loại xe tính cước trả ĐV');
      return;
    }
    if (!carrierKey) {
      setError(sourcingRule === LclVehicleSourcing.EXTERNAL_ONLY
        ? 'Hàng lẻ xe tải 100% xe ngoài — chọn Nhà xe (xe ngoài)'
        : 'Chọn nguồn xe: Đội xe nội bộ SilverSea hoặc Nhà xe (xe ngoài)');
      return;
    }
    if (!ownFleet && externalCarrierId == null) {
      setError('Nhà xe đã chọn không hợp lệ — chọn lại từ danh sách');
      return;
    }
    const actual = actualTruckNo.trim();
    if (!actual) {
      setError('Nhập BKS thực');
      return;
    }
    // Same rule the server enforces — caught here so the operator never loses
    // the form to a 400 (FB-090 sourcing rule).
    if (sourcingRule === LclVehicleSourcing.EXTERNAL_ONLY && internalPlates.has(actual)) {
      setError(`Hàng lẻ xe tải 100% xe ngoài — BKS ${actual} là xe nội bộ, chọn BKS nhà xe`);
      return;
    }
    setSaving(true);
    try {
      // Spec 23/10 §3 — exactly the 4 cost fields; the ĐV flow never writes a
      // BKS báo khách (that is CUS's output on /shipments/lcl/truck).
      const result = await assignLclCostGroup({
        shipmentIds: rows.map((row) => row.shipmentId),
        vehicleSizeClassId: selectedClass.id,
        actualTruckNo: actual,
        ...(ownFleet ? { carrierType: 'OWN' as const } : { carrierType: 'EXTERNAL' as const, carrierId: externalCarrierId! }),
        ...(manualFreightCost === '' ? {} : { freightCost: manualFreightCost }),
      });
      toast({
        kind: 'success',
        message: `Đã gán nhóm xe cho ${result.memberCount} lô — Lô 1 (${rows[0]?.reference ?? ''}) giữ 100% cước trả ĐV.`,
      });
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gán nhóm xe thất bại');
    } finally {
      setSaving(false);
    }
  }

  const sortedClasses = useMemo(
    () => [...(vehicleClasses.data ?? [])].filter((vc) => !vc.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    [vehicleClasses.data],
  );

  return (
    <Modal
      isOpen={rows.length > 0}
      onClose={onClose}
      openerRef={openerRef}
      title="Gán xe nhóm"
      subtitle={`${rows.length} lô lẻ`}
      footer={
        <>
          {error && <p className="assign-truck-group__error" role="alert">{error}</p>}
          <UUIButton size="sm" color="secondary" onPress={onClose} isDisabled={saving}>Hủy</UUIButton>
          <UUIButton size="sm" color="tertiary" onPress={() => void submit()} isDisabled={saving || rows.length < 2}>
            {saving ? 'Đang gán…' : 'Gán nhóm xe'}
          </UUIButton>
        </>
      }
    >
      <div className="assign-truck-group">
        {/* SIL-709 — the lot list: numbering lives in each line ("Lô 1 · …"). */}
        <ol className="assign-truck-group__lots">
          {rows.map((row, index) => (
            <li key={row.shipmentId}>
              {`Lô ${index + 1} · ${row.reference}${row.customerName ? ` — ${row.customerName}` : ''}`}
            </li>
          ))}
        </ol>
        <USearchableField
          label="Loại xe tính cước trả ĐV"
          value={vehicleClassId}
          onChange={(next) => setVehicleClassId(next)}
          // FB-138 — grouped menu: "XE TẢI (TẤN)" | "CONTAINER" section
          // headers (design direction 24/10), so the tonnage rungs are as
          // visible as the cont classes and the sourcing rule is testable.
          options={vehicleClassSectionedOptions(sortedClasses)}
          placeholder="Chọn loại xe (trọng tải / cont)"
          searchable
          required
        />
        {/* SIL-709 — the sourcing rule line only where it adds information
            beyond the carrier field's placeholder: the 100%-external rung
            restricts the PLATES. The cont rung's allowance ("Xe nội bộ hoặc
            xe ngoài") is already the placeholder — say it once there. */}
        {sourcingRule === LclVehicleSourcing.EXTERNAL_ONLY && (
          <p className="assign-truck-group__hint">
            {`${LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.EXTERNAL_ONLY]} — chỉ lấy BKS từ nhà xe.`}
          </p>
        )}
        {fitLine && (
          <p
            className={`assign-truck-group__fit${cargoFit?.status === 'OVER' ? ' assign-truck-group__fit--over' : ''}`}
            role="status"
          >
            {fitLine}
          </p>
        )}
        {carrierCatalog.empty && (
          <p className="assign-truck-group__hint">
            Danh mục chưa có Nhà xe (Xe ngoài) nào — đề nghị quản trị gắn cờ “Nhà xe” cho nhà thầu.
          </p>
        )}
        <USearchableField
          label="Nhà xe"
          value={carrierKey}
          onChange={(next) => {
            setCarrierKey(next);
            // The plate belongs to the source, never carried across it.
            setActualTruckNo('');
            // FB-138 — a fresh pick resolves the reset warning on its own.
            if (next !== '') setCarrierResetWarning(null);
          }}
          options={carrierOptions}
          placeholder={sourcingRule === LclVehicleSourcing.EXTERNAL_ONLY
            ? 'Chọn Nhà xe (xe ngoài)'
            : 'Chọn Đội xe nội bộ SilverSea hoặc Nhà xe'}
          searchable
          required
        />
        {/* FB-138 — the sourcing flip's visible consequence (never a silent
            dead id): the internal-fleet pick was dropped, re-pick an outside
            nhà xe. */}
        {carrierResetWarning && (
          <p className="assign-truck-group__hint" role="status">{carrierResetWarning}</p>
        )}
        {/* FB-066 — the "BKS thực" picker gets the quick-add affordance the
            dispatch editor and trip form already own: a dispatcher meeting a
            brand-new plate registers it under the chosen nhà xe without
            leaving the Gán xe nhóm flow (r25 guide step 3, lclspec). */}
        <div className="assign-truck-group__vehicle">
          <div className="assign-truck-group__vehicle-head">
            <span className="assign-truck-group__label">BKS thực <span aria-hidden="true">*</span></span>
            {(ownFleet || externalCarrierId != null) && (
              <QuickAddButton onClick={() => setQuickAddOpen(true)} disabled={saving} />
            )}
          </div>
          <USearchableField
            label="BKS thực"
            hideLabel
            value={actualTruckNo}
            onChange={(next) => setActualTruckNo(next)}
            options={plateOptions}
            placeholder={ownFleet ? 'Chọn BKS xe nội bộ hoặc gõ mới' : 'Chọn BKS của nhà xe hoặc gõ mới'}
            allowsCustomValue
            searchable
            onCustomValue={setActualTruckNo}
            required
          />
        </div>
        {/* Spec 23/10 §3 field 4 (SIL-537 wording: "Cước trả ĐV Lô 1") —
            blank ⇒ the server traces the carrier price board; a typed value is
            the manual override that always wins (161026232319). */}
        <div className="assign-truck-group__money-block">
          <NumberField
            label="Cước trả ĐV Lô 1 (đ)"
            value={manualFreightCost}
            onChange={setManualFreightCost}
            grouped
            min={0}
            placeholder="Bỏ trống = tự tra bảng giá"
          />
          {/* SIL-709 — the ONE place the cước law is said: a small caption under
              the field it explains (webchat deepseek 2nd opinion 30/10, verdict
              1: under "Cước trả ĐV Lô 1" as a caption — a list-adjacent note
              misreads as a list rule, a dialog footnote gets ignored; never a
              helpText paragraph — design law §8 no-lecturing-copy). */}
          <p className="assign-truck-group__note">Lô 1 (theo thứ tự chọn) giữ 100% cước trả ĐV · các lô còn lại 0₫</p>
        </div>
      </div>
      {/* FB-066 — register a brand-new plate under the chosen source; the
          created plate is preselected and folds into the option list. */}
      <QuickAddVehicleDialog
        isOpen={quickAddOpen}
        carrierId={ownFleet ? null : externalCarrierId}
        carrierName={quickAddCarrierName}
        onClose={() => setQuickAddOpen(false)}
        onCreated={handleVehicleCreated}
      />
    </Modal>
  );
}
