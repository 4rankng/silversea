// FB-092 — "Gán xe nhóm" dialog (Kế hoạch Chi tiết Xe).
//
// Assigns ONE truck to the dispatcher's selected LCL lots: a cost group whose
// Lô 1 carries 100% of the cước trả ĐV (members 2..N drop to 0₫ — the service
// owns that money jump) plus the group's BKS pair: actual (what runs the
// lane) and billing ("xe ảo", what the customer is told; auto-copied from the
// actual and freely editable).
//
// Sourcing rule (FB-090, shared lclVehicleSourcingRule): truck-tonnage
// classes are 100% xe ngoài — an internal-fleet plate is refused here with
// the same message the server enforces; container classes accept both.
//
// UI provenance: house Modal (design-system/Modal) + Untitled UI PRO v8
// components (catalog ids: base `button`, base `select`/`combobox` via
// USearchableField, base `checkbox` in the grid) — vendored locally at
// components/untitled-ui (never re-add via CLI).
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { USearchableField } from '../../shipments/create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { useTrucksAndDrivers, useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { assignLclCostGroup, type DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { lclVehicleSourcingRule, LclVehicleSourcing, LCL_VEHICLE_SOURCING_LABELS } from '@tingting/shared';
import { billBookingReference } from '../../../lib/business-reference';

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

  const [vehicleClassId, setVehicleClassId] = useState('');
  const [actualTruckNo, setActualTruckNo] = useState('');
  const [billingTruckNo, setBillingTruckNo] = useState('');
  const [billingTouched, setBillingTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-copy: the billing BKS follows the actual one until the operator
  // edits it by hand (spec: "auto-copy từ thực tế").
  useEffect(() => {
    if (!billingTouched) setBillingTruckNo(actualTruckNo.trim());
  }, [actualTruckNo, billingTouched]);

  const selectedClass = vehicleClasses.data?.find((vc) => String(vc.id) === vehicleClassId);
  const sourcingRule = selectedClass ? lclVehicleSourcingRule(selectedClass.isContainer) : null;

  const plateOptions = useMemo(() => {
    const plates = new Set<string>();
    for (const truck of trucksAndDrivers.data?.trucks ?? []) {
      if (truck.licensePlate?.trim()) plates.add(truck.licensePlate.trim());
    }
    return [...plates].map((plate) => ({ value: plate, label: plate, searchText: plate }));
  }, [trucksAndDrivers.data]);

  const internalPlates = useMemo(
    () => new Set((trucksAndDrivers.data?.trucks ?? []).map((truck) => truck.licensePlate?.trim()).filter(Boolean) as string[]),
    [trucksAndDrivers.data],
  );

  async function submit() {
    setError(null);
    if (!selectedClass) {
      setError('Chọn loại xe tính cước trả ĐV');
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
              ? `${LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.EXTERNAL_ONLY]} — BKS xe nội bộ bị từ chối.`
              : `${LCL_VEHICLE_SOURCING_LABELS[LclVehicleSourcing.INTERNAL_OR_EXTERNAL]} — chấp nhận cả xe nội bộ.`}
          </p>
        )}
        <USearchableField
          label="BKS thực (xe chạy chuyến)"
          value={actualTruckNo}
          onChange={(next) => setActualTruckNo(next)}
          options={plateOptions}
          placeholder="Chọn BKS hệ thống hoặc gõ mới"
          allowsCustomValue
          searchable
          onCustomValue={setActualTruckNo}
          required
        />
        <USearchableField
          label="BKS báo khách (ảo)"
          value={billingTruckNo}
          onChange={(next) => { setBillingTouched(true); setBillingTruckNo(next); }}
          options={plateOptions}
          placeholder="Mặc định copy BKS thực"
          allowsCustomValue
          searchable
          onCustomValue={(text) => { setBillingTouched(true); setBillingTruckNo(text); }}
          hint="Debit Note (FB-094) sẽ in BKS này, tuyệt đối không in BKS thực."
        />
      </div>
    </Modal>
  );
}
