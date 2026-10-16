// FB-093 — CUS "Ghép cước thu khách" dialog (Chi phí - Quyết toán).
//
// Merges the selected same-customer LCL lots into ONE bill (rev group): Lô 1
// keeps 100% of CƯỚC VẬN TẢI (AUTO re-priced from the customer × route ×
// class lane); members 2..N drop to 0₫ with the "Ghép cước cùng Bill X"
// stamp. Same-customer validation runs client-side first (the server remains
// the authority) so the operator sees the conflicting lots before losing the
// selection.
//
// UI provenance: house Modal + Untitled UI PRO v8 (base `button`, base
// `select`/`combobox` via USearchableField) — vendored at components/untitled-ui.
import { useMemo, useState } from 'react';
import { Modal } from '../../../components/UI';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { USearchableField } from '../create/uui-searchable-field';
import { useToast } from '../../../components/shared/Toast';
import { useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { mergeLclRevGroup } from '../../../api/dispatchPlanningClient';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';

export interface MergeRevGroupDialogProps {
  rows: ShipmentDebitLotRow[];
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedClasses = useMemo(
    () => [...(vehicleClasses.data ?? [])].filter((vc) => !vc.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    [vehicleClasses.data],
  );

  // Same-customer gate (FB-093): the server enforces it; this names the lots.
  const customerIds = new Set(rows.map((row) => row.customerId));
  const sameCustomer = customerIds.size === 1;

  async function submit() {
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
      });
      toast({
        kind: 'success',
        message: `Đã ghép cước thu khách cho ${result.memberCount} lô — Lô 1 (${result.members[0]?.reference ?? ''}) giữ 100% cước vận tải`,
      });
      onMerged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ghép cước thu khách thất bại');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={rows.length > 0}
      onClose={onClose}
      title="Ghép cước thu khách"
      subtitle={`${rows.length} lô lẻ · Lô 1 giữ 100% CƯỚC VẬN TẢI (Auto), các lô còn lại 0₫`}
      footer={
        <>
          {error && <p className="merge-rev-group__error" role="alert">{error}</p>}
          <UUIButton size="sm" color="secondary" onPress={onClose} isDisabled={saving}>Hủy</UUIButton>
          <UUIButton size="sm" color="tertiary" onPress={() => void submit()} isDisabled={saving || !sameCustomer || rows.length < 2}>
            {saving ? 'Đang ghép…' : 'Ghép cước thu khách'}
          </UUIButton>
        </>
      }
    >
      <div className="merge-rev-group">
        <ol className="merge-rev-group__lots" title="Thứ tự chọn quyết định Lô 1 (giữ 100% cước thu)">
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
            Chỉ ghép cước thu được các lô của cùng một khách hàng — các lô đã chọn thuộc {customerIds.size} khách hàng khác nhau.
          </p>
        )}
        <USearchableField
          label="Loại xe tính cước thu khách"
          value={vehicleClassId}
          onChange={(next) => setVehicleClassId(next)}
          options={sortedClasses.map((vc) => ({ value: String(vc.id), label: vc.name, searchText: vc.code }))}
          placeholder="Chọn loại xe (trọng tải / cont)"
          searchable
          required
        />
        <USearchableField
          label="BKS báo khách (ảo) chung nhóm"
          value={billingTruckNo}
          onChange={setBillingTruckNo}
          options={plateOptions}
          placeholder="Chọn BKS hệ thống hoặc gõ mới"
          hint="Để trống = giữ BKS hiện tại của nhóm."
          allowsCustomValue
          searchable
          onCustomValue={setBillingTruckNo}
        />
      </div>
    </Modal>
  );
}
