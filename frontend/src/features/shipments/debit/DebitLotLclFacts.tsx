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
import { NumberField } from '../../../design-system';
import { USearchableField } from '../create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { setLclLotRevClass, unmergeLclLot, updateLclTruck } from '../../../api/dispatchPlanningClient';
import { ConfirmDialog } from '../../../components/UI';
import { formatMoney } from '../../../lib/format';
import { revOutputGroupLock } from '../../../lib/shipment-operations';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';
import { vehicleClassSectionedOptions } from '../../../lib/vehicle-class-options';

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
  // Spec 23/10 §4.1 field 2 — "Giá cước thu khách": auto-traced from the
  // picked class; a typed value is the negotiated override (blank = auto).
  const [manualFreightRevenue, setManualFreightRevenue] = useState<number | ''>('');

  useEffect(() => {
    setActual(row.actualTruckNo ?? '');
    setBilling(row.billingTruckNo ?? '');
  }, [row.shipmentId, row.actualTruckNo, row.billingTruckNo]);

  useEffect(() => {
    setRevClassId(currentRevClassId);
  }, [row.shipmentId, currentRevClassId]);
  // A per-lot manual price never survives a lot switch (it belongs to the lot
  // being edited, not the strip).
  useEffect(() => {
    setManualFreightRevenue('');
  }, [row.shipmentId]);

  const truckDirty = useMemo(
    () => actual.trim() !== (row.actualTruckNo ?? '') || billing.trim() !== (row.billingTruckNo ?? ''),
    [actual, billing, row.actualTruckNo, row.billingTruckNo],
  );

  const revClassDirty = revClassId !== '' && revClassId !== currentRevClassId;
  // Spec 23/10 §4.1 — the save arms on EITHER output: a new class (auto cước
  // theo loại xe) or a typed negotiated price (override).
  const revOutputDirty = revClassDirty || manualFreightRevenue !== '';
  // A grouped lot's class is set by the merge (spec 23/10 §4.2: the group's
  // Lô-1 law owns its members' cước thu) — change it after un-grouping.
  // SIL-548 (id 615, QA fail round 3): ANY merge group locks (owner law «lô
  // đã ghép phải KHÓA editor + hướng dẫn tách nhóm trước») — ONE shared law
  // with the Chi tiết lô hàng in-cell editor so the lock can never diverge
  // between the two surfaces again.
  const groupLock = revOutputGroupLock(row);
  const revClassLocked = groupLock.locked;

  async function saveTruck() {
    setSavingTruck(true);
    try {
      await updateLclTruck({
        shipmentId: row.shipmentId,
        ...(actual.trim() !== (row.actualTruckNo ?? '') ? { actualTruckNo: actual.trim() } : {}),
        // FB-141 (card 231026163927, spec 23/10 §4.1): BKS báo khách để trống
        // là HỢP LỆ — gửi `null` để clear về fallback "lấy BKS thực", không
        // gửi '' (schema cũ 400 "BKS không được để trống").
        ...(billing.trim() !== (row.billingTruckNo ?? '')
          ? { billingTruckNo: billing.trim() === '' ? null : billing.trim() }
          : {}),
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
    // Spec 23/10 §4.1 — send whichever output changed: a NEW class (with or
    // without a typed price) or the price alone (the untouched class is
    // already stored server-side; the schema needs just one of the two).
    const selected = sortedClasses.find((vc) => String(vc.id) === revClassId);
    if (revClassId !== '' && !selected) return;
    setSavingRevClass(true);
    try {
      const result = await setLclLotRevClass({
        shipmentId: row.shipmentId,
        ...(revClassDirty && selected ? { vehicleSizeClassId: selected.id } : {}),
        ...(manualFreightRevenue !== '' ? { freightRevenue: manualFreightRevenue } : {}),
      });
      toast({
        kind: 'success',
        message: manualFreightRevenue !== ''
          ? `Đã lưu giá cước thu khách nhập tay — ${formatMoney(manualFreightRevenue)} ₫ áp cho lô này`
          : result.freightAuto == null
            ? `Đã lưu loại xe tính cước thu (Xe ${result.vehicleClassCode}) — bảng giá khách × tuyến chưa có giá: CƯỚC VẬN TẢI (AUTO) đang Chưa xác định`
            : `Đã lưu loại xe tính cước thu (Xe ${result.vehicleClassCode}) — CƯỚC VẬN TẢI (AUTO) = 100% đơn giá loại xe`,
      });
      // The typed price is consumed by the save — clear it so the button
      // re-arms only on the NEXT real edit (no accidental double-send).
      setManualFreightRevenue('');
      onChanged();
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Lưu cước thu khách thất bại' });
    } finally {
      setSavingRevClass(false);
    }
  }

  // FB-095 — one lot leaves its group; the server promotes Lô 2 with the
  // crown + 100% of the money (or dissolves the group) inside one transaction.
  async function doUnmerge() {
    const dimension = confirmUnmerge;
    if (dimension == null) return;
    setUnmerging(dimension);
    try {
      const result = await unmergeLclLot({ shipmentId: row.shipmentId, dimension });
      // Spec 23/10 §4.2: inside a REV group Lô 1 holds 100% and members 0₫ —
      // so the principal's exit PROMOTES the money to Lô 2 (transferredAmount),
      // while a member's exit leaves it awaiting its own per-lot reprice.
      const message = result.promoted
        ? (dimension === 'REV'
          ? `Đã hủy ghép — Bill ${result.promoted.reference} thành Lô chính và nhận 100% cước thu nhóm`
          : `Đã hủy ghép — Bill ${result.promoted.reference} nhận 100% cước trả ĐV`)
        : result.dissolved
          ? 'Đã hủy ghép — nhóm giải tán'
          : `Đã hủy ghép — lô rời nhóm, còn ${result.remaining.length} lô trong nhóm`;
      toast({ kind: 'success', message });
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
        {/* SIL-482 (consult spec 24/10): the two plate fields sit in a 2-col
            grid (minmax(0,1fr) — items can shrink, no wrap/clip) instead of
            the old flex-wrap that staggered field 1 under field 2 and pushed
            "Lưu BKS" inline beside the helper text. Action row lives below
            the grid, right-aligned, per the same spec. */}
        <div className="debit-lot-lcl-facts__truck-grid">
          <USearchableField
            label="Nhà xe - BKS thực"
            value={actual}
            onChange={setActual}
            options={plateOptions}
            allowsCustomValue
            searchable
            onCustomValue={setActual}
            hideLabel={false}
            placeholder="Chọn nhà xe / BKS thực…"
          />
          {/* FB-141 — BKS báo khách là output TÙY CHỌN: ghost placeholder =
              BKS thực khi có (người dùng thấy giá trị sẽ được dùng nếu bỏ
              trống), fallback text hướng dẫn; hint chốt luật. Submit gửi
              null khi trống (xem saveTruck). */}
          <USearchableField
            label="BKS ảo"
            value={billing}
            onChange={setBilling}
            options={plateOptions}
            allowsCustomValue
            searchable
            onCustomValue={setBilling}
            placeholder={row.actualTruckNo ? row.actualTruckNo : 'Trống = tự động dùng BKS thực'}
            hint="Mặc định dùng BKS thực tế nếu để trống"
          />
        </div>
        <div className="debit-lot-lcl-facts__actions">
          <UUIButton
            size="md"
            color="primary"
            onPress={() => void saveTruck()}
            isDisabled={!truckDirty || savingTruck}
          >
            {savingTruck ? 'Đang lưu…' : 'Lưu BKS'}
          </UUIButton>
        </div>
        {row.billingTruckNo && row.actualTruckNo && row.billingTruckNo !== row.actualTruckNo && (
          <span className="debit-lot-lcl-facts__billing-warn" title="Debit Note in BKS báo khách, không in BKS thực">
            BKS ảo: {row.billingTruckNo} — khác BKS thực
          </span>
        )}
      </div>
      {/* 161026232349 (§II.3.2 "Thu riêng từng lô") + spec 23/10 §4.1 — the
          lot's OWN thu outputs: Loại xe thu khách + Giá cước thu (auto theo
          loại / nhập tay). A lot inside a rev group keeps the group's outputs:
          the fields disable and say so (the server refuses the same way).
          FB-145: sau Tách nhóm ô này phải TRỐNG (BE gỡ revVehicleClassId của
          nhóm) — CUS chọn lại loại xe từng lô. FB-138: grouped menu
          "XE TẢI (TẤN)" | "CONTAINER" — cùng builder shared với popup ĐV. */}
      <div className="debit-lot-lcl-facts__block">
        <small>CƯỚC THU KHÁCH (TỪNG LÔ)</small>
        <div className="debit-lot-lcl-facts__truck">
          <USearchableField
            label="Loại xe tính cước thu khách"
            value={revClassId}
            onChange={setRevClassId}
            options={vehicleClassSectionedOptions(sortedClasses)}
            placeholder="Chọn loại xe (trọng tải / cont)"
            searchable
            disabled={revClassLocked}
            hint={groupLock.hint}
          />
          <NumberField
            label="Giá cước thu khách (đ)"
            value={manualFreightRevenue}
            onChange={setManualFreightRevenue}
            grouped
            min={0}
            placeholder="Bỏ trống = tự tra bảng giá"
            helpText="Nhập tay giá thỏa thuận — thắng giá tra bảng theo loại xe. Bỏ trống: tự tra bảng giá thu khách."
            disabled={revClassLocked}
          />
          <UUIButton
            size="sm"
            color="secondary"
            onPress={() => void saveRevClass()}
            isDisabled={revClassLocked || !revOutputDirty || savingRevClass}
          >
            {savingRevClass ? 'Đang lưu…' : 'Lưu cước thu'}
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
                {row.costGroupPrincipalRef && <em title={`Ghép cùng Bill ${row.costGroupPrincipalRef}`}>{`Ghép cùng Bill ${row.costGroupPrincipalRef}`}</em>}
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
                {row.revGroupPrincipalRef && <em title={`Ghép cước cùng Bill ${row.revGroupPrincipalRef}`}>{`Ghép cước cùng Bill ${row.revGroupPrincipalRef}`}</em>}
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
          ? 'Hủy ghép cước thu khách cho lô này? Lô chính rời nhóm thì 100% cước thu chuyển sang lô kế tiếp (nhóm còn 1 lô thì giải tán); thành viên rời nhóm thì cước thu của lô đó chờ định giá lại theo từng lô.'
          : 'Hủy ghép cước trả ĐV cho lô này? Khoản cước 100% tự động chuyển sang lô kế tiếp trong nhóm (nhóm còn 1 lô thì giải tán).'}
        confirmLabel={unmerging != null ? 'Đang hủy…' : 'Hủy ghép'}
        onConfirm={() => void doUnmerge()}
        onCancel={() => { if (unmerging == null) setConfirmUnmerge(null); }}
      />
    </div>
  );
}
