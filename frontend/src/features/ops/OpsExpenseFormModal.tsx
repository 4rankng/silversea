import { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Trash2, X } from 'lucide-react';
import { useOpsExpenseTypes, useCreateOpsExpense, useAttachOpsExpensePhoto } from '../../hooks/useOpsQueries';
import { opsClient, type OpsOrderItem } from '../../api/opsClient';
import { compressImageFile } from '../../lib/imageCompression';
import { getAuthenticatedPhotoUrl } from '../../lib/api';
import { useToast } from '../../components/shared/Toast';
import { formatVnd, localDateInputValue } from './opsStatus';

interface Props {
  order: OpsOrderItem;
  onClose: () => void;
}

interface PendingPhoto {
  storageKey: string;
  name: string;
}

/**
 * "Khai báo chi phí" (OpsVanHanh §3.3): context-first form — mã lô + số bill
 * tự điền readonly, số cont chọn từ vỏ của lô, loại phí nhóm theo
 * requires_invoice. Ảnh nén trên máy trước khi tải; cho phép lưu trước và
 * bổ sung ảnh sau (tạo "nợ chứng từ").
 */
export function OpsExpenseFormModal({ order, onClose }: Props) {
  const { data: typesData } = useOpsExpenseTypes();
  const createExpense = useCreateOpsExpense();
  const attachPhoto = useAttachOpsExpensePhoto();
  const { toast } = useToast();

  const [containerChoice, setContainerChoice] = useState<string>('LOT');
  const [typeCode, setTypeCode] = useState('');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(localDateInputValue());
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const groupedTypes = useMemo(() => {
    const items = typesData?.items ?? [];
    return {
      withInvoice: items.filter((type) => type.requiresInvoice === true),
      withoutInvoice: items.filter((type) => type.requiresInvoice !== true),
    };
  }, [typesData]);

  const amountClean = amount.replace(/[^\d]/g, '');
  const amountValid = /^\d+$/.test(amountClean) && Number(amountClean) > 0;
  const canSubmit = Boolean(typeCode) && amountValid && !createExpense.isPending;

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const uploaded: PendingPhoto[] = [];
      for (const file of Array.from(fileList)) {
        const compressed = await compressImageFile(file, { maxDimension: 2048 });
        const uploaded1 = await opsClient.uploadExpensePhoto(compressed);
        uploaded.push({ storageKey: uploaded1.storageKey, name: file.name });
      }
      setPhotos((current) => [...current, ...uploaded]);
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Tải ảnh thất bại.' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const containerId = containerChoice === 'LOT' ? null : Number(containerChoice);
    try {
      await createExpense.mutateAsync({
        shipmentId: order.id,
        shipmentContainerId: containerId,
        expenseTypeCode: typeCode,
        amount: amountClean,
        paidAt,
        note: note.trim() || null,
        photoStorageKeys: photos.map((photo) => photo.storageKey),
      });
      toast({ kind: 'success', message: 'Đã lưu khoản chi — chờ kế toán duyệt.' });
      onClose();
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Lưu khoản chi thất bại.' });
    }
  }

  const busy = createExpense.isPending;

  return (
    <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Khai báo chi phí">
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Khai báo chi phí</h2>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="ops-modal__body">
          <div className="ops-form-grid">
            <label>
              Mã lô
              <input value={order.shipmentCode ?? '—'} readOnly />
            </label>
            <label>
              Số {order.tradeDirection === 'EXPORT' ? 'Booking' : 'Bill'}
              <input value={order.billRef ?? '—'} readOnly />
            </label>
            <label>
              Số Cont
              <select
                value={containerChoice}
                onChange={(event) => setContainerChoice(event.target.value)}
              >
                <option value="LOT">Phí chung lô</option>
                {order.containerNumbers.map((containerNumber, index) => (
                  <option key={order.containerIds[index]} value={order.containerIds[index]}>
                    {containerNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Loại phí *
              <select value={typeCode} onChange={(event) => setTypeCode(event.target.value)} required>
                <option value="">— Chọn loại phí —</option>
                {groupedTypes.withInvoice.length > 0 && (
                  <optgroup label="Có hóa đơn">
                    {groupedTypes.withInvoice.map((type) => (
                      <option key={type.code} value={type.code}>{type.name}</option>
                    ))}
                  </optgroup>
                )}
                {groupedTypes.withoutInvoice.length > 0 && (
                  <optgroup label="Không hóa đơn">
                    {groupedTypes.withoutInvoice.map((type) => (
                      <option key={type.code} value={type.code}>{type.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              Số tiền (VND) *
              <input
                value={amountClean ? formatVnd(amountClean) : ''}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder="0"
                required
              />
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
              <span>Ảnh biên lai ({photos.length})</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
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
            <p className="ops-form-photos__hint">Có thể lưu trước và bổ sung ảnh sau — khoản chi sẽ bị đánh dấu “Nợ chứng từ” cho tới khi đủ ảnh.</p>
          </div>
        </div>

        <footer className="ops-modal__foot">
          <div>{attachPhoto.isPending ? 'Đang đính kèm ảnh…' : `Tổng: ${amountClean ? formatVnd(amountClean) : 0} ₫`}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Đóng</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {busy ? <Loader2 size={14} className="spin" /> : null} Lưu
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

export default OpsExpenseFormModal;
