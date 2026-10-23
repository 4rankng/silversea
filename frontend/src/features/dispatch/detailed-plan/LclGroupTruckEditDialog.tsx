// Card 191026100010 (B.1, cases DV-B1-03/04) — sau "Gán xe nhóm" (FB-092/093)
// BKS sống trên COST GROUP, và cả hai màn điều vận đều khép lại: checkbox
// lô trên /dispatch bị khóa ("tách nhóm trước khi ghép lại"), tái chọn lô thì
// assignLclCostGroup 409 ("đã thuộc nhóm ghép"). Module này sở hữu CẢ HAI
// affordance đổi BKS và một luật chung: updateLclTruck({ shipmentId, … }) lan
// toả BKS thực của TOÀN nhóm, nên:
//   • dialog (row action "Đổi BKS nhóm" trong menu Nhóm ghép trả ĐV) sửa
//     BKS thực của nhóm — GP-03 (spec 23/10 §1 "không nhập BKS báo khách tại
//     màn hình Điều vận"): hết ô BKS báo khách, BKS ảo là output CUS-side —
//     và PAGE sở hữu refetch qua onSaved, giống hệt wiring của Hủy ghép;
//   • dòng nhóm compact trong popup "Chỉnh sửa điều phối" (LclGroupTruckLine)
//     raise CÙNG page-owned dialog; còn save() của editor từ chối đẩy biển số
//     mới qua đường plan-save chỉ-hàng (xem DispatchPlanEditorCell) — save
//     hàng đơn lẻ sẽ làm grid hiện 2 BKS cho một nhóm và Debit Note (FB-094)
//     in nhầm BKS ảo cũ.
import { useEffect, useState } from 'react';
import { Modal } from '../../../components/UI';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { useToast } from '../../../components/shared/Toast';
import { USearchableField } from '../../shipments/create/uui-searchable-field';
import { QuickAddButton } from '../../../components/shared/QuickAddButton';
import { QuickAddVehicleDialog } from './QuickAddVehicleDialog';
import {
  listDispatchFleetResources,
  updateLclTruck,
  type DispatchDetailPlanRow,
} from '../../../api/dispatchPlanningClient';
import {
  CURRENT_PLATE_PREFIX,
  DEFERRED_PLATE_PREFIX,
  FREE_TEXT_PREFIX,
} from './DispatchPlanCellValues';
import './LclGroupTruckEditDialog.css';

// Same own-fleet label the dispatch editor's quick-add shows (card
// 101026043010) so the dialog context reads identically across surfaces.
const OWN_CARRIER_LABEL = 'SilverSea — xe nội bộ';

export interface LclGroupTruckEditDialogProps {
  /** Dòng LCL đã ghép nhóm — seed cặp BKS từ row.lcl.group; null = đóng. */
  row: DispatchDetailPlanRow | null;
  onClose: () => void;
  /** Sau khi updateLclTruck thành công — page invalidate/refetch grid. */
  onSaved: () => void;
}

/**
 * Card 191026100010 (DV-B1-03) — "Đổi BKS nhóm": dialog một field BKS thực,
 * seed từ BKS đã lưu của nhóm, gọi updateLclTruck đúng theo contract đã có
 * (FB-093) — không API mới. GP-03: không ô BKS báo khách ở ĐV (spec 23/10
 * §1) — payload không bao giờ mang billingTruckNo.
 */
export function LclGroupTruckEditDialog({ row, onClose, onSaved }: LclGroupTruckEditDialogProps) {
  const { toast } = useToast();
  const group = row?.lcl?.group ?? null;

  const [actualTruckNo, setActualTruckNo] = useState(group?.actualTruckNo ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Round-19 law (TripReassignDialog): BKS là SELECTOR trên fleet của chính
  // nhà xe đang gắn cho lô, free text cho biển chưa có trong danh mục. Lỗi
  // tải danh sách nuốt im lặng — free text vẫn là đường gõ trực tiếp.
  const [plateOptions, setPlateOptions] = useState<Array<{ value: string; label: string }>>([]);
  // FB-066 — quick-add a plate from the "BKS thực" picker. The nonce re-runs
  // the fleet fetch so a just-registered plate joins the option list (the
  // typed value is set directly, so it shows even before the refetch).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [fleetNonce, setFleetNonce] = useState(0);

  useEffect(() => {
    if (!row) return undefined;
    let cancelled = false;
    const request = row.dispatch.carrierType === 'EXTERNAL' && row.dispatch.externalCarrierId != null
      ? listDispatchFleetResources('EXTERNAL_VEHICLE', { carrierId: row.dispatch.externalCarrierId, limit: 50 })
      : row.dispatch.carrierType === 'OWN'
        ? listDispatchFleetResources('TRUCK', { limit: 50 })
        : null;
    if (!request) {
      setPlateOptions([]);
      return undefined;
    }
    request.then((response) => {
      if (cancelled) return;
      const plates = (response.items as Array<{ licensePlate?: string | null }>)
        .map((item) => item.licensePlate?.trim())
        .filter((plate): plate is string => Boolean(plate));
      setPlateOptions([...new Set(plates)].map((plate) => ({ value: plate, label: plate })));
    }).catch(() => { if (!cancelled) setPlateOptions([]); });
    return () => { cancelled = true; };
  }, [row, fleetNonce]);

  // FB-066 — the chosen source decides where the quick-add registers: own
  // fleet lands a TRUCK (carrierId null), external lands a Xe ngoài vehicle.
  const quickAddCarrierId = row?.dispatch.carrierType === 'EXTERNAL' ? row?.dispatch.externalCarrierId ?? null : null;
  const quickAddCarrierName = row?.dispatch.carrierType === 'OWN'
    ? OWN_CARRIER_LABEL
    : row?.dispatch.carrierName ?? '';

  const handleVehicleCreated = (_vehicleId: number, licensePlate: string) => {
    setActualTruckNo(licensePlate);
    setFleetNonce((nonce) => nonce + 1);
    setQuickAddOpen(false);
  };

  async function submit() {
    if (saving || !row || !group) return;
    setError(null);
    const actual = actualTruckNo.trim();
    if (!actual) {
      setError('Nhập BKS thực của xe chạy chuyến');
      return;
    }
    setSaving(true);
    try {
      // GP-03 — only BKS thực rides the ĐV write; billingTruckNo is the
      // CUS-side identity and never appears on this payload.
      await updateLclTruck({
        shipmentId: row.shipmentId,
        actualTruckNo: actual,
      });
      toast({
        kind: 'success',
        message: `Đã đổi BKS nhóm ${group.memberCount ?? '?'} lô — BKS thực ${actual}`,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đổi BKS nhóm thất bại');
    } finally {
      setSaving(false);
    }
  }

  // Hooks luôn chạy đủ trước guard (row có thể null giữa hai lần mở).
  if (!row || !group) return null;

  return (
    <Modal
      isOpen
      title="Đổi BKS nhóm"
      subtitle={`Nhóm ghép trả ĐV · Lẻ (${group.order ?? '?'}/${group.memberCount ?? '?'}) — BKS mới áp dụng cho cả nhóm`}
      onClose={() => { if (!saving) onClose(); }}
      maxWidth={460}
      footer={(
        <>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => { if (saving) return; onClose(); }}
            aria-disabled={saving || undefined}
          >
            Hủy
          </button>
          <DisabledActionTip
            id={`lcl-group-truck-save-${row.shipmentId}`}
            reason={saving ? 'Đang lưu BKS nhóm…' : null}
          >
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => { if (saving) return; void submit(); }}
              aria-disabled={saving || undefined}
            >
              {saving ? 'Đang lưu…' : 'Lưu BKS nhóm'}
            </button>
          </DisabledActionTip>
        </>
      )}
    >
      {error && <p className="lcl-group-truck-dialog__error" role="alert">{error}</p>}
      <div className="lcl-group-truck-dialog">
        {/* FB-066 — the "BKS thực" picker gets the quick-add affordance the
            dispatch editor and trip form already own: a dispatcher meeting a
            brand-new plate registers it under this lot's nhà xe without
            leaving the Đổi BKS nhóm flow (chungtu-dieuvan B.1, lclspec). */}
        <div className="lcl-group-truck-dialog__vehicle">
          <div className="lcl-group-truck-dialog__vehicle-head">
            <span className="lcl-group-truck-dialog__label">BKS thực (xe chạy chuyến) <span aria-hidden="true">*</span></span>
            {(row.dispatch.carrierType === 'OWN' || quickAddCarrierId != null) && (
              <QuickAddButton onClick={() => setQuickAddOpen(true)} disabled={saving} />
            )}
          </div>
          <USearchableField
            label="BKS thực (xe chạy chuyến)"
            hideLabel
            value={actualTruckNo}
            onChange={setActualTruckNo}
            onCustomValue={setActualTruckNo}
            options={plateOptions}
            placeholder="Chọn BKS của nhà xe hoặc gõ mới"
            searchable
            allowsCustomValue
            required
            disabled={saving}
          />
        </div>
        {/* GP-03 (spec 23/10 §1) — no "BKS báo khách" field on the ĐV side:
            the ảo plate is the CUS-side output (quick edit on Chi phí -
            Quyết toán / chi tiết lô), never entered at Điều vận. */}
      </div>
      {/* FB-066 — register a brand-new plate under this lot's source; the
          created plate is preselected and folds into the option list. */}
      <QuickAddVehicleDialog
        isOpen={quickAddOpen}
        carrierId={quickAddCarrierId}
        carrierName={quickAddCarrierName}
        onClose={() => setQuickAddOpen(false)}
        onCreated={handleVehicleCreated}
      />
    </Modal>
  );
}

/**
 * Card 191026100010 (DV-B1-04) — dòng nhóm compact trong popup "Chỉnh sửa
 * điều phối": chỉ hiện trên lô LCL đã ghép nhóm VÀ khi page đã wiring
 * onChangeGroupTruck (unwired = không nút chết, cùng luật badge FB-095).
 * Nút raise dòng lên page — page sở hữu dialog + refetch.
 */
export function LclGroupTruckLine({
  row,
  disabled,
  onChange,
}: {
  row: DispatchDetailPlanRow;
  disabled?: boolean;
  onChange?: (row: DispatchDetailPlanRow) => void;
}) {
  const group = row.cargoMode === 'LCL' ? row.lcl?.group : null;
  if (!group || !onChange) return null;
  const billingLine = group.billingTruckNo && group.billingTruckNo !== group.actualTruckNo
    ? ` · Ảo: ${group.billingTruckNo}`
    : '';
  return (
    <div className="lcl-group-truck-line">
      <span className="lcl-group-truck-line__text">
        {`BKS nhóm: ${group.actualTruckNo ?? '—'}${billingLine}`}
      </span>
      <DisabledActionTip
        id={`lcl-group-truck-line-${row.shipmentId}`}
        reason={disabled ? 'Đang lưu thay đổi — chưa đổi BKS nhóm được.' : null}
      >
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => { if (disabled) return; onChange(row); }}
          aria-disabled={disabled || undefined}
        >
          Đổi BKS nhóm
        </button>
      </DisabledActionTip>
    </div>
  );
}

/**
 * Card 191026100010 (DV-B1-04) —resolve giá trị draft của ô Xe/biển số về
 * CHUỖI BKS thật để gửi updateLclTruck: giá trị fleet (`truck:{id}` /
 * `vehicle:{id}`)resolve qua nhãn option (cùng phép tách ' — ' mà
 * vehiclePlateKey dùng cho so sánh); null khi draft KHÔNG mang biển mới
 * ('' = clear, `defer:` = Bổ sung sau) — các nhánh ấy editor phải từ chối,
 * không bao giờ đẩy lên nhóm.
 */
export function draftGroupPlate(
  value: string,
  options: ReadonlyArray<{ value: string; label: string }>,
): string | null {
  if (!value || value === DEFERRED_PLATE_PREFIX) return null;
  if (value.startsWith(CURRENT_PLATE_PREFIX)) return value.slice(CURRENT_PLATE_PREFIX.length).trim() || null;
  if (value.startsWith(FREE_TEXT_PREFIX)) return value.slice(FREE_TEXT_PREFIX.length).trim() || null;
  const label = options.find((option) => option.value === value)?.label;
  return label ? label.split(' — ')[0].trim() || null : null;
}
