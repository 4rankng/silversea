/**
 * Cập nhật biển số xe ngoài (SIL-714, Spec I.4e) — the ONE plate-update
 * dialog for a live EXTERNAL trip awaiting its biển số, shared by the
 * /dispatch-detail row menu (Điều vận) and the /shipments-detail PHÂN XE
 * cell (Chứng từ). Both roles hold the same server authority; the dialog is
 * role-agnostic — callers gate the affordance that opens it.
 *
 * Self-loading: fetches the trip's plate context on open (GET on the
 * /api/shipments mount — CUS holds no /api/trips read), so callers pass only
 * the trip id plus display context. Save rides the version the server
 * served; a 409 comes back verbatim for the operator to reload.
 */
import { useEffect, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { Modal } from '../UI';
import {
  getExternalTripPlateContext,
  updateExternalTripPlate,
  type ExternalTripPlateContext,
} from '../../api/shipmentClient';

export interface TripExternalPlateDialogProps {
  /** Trip to update, or null to keep the dialog closed. */
  tripId: number | null;
  /** Display-only: the carrier name from the caller's row. */
  carrierName?: string | null;
  onClose: () => void;
  /** Called after a successful save with the fresh context (already primed
   *  into the response) — the caller refetches its own list. */
  onSaved: (context: ExternalTripPlateContext) => void;
}

export function TripExternalPlateDialog({ tripId, carrierName, onClose, onSaved }: TripExternalPlateDialogProps) {
  const [context, setContext] = useState<ExternalTripPlateContext | null>(null);
  const [plate, setPlate] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (tripId == null) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setContext(null);
    setPlate('');
    getExternalTripPlateContext(tripId).then((ctx) => {
      if (cancelled) return;
      setContext(ctx);
      setPlate(ctx.externalPlateNumber ?? '');
      setLoading(false);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setLoadError((err as Error).message || 'Không tải được thông tin chuyến đi.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tripId]);

  const handleSave = async () => {
    if (!context || saving) return;
    if (plate.trim().length === 0) {
      setSaveError('Biển số xe là bắt buộc');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const fresh = await updateExternalTripPlate(context.tripId, {
        externalPlateNumber: plate.trim(),
        expectedVersion: context.version,
      });
      onSaved(fresh);
      onClose();
    } catch (err: unknown) {
      setSaveError((err as Error).message || 'Lỗi khi cập nhật biển số.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={tripId != null}
      title="Cập nhật biển số xe ngoài"
      onClose={onClose}
      onConfirm={handleSave}
      maxWidth={440}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={saving}>
            <X size={14} /> Hủy
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={saving || loading || !context}
            onClick={handleSave}
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            Lưu biển số
          </button>
        </>
      }
    >
      {loadError && <div className="tdp-modal-error" role="alert">{loadError}</div>}
      {saveError && (
        <div id="trip-external-plate-error" className="tdp-modal-error" role="alert">{saveError}</div>
      )}
      {loading && (
        <p className="tdp-drawer-hint" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" /> Đang tải dữ liệu…
        </p>
      )}
      {context && (
        <>
          <p className="tdp-drawer-hint">
            Chuyến {context.tripCode ?? `#${context.tripId}`}{carrierName ? ` · ${carrierName}` : ''}
            {context.externalPlateNumber ? ' — đang chờ bổ sung biển số' : ''}
          </p>
          <div className="field">
            <label htmlFor="trip-external-plate-input">Biển số xe *</label>
            <input
              id="trip-external-plate-input"
              name="tripExternalPlate"
              type="text"
              className="input"
              placeholder="Ví dụ: 15C-12345"
              value={plate}
              maxLength={20}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-invalid={saveError ? true : undefined}
              aria-describedby={saveError ? 'trip-external-plate-error' : undefined}
              onChange={(e) => setPlate(e.target.value.toUpperCase().slice(0, 20))}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
