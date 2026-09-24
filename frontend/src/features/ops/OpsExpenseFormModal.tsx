import { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Trash2, X } from 'lucide-react';
import { useOpsExpenseTypes, useCreateOpsExpense } from '../../hooks/useOpsQueries';
import { opsClient, type OpsOrderItem } from '../../api/opsClient';
import { compressImageFile } from '../../lib/imageCompression';
import { getAuthenticatedPhotoUrl } from '../../lib/api';
import { useToast } from '../../components/shared/Toast';
import { formatVnd, localDateInputValue } from './opsStatus';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { DateInput } from '../../design-system/forms/DateInput';
import { NumberField } from '../../design-system/forms/NumberField';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { OpsExpenseFinancialFields, opsFinancialPayload, opsGroupForType, useOpsExpenseFinancialDraft } from './OpsExpenseFinancialFields';
interface Props {
  order: OpsOrderItem;
  onClose: () => void;
}

interface PendingPhoto {
  storageKey: string;
  name: string;
}

/** Số Cont choice → payload container id. The shared-lot choice and an empty
 *  choice both mean "no container row" — an empty string must never reach
 *  `Number()` and serialize as container 0 (audit c12 A2: the backend zod
 *  schema `shipmentContainerId: z.number().int().positive()` rejects 0 with
 *  the default message the UI translates to "Giá trị phải lớn hơn 0"). */
export function opsContainerId(containerChoice: string): number | null {
  if (containerChoice === 'LOT' || containerChoice === '') return null;
  return Number(containerChoice);
}

/**
 * "Khai báo chi phí" (OpsVanHanh §3.3): context-first form — mã lô + số bill
 * tự điền readonly, số cont chọn từ vỏ của lô, loại phí nhóm theo
 * requires_invoice. Ảnh nén trên máy trước khi tải; cho phép lưu trước và
 * bổ sung ảnh sau (tạo "nợ chứng từ").
 */
export function OpsExpenseFormModal({ order, onClose }: Props) {
  const typesQuery = useOpsExpenseTypes();
  const typesData = typesQuery.data;
  const createExpense = useCreateOpsExpense();
  const { toast } = useToast();

  const [containerChoice, setContainerChoice] = useState<string>('LOT');
  const [typeCode, setTypeCode] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [paidAt, setPaidAt] = useState(localDateInputValue());
  const [note, setNote] = useState('');
  const [financial, setFinancial] = useOpsExpenseFinancialDraft();
  const savingRef = useRef(false);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const groupedTypes = useMemo(() => {
    const items = typesData?.items ?? [];
    return {
      withInvoice: items.filter((type) => type.requiresInvoice === true),
      withoutInvoice: items.filter((type) => type.requiresInvoice !== true),
    };
  }, [typesData]);

  // UuiSelectField has no optgroup support — flatten the two groups with
  // disabled section-header rows (same as OpsExpenseEditModal).
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
  const canSubmit = typesReady && Boolean(typeCode) && amountValid && !createExpense.isPending && !uploading && pendingFiles.length === 0;

  async function handleFiles(files: FileList | File[] | null) {
    if (!files?.length || uploading || savingRef.current) return;
    if (files.length + photos.length > 20) { toast({ kind: 'error', message: 'Mỗi khoản chi tối đa 20 ảnh. Chọn ít ảnh hơn.' }); return; }
    const remaining = Array.from(files);
    setPendingFiles(remaining); setUploading(true);
    try {
      while (remaining.length) {
        const file = remaining[0];
        const compressed = await compressImageFile(file, { maxDimension: 2048 });
        const result = await opsClient.uploadExpensePhoto(compressed);
        setPhotos(current => [...current, { storageKey: result.storageKey, name: file.name }]);
        remaining.shift(); setPendingFiles([...remaining]);
      }
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Tải ảnh thất bại. Ảnh chưa tải vẫn được giữ để thử lại.' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || savingRef.current) return;
    savingRef.current = true;
    const containerId = opsContainerId(containerChoice);
    try {
      await createExpense.mutateAsync({
        shipmentId: order.id,
        shipmentContainerId: containerId,
        expenseTypeCode: typeCode,
        amount: String(amount),
        paidAt,
        note: note.trim() || null,
        photoStorageKeys: photos.map((photo) => photo.storageKey),
        ...opsFinancialPayload(financial),
      });
      toast({ kind: 'success', message: 'Đã ghi nhận khoản chi.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Lưu khoản chi thất bại.' });
    } finally {
      savingRef.current = false;
    }
  }

  const busy = createExpense.isPending;

  return (
    <OpsModalBackdrop onClose={() => { if (!savingRef.current && !uploading) onClose(); }} ariaLabel="Khai báo chi phí">
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Khai báo chi phí</h2>
          <button type="button" aria-label="Đóng" disabled={busy || uploading} onClick={onClose}><X size={18} /></button>
        </header>

        <div className="ops-modal__body">
          {typesQuery.isPending && <p role="status">Đang tải danh mục loại phí…</p>}
          {typesQuery.isError && <div role="alert">
            <p>Không tải được danh mục loại phí. Nội dung đang nhập vẫn được giữ.</p>
            <button type="button" className="btn-secondary" disabled={typesQuery.isFetching} onClick={() => void typesQuery.refetch()}>
              {typesQuery.isFetching ? 'Đang tải…' : 'Thử tải lại loại phí'}
            </button>
          </div>}
          {typesQuery.isSuccess && !typesData?.items.length && <p role="status">Chưa có loại phí đang sử dụng. Liên hệ người quản lý danh mục để bổ sung.</p>}
          <div className="ops-form-grid">
            <label>
              Mã lô
              <input value={order.shipmentCode ?? '—'} readOnly />
            </label>
            <label>
              Số {order.tradeDirection === 'EXPORT' ? 'Booking' : 'Bill'}
              <input value={order.billRef ?? '—'} readOnly />
            </label>
            <UuiSelectField
              label="Số Cont"
              value={containerChoice}
              onChange={(event) => setContainerChoice(event.target.value)}
              options={[
                { value: 'LOT', label: 'Phí chung lô' },
                ...order.containerNumbers.map((containerNumber, index) => (
                  { value: String(order.containerIds[index]), label: containerNumber }
                )),
              ]}
            />
            <UuiSelectField
              label="Loại phí"
              required
              disabled={!typesReady || busy}
              value={typeCode}
              onChange={(event) => {
                const type = typesData?.items.find((item) => item.code === event.target.value);
                setTypeCode(event.target.value);
                setFinancial((current) => ({ ...current, costGroup: opsGroupForType(event.target.value, type?.requiresInvoice === true) }));
              }}
              options={expenseTypeOptions}
            />
            <NumberField controlSize="sm" label="Thực chi (VND)" value={amount} onChange={setAmount}
              min={1} max={999_999_999_999_999} step={1} required error={amountError} />
            <label>
              Ngày chi *
              <DateInput value={paidAt} onChange={setPaidAt} required />
            </label>
          </div>

          <OpsExpenseFinancialFields value={financial} onChange={setFinancial} amount={amountValid ? Number(amount) : 0} disabled={busy || uploading} />

          <label className="ops-form-note">
            Ghi chú
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>

          <div className="ops-form-photos">
            <div className="ops-form-photos__head">
              <span>Ảnh biên lai ({photos.length})</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || busy}
              >
                {uploading ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}
                {uploading ? 'Đang tải…' : 'Chụp / chọn ảnh'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                onChange={(event) => void handleFiles(event.target.files)}
              />
            </div>
            {pendingFiles.length > 0 && !uploading && <div className="expense-accounting-file" role="status"><span>{pendingFiles.length} ảnh chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleFiles(pendingFiles)}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => setPendingFiles([])}>Bỏ ảnh chưa tải</button></div>}
            {photos.length > 0 && (
              <ul className="ops-form-photos__list">
                {photos.map((photo) => (
                  <li key={photo.storageKey}>
                    <img src={getAuthenticatedPhotoUrl(`/api/photos/${encodeURIComponent(photo.storageKey)}`)} alt={photo.name} />
                    <button
                      type="button"
                      aria-label={`Xóa ${photo.name}`}
                      onClick={() => setPhotos((current) => current.filter((item) => item.storageKey !== photo.storageKey))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="ops-modal__foot">
          <div>{`Tổng: ${amountValid ? formatVnd(String(amount)) : '—'} ₫`}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy || uploading}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {busy ? <Loader2 size={14} className="spin" /> : null} Lưu
            </button>
          </div>
        </footer>
      </form>
    </OpsModalBackdrop>
  );
}

export default OpsExpenseFormModal;
