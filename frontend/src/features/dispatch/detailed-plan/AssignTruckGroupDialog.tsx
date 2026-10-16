// FB-092 — "Gán xe nhóm" dialog (Kế hoạch Chi tiết Xe).
//
// Assigns ONE truck to the dispatcher's selected LCL lots: a cost group whose
// Lô 1 carries 100% of the cước trả ĐV (members 2..N drop to 0₫ — the service
// owns that money jump) plus the group's BKS pair: actual (what runs the
// lane) and billing ("xe ảo", what the customer is told; auto-copied from the
// actual and freely editable).
//
// Field 2 (161026232309) — "Chọn Nhà xe & Biển số xe thực tế": the group's
// vehicle source is chosen first, and it decides the plate list.
//   • truck-tonnage class (FB-090 rule: 100% xe ngoài) ⇒ only Nhà thầu
//     (Xe ngoài); the internal fleet is neither listed nor accepted;
//   • container class ⇒ Đội xe nội bộ SilverSea OR a Nhà thầu.
// The chosen source persists with the group (the lot's "phân bổ xe" channel),
// so reopening a grouped lot redisplays the nhà xe it was assigned to.
//
// Field 3 (161026232319) — cước trả ĐV of Lô 1: left empty the server traces
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
import { lclVehicleSourcingRule, LclVehicleSourcing, LCL_VEHICLE_SOURCING_LABELS } from '@tingting/shared';
import { billBookingReference } from '../../../lib/business-reference';

const OWN_CARRIER_KEY = carrierOptionKey('OWN', null);

export interface AssignTruckGroupDialogProps {
  /** Selected LCL rows in the operator's click order (index 0 = Lô 1). */
  rows: DispatchDetailPlanRow[];
  onClose: () => void;
  /** Called after a successful assignment (the page refreshes the grid). */
  onAssigned: () => void;
}

export function AssignTruckGroupDialog({ rows, onClose, onAssigned }: AssignTruckGroupDialogProps) {
  const { toast } = useToast();
  const vehicleClasses = useVehicleSizeClasses();
  const trucksAndDrivers = useTrucksAndDrivers({ enabled: rows.length > 0 });
  const carrierCatalog = useCarrierAllocationOptions();

  const [vehicleClassId, setVehicleClassId] = useState('');
  const [carrierKey, setCarrierKey] = useState('');
  const [actualTruckNo, setActualTruckNo] = useState('');
  const [billingTruckNo, setBillingTruckNo] = useState('');
  // A ref, not state: the flag only gates the auto-copy effect, and the seed
  // effect must be able to raise it BEFORE that sibling effect runs in the
  // same commit (a state flag would still read false there and clobber the
  // stored "BKS báo khách" with the actual plate on reopen).
  const billingTouchedRef = useRef(false);
  const [manualFreightCost, setManualFreightCost] = useState<number | ''>('');
  const [carrierVehicles, setCarrierVehicles] = useState<DispatchCarrierVehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedClass = vehicleClasses.data?.find((vc) => String(vc.id) === vehicleClassId);
  const sourcingRule = selectedClass ? lclVehicleSourcingRule(selectedClass.isContainer) : null;

  const externalCarrierId = useMemo(() => {
    if (!carrierKey.startsWith('EXTERNAL:')) return null;
    const raw = carrierKey.slice('EXTERNAL:'.length);
    return /^\d+$/.test(raw) ? Number(raw) : null;
  }, [carrierKey]);
  const ownFleet = carrierKey === OWN_CARRIER_KEY;

  // Reopen a grouped lot with its stored identity in the form: loại xe, BKS
  // pair and the persisted vehicle source (nhà xe / đội xe nội bộ). Guarded by
  // the anchor's group id so a background re-render never clobbers edits.
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    const anchor = rows[0];
    const group = rows.find((row) => row.lcl?.group != null)?.lcl?.group ?? null;
    if (anchor == null || group == null) return;
    if (seededForRef.current === group.groupId) return;
    seededForRef.current = group.groupId;
    const storedClass = (vehicleClasses.data ?? []).find((vc) => vc.code === group.vehicleClassCode);
    if (storedClass) setVehicleClassId(String(storedClass.id));
    if (group.billingTruckNo) {
      billingTouchedRef.current = true;
      setBillingTruckNo(group.billingTruckNo);
    }
    if (group.actualTruckNo) setActualTruckNo(group.actualTruckNo);
    if (anchor.dispatch.carrierType === 'OWN') setCarrierKey(OWN_CARRIER_KEY);
    else if (anchor.dispatch.externalCarrierId != null) {
      setCarrierKey(carrierOptionKey('EXTERNAL', anchor.dispatch.externalCarrierId));
    }
  }, [rows, vehicleClasses.data]);

  // Auto-copy: the billing BKS follows the actual one until the operator
  // edits it by hand (spec: "auto-copy từ thực tế").
  useEffect(() => {
    if (!billingTouchedRef.current) setBillingTruckNo(actualTruckNo.trim());
  }, [actualTruckNo]);

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
  }, [externalCarrierId]);

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
      setError('Nhập BKS thực của xe chạy chuyến');
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
      const result = await assignLclCostGroup({
        shipmentIds: rows.map((row) => row.shipmentId),
        vehicleSizeClassId: selectedClass.id,
        actualTruckNo: actual,
        ...(billingTruckNo.trim() && billingTruckNo.trim() !== actual ? { billingTruckNo: billingTruckNo.trim() } : {}),
        ...(ownFleet ? { carrierType: 'OWN' as const } : { carrierType: 'EXTERNAL' as const, carrierId: externalCarrierId! }),
        ...(manualFreightCost === '' ? {} : { freightCost: manualFreightCost }),
      });
      toast({
        kind: 'success',
        message: `Đã gán nhóm xe cho ${result.memberCount} lô — Lô 1 (${rows[0] ? billBookingReference(rows[0].docs.billNumber) : ''}) giữ 100% cước trả ĐV, các lô còn lại 0₫`,
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
      title="Gán xe nhóm"
      subtitle={`${rows.length} lô lẻ · Lô 1 giữ 100% cước trả ĐV, các lô còn lại 0₫`}
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
        <ol className="assign-truck-group__lots" title="Thứ tự chọn quyết định Lô 1 (giữ 100% cước)">
          {rows.map((row, index) => (
            <li key={row.shipmentId}>
              {index === 0 ? 'Lô 1 · ' : `Lô ${index + 1} · `}
              {billBookingReference(row.docs.billNumber)}
              {row.customerRoute.customerName ? ` — ${row.customerRoute.customerName}` : ''}
            </li>
          ))}
        </ol>
        <USearchableField
          label="Loại xe tính cước trả ĐV"
          value={vehicleClassId}
          onChange={(next) => setVehicleClassId(next)}
          options={sortedClasses.map((vc) => ({
            value: String(vc.id),
            label: vc.name,
            searchText: vc.code,
          }))}
          placeholder="Chọn loại xe (trọng tải / cont)"
          searchable
          required
        />
        {sourcingRule && (
          <p className="assign-truck-group__hint">
            {sourcingRule === LclVehicleSourcing.EXTERNAL_ONLY
              ? `${LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.EXTERNAL_ONLY]} — BKS xe nội bộ bị từ chối, biển số chỉ lấy từ nhà xe.`
              : `${LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.INTERNAL_OR_EXTERNAL]} — chọn Đội xe nội bộ SilverSea hoặc Nhà xe.`}
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
          }}
          options={carrierOptions}
          placeholder={sourcingRule === LclVehicleSourcing.EXTERNAL_ONLY
            ? 'Chọn Nhà xe (xe ngoài)'
            : 'Chọn Đội xe nội bộ SilverSea hoặc Nhà xe'}
          searchable
          required
        />
        <USearchableField
          label="BKS thực (xe chạy chuyến)"
          value={actualTruckNo}
          onChange={(next) => setActualTruckNo(next)}
          options={plateOptions}
          placeholder={ownFleet ? 'Chọn BKS xe nội bộ hoặc gõ mới' : 'Chọn BKS của nhà xe hoặc gõ mới'}
          allowsCustomValue
          searchable
          onCustomValue={setActualTruckNo}
          required
        />
        <USearchableField
          label="BKS báo khách (ảo)"
          value={billingTruckNo}
          onChange={(next) => { billingTouchedRef.current = true; setBillingTruckNo(next); }}
          options={plateOptions}
          placeholder="Mặc định copy BKS thực"
          allowsCustomValue
          searchable
          onCustomValue={(text) => { billingTouchedRef.current = true; setBillingTruckNo(text); }}
          hint="Debit Note (FB-094) sẽ in BKS này, tuyệt đối không in BKS thực."
        />
        <NumberField
          label="Cước trả ĐV Lô 1 (đ) — nhập tay"
          value={manualFreightCost}
          onChange={setManualFreightCost}
          grouped
          min={0}
          placeholder="Bỏ trống = tự tra bảng giá"
          helpText="Bỏ trống: hệ thống tự tra bảng giá cước trả nhà xe (tuyến × loại xe × nhà xe). Nhập tay: số tiền này thắng giá tra được."
        />
      </div>
    </Modal>
  );
}
