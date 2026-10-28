// FB-093 + spec 23/10 (261023110000 §4.2) — CUS "Gộp xe thu khách" dialog
// (Chi phí - Quyết toán; the Kế toán chốt-debit board reuses it).
//
// Merges the selected same-customer LCL lots into ONE rev group. Spec 23/10
// ruling (supersedes the 21/10 per-lot rule ONLY inside this active merge):
// Lô 1 keeps 100% of the group's cước thu khách, members 2..N drop to 0₫ and
// carry the "Ghép thu cước cùng Lô 1" tag (BE stamps it). Outside a merge the
// per-lot law of 21/10 keeps holding.
//
// Same-customer validation runs client-side first (the server remains the
// authority and 400s the same way) so the operator sees the conflicting lots
// before losing the selection.
//
// UI provenance: house Modal + Untitled UI PRO v8 (base `button`, base
// `select`/`combobox` via USearchableField) — vendored at components/untitled-ui.
import { useMemo, useState } from 'react';
import { Modal } from '../../../components/UI';
import { NumberField } from '../../../design-system';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { USearchableField } from '../create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { mergeLclRevGroup } from '../../../api/dispatchPlanningClient';
import { vehicleClassSectionedOptions } from '../../../lib/vehicle-class-options';

/** The only lot facts this dialog reads: identity, the customer the merge
 *  groups by, and the three labels the lot list renders. Structural — the
 *  Chi phí - Quyết toán row (`ShipmentDebitLotRow`) and the chốt-debit board
 *  row both satisfy it, so neither surface has to fabricate the other's
 *  fields to open the same dialog. */
export interface MergeRevGroupLot {
  shipmentId: number;
  customerId: number | null;
  /** Nullable like the wire (SIL-478 P0): the dialog renders the name only
   *  when it exists. */
  customerName: string | null;
  /** The settlement wire's lot code. Optional since SIL-547: the Chi tiết lô
   *  hàng wire has no `code` — its labels fall through Bill → tờ khai, so the
   *  callers that have one keep passing it. */
  code?: string;
  billOrBookNumber: string;
  customsNumber?: string | null;
}

export interface MergeRevGroupDialogProps {
  rows: MergeRevGroupLot[];
  /** BKS báo khách (xe ảo) catalog — the plate list the caller sources (the
   *  same fleet the Điều vận "Gán xe nhóm" dialog offers). The dialog stays
   *  presentational: it lists what it is handed and never fetches a catalog. */
  plateOptions: Array<{ value: string; label: string; searchText?: string }>;
  onClose: () => void;
  onMerged: () => void;
}

export function MergeRevGroupDialog({ rows, plateOptions, onClose, onMerged }: MergeRevGroupDialogProps) {
  const { toast } = useToast();
  const vehicleClasses = useVehicleSizeClasses();
  const [vehicleClassId, setVehicleClassId] = useState('');
  const [billingTruckNo, setBillingTruckNo] = useState('');
  // Spec 23/10 §4.2 field 3 — "Cước thu khách Lô 1 (đ) – nhập tay": blank ⇒
  // the server auto-traces bảng giá thu khách; a typed value overrides it.
  const [manualFreightRevenue, setManualFreightRevenue] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedClasses = useMemo(
    () => [...(vehicleClasses.data ?? [])].filter((vc) => !vc.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    [vehicleClasses.data],
  );

  // Same-customer gate (FB-093 + GP-04): the server enforces it; this names
  // the lots BEFORE any request leaves. A lot with NO customer is a conflict
  // too (BE law `findRevCustomerConflict` reads "Chưa có khách hàng" as one),
  // so the merge needs exactly one DISTINCT non-null customerId.
  const missingCustomer = rows.some((row) => row.customerId == null);
  const customerIds = new Set(rows.map((row) => row.customerId).filter((id): id is number => id != null));
  const sameCustomer = !missingCustomer && customerIds.size === 1;
  const gateMessage = missingCustomer
    ? 'Chỉ ghép cước thu được các lô của cùng một khách hàng — có lô chưa xác định khách hàng.'
    : `Chỉ ghép cước thu được các lô của cùng một khách hàng — các lô đã chọn thuộc ${customerIds.size} khách hàng khác nhau.`;

  async function submit() {
    // GP-04 — the gate lives HERE too (not only on the button's isDisabled):
    // no future submit path may send a merge the same-customer law refuses,
    // and the guard closes the double-click race before `saving` re-renders.
    if (saving || !sameCustomer || rows.length < 2) return;
    setError(null);
    const selectedClass = sortedClasses.find((vc) => String(vc.id) === vehicleClassId);
    if (!selectedClass) {
      setError('Chọn loại xe tính cước thu khách');
      return;
    }
    setSaving(true);
    try {
      const result = await mergeLclRevGroup({
        shipmentIds: rows.map((row) => row.shipmentId),
        vehicleSizeClassId: selectedClass.id,
        ...(billingTruckNo.trim() ? { billingTruckNo: billingTruckNo.trim() } : {}),
        ...(manualFreightRevenue === '' ? {} : { freightRevenue: manualFreightRevenue }),
      });
      toast({
        kind: 'success',
        message: `Đã gộp xe thu khách cho ${result.memberCount} lô — Lô 1 (${rows[0]?.billOrBookNumber || rows[0]?.customsNumber || rows[0]?.code || ''}) giữ 100% cước thu khách, các lô còn lại 0₫`,
      });
      onMerged();
      onClose();
    } catch (err) {
      // GP-04 — a server refusal (BE 400 khác-KH, locked money, …) must never
      // be silent: the message shows inline AND as an error toast (the footer
      // line alone scrolls out of view on phone modals), the dialog stays
      // open and a corrected retry re-arms.
      const message = err instanceof Error ? err.message : 'Gộp xe thu khách thất bại';
      setError(message);
      toast({ kind: 'error', message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={rows.length > 0}
      onClose={onClose}
      title="Gộp xe thu khách"
      subtitle={`${rows.length} lô lẻ · Lô 1 giữ 100% cước thu khách, các lô còn lại 0₫`}
      footer={
        <>
          {error && <p className="merge-rev-group__error" role="alert">{error}</p>}
          <UUIButton size="sm" color="secondary" onPress={onClose} isDisabled={saving}>Hủy</UUIButton>
          <UUIButton size="sm" color="tertiary" onPress={() => void submit()} isDisabled={saving || !sameCustomer || rows.length < 2}>
            {saving ? 'Đang ghép…' : 'Gộp xe thu khách'}
          </UUIButton>
        </>
      }
    >
      <div className="merge-rev-group">
        <ol className="merge-rev-group__lots" title="Thứ tự ghép — Lô 1 giữ 100% cước thu khách">
          {rows.map((row, index) => (
            <li key={row.shipmentId}>
              {index === 0 ? 'Lô 1 · ' : `Lô ${index + 1} · `}
              {row.billOrBookNumber || row.customsNumber || row.code}
              {row.customerName ? ` — ${row.customerName}` : ''}
            </li>
          ))}
        </ol>
        {!sameCustomer && rows.length > 0 && (
          <p className="merge-rev-group__error" role="alert">
            {gateMessage}
          </p>
        )}
        {/* Field 1 — Loại xe tính cước thu khách (cả nhóm gộp). FB-138: grouped
            menu — "XE TẢI (TẤN)" | "CONTAINER" headers, same shared builder as
            the ĐV popup so one pattern serves every loại xe dropdown. */}
        <USearchableField
          label="Loại xe tính cước thu khách"
          value={vehicleClassId}
          onChange={(next) => setVehicleClassId(next)}
          options={vehicleClassSectionedOptions(sortedClasses)}
          placeholder="Chọn loại xe (trọng tải / cont)"
          searchable
          required
        />
        {/* Field 2 — BKS báo khách chung nhóm. Spec 23/10: blank ⇒ each lot
            reports the ĐV-assigned BKS thực (the BE read-side fallback); a
            value is stamped onto every member for the Debit Note. */}
        <USearchableField
          label="BKS báo khách (chung nhóm)"
          value={billingTruckNo}
          onChange={setBillingTruckNo}
          options={plateOptions}
          placeholder="Chọn BKS hệ thống hoặc gõ mới"
          hint="Để trống = lấy BKS thực (Điều vận đã gán) của từng lô khi báo khách."
          allowsCustomValue
          searchable
          onCustomValue={setBillingTruckNo}
        />
        {/* Field 3 — Cước thu khách Lô 1: blank = auto-trace bảng giá thu
            khách; typed = the negotiated override that wins. */}
        <NumberField
          label="Cước thu khách Lô 1 (đ)"
          value={manualFreightRevenue}
          onChange={setManualFreightRevenue}
          grouped
          min={0}
          placeholder="Bỏ trống = tự tra bảng giá"
          helpText="Bỏ trống: hệ thống tự tra bảng giá thu khách (KH × tuyến × loại xe). Nhập tay: số tiền này thắng giá tra được — Lô 1 giữ 100%, các lô còn lại 0₫."
        />
      </div>
    </Modal>
  );
}
