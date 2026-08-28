import { useEffect, useState } from 'react';
import { Camera, Loader2, Save, Package, AlertCircle, Pencil, X, Check, ImageOff } from 'lucide-react';
import { api, fileCommandFingerprint, getAuthenticatedPhotoUrl } from '../../lib/api';
import { compressImageFile } from '../../lib/imageCompression';
import { useToast } from '../shared/Toast';
import { ContainerScanner, dataUrlToFile } from '../shared/ContainerScanner';
import {
  normalizeContainerNumber,
  validateContainerFormat,
  validateCheckDigit,
  suggestCorrections,
} from '@tingting/shared';
import { TextField } from '../../design-system';
import './DriverContainerCard.css';

/**
 * Container & seal section for the driver trip-detail page.
 *
 * Unlike `ContainerInstancesCard` (back-office, lives inside the trip-form
 * context and batch-saves the whole list), this card is standalone: the driver
 * detail page is NOT wrapped in a TripFormProvider. The driver uploads a photo
 * of the container/seal, the server recognizes the numbers via OCR, the numbers
 * auto-fill an inline form for review/editing, and the driver confirms by
 * saving — one container at a time through `POST /driver/me/trips/:id/containers`.
 *
 * Numbers are NEVER auto-committed (locked design decision #1): the OCR result
 * only pre-fills the form; nothing reaches the DB until the driver taps Lưu.
 *
 * After a container is saved, the card switches to a bento read-only view
 * (license-plate hero + 1/1+1/1 cells for seal / cont photo, wide tile for
 * seal photo). A Sửa button on the hero re-enters the form pre-filled with
 * the saved values; saving there PATCHes the existing row instead of creating
 * a new one.
 */

interface ExistingContainer {
  id: number;
  /** Optimistic-lock token for PATCH — the backend requires If-Unmodified-Since. */
  updatedAt: string;
  containerNumber: string;
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
  /** Existing containers for this trip (read-only display; refreshed by parent). */
  containers: ExistingContainer[];
  /** Storage key of the latest container photo — shown as a thumbnail once saved. */
  contPhotoKey: string | null;
  /** Storage key of the latest seal photo — shown as a thumbnail once saved. */
  sealPhotoKey: string | null;
  /** Shipment trade direction. IMPORT (trả hàng) scans are cross-checked
   *  against the declared container number (spec A6, advisory only). */
  tradeDirection: string | null;
  onSaved: () => void;
}

type CheckStatus = { warning: string | null; suggestion: string | null };

/** ISO 6346 check-digit validation + a 1-edit correction suggestion. Advisory
 *  only — the number is never auto-saved. */
function checkContainerNumber(cn: string): CheckStatus {
  const trimmed = cn.trim();
  if (!trimmed) return { warning: null, suggestion: null };
  const norm = normalizeContainerNumber(trimmed);
  if (!validateContainerFormat(norm)) {
    return { warning: 'Số cont sai định dạng (4 chữ cái + 7 số).', suggestion: null };
  }
  if (validateCheckDigit(norm)) return { warning: null, suggestion: null };
  const corrections = suggestCorrections(norm, 1);
  return { warning: 'Số cont sai chữ số kiểm tra — kiểm tra lại.', suggestion: corrections[0] ?? null };
}

/** Normalize a stored photo reference to an authenticated `/api/photos/` URL.
 *  Accepts either a bare storage key (e.g. `trips/154/container-…jpg`, as
 *  returned by getDriverTripDetail) or an already-formed `/api/photos/…` URL
 *  (as returned by a fresh OCR upload). Bare keys are encoded so the slashes
 *  survive as a single path segment that the wildcard photo route decodes. */
function photoSrc(value: string | null | undefined): string {
  if (!value) return '';
  const url = value.startsWith('/api/photos/') ? value : `/api/photos/${encodeURIComponent(value)}`;
  return getAuthenticatedPhotoUrl(url);
}

function EmptyThumb({ label }: { label: string }) {
  return <div className="dcc-bento__thumb-empty"><ImageOff size={15} /><span>{label}</span></div>;
}

/** One bento thumbnail: preflight the protected photo URL so missing files render
 *  as a calm placeholder instead of a broken browser image on the driver phone. */
function BentoThumb({ photoKey, label }: { photoKey: string | null; label: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!photoKey) {
      setSrc('');
      return;
    }

    const nextSrc = photoSrc(photoKey);
    const controller = new AbortController();

    fetch(nextSrc, { method: 'HEAD', signal: controller.signal })
      .then(response => {
        setSrc(response.ok ? nextSrc : '');
      })
      .catch(() => {
        if (!controller.signal.aborted) setSrc('');
      });

    return () => controller.abort();
  }, [photoKey]);

  return src
    ? <img className="dcc-bento__thumb" src={src} alt={`Ảnh ${label.toLowerCase()}`} onError={() => setSrc('')} />
    : <EmptyThumb label={label} />;
}

/** One bento thumbnail: the photo if `key` is present and valid, else a labelled
 *  empty placeholder. Cont and Seal thumbs are identical modulo key + label. */
function renderThumb(key: string | null, label: string) {
  return <BentoThumb photoKey={key} label={label} />;
}

export function DriverContainerCard({ tripId, containers, contPhotoKey, sealPhotoKey, tradeDirection, onSaved }: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({ containerNumber: '', sealNumber: '', containerTypeId: '' });
  const [lastPhotos, setLastPhotos] = useState<{ cont: string | null; seal: string | null }>({ cont: null, seal: null });
  const [uploading, setUploading] = useState<{ cont: boolean; seal: boolean }>({ cont: false, seal: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerType, setScannerType] = useState<'CONTAINER' | 'SEAL' | null>(null);
  const [editing, setEditing] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState<'CONTAINER' | 'SEAL' | null>(null);
  // Spec A6 (hàng nhập / trả hàng): the OCR'd number is compared against the
  // declared number at SCAN time — after Lưu the declared value is overwritten,
  // so a post-save comparison is meaningless. Advisory only (non-blocking).
  const [scanCheck, setScanCheck] = useState<{ scanned: string; declared: string } | null>(null);

  const hasSaved = containers.length > 0;
  const showForm = !hasSaved || editing;
  const editingExisting = hasSaved && editing;

  const enterEdit = () => {
    if (!hasSaved) return;
    const c = containers[0];
    setDraft({
      containerNumber: c.containerNumber,
      sealNumber: c.sealNumber ?? '',
      containerTypeId: c.containerTypeId ? String(c.containerTypeId) : '',
    });
    // Seed the photo strip with the currently-saved photos so the driver can see
    // what was on file before they decide to re-capture. Re-capture overwrites
    // these in-place, and the parent refetch updates contPhotoKey/sealPhotoKey.
    setLastPhotos({ cont: contPhotoKey, seal: sealPhotoKey });
    setError(null);
    setScanCheck(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const onPick = async (rawFile: File | undefined, _type: 'CONTAINER' | 'SEAL') => {
    if (!rawFile) return;
    const key = _type === 'CONTAINER' ? 'cont' : 'seal';
    setUploading(prev => ({ ...prev, [key]: true }));
    setError(null);
    if (_type === 'CONTAINER') setScanCheck(null);
    // The IMPORT cross-check below already speaks (match or mismatch toast);
    // suppress the generic "recognized" toast in that case to avoid a double.
    let crossCheckToasted = false;
    try {
      // Spec A6/Phần 2 Khối 2: every driver photo carries a burned-in upload
      // timestamp — same contract as the e-POD and fuel paths.
      const file = await compressImageFile(rawFile, { timestamp: new Date() });
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

  const handleSave = async () => {
    setError(null);
    setScanCheck(null);
    if (!draft.containerNumber.trim()) {
      setError('Cần nhập số container.');
      return;
    }
    setSaving(true);
    try {
      // Both branches persist the same payload — only the verb + outcome differ.
      const payload = {
        containerNumber: draft.containerNumber.trim().toUpperCase(),
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
  const busy = saving || uploading.cont || uploading.seal;

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
        {hasSaved && !editing && (
          <div className="dcc-bento">
            <div className="dcc-bento__hero">
              <div className="dcc-bento__hero-content">
                <div className="dcc-bento__eyebrow">Số cont</div>
                <div className="dcc-bento__plate">{containers[0].containerNumber}</div>
                {containers[0].containerTypeName && (
                  <div className="dcc-bento__hero-meta">
                    {containers[0].containerTypeName}
                    {containers[0].containerTypeCode ? ` · ${containers[0].containerTypeCode}` : ''}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="dcc-bento__edit-btn"
                onClick={enterEdit}
                aria-label="Sửa số cont"
              >
                <Pencil size={13} /> Sửa
              </button>
            </div>

            <div className="dcc-bento__seal">
              <div className="dcc-bento__eyebrow">Seal</div>
              <div className="dcc-bento__seal-value">
                {containers[0].sealNumber || <span className="dcc-bento__dash">—</span>}
              </div>
            </div>

            <div className="dcc-bento__photos">
              <div className="dcc-bento__eyebrow">Hình ảnh</div>
              <div className="dcc-bento__thumbs">
                {renderThumb(contPhotoKey, 'Cont')}
                {renderThumb(sealPhotoKey, 'Seal')}
              </div>
            </div>
          </div>
        )}

        {/* Entry form — shown for the very first save, and re-shown when the
            driver taps Sửa. PATCH (edit) vs POST (create) is decided inside
            handleSave based on the editingExisting flag. */}
        {showForm && (
          <>
            {error && (
              <div className="dcc-error">
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
              {/* No aria-label: the visible span text is the accessible name
                  (WCAG 2.5.3 Label-in-Name). */}
              <label className="dcc-capture-btn dcc-capture-btn--primary">
                {uploading.cont ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
                <span>Chụp / chọn ảnh cont</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={e => {
                    const file = e.target.files?.[0];
                    void onPick(file, 'CONTAINER');
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="dcc-capture-btn dcc-capture-btn--primary">
                {uploading.seal ? <Loader2 size={20} className="spin" /> : <Camera size={20} />}
                <span>Chụp / chọn ảnh seal</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
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
                disabled={uploading.cont}
                onClick={() => setScannerType('CONTAINER')}
                title="Mở camera overlay (chế độ chụp nâng cao)"
              >
                <span>Mở camera cont</span>
              </button>
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

            {scannerType && (
              <ContainerScanner
                onCapture={dataUrl => {
                  void onPick(dataUrlToFile(dataUrl), scannerType);
                  setScannerType(null);
                }}
                onClose={() => setScannerType(null)}
              />
            )}

            {/* Show the most recently uploaded photo for each capture zone so the
                driver can verify both the cont photo and the seal photo side-by-side
                before pressing Save. In edit mode this is seeded with the
                currently-saved photos so the driver can see what was on file
                before deciding to re-capture. */}
            {(lastPhotos.cont || lastPhotos.seal) && (
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
              </div>
            )}

            <div className="dcc-fields">
              <div>
                <TextField
                  label="Số container"
                  required
                  placeholder="Ví dụ: TCKU1234567"
                  value={draft.containerNumber}
                  onChange={e => setDraft(prev => ({ ...prev, containerNumber: e.target.value.toUpperCase() }))}
                />
                {check.warning && (
                  <div className="dcc-warn">
                    <span>⚠ {check.warning}</span>
                    {check.suggestion && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        style={{ padding: '0 10px', fontSize: 12 }}
                        onClick={() => setDraft(prev => ({ ...prev, containerNumber: check.suggestion! }))}
                      >
                        Đổi thành {check.suggestion}
                      </button>
                    )}
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
                disabled={saving || uploading.cont || uploading.seal}
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
      </div>
    </section>
  );
}
