import { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, X, Trash2 } from 'lucide-react';
import { useOpsExpenseTypes, useUpdateOpsExpense, useAttachOpsExpensePhoto, useOpsExpensePhotos, useDeleteOpsExpensePhoto } from '../../hooks/useOpsQueries';
import { opsClient, type OpsExpenseRow } from '../../api/opsClient';
import { compressImageFile } from '../../lib/imageCompression';
import { getAuthenticatedPhotoUrl } from '../../lib/api';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
/**
 * Author edit of an own PENDING/REJECTED, unlinked expense (OpsVanHanh §5.5
 * "được sửa/xóa (chỉ người nhập)"). Container scope is fixed after create —
 * only type, amount, date and note are editable.
 */
export function OpsExpenseEditModal({ entry, onClose }: { entry: OpsExpenseRow; onClose: () => void }) {
  const { data: typesData } = useOpsExpenseTypes();
  const updateExpense = useUpdateOpsExpense();
  const { toast } = useToast();

  const attachPhoto = useAttachOpsExpensePhoto();
  const deletePhoto = useDeleteOpsExpensePhoto();
  const { data: existingPhotosData } = useOpsExpensePhotos(entry.id);

  const [typeCode, setTypeCode] = useState(entry.expenseTypeCode);
  const [amount, setAmount] = useState(entry.amount);
  const [paidAt, setPaidAt] = useState(entry.paidAt);
  const [note, setNote] = useState(entry.note ?? '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const groupedTypes = useMemo(() => {
    const items = typesData?.items ?? [];
    return {
      withInvoice: items.filter((type) => type.requiresInvoice === true),
      withoutInvoice: items.filter((type) => type.requiresInvoice !== true),
    };
  }, [typesData]);

  // UuiSelectField has no optgroup support — flatten the two groups with
  // disabled section-header rows so the grouping stays visible in the menu.
  const expenseTypeOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: '', label: '— Chọn loại phí —' },
    ];
    if (groupedTypes.withInvoice.length > 0) {
      options.push({ value: '__HDR_INV__', label: '— Có hóa đơn —', disabled: true });
      groupedTypes.withInvoice.forEach((type) => options.push({ value: type.code, label: type.name }));
    }
    if (groupedTypes.withoutInvoice.length > 0) {
      options.push({ value: '__HDR_NO_INV__', label: '— Không hóa đơn —', disabled: true });
      groupedTypes.withoutInvoice.forEach((type) => options.push({ value: type.code, label: type.name }));
    }
    return options;
  }, [groupedTypes]);

  const amountClean = amount.replace(/[^\d-]/g, '');
  const isNegative = amountClean.startsWith('-');
  const amountDigits = amountClean.replace(/-/g, '');
  const amountError = isNegative ? 'Số tiền phải là số dương' : null;
  const canSubmit = Boolean(typeCode) && /^\d+$/.test(amountDigits) && Number(amountDigits) > 0 && !isNegative && !updateExpense.isPending && !uploadingPhoto;

  // Server-side photo count via readback (reactively updates through cache
  // invalidation from useAttachOpsExpensePhoto → useOpsExpensePhotos).
  const serverPhotoCount = existingPhotosData?.items.length ?? 0;
  const missingReceipt = serverPhotoCount === 0 && entry.requiresInvoice === true;

  async function handlePhotoUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadingPhoto(true);
    try {
      for (const file of Array.from(fileList)) {
        const compressed = await compressImageFile(file, { maxDimension: 2048 });
        const uploaded = await opsClient.uploadExpensePhoto(compressed);
        await attachPhoto.mutateAsync({ expenseId: entry.id, storageKey: uploaded.storageKey });
      }
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Tải ảnh thất bại.' });
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await updateExpense.mutateAsync({
        id: entry.id,
        body: {
          expenseTypeCode: typeCode,
          amount: amountDigits,
          paidAt,
          note: note.trim() || null,
        },
      });
      toast({ kind: 'success', message: 'Đã cập nhật khoản chi.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Cập nhật thất bại.' });
    }
  }

  return (
    <OpsModalBackdrop onClose={onClose} ariaLabel={`Sửa khoản chi ${entry.shipmentCode ?? ''}`}>
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Sửa khoản chi · {entry.shipmentCode ?? entry.shipmentId}{entry.containerNumber ? ` · ${entry.containerNumber}` : ''}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          <div className="ops-form-grid">
            <UuiSelectField
              label="Loại phí"
              required
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value)}
              options={expenseTypeOptions}
            />
            <label>
              Số tiền (VND) *
              <input
                value={amountDigits ? `${isNegative ? '-' : ''}${formatVnd(amountDigits)}` : (isNegative ? '-' : '')}
                aria-invalid={Boolean(amountError)} aria-describedby={amountError ? 'ops-edit-amount-error' : undefined}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                required
              />
              {amountError && <span id="ops-edit-amount-error" role="alert" className="ops-field-error">{amountError}</span>}
            </label>
            <label>
              Ngày chi *
              <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} required />
            </label>
          </div>
          <label className="ops-form-note">
            Ghi chú
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>

          <div className="ops-form-photos">
            <div className="ops-form-photos__head">
              <span>
                Ảnh biên lai ({serverPhotoCount})
                {missingReceipt && <span className="ops-doc-state is-debt" style={{ marginLeft: 8 }}>Nợ chứng từ</span>}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingPhoto || attachPhoto.isPending}
              >
                {uploadingPhoto ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}
                {uploadingPhoto ? 'Đang tải…' : 'Thêm ảnh'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                onChange={(event) => void handlePhotoUpload(event.target.files)}
              />
            </div>
            {serverPhotoCount > 0 && (
              <ul className="ops-form-photos__list">
                {(existingPhotosData?.items ?? []).map((photo) => (
                  <li key={photo.storageKey}>
                    <img src={getAuthenticatedPhotoUrl(`/api/photos/${encodeURIComponent(photo.storageKey)}`)} alt="Biên lai khoản chi" />
                    <button type="button" aria-label={`Xóa ảnh biên lai ${photo.id}`} disabled={deletePhoto.isPending} onClick={() => void deletePhoto.mutateAsync(photo.id).catch((error: unknown) => toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không xóa được ảnh.' }))}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <footer className="ops-modal__foot">
          <div>{entry.rejectionReason ? `Lý do bị từ chối: ${entry.rejectionReason}` : ''}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={updateExpense.isPending}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {updateExpense.isPending ? <Loader2 size={14} className="spin" /> : null} Lưu
            </button>
          </div>
        </footer>
      </form>
    </OpsModalBackdrop>
  );
}
