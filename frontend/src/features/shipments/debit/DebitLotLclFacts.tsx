// FB-093 — LCL lot facts strip on Chi phí - Quyết toán's expanded lot detail:
// THÔNG SỐ CONTAINER ("Lô lẻ | Thu: Xe 3.5T | Trả: Xe 10T"), PHÂN XE with the
// two-plate quick edit (BKS thực / BKS báo khách (Ảo) — combobox + free text,
// the truck being the cost group's shared identity) and the member's
// "Ghép cước cùng Bill X" note. FB-095 adds Hủy ghép (auto-promotes Lô 2 when
// the departing lot is the principal).
//
// 161026232349 (DEV SPEC §II.3.2 "Thu riêng từng lô"): an UNGROUPED lot also
// picks its own Loại xe tính cước thu khách here — the same searchable class
// field the merge popup uses, saving straight onto the lot and jumping CƯỚC
// VẬN TẢI (AUTO) to 100% of that class' lane price. A lot already inside a
// rev group keeps the group's class: the field is disabled with the "tách
// nhóm trước" hint (the server refuses the same way).
//
// UI provenance: Untitled UI PRO v8 base `button` + `select`/`combobox` via
// USearchableField — vendored at components/untitled-ui.
import { useEffect, useMemo, useState } from 'react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { USearchableField } from '../create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { setLclLotRevClass, unmergeLclLot, updateLclTruck } from '../../../api/dispatchPlanningClient';
import { ConfirmDialog } from '../../../components/UI';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';

export interface DebitLotLclFactsProps {
  row: ShipmentDebitLotRow;
  /** BKS suggestions — the internal fleet plus every carrier-fleet plate. */
  plateOptions: Array<{ value: string; label: string; searchText?: string }>;
  onChanged: () => void;
}

export function DebitLotLclFacts({ row, plateOptions, onChanged }: DebitLotLclFactsProps) {
  const { toast } = useToast();
  const [actual, setActual] = useState(row.actualTruckNo ?? '');
  const [billing, setBilling] = useState(row.billingTruckNo ?? '');
  const [savingTruck, setSavingTruck] = useState(false);
  const [savingRevClass, setSavingRevClass] = useState(false);
  // FB-095 — the user-facing trigger for the money-conservation law: which
  // dimension is being confirmed (dialog open) and which one is in flight.
  const [confirmUnmerge, setConfirmUnmerge] = useState<'COST' | 'REV' | null>(null);
  const [unmerging, setUnmerging] = useState<'COST' | 'REV' | null>(null);

  // FB-090 catalog — the same source (and sort) as MergeRevGroupDialog's field.
  const vehicleClasses = useVehicleSizeClasses();
  const sortedClasses = useMemo(
    () => [...(vehicleClasses.data ?? [])].filter((vc) => !vc.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    [vehicleClasses.data],
  );
  // The row carries the class CODE (never the id on the debit wire), so the
  // picker reopens on the stored class by matching the catalog's code.
  const currentRevClassId = useMemo(() => {
    const current = sortedClasses.find((vc) => vc.code === row.revVehicleClassCode);
    return current ? String(current.id) : '';
  }, [sortedClasses, row.revVehicleClassCode]);
  const [revClassId, setRevClassId] = useState(currentRevClassId);

  useEffect(() => {
    setActual(row.actualTruckNo ?? '');
    setBilling(row.billingTruckNo ?? '');
  }, [row.shipmentId, row.actualTruckNo, row.billingTruckNo]);

  useEffect(() => {
    setRevClassId(currentRevClassId);
  }, [row.shipmentId, currentRevClassId]);

  const truckDirty = useMemo(
    () => actual.trim() !== (row.actualTruckNo ?? '') || billing.trim() !== (row.billingTruckNo ?? ''),
    [actual, billing, row.actualTruckNo, row.billingTruckNo],
  );

  const revClassDirty = revClassId !== '' && revClassId !== currentRevClassId;
  // A grouped lot's cước thu belongs to the group (merge 100%/0₫ law).
  const revClassLocked = row.revGroupId != null;

  async function saveTruck() {
    setSavingTruck(true);
    try {
      await updateLclTruck({
        shipmentId: row.shipmentId,
        ...(actual.trim() !== (row.actualTruckNo ?? '') ? { actualTruckNo: actual.trim() } : {}),
        ...(billing.trim() !== (row.billingTruckNo ?? '') ? { billingTruckNo: billing.trim() } : {}),
      });
      toast({ kind: 'success', message: 'Đã cập nhật BKS của nhóm xe' });
      onChanged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Cập nhật BKS thất bại' });
    } finally {
      setSavingTruck(false);
    }
  }

  async function saveRevClass() {
    const selected = sortedClasses.find((vc) => String(vc.id) === revClassId);
    if (!selected) return;
    setSavingRevClass(true);
    try {
      const result = await setLclLotRevClass({ shipmentId: row.shipmentId, vehicleSizeClassId: selected.id });
      toast({
        kind: 'success',
        message: result.freightAuto == null
          ? `Đã lưu loại xe tính cước thu (Xe ${result.vehicleClassCode}) — bảng giá khách × tuyến chưa có giá: CƯỚC VẬN TẢI (AUTO) đang Chưa xác định`
          : `Đã lưu loại xe tính cước thu (Xe ${result.vehicleClassCode}) — CƯỚC VẬN TẢI (AUTO) = 100% đơn giá loại xe`,
      });
      onChanged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Lưu loại xe tính cước thu thất bại' });
    } finally {
      setSavingRevClass(false);
    }
  }

  // FB-095 — one lot leaves its group; the server promotes Lô 2 with 100% of
  // the money (or dissolves the group) inside one transaction.
  async function doUnmerge() {
    const dimension = confirmUnmerge;
    if (dimension == null) return;
    setUnmerging(dimension);
    try {
      const result = await unmergeLclLot({ shipmentId: row.shipmentId, dimension });
      toast({
        kind: 'success',
        message: result.promoted
          ? `Đã hủy ghép — Bill ${result.promoted.reference} nhận 100% ${dimension === 'REV' ? 'cước thu khách' : 'cước trả ĐV'}`
          : 'Đã hủy ghép — nhóm giải tán',
      });
      setConfirmUnmerge(null);
      onChanged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Hủy ghép thất bại' });
    } finally {
      setUnmerging(null);
    }
  }

  const params: string[] = [];
  if (row.cargoMode === 'LCL') {
    params.push('Lô lẻ');
    if (row.revVehicleClassCode) params.push(`Thu: Xe ${row.revVehicleClassCode}`);
    if (row.costVehicleClassCode) params.push(`Trả: Xe ${row.costVehicleClassCode}`);
  }

  return (
    <div className="debit-lot-lcl-facts">
      <div className="debit-lot-lcl-facts__block">
        <small>THÔNG SỐ CONTAINER</small>
        <span>{params.length > 0 ? params.join(' | ') : '—'}</span>
      </div>
      <div className="debit-lot-lcl-facts__block">
        <small>PHÂN XE</small>
        <div className="debit-lot-lcl-facts__truck">
          <USearchableField
            label="Nhà xe - BKS thực"
            value={actual}
            onChange={setActual}
            options={plateOptions}
            allowsCustomValue
            searchable
            onCustomValue={setActual}
            hideLabel={false}
          />
          <USearchableField
            label="BKS báo khách (Ảo)"
            value={billing}
            onChange={setBilling}
            options={plateOptions}
            allowsCustomValue
            searchable
            onCustomValue={setBilling}
          />
          <UUIButton
            size="sm"
            color="secondary"
            onPress={() => void saveTruck()}
            isDisabled={!truckDirty || savingTruck}
          >
            {savingTruck ? 'Đang lưu…' : 'Lưu BKS'}
          </UUIButton>
        </div>
        {row.billingTruckNo && row.actualTruckNo && row.billingTruckNo !== row.actualTruckNo && (
          <span className="debit-lot-lcl-facts__billing-warn" title="Debit Note in BKS báo khách, không in BKS thực">
            Báo khách (Ảo): {row.billingTruckNo} — khác BKS thực
          </span>
        )}
      </div>
      {/* 161026232349 (§II.3.2 "Thu riêng từng lô") — the lot's OWN thu class.
          A lot inside a rev group keeps the group's class: the field is
          disabled and says so (the server refuses the same way). */}
      <div className="debit-lot-lcl-facts__block">
        <small>LOẠI XE TÍNH CƯỚC THU KHÁCH</small>
        <div className="debit-lot-lcl-facts__truck">
          <USearchableField
            label="Loại xe tính cước thu khách"
            value={revClassId}
            onChange={setRevClassId}
            options={sortedClasses.map((vc) => ({ value: String(vc.id), label: vc.name, searchText: vc.code }))}
            placeholder="Chọn loại xe (trọng tải / cont)"
            searchable
            disabled={revClassLocked}
            hint={revClassLocked
              ? 'Lô đã thuộc nhóm ghép cước thu khách — tách nhóm (Hủy ghép) trước khi chọn loại xe riêng cho lô này.'
              : 'CƯỚC VẬN TẢI (AUTO) của lô = 100% đơn giá của loại xe đã chọn.'}
          />
          <UUIButton
            size="sm"
            color="secondary"
            onPress={() => void saveRevClass()}
            isDisabled={revClassLocked || !revClassDirty || savingRevClass}
          >
            {savingRevClass ? 'Đang lưu…' : 'Lưu loại xe'}
          </UUIButton>
        </div>
      </div>
      {(row.costGroupId != null || row.revGroupId != null) && (
        <div className="debit-lot-lcl-facts__block">
          <small>NHÓM GHÉP</small>
          <span className="debit-lot-lcl-facts__groups">
            {row.costGroupId != null && (
              <span className="debit-lot-lcl-facts__group">
                <span>Trả ĐV: Ghép ({row.costGroupOrder ?? '?'}/{row.costGroupMemberCount ?? '?'})</span>
                {row.costGroupPrincipalRef && <em>Ghép cùng Bill {row.costGroupPrincipalRef}</em>}
                <UUIButton
                  size="sm"
                  color="secondary"
                  onPress={() => setConfirmUnmerge('COST')}
                  isDisabled={unmerging != null}
                >
                  {unmerging === 'COST' ? 'Đang hủy…' : 'Hủy ghép'}
                </UUIButton>
              </span>
            )}
            {row.revGroupId != null && (
              <span className="debit-lot-lcl-facts__group">
                <span>Thu khách: Ghép ({row.revGroupOrder ?? '?'}/{row.revGroupMemberCount ?? '?'})</span>
                {row.revGroupPrincipalRef && <em>Ghép cước cùng Bill {row.revGroupPrincipalRef}</em>}
                <UUIButton
                  size="sm"
                  color="secondary"
                  onPress={() => setConfirmUnmerge('REV')}
                  isDisabled={unmerging != null}
                >
                  {unmerging === 'REV' ? 'Đang hủy…' : 'Hủy ghép'}
                </UUIButton>
              </span>
            )}
          </span>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmUnmerge != null}
        message={confirmUnmerge === 'REV'
          ? 'Hủy ghép cước thu khách cho lô này? Khoản cước 100% tự động chuyển sang lô kế tiếp trong nhóm (nhóm còn 1 lô thì giải tán).'
          : 'Hủy ghép cước trả ĐV cho lô này? Khoản cước 100% tự động chuyển sang lô kế tiếp trong nhóm (nhóm còn 1 lô thì giải tán).'}
        confirmLabel={unmerging != null ? 'Đang hủy…' : 'Hủy ghép'}
        onConfirm={() => void doUnmerge()}
        onCancel={() => { if (unmerging == null) setConfirmUnmerge(null); }}
      />
    </div>
  );
}
