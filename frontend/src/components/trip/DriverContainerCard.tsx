import { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Save, Package, AlertCircle, Pencil, X, Check } from 'lucide-react';
import { api, fileCommandFingerprint } from '../../lib/api';
import { compressImageFile } from '../../lib/imageCompression';
import { useToast } from '../shared/Toast';
import { ContainerScanner, dataUrlToFile } from '../shared/ContainerScanner';
import { PhotoViewer } from '../PhotoViewer';
import { photoSrc, renderThumb } from './DriverTripPhotos';
import { normalizeContainerNumber } from '@tingting/shared';
import { checkContainerNumber } from './container-instance-helpers';
import { TextField } from '../../design-system';
import './DriverContainerCard.css';

/** Driver container/seal/evidence editor. OCR fills a draft; only explicit
 * Save writes identifiers. Container, seal and delivery-note images share
 * the same attachment area and authenticated viewer. */

interface ExistingContainer {
  id: number;
  /** Optimistic-lock token for PATCH — the backend requires If-Unmodified-Since. */
  updatedAt: string;
  containerNumber: string | null;
  sealNumber: string | null;
  containerTypeId: number | null;
  containerTypeName: string | null;
  containerTypeCode: string | null;
  cargoWeightKg: string | null;
}

interface OcrResponse {
  ok: boolean;
  containerNumbers?: string[];
  sealNumber?: string | null;
  photoUrl?: string;
  error?: string | null;
}

interface Props {
  tripId: number;
  /** Completed trips reject container edits and photo deletion in the API. */
  readOnly?: boolean;
  /** Existing containers for this trip (read-only display; refreshed by parent). */
  containers: ExistingContainer[];
  /** Storage key of the latest container photo — shown as a thumbnail once saved. */
  contPhotoKey: string | null;
  /** Storage key of the latest seal photo — shown as a thumbnail once saved. */
  sealPhotoKey: string | null;
  /** 40f3ae15: latest biên bản giao hàng photo (trip_photos type OTHER). */
  deliveryNotePhotoKey: string | null;
  /** Shipment trade direction. IMPORT (trả hàng) scans are cross-checked
   *  against the declared container number (spec A6, advisory only). */
  tradeDirection: string | null;
  onSaved: () => void;
}

// photoSrc + renderThumb/BentoThumb primitives live in ./DriverTripPhotos
// (structure-guard split shared across the driver photo surfaces).
export function DriverContainerCard({ tripId, readOnly = false, containers: sourceContainers, contPhotoKey, sealPhotoKey, deliveryNotePhotoKey, tradeDirection, onSaved }: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({ containerNumber: '', sealNumber: '', containerTypeId: '' });
  const [lastPhotos, setLastPhotos] = useState<{ cont: string | null; seal: string | null }>({ cont: null, seal: null });
  const [uploading, setUploading] = useState<{ cont: boolean; seal: boolean }>({ cont: false, seal: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [containerError, setContainerError] = useState<string | null>(null);
  const containerFieldRef = useRef<HTMLDivElement>(null);
  const [scannerType, setScannerType] = useState<'CONTAINER' | 'SEAL' | 'DELIVERY_NOTE' | null>(null);
  const [editing, setEditing] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState<'CONTAINER' | 'SEAL' | null>(null);
  // Biên bản giao hàng upload/delete — independent of the form lifecycle
  // (always reachable, saved row or not), same as before the unification.
  const [uploadingNote, setUploadingNote] = useState(false);
  const [removingNote, setRemovingNote] = useState(false);
  // Full-image viewer over the populated slots (same PhotoViewer the e-POD
  // flow uses): the opener tile is remembered so closing returns focus to it.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerOpenerRef = useRef<HTMLButtonElement | null>(null);
  // Spec A6 (hàng nhập / trả hàng): the OCR'd number is compared against the
  // declared number at SCAN time — after Lưu the declared value is overwritten,
  // so a post-save comparison is meaningless. Advisory only (non-blocking).
  const [scanCheck, setScanCheck] = useState<{ scanned: string; declared: string } | null>(null);

  const containers = sourceContainers ?? [];
  const hasSaved = containers.length > 0;
  const showForm = !readOnly && (!hasSaved || editing);
  const editingExisting = hasSaved && editing;

  const enterEdit = () => {
    if (!hasSaved || readOnly) return;
    const c = containers[0];
    setDraft({
      // Saved rows can carry a null container number (seal-only / LCL saves) —
      // seeding the draft with null would crash the render-time ISO-6346
      // check (`.trim()` on null) the moment Sửa opens the form.
      containerNumber: c.containerNumber ?? '',
      sealNumber: c.sealNumber ?? '',
      containerTypeId: c.containerTypeId ? String(c.containerTypeId) : '',
    });
    // Seed the photo strip with the currently-saved photos so the driver can see
    // what was on file before they decide to re-capture. Re-capture overwrites
    // these in-place, and the parent refetch updates contPhotoKey/sealPhotoKey.
    setLastPhotos({ cont: contPhotoKey, seal: sealPhotoKey });
    setError(null);
    setContainerError(null);
    setScanCheck(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const onPick = async (rawFile: File | undefined, _type: 'CONTAINER' | 'SEAL', capturedAt?: Date) => {
    if (!rawFile) return;
    const key = _type === 'CONTAINER' ? 'cont' : 'seal';
    setUploading(prev => ({ ...prev, [key]: true }));
    setError(null);
    if (_type === 'CONTAINER') setScanCheck(null);
    // The IMPORT cross-check below already speaks (match or mismatch toast);
    // suppress the generic "recognized" toast in that case to avoid a double.
    let crossCheckToasted = false;
    try {
      // Only a live shutter supplies capture time; gallery selection does not.
      const file = await compressImageFile(rawFile, { timestamp: capturedAt });
      const formData = new FormData();
      formData.append('file', file);
      // The backend now uses type-specific extraction: CONTAINER photos only
      // extract container numbers, SEAL photos only extract seal numbers.
      formData.append('type', _type);
      formData.append('trip_id', String(tripId));
      const retryFingerprint = [
        'driver-container-card',
        fileCommandFingerprint(file),
        _type,
        tripId,
      ].join(':');
      const result = await api.upload('/ocr', formData, { retryFingerprint }) as OcrResponse;

      if (_type === 'CONTAINER') {
        const cn = result.containerNumbers?.[0];
        if (cn) {
          setDraft(prev => ({ ...prev, containerNumber: cn.toUpperCase() }));
          // Spec A6 IMPORT (trả hàng): cross-check the scanned number against
          // the declared one and warn on mismatch — guards against picking the
          // wrong container. Advisory only; the driver still reviews + Lưu.
          const declared = containers[0]?.containerNumber;
          if (tradeDirection === 'IMPORT' && declared) {
            crossCheckToasted = true;
            const scannedNorm = normalizeContainerNumber(cn);
            const declaredNorm = normalizeContainerNumber(declared);
            if (scannedNorm !== declaredNorm) {
              setScanCheck({ scanned: cn.toUpperCase(), declared });
              toast({ kind: 'warning', message: 'Số cont quét được khác số khai báo — kiểm tra lại trước khi lưu.' });
            } else {
              toast({ kind: 'success', message: 'Số cont quét được khớp số khai báo.' });
            }
          }
        }
      } else {
        if (result.sealNumber) {
          setDraft(prev => ({ ...prev, sealNumber: result.sealNumber!.toUpperCase() }));
        }
      }

      if (result.photoUrl) {
        setLastPhotos(prev => ({ ...prev, [key]: result.photoUrl! }));
      }

      if (result.error) {
        setError(result.error);
      } else if ((result.containerNumbers?.length ?? 0) > 0 || result.sealNumber) {
        if (!crossCheckToasted) {
          toast({ kind: 'info', message: 'Đã nhận diện số — xem lại rồi bấm Lưu.' });
        }
      } else {
        setError(_type === 'SEAL'
          ? 'Không thấy số seal trên ảnh. Hãy nhập tay hoặc chụp lại.'
          : 'Không thấy số cont trên ảnh. Hãy nhập tay hoặc chụp lại.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi nhận diện ảnh.');
    } finally {
      setUploading(prev => ({ ...prev, [key]: false }));
    }
  };

  // Remove a single photo type (cont or seal) immediately — consistent with
  // capture being immediate (each capture already persists via OCR). Clears the
  // thumbnail from the strip and refetches via onSaved so the read-only view
  // stays correct even if the driver later cancels.
  const removePhoto = async (type: 'CONTAINER' | 'SEAL') => {
    const key = type === 'CONTAINER' ? 'cont' : 'seal';
    setRemovingPhoto(type);
    setError(null);
    try {
      await api.delete(`/driver/me/trips/${tripId}/photos/${type.toLowerCase()}`);
      setLastPhotos(prev => ({ ...prev, [key]: null }));
      toast({ kind: 'success', message: type === 'CONTAINER' ? 'Đã xóa ảnh cont.' : 'Đã xóa ảnh seal.' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', message: e instanceof Error ? e.message : 'Không xóa được ảnh.' });
    } finally {
      setRemovingPhoto(null);
    }
  };

  // Biên bản giao hàng photo — no OCR path (the /ocr route is CONTAINER/SEAL
  // specific), stored as trip_photos type DELIVERY_NOTE through POST /upload.
  const onPickNote = async (rawFile: File | undefined, capturedAt?: Date) => {
    if (!rawFile) return;
    setUploadingNote(true);
    try {
      const file = await compressImageFile(rawFile, { timestamp: capturedAt });
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

  // Targeted per-photo delete (exact storage key) — unlike the delete-all-of-
  // type driver route, it can never sweep unrelated rows (incidental-cost
  // receipts still ride OTHER).
  const removeDeliveryNote = async () => {
    if (!deliveryNotePhotoKey) return;
    setRemovingNote(true);
    try {
      await api.post(`/upload/trips/${tripId}/photos/delivery_note/delete`, { storage_key: deliveryNotePhotoKey }, {
        idempotencyKey: `driver-delivery-note-delete:${tripId}:${deliveryNotePhotoKey}`,
      });
      toast({ kind: 'success', message: 'Đã xóa ảnh biên bản.' });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', message: e instanceof Error ? e.message : 'Không xóa được ảnh biên bản.' });
    } finally {
      setRemovingNote(false);
    }
  };

  const noteFileInput = (
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
  );

  // Populated slots only — gallery order follows the tile strip (cont, seal,
  // biên bản). Empty slots never imply an openable image.
  const viewerPhotos = useMemo(() => [
    contPhotoKey ? { label: 'Cont', url: photoSrc(contPhotoKey) } : null,
    sealPhotoKey ? { label: 'Seal', url: photoSrc(sealPhotoKey) } : null,
    deliveryNotePhotoKey ? { label: 'Biên bản', url: photoSrc(deliveryNotePhotoKey) } : null,
  ].filter((entry): entry is { label: string; url: string } => entry != null), [contPhotoKey, sealPhotoKey, deliveryNotePhotoKey]);

  const openViewer = (label: string, opener: HTMLButtonElement) => {
    const index = viewerPhotos.findIndex((entry) => entry.label === label);
    if (index < 0) return;
    viewerOpenerRef.current = opener;
    setViewerIndex(index);
  };

  /** One photo slot: a plain-tile button when populated (opens the viewer),
   *  the labelled placeholder when empty — never an empty button. */
  const attachmentTile = (photoKey: string | null, label: string) => photoKey ? (
    <button
      type="button"
      className="dcc-bento__tile-btn"
      aria-label={`Xem ảnh ${label.toLowerCase()}`}
      onClick={(e) => openViewer(label, e.currentTarget)}
    >
      {renderThumb(photoKey, label)}
    </button>
  ) : (
    renderThumb(photoKey, label)
  );

  const handleSave = async () => {
    if (readOnly || saving || uploading.cont || uploading.seal || uploadingNote) return;
    setError(null);
    const invalid = draft.containerNumber.trim()
      ? checkContainerNumber(draft.containerNumber).warning : 'Cần nhập số container.';
    setContainerError(invalid);
    if (invalid) {
      containerFieldRef.current?.querySelector('input')?.focus();
      return;
    }
    setScanCheck(null);
    setSaving(true);
    try {
      // Both branches persist the same payload — only the verb + outcome differ.
      const payload = {
        containerNumber: normalizeContainerNumber(draft.containerNumber),
        sealNumber: draft.sealNumber.trim() || null,
        containerTypeId: draft.containerTypeId ? Number(draft.containerTypeId) : null,
      };
      if (editingExisting) {
        // PATCH the existing row — preserves id, audit history, and updates
        // updatedAt. Photos are re-persisted by the OCR pipeline (saveTripPhoto)
        // so the latest photo becomes the canonical one on the next refetch.
        // Pass If-Unmodified-Since explicitly from the loaded row: the blind
        // client-side remember-map is not seeded for this nested path, so a
        // first-save-after-load (the scan → Lưu happy path) failed with
        // "Cần tải lại phiên bản số cont mới nhất" until reload.
        const id = containers[0].id;
        await api.patch(`/driver/me/trips/${tripId}/containers/${id}`, payload, {
          expectedUpdatedAt: containers[0].updatedAt,
        });
        toast({ kind: 'success', message: 'Đã cập nhật số cont.' });
        setEditing(false);
      } else {
        // First-time save — creates the row. Numbers are never auto-committed
        // (locked design decision #1): the OCR result only pre-fills the form;
        // nothing reaches the DB until the driver taps Lưu.
        await api.post(`/driver/me/trips/${tripId}/containers`, payload);
        // Intentionally RETAIN draft + lastPhotos after a successful save:
        // clearing was discarding the cont number, seal number and both photos
        // the instant the save went through, so the driver couldn't review what
        // was captured. The saved row still appears in the read-only list via
        // onSaved() below.
        toast({ kind: 'success', message: 'Đã lưu số cont.' });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi lưu số cont.');
    } finally {
      setSaving(false);
    }
  };

  const check = checkContainerNumber(draft.containerNumber);
  const busy = saving || uploading.cont || uploading.seal || uploadingNote;

  return (
    <section className="dcc-section">
      <div className="dcc-section__head">
        <Package size={15} style={{ color: 'var(--ink-3)' }} />
        <span className="dcc-section__title">Số cont & seal</span>
      </div>
      <div className="dcc-section__body">
        {/* Bento read-only view — shown when a container has been saved and the
            driver is NOT currently editing it. Dispatch-style metric strip: a
            full-width featured hero (cont # + type + Sửa) over a hairline-split
            1×2 row — Seal on the left, both photos as fixed square thumbnails
            inside a single "Hình ảnh" cell on the right. A centered 3×20 status
            strip on the hero carries the brand accent (never a full-height bar),
            and thumbnails are pinned to fixed square dimensions so the grid can
            never stretch them. */}
        {((hasSaved && !editing) || readOnly) && (
          <div className="dcc-bento">
            <div className="dcc-bento__hero">
              <div className="dcc-bento__hero-content">
                <div className="dcc-bento__eyebrow">Số cont</div>
                <div className="dcc-bento__plate">{containers[0]?.containerNumber || 'Chưa có số cont'}</div>
                {containers[0]?.containerTypeName && (
                  <div className="dcc-bento__hero-meta">
                    {containers[0].containerTypeName}
                  </div>
                )}
              </div>
              {!readOnly && <button
                type="button"
                className="dcc-bento__edit-btn"
                onClick={enterEdit}
                aria-label="Sửa số cont"
              >
                <Pencil size={13} /> Sửa
              </button>}
            </div>

            <div className="dcc-bento__seal">
              <div className="dcc-bento__eyebrow">Seal</div>
              <div className="dcc-bento__seal-value">
                {containers[0]?.sealNumber || <span className="dcc-bento__dash">—</span>}
              </div>
            </div>

            <div className="dcc-bento__photos">
              <div className="dcc-bento__eyebrow">Hình ảnh</div>
              <div className="dcc-bento__thumbs">
                {attachmentTile(contPhotoKey, 'Cont')}
                {attachmentTile(sealPhotoKey, 'Seal')}
                {/* Biên bản slot carries its own delete — the photo block is
                    the single display + management surface for all 3 types. */}
                <div className="dcc-bento__slot">
                  {attachmentTile(deliveryNotePhotoKey, 'Biên bản')}
                  {deliveryNotePhotoKey && !readOnly && (
                    <button
                      type="button"
                      className="dcc-photo-remove"
                      onClick={() => void removeDeliveryNote()}
                      disabled={removingNote || uploadingNote}
                      aria-label="Xóa ảnh biên bản"
                    >
                      {removingNote ? <Loader2 size={12} className="spin" /> : <X size={12} />}
                    </button>
                  )}
                </div>
              </div>
              {/* Ghost retake affordances under the saved slots — one style,
                  ≥44px touch on coarse pointers (design spec photo block). */}
              {!readOnly && <div className="dcc-capture dcc-capture--note">
                <label className="dcc-capture-btn dcc-capture-btn--secondary">
                  {uploadingNote ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
                  <span>Chụp / chọn ảnh biên bản</span>
                  {noteFileInput}
                </label>
                <button
                  type="button"
                  className="dcc-capture-btn dcc-capture-btn--secondary"
                  disabled={uploadingNote}
                  onClick={() => setScannerType('DELIVERY_NOTE')}
                  title="Mở camera overlay (chế độ chụp nâng cao)"
                >
                  <span>Mở camera biên bản</span>
                </button>
              </div>}
            </div>
          </div>
        )}

        {/* Entry form — shown for the very first save, and re-shown when the
            driver taps Sửa. PATCH (edit) vs POST (create) is decided inside
            handleSave based on the editingExisting flag. */}
        {showForm && (
          <>
            {error && (
              <div className="dcc-error" role="alert">
                <AlertCircle size={15} /> {error}
              </div>
            )}

            {scanCheck && (
              <div className="dcc-scancheck" role="alert" data-testid="container-scan-mismatch">
                <AlertCircle size={15} />
                <span>
                  Số cont quét được <strong>{scanCheck.scanned}</strong> khác số khai báo{' '}
                  <strong>{scanCheck.declared}</strong>. Kiểm tra lại cont đang chụp trước khi lưu.
                </span>
              </div>
            )}

            {/* Capture zones — primary action is a direct file picker (always
                available, works on every browser), the camera icon is the
                secondary action that opens the fullscreen scanner overlay.
                Phần 4 ticket 2026-08-28: customer reported the camera-only
                button was unusable on some devices; the file picker is now
                one tap away. */}
            <div className="dcc-capture">
              <div className="dcc-capture-group">
                <label className="dcc-capture-btn dcc-capture-btn--primary">
                  {uploading.cont ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
                  <span>Chụp / chọn ảnh cont</span>
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading.cont}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      void onPick(file, 'CONTAINER');
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="dcc-capture-btn dcc-capture-btn--secondary"
                  disabled={uploading.cont}
                  onClick={() => setScannerType('CONTAINER')}
                  title="Mở camera overlay (chế độ chụp nâng cao)"
                >
                  <span>Mở camera cont</span>
                </button>
              </div>
              <div className="dcc-capture-group">
                <label className="dcc-capture-btn dcc-capture-btn--primary">
                  {uploading.seal ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
                  <span>Chụp / chọn ảnh seal</span>
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading.seal}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      void onPick(file, 'SEAL');
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="dcc-capture-btn dcc-capture-btn--secondary"
                  disabled={uploading.seal}
                  onClick={() => setScannerType('SEAL')}
                  title="Mở camera overlay (chế độ chụp nâng cao)"
                >
                  <span>Mở camera seal</span>
                </button>
              </div>
              <div className="dcc-capture-group">
                <label className="dcc-capture-btn dcc-capture-btn--primary">
                  {uploadingNote ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
                  <span>Chụp / chọn ảnh biên bản</span>
                  {noteFileInput}
                </label>
                <button
                  type="button"
                  className="dcc-capture-btn dcc-capture-btn--secondary"
                  disabled={uploadingNote}
                  onClick={() => setScannerType('DELIVERY_NOTE')}
                  title="Mở camera overlay (chế độ chụp nâng cao)"
                >
                  <span>Mở camera biên bản</span>
                </button>
              </div>
            </div>

            {/* Show the most recently uploaded photo for each capture zone so the
                driver can verify both the cont photo and the seal photo side-by-side
                before pressing Save. In edit mode this is seeded with the
                currently-saved photos so the driver can see what was on file
                before deciding to re-capture. */}
            {(lastPhotos.cont || lastPhotos.seal || deliveryNotePhotoKey) && (
              <div className="dcc-photos">
                {lastPhotos.cont && (
                  <figure className="dcc-photo-fig">
                    <button
                      type="button"
                      className="dcc-photo-remove"
                      onClick={() => void removePhoto('CONTAINER')}
                      disabled={removingPhoto !== null}
                      aria-label="Xóa ảnh cont"
                    >
                      {removingPhoto === 'CONTAINER' ? <Loader2 size={12} className="spin" /> : <X size={12} />}
                    </button>
                    <img className="dcc-photo" src={photoSrc(lastPhotos.cont)} alt="Ảnh cont" />
                    <figcaption>Ảnh cont</figcaption>
                  </figure>
                )}
                {lastPhotos.seal && (
                  <figure className="dcc-photo-fig">
                    <button
                      type="button"
                      className="dcc-photo-remove"
                      onClick={() => void removePhoto('SEAL')}
                      disabled={removingPhoto !== null}
                      aria-label="Xóa ảnh seal"
                    >
                      {removingPhoto === 'SEAL' ? <Loader2 size={12} className="spin" /> : <X size={12} />}
                    </button>
                    <img className="dcc-photo" src={photoSrc(lastPhotos.seal)} alt="Ảnh seal" />
                    <figcaption>Ảnh seal</figcaption>
                  </figure>
                )}
                {/* Biên bản preview in the same strip — keeps the empty-state
                    capture flow verifiable before the first container save. */}
                {deliveryNotePhotoKey && (
                  <figure className="dcc-photo-fig">
                    <button
                      type="button"
                      className="dcc-photo-remove"
                      onClick={() => void removeDeliveryNote()}
                      disabled={removingNote || uploadingNote}
                      aria-label="Xóa ảnh biên bản"
                    >
                      {removingNote ? <Loader2 size={12} className="spin" /> : <X size={12} />}
                    </button>
                    <img className="dcc-photo" src={photoSrc(deliveryNotePhotoKey)} alt="Ảnh biên bản giao hàng" />
                    <figcaption>Ảnh biên bản</figcaption>
                  </figure>
                )}
              </div>
            )}

            <div className="dcc-fields">
              <div ref={containerFieldRef}>
                <TextField
                  label="Số container"
                  required
                  placeholder="Ví dụ: TCKU1234567"
                  value={draft.containerNumber}
                  error={check.warning ?? containerError ?? undefined}
                  onChange={e => {
                    setDraft(prev => ({ ...prev, containerNumber: e.target.value.toUpperCase() }));
                    setContainerError(null);
                    setError(null);
                  }}
                />
                {check.suggestion && (
                  <div className="dcc-warn">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ padding: '0 10px', fontSize: 'var(--text-control-size)' }}
                      onClick={() => {
                        setDraft(prev => ({ ...prev, containerNumber: check.suggestion! }));
                        setContainerError(null);
                      }}
                    >
                      Đổi thành {check.suggestion}
                    </button>
                  </div>
                )}
              </div>

              <TextField
                label="Số seal"
                placeholder="Ví dụ: AB123456"
                value={draft.sealNumber}
                onChange={e => setDraft(prev => ({ ...prev, sealNumber: e.target.value.toUpperCase() }))}
              />
            </div>

            <div className="dcc-actions">
              {editingExisting && (
                <button
                  type="button"
                  className="btn btn--secondary dcc-cancel"
                  onClick={cancelEdit}
                  disabled={busy}
                >
                  <X size={16} />
                  Hủy
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary dcc-save"
                onClick={handleSave}
                disabled={busy}
              >
                {saving
                  ? <Loader2 size={16} className="spin" />
                  : editingExisting
                    ? <Check size={16} />
                    : <Save size={16} />}
                {saving
                  ? 'Đang lưu…'
                  : editingExisting
                    ? 'Lưu thay đổi'
                    : 'Lưu số cont'}
              </button>
            </div>

            <p className="dcc-help">
              {editingExisting
                ? 'Thay đổi số cont, seal hoặc chụp lại ảnh — bấm Lưu thay đổi khi xong.'
                : 'Chụp/tải ảnh vỏ cont hoặc seal — app tự nhận diện số. Hãy kiểm tra lại rồi bấm Lưu.'}
            </p>
          </>
        )}

        {/* Scanner overlay mounts once for both states — cont/seal (form) and
            biên bản (form or saved bento) all funnel through it. */}
        {scannerType && (
          <ContainerScanner
            onCapture={(dataUrl, capturedAt) => {
              if (scannerType === 'DELIVERY_NOTE') {
                void onPickNote(dataUrlToFile(dataUrl, 'delivery-note.jpg'), capturedAt);
              } else {
                void onPick(dataUrlToFile(dataUrl), scannerType, capturedAt);
              }
              setScannerType(null);
            }}
            onClose={() => setScannerType(null)}
          />
        )}

        {/* Full-image viewer (e-POD pattern): fit-to-image start, zoom/pan,
            gallery across the populated slots. The fixed overlay never
            scrolls the page behind it; closing restores focus to the opener
            tile so keyboard/AT users land exactly where they left. */}
        {viewerIndex != null && viewerPhotos[viewerIndex] && (
          <PhotoViewer
            urls={viewerPhotos.map((entry) => entry.url)}
            initialIndex={viewerIndex}
            onClose={() => {
              setViewerIndex(null);
              viewerOpenerRef.current?.focus();
            }}
          />
        )}
      </div>
    </section>
  );
}
