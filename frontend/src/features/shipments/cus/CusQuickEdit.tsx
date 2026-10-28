import {
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { useRef } from 'react';
import { TimeInput } from '../../../design-system/forms/TimeInput';
import { BufferedUuiDateInput, UuiSelectField } from '../../../design-system';
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
  // FB-030/075 (171026215500): the schedule dialog's Giờ is the single-box
  // TimeInput, so the "segment kế" after a completed giờ is the Ngày đóng/trả
  // day segment — the same hand-off SplitDateTimeField runs from its time
  // half to its date half.
  const scheduleDateFieldRef = useRef<HTMLDivElement>(null);

  return (
    <div className="cus-quick-edit-modal__fields" data-edit-field={draft.field}>
      {draft.field === 'identity' && <>
        <label className="cus-quick-edit-modal__field--full"><span>Khách hàng</span><div className="cus-quick-edit-modal__readonly" title={item.customerName ?? item.fieldAccess.customerId.reason}>{item.customerName ?? '—'}</div></label>
        <label className="cus-quick-edit-modal__field--full"><span>Nhà máy</span><input autoFocus value={draft.factoryName} onChange={(event) => update({ factoryName: event.target.value })} maxLength={255} disabled={saving} /></label>
      </>}
      {draft.field === 'documents' && <>
        {documentDirection === 'IMPORT' && <label><span>Số Bill</span><input autoFocus value={draft.blNumber} onChange={(event) => update({ blNumber: event.target.value })} maxLength={100} disabled={saving || item.fieldAccess.blNumber.mode === 'READ_ONLY'} title={item.fieldAccess.blNumber.reason} /></label>}
        {documentDirection === 'EXPORT' && <label><span>Số Booking</span><input autoFocus value={draft.bookingRef} onChange={(event) => update({ bookingRef: event.target.value })} maxLength={100} disabled={saving || item.fieldAccess.bookingRef.mode === 'READ_ONLY'} title={item.fieldAccess.bookingRef.reason} /></label>}
        {!documentDirection && <p className="cus-quick-edit-modal__help">Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhật Bill/Booking.</p>}
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
        <label><span>Giờ</span><TimeInput autoFocus label="Giờ" disabled={saving} value={draft.time} onChange={(time) => update({ time })} onComplete={() => { scheduleDateFieldRef.current?.querySelector<HTMLInputElement>('[data-seg="dd"]')?.focus(); }} /></label>
        <BufferedUuiDateInput groupRef={scheduleDateFieldRef} label="Ngày đóng/trả" size="sm" disabled={saving} value={draft.date} onChange={(value) => update({ date: value })} />
        <p className="cus-quick-edit-modal__help">{vehicleReadinessLabel(item)}</p>
      </>}
      {draft.field === 'notes' && <>
        <label><span>Ghi chú cho khách hàng</span><textarea autoFocus disabled={saving} rows={3} maxLength={2000} value={draft.customerNote} onChange={(event) => update({ customerNote: event.target.value })} /></label>
        <label><span>Ghi chú cho lái xe</span><textarea disabled={saving} rows={3} maxLength={2000} value={draft.operationalNote} onChange={(event) => update({ operationalNote: event.target.value })} /></label>
        <p className="cus-quick-edit-modal__help">Enter để xuống dòng; Ctrl/Cmd+Enter để lưu.</p>
      </>}
      {error && <p className="cus-inline-edit-error" role="alert">{error}</p>}
    </div>
  );
}
