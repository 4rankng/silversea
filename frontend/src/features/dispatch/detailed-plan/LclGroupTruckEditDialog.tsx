// Card 191026100010 (B.1, cases DV-B1-03/04) — sau "Gán xe nhóm" (FB-092/093)
// cặp BKS sống trên COST GROUP, và cả hai màn điều vận đều khép lại: checkbox
// lô trên /dispatch bị khóa ("tách nhóm trước khi ghép lại"), tái chọn lô thì
// assignLclCostGroup 409 ("đã thuộc nhóm ghép"), và updateLclTruck chưa hề
// được gọi từ đâu. Module này sở hữu CẢ HAI affordance đổi BKS và một luật
// chung: updateLclTruck({ shipmentId, … }) lan toả BKS thực của TOÀN nhóm (+
// BKS ảo của lô được nêu tên), nên:
//   • dialog (row action "Đổi BKS nhóm" trong menu Nhóm ghép trả ĐV) sửa
//     cặp BKS — BKS thực + BKS báo khách (ảo, auto-copy từ thực cho khi
//     operator sửa tay, đúng luật AssignTruckGroupDialog) — và PAGE sở hữu
//     refetch qua onSaved, giống hệt wiring của Hủy ghép;
//   • dòng nhóm compact trong popup "Chỉnh sửa điều phối" (LclGroupTruckLine)
//     raise CÙNG page-owned dialog; còn save() của editor từ chối đẩy biển số
//     mới qua đường plan-save chỉ-hàng (xem DispatchPlanEditorCell) — save
//     hàng đơn lẻ sẽ làm grid hiện 2 BKS cho một nhóm và Debit Note (FB-094)
//     in nhầm BKS ảo cũ.
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/UI';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { useToast } from '../../../components/shared/Toast';
import { USearchableField } from '../../shipments/create/uui-searchable-field';
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

export interface LclGroupTruckEditDialogProps {
  /** Dòng LCL đã ghép nhóm — seed cặp BKS từ row.lcl.group; null = đóng. */
  row: DispatchDetailPlanRow | null;
  onClose: () => void;
  /** Sau khi updateLclTruck thành công — page invalidate/refetch grid. */
  onSaved: () => void;
}

/**
 * Card 191026100010 (DV-B1-03) — "Đổi BKS nhóm": dialog hai field, seed từ
 * BKS đã lưu của nhóm; BKS ảo auto-copy BKS thực cho tới khi operator sửa tay
 * (luật AssignTruckGroupDialog). Submit gọi updateLclTruck đúng theo contract
 * đã có (FB-093) — không API mới.
 */
export function LclGroupTruckEditDialog({ row, onClose, onSaved }: LclGroupTruckEditDialogProps) {
  const { toast } = useToast();
  const group = row?.lcl?.group ?? null;

  const [actualTruckNo, setActualTruckNo] = useState(group?.actualTruckNo ?? '');
  const [billingTruckNo, setBillingTruckNo] = useState(group?.billingTruckNo ?? '');
  // Ref, không phải state: flag chỉ gate hiệu ứng auto-copy, và ref khởi tạo
  // đã đúng ngay ở commit đầu (một state flag lúc đó vẫn đọc false và clobber
  // BKS ảo đã lưu bằng BKS thực) — cùng kỹ thuật billingTouchedRef của
  // AssignTruckGroupDialog.
  const billingTouchedRef = useRef(Boolean(group?.billingTruckNo?.trim()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Round-19 law (TripReassignDialog): BKS là SELECTOR trên fleet của chính
  // nhà xe đang gắn cho lô, free text cho biển chưa có trong danh mục. Lỗi
  // tải danh sách nuốt im lặng — free text vẫn là đường gõ trực tiếp.
  const [plateOptions, setPlateOptions] = useState<Array<{ value: string; label: string }>>([]);

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
  }, [row]);

  // Auto-copy: BKS ảo bám BKS thực cho tới khi operator sửa tay (spec
  // "auto-copy từ thực tế"). BKS ảo đã lưu khi seed thì luôn là "sửa tay" —
  // reopen không được nuốt nó bằng BKS thực.
  useEffect(() => {
    if (!billingTouchedRef.current) setBillingTruckNo(actualTruckNo.trim());
  }, [actualTruckNo]);

  async function submit() {
    if (saving || !row || !group) return;
    setError(null);
    const actual = actualTruckNo.trim();
    if (!actual) {
      setError('Nhập BKS thực của xe chạy chuyến');
      return;
    }
    const billing = billingTouchedRef.current ? billingTruckNo.trim() : '';
    setSaving(true);
    try {
      await updateLclTruck({
        shipmentId: row.shipmentId,
        actualTruckNo: actual,
        // BKS ảo bằng BKS thực (hoặc trống = copy thực) thì bỏ khỏi payload —
        // server đã coi mặc định là copy, đúng hình dáng dây của
        // AssignTruckGroupDialog; chỉ một BKS ảo KHÁC mới được nêu tên.
        ...(billing && billing !== actual ? { billingTruckNo: billing } : {}),
      });
      toast({
        kind: 'success',
        message: `Đã đổi BKS nhóm ${group.memberCount ?? '?'} lô — BKS thực ${actual}${billing && billing !== actual ? ` · BKS ảo ${billing}` : ''}`,
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
        <USearchableField
          label="BKS thực (xe chạy chuyến)"
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
        <USearchableField
          label="BKS báo khách (ảo)"
          value={billingTruckNo}
          onChange={(next) => { billingTouchedRef.current = true; setBillingTruckNo(next); }}
          onCustomValue={(text) => { billingTouchedRef.current = true; setBillingTruckNo(text); }}
          options={plateOptions}
          placeholder="Mặc định copy BKS thực"
          searchable
          allowsCustomValue
          disabled={saving}
          hint="Debit Note (FB-094) sẽ in BKS này, tuyệt đối không in BKS thực."
        />
      </div>
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
