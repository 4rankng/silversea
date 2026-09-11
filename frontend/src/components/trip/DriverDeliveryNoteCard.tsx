import { useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { api, fileCommandFingerprint } from '../../lib/api';
import { compressImageFile } from '../../lib/imageCompression';
import { useToast } from '../shared/Toast';
import { ContainerScanner, dataUrlToFile } from '../shared/ContainerScanner';
import { photoSrc } from './DriverTripPhotos';

/**
 * 40f3ae15 — biên bản giao hàng (delivery note) photo card for the driver
 * trip-detail page. Optional photo, stored as trip_photos type DELIVERY_NOTE
 * through POST /upload (the OCR route is CONTAINER/SEAL-specific;
 * applicationEnum is a text column — additive value, no migration).
 * Independent of the container card's form lifecycle: always reachable,
 * saved row or not.
 *
 * Deleted via the targeted per-photo route (exact storage key) — unlike the
 * delete-all-of-type driver route, it can never sweep unrelated rows
 * (incidental-cost receipts still ride OTHER).
 */
export function DriverDeliveryNoteCard({ tripId, photoKey, onSaved }: {
  tripId: number;
  photoKey: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [uploadingNote, setUploadingNote] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const onPickNote = async (rawFile: File | undefined) => {
    if (!rawFile) return;
    setUploadingNote(true);
    try {
      const file = await compressImageFile(rawFile, { timestamp: new Date() });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('trip_id', String(tripId));
      formData.append('type', 'DELIVERY_NOTE');
      const retryFingerprint = [
        'driver-delivery-note-photo',
        fileCommandFingerprint(file),
        tripId,
      ].join(':');
      await api.upload('/upload', formData, { retryFingerprint });
      toast({ kind: 'success', message: 'Đã lưu ảnh biên bản giao hàng.' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', message: e instanceof Error ? e.message : 'Không tải được ảnh biên bản.' });
    } finally {
      setUploadingNote(false);
    }
  };

  const removeDeliveryNote = async () => {
    if (!photoKey) return;
    setUploadingNote(true);
    try {
      await api.post(`/upload/trips/${tripId}/photos/delivery_note/delete`, { storage_key: photoKey }, {
        idempotencyKey: `driver-delivery-note-delete:${tripId}:${photoKey}`,
      });
      toast({ kind: 'success', message: 'Đã xóa ảnh biên bản.' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', message: e instanceof Error ? e.message : 'Không xóa được ảnh biên bản.' });
    } finally {
      setUploadingNote(false);
    }
  };

  return (
    <div className="dcc-note" data-testid="delivery-note-block">
      <div className="dcc-note__title">Biên bản giao hàng</div>
      <div className="dcc-capture">
        {/* No aria-label: the visible span text is the accessible name. */}
        <label className="dcc-capture-btn dcc-capture-btn--primary">
          {uploadingNote ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
          <span>Chụp / chọn ảnh biên bản giao hàng</span>
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={uploadingNote}
            onChange={e => {
              const file = e.target.files?.[0];
              void onPickNote(file);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          className="dcc-capture-btn dcc-capture-btn--secondary"
          disabled={uploadingNote}
          onClick={() => setScannerOpen(true)}
          title="Mở camera overlay (chế độ chụp nâng cao)"
        >
          <span>Mở camera biên bản</span>
        </button>
      </div>

      {scannerOpen && (
        <ContainerScanner
          onCapture={dataUrl => {
            void onPickNote(dataUrlToFile(dataUrl, 'delivery-note.jpg'));
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {photoKey && (
        <div className="dcc-photos">
          <figure className="dcc-photo-fig">
            <button
              type="button"
              className="dcc-photo-remove"
              onClick={() => void removeDeliveryNote()}
              disabled={uploadingNote}
              aria-label="Xóa ảnh biên bản"
            >
              {uploadingNote ? <Loader2 size={12} className="spin" /> : <X size={12} />}
            </button>
            <img className="dcc-photo" src={photoSrc(photoKey)} alt="Ảnh biên bản giao hàng" />
            <figcaption>Ảnh biên bản</figcaption>
          </figure>
        </div>
      )}
      <p className="dcc-help">Ảnh biên bản giao hàng (tùy chọn) — chụp khi giao nhận cont tại nhà máy/kho.</p>
    </div>
  );
}
