import {
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { DateInput, UuiSelectField } from '../../../design-system';
import { vehicleReadinessLabel, type ShipmentQuickEditDraft } from './cusUtils';

export function ShipmentQuickEditFields({
  draft,
  item,
  saving,
  error,
  onChange,
}: {
  draft: ShipmentQuickEditDraft;
  item: ShipmentCusWorkspaceListItem;
  saving: boolean;
  error: string | null;
  onChange: (draft: ShipmentQuickEditDraft) => void;
}) {
  const update = (patch: Partial<ShipmentQuickEditDraft>) => onChange({ ...draft, ...patch });
  const documentDirection = draft.tradeDirection || item.direction || '';

  return (
    <div className="cus-quick-edit-modal__fields">
      {draft.field === 'identity' && <>
        <label className="cus-quick-edit-modal__field--full"><span>Khách hàng</span><div className="cus-quick-edit-modal__readonly" title={item.customerName ?? item.fieldAccess.customerId.reason}>{item.customerName ?? '—'}</div></label>
        <label className="cus-quick-edit-modal__field--full"><span>Nhà máy</span><input autoFocus value={draft.factoryName} onChange={(event) => update({ factoryName: event.target.value })} maxLength={255} disabled={saving} /></label>
      </>}
      {draft.field === 'documents' && <>
        {documentDirection === 'IMPORT' && <label><span>Số Bill</span><input autoFocus value={draft.blNumber} onChange={(event) => update({ blNumber: event.target.value })} maxLength={100} disabled={saving || item.fieldAccess.blNumber.mode === 'READ_ONLY'} title={item.fieldAccess.blNumber.reason} /></label>}
        {documentDirection === 'EXPORT' && <label><span>Số Booking</span><input autoFocus value={draft.bookingRef} onChange={(event) => update({ bookingRef: event.target.value })} maxLength={100} disabled={saving || item.fieldAccess.bookingRef.mode === 'READ_ONLY'} title={item.fieldAccess.bookingRef.reason} /></label>}
        {!documentDirection && <p className="cus-quick-edit-modal__help">Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhật Bill/Booking.</p>}
        <label><span>Số tờ khai</span><input value={draft.declarationNumber} onChange={(event) => update({ declarationNumber: event.target.value })} maxLength={50} disabled={saving || item.fieldAccess.declarationNumber.mode === 'READ_ONLY'} title={item.fieldAccess.declarationNumber.reason} /></label>
        <p className="cus-quick-edit-modal__help">{documentDirection === 'IMPORT' ? 'Hàng Nhập chỉ dùng Số Bill.' : documentDirection === 'EXPORT' ? 'Hàng Xuất chỉ dùng Số Booking.' : 'Số Bill và Số Booking không thể cùng thuộc một lô hàng.'} Tờ khai đã có sẽ được cập nhật số mới.</p>
      </>}
      {draft.field === 'classification' && <>
        <UuiSelectField
          label="Xuất / Nhập"
          value={draft.tradeDirection}
          onChange={(event) => { const tradeDirection = event.target.value as ShipmentQuickEditDraft['tradeDirection']; update({ tradeDirection, ...(tradeDirection === 'IMPORT' ? { bookingRef: '' } : tradeDirection === 'EXPORT' ? { blNumber: '' } : {}) }); }}
          disabled={saving}
          options={[{ value: '', label: 'Chưa xác định' }, { value: 'IMPORT', label: 'Nhập' }, { value: 'EXPORT', label: 'Xuất' }]}
        />
        <label><span>Hãng tàu</span><input value={draft.shippingLineName} onChange={(event) => update({ shippingLineName: event.target.value })} maxLength={255} disabled={saving} /></label>
      </>}
      {draft.field === 'cargo' && <>
        <label><span>Số kiện</span><input autoFocus type="number" min="1" value={draft.packageCount} onChange={(event) => update({ packageCount: event.target.value })} disabled={saving || item.fieldAccess.packageCount.mode === 'READ_ONLY'} /></label>
        <label><span>Loại kiện</span><input value={draft.packageType} onChange={(event) => update({ packageType: event.target.value })} maxLength={100} disabled={saving || item.fieldAccess.packageType.mode === 'READ_ONLY'} /></label>
        <label><span>Trọng lượng (kg)</span><input type="number" min="0" step="0.01" value={draft.cargoWeightKg} onChange={(event) => update({ cargoWeightKg: event.target.value })} disabled={saving || item.fieldAccess.cargoWeightKg.mode === 'READ_ONLY'} title={item.fieldAccess.cargoWeightKg.reason} /></label>
        <label><span>Thể tích (CBM)</span><input type="number" min="0" step="0.001" value={draft.cargoVolumeCbm} onChange={(event) => update({ cargoVolumeCbm: event.target.value })} disabled={saving || item.fieldAccess.cargoVolumeCbm.mode === 'READ_ONLY'} title={item.fieldAccess.cargoVolumeCbm.reason} /></label>
      </>}
      {draft.field === 'schedule' && <>
        <label><span>Ngày đóng/trả</span><DateInput autoFocus disabled={saving} value={draft.date} onChange={(value) => update({ date: value })} /></label>
        <label><span>Giờ</span><input disabled={saving} type="time" value={draft.time} onChange={(event) => update({ time: event.target.value })} /></label>
        <p className="cus-quick-edit-modal__help">{vehicleReadinessLabel(item)}</p>
      </>}
      {draft.field === 'notes' && <>
        <label><span>Ghi chú cho khách hàng</span><textarea autoFocus disabled={saving} rows={3} maxLength={2000} value={draft.customerNote} onChange={(event) => update({ customerNote: event.target.value })} /></label>
        <label><span>Ghi chú cho lái xe</span><textarea disabled={saving} rows={3} maxLength={2000} value={draft.operationalNote} onChange={(event) => update({ operationalNote: event.target.value })} /></label>
        <p className="cus-quick-edit-modal__help">Shift+Enter để xuống dòng.</p>
      </>}
      {error && <p className="cus-inline-edit-error" role="alert">{error}</p>}
    </div>
  );
}
