import { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, X, Trash2 } from 'lucide-react';
import { useOpsExpenseTypes, useUpdateOpsExpense, useAttachOpsExpensePhoto, useOpsExpensePhotos, useDeleteOpsExpensePhoto } from '../../hooks/useOpsQueries';
import { opsClient, type OpsExpenseRow } from '../../api/opsClient';
import { compressImageFile } from '../../lib/imageCompression';
import { getAuthenticatedPhotoUrl } from '../../lib/api';
import { useToast } from '../../components/shared/Toast';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { DateInput } from '../../design-system/forms/DateInput';
import { NumberField } from '../../design-system/forms/NumberField';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { OpsExpenseFinancialFields, opsFinancialPayload, opsGroupForType, useOpsExpenseFinancialDraft, type OpsCostGroup } from './OpsExpenseFinancialFields';
/**
 * Author correction of an editable own expense. Server-side source/version
 * checks remain authoritative; the container scope stays fixed after create.
 */
export function OpsExpenseEditModal({ entry, onClose }: { entry: OpsExpenseRow; onClose: () => void }) {
  const typesQuery = useOpsExpenseTypes();
  const typesData = typesQuery.data;
  const updateExpense = useUpdateOpsExpense();
  const { toast } = useToast();

  const attachPhoto = useAttachOpsExpensePhoto();
  const deletePhoto = useDeleteOpsExpensePhoto();
  const { data: existingPhotosData } = useOpsExpensePhotos(entry.id);

  const [typeCode, setTypeCode] = useState(entry.expenseTypeCode);
  const [amount, setAmount] = useState<number | ''>(Number(entry.amount));
  const [paidAt, setPaidAt] = useState(entry.paidAt);
  const locked = Boolean(entry.confirmedAt || entry.opsSettlementId || ['VOIDED', 'REJECTED'].includes(entry.approvalStatus));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(entry.note ?? '');
  const [financial, setFinancial] = useOpsExpenseFinancialDraft({
    costGroup: (entry.costGroup as OpsCostGroup | null) ?? opsGroupForType(entry.expenseTypeCode, entry.requiresInvoice === true),
    feeName: entry.feeName ?? '', invoiceNumber: entry.invoiceNumber ?? '',
    invoiceDate: entry.invoiceDate ?? '', recoveryNote: entry.recoveryNote ?? '',
  });
  const savingRef = useRef(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
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

  const amountValid = amount !== '' && Number.isSafeInteger(amount) && amount > 0 && amount <= 999_999_999_999_999;
  const amountError = amount === '' || amountValid ? undefined
    : amount <= 0 ? 'Số tiền phải là số dương' : 'Nhập số tiền nguyên, tối đa 999.999.999.999.999đ';
  const typesReady = typesQuery.isSuccess && Boolean(typesData?.items.length);
  const canSubmit = typesReady && !locked && Boolean(reason.trim()) && Boolean(typeCode) && amountValid && !updateExpense.isPending && !uploadingPhoto && pendingFiles.length === 0;

  // Server-side photo count via readback (reactively updates through cache
  // invalidation from useAttachOpsExpensePhoto → useOpsExpensePhotos).
  const serverPhotoCount = existingPhotosData?.items.length ?? 0;
  const missingReceipt = serverPhotoCount === 0 && entry.requiresInvoice === true;

  async function handlePhotoUpload(files: FileList | File[] | null) {
    if (!files?.length || uploadingPhoto || savingRef.current) return;
    if (files.length + serverPhotoCount > 20) { toast({ kind: 'error', message: 'Mỗi khoản chi tối đa 20 ảnh. Chọn ít ảnh hơn.' }); return; }
    const remaining = Array.from(files);
    setPendingFiles(remaining); setUploadingPhoto(true);
    try {
      while (remaining.length) {
        const file = remaining[0];
        const compressed = await compressImageFile(file, { maxDimension: 2048 });
        const uploaded = await opsClient.uploadExpensePhoto(compressed);
        await attachPhoto.mutateAsync({ expenseId: entry.id, storageKey: uploaded.storageKey });
        remaining.shift(); setPendingFiles([...remaining]);
      }
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Tải ảnh thất bại. Ảnh chưa tải vẫn được giữ để thử lại.' });
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || savingRef.current) return;
    savingRef.current = true;
    try {
      await updateExpense.mutateAsync({
        id: entry.id,
        body: {
          expenseTypeCode: typeCode,
          amount: String(amount),
          paidAt,
          note: note.trim() || null,
          expectedVersion: entry.version,
          reason: reason.trim(),
          ...opsFinancialPayload(financial),
        },
      });
      toast({ kind: 'success', message: 'Đã cập nhật khoản chi.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Cập nhật thất bại.' });
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <OpsModalBackdrop onClose={() => { if (!savingRef.current && !uploadingPhoto) onClose(); }} ariaLabel={`Sửa khoản chi ${entry.shipmentCode ?? ''}`}>
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Sửa khoản chi · {entry.shipmentCode ?? '—'}{entry.containerNumber ? ` · ${entry.containerNumber}` : ''}</h2>
          <button type="button" aria-label="Đóng" disabled={updateExpense.isPending || uploadingPhoto} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ops-modal__body">
          {locked && <p role="status">Khoản đã đối chiếu. Kế toán điều chỉnh có liên kết tại bảng chi phí; bạn vẫn có thể bổ sung chứng từ.</p>}
          {typesQuery.isPending && <p role="status">Đang tải danh mục loại phí…</p>}
          {typesQuery.isError && <div role="alert">
            <p>Không tải được danh mục loại phí. Nội dung đang nhập vẫn được giữ.</p>
            <button type="button" className="btn-secondary" disabled={typesQuery.isFetching} onClick={() => void typesQuery.refetch()}>
              {typesQuery.isFetching ? 'Đang tải…' : 'Thử tải lại loại phí'}
            </button>
          </div>}
          {typesQuery.isSuccess && !typesData?.items.length && <p role="status">Chưa có loại phí đang sử dụng. Liên hệ người quản lý danh mục để bổ sung.</p>}
          <fieldset disabled={locked || updateExpense.isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="ops-form-grid">
            <UuiSelectField
              label="Loại phí"
              required
              disabled={!typesReady}
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value)}
              options={expenseTypeOptions}
            />
            <NumberField controlSize="sm" label="Thực chi (VND)" value={amount} onChange={setAmount}
              min={1} max={999_999_999_999_999} step={1} required error={amountError} />
            <label>
              Ngày chi *
              <DateInput value={paidAt} onChange={setPaidAt} required />
            </label>
          </div>
          <OpsExpenseFinancialFields value={financial} onChange={setFinancial} amount={amountValid ? Number(amount) : 0} disabled={updateExpense.isPending || uploadingPhoto} />
          <label className="ops-form-note">
            Ghi chú
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>

          {!locked && <label className="ops-form-note">Lý do điều chỉnh *<textarea value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} rows={2} /></label>}
          </fieldset>
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
            {pendingFiles.length > 0 && !uploadingPhoto && <div className="expense-accounting-file" role="status"><span>{pendingFiles.length} ảnh chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" onClick={() => void handlePhotoUpload(pendingFiles)}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => setPendingFiles([])}>Bỏ ảnh chưa tải</button></div>}
            {serverPhotoCount > 0 && (
              <ul className="ops-form-photos__list">
                {(existingPhotosData?.items ?? []).map((photo) => (
                  <li key={photo.storageKey}>
                    <img src={getAuthenticatedPhotoUrl(`/api/photos/${encodeURIComponent(photo.storageKey)}`)} alt="Biên lai khoản chi" />
                    <button type="button" aria-label={`Xóa ảnh biên lai ${photo.id}`} disabled={locked || deletePhoto.isPending} onClick={() => void deletePhoto.mutateAsync(photo.id).catch((error: unknown) => toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không xóa được ảnh.' }))}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <footer className="ops-modal__foot">
          <div>{entry.rejectionReason ? `Lý do bị từ chối: ${entry.rejectionReason}` : ''}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={updateExpense.isPending || uploadingPhoto}>Đóng</button>
            {!locked && <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {updateExpense.isPending ? <Loader2 size={14} className="spin" /> : null} Lưu
            </button>}
          </div>
        </footer>
      </form>
    </OpsModalBackdrop>
  );
}
