// SIL-688 (id 800 — QA 06/11) — the settlement board's "Xóa lô" entry in the
// row "…" menu (CUS Chi phí - Quyết toán). QA: the delete existed ONLY on the
// list drawer; /shipments-debit's menu had Mở chi tiết lô / Xem lô hàng /
// Tách nhóm and nothing destructive, while the BE endpoint
// (`DELETE /shipments/cus-workspace/:id`, CUS/ADMIN, version + reason) has
// been live the whole time.
//
// ONE action, the EXISTING delete flow: the lot's optimistic-lock version
// and its fulfillment state are read on demand via the same
// `GET /shipments/:id` the review page uses (the debit row payload carries
// no version — a BE contract change is out of this lane's scope), the
// shared `deleteCusShipment` client call does the delete, and the caller
// refreshes the board (the deleted row disappears). A dispatched lot is
// refused BEFORE the confirm opens with the same rule the BE 409 answers
// ("Chỉ xóa được khi mọi container chưa phát lệnh").
//
// UI provenance: house primitive — the same native <button> + shared Modal
// confirm + danger voice (`btn btn--danger`) the create workspace's Xóa lô
// confirm runs (ShipmentCreateModals); destructive actions last, reason
// required, never auto-armed.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../../../components/UI';
import { useToast } from '../../../components/shared/Toast';
import { deleteCusShipment, getShipmentDetail } from '../../../api/shipmentClient';
import { safeError } from '../cus/cusUtils';

export interface DeleteLotActionProps {
  /** The lot row the menu entry sits on. */
  shipmentId: number;
  /** Số Bill / Số Booking display identity (aria + confirm copy). */
  lotRef: string;
  /** Master-data lock (lockStatus LOCKED) — the entry disables with the
   *  same voice as the Tách nhóm entry beside it. */
  disabledReason?: string | null;
  /** Called after a successful delete — the caller refetches the board so
   *  the deleted row disappears. */
  onDeleted: () => void;
}

export function DeleteLotAction({ shipmentId, lotRef, disabledReason, onDeleted }: DeleteLotActionProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The version + lifecycle state ride the detail fetch (on demand — the
   *  debit row payload has no version). A dispatched lot never opens the
   *  confirm: it answers with the BE's own 409 rule up front. */
  async function openConfirm() {
    setBusy(true);
    setError(null);
    try {
      const detail = await getShipmentDetail(shipmentId);
      // SIL-688 r2: the BE delete law blocks on a LIVE trip only (soft-deleted
      // or CANCELED trips never block; a planned fulfillment is not a
      // dispatch). Counting carrierAssignments here disabled the delete for
      // every LCL lot — they always carry a plan fulfillment.
      if (detail.hasLiveTrips === true) {
        toast({ kind: 'error', message: 'Chỉ xóa được khi mọi container chưa phát lệnh.' });
        return;
      }
      setReason('');
      setConfirmOpen(true);
    } catch (err) {
      toast({ kind: 'error', message: safeError(err, 'Không thể kiểm tra trạng thái lô hàng. Vui lòng thử lại.') });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      // The version read at openConfirm time is the optimistic lock the BE
      // requires; a stale version answers 409 and the reason lands verbatim.
      const detail = await getShipmentDetail(shipmentId);
      await deleteCusShipment(shipmentId, detail.shipment.version, reason.trim(), crypto.randomUUID());
      setConfirmOpen(false);
      toast({ kind: 'success', message: 'Đã xóa lô hàng.' });
      onDeleted();
    } catch (err) {
      setError(safeError(err, 'Không thể xóa lô hàng. Vui lòng thử lại.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="shipment-debit-menu__item shipment-debit-menu__item--danger"
        aria-label={`Xóa lô ${lotRef}`}
        aria-disabled={disabledReason != null || undefined}
        onClick={() => {
          if (disabledReason != null || busy) return;
          void openConfirm();
        }}
      >
        <Trash2 size={14} aria-hidden="true" />Xóa lô
      </button>
      <Modal
        isOpen={confirmOpen}
        title="Xóa lô hàng?"
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => { if (!busy) setConfirmOpen(false); }}>Hủy</button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void doDelete()}
              disabled={busy || !reason.trim()}
            >
              {busy ? 'Đang xóa…' : 'Xóa lô hàng'}
            </button>
          </>
        )}
      >
        <p>Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu của lô {lotRef} cùng mọi container của nó. Thao tác không thể hoàn tác.</p>
        <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
          <label htmlFor={`shipment-debit-delete-reason-${shipmentId}`} style={{ color: 'var(--fg-1)', fontSize: 'var(--text-label-size)', fontWeight: 600 }}>
            Lý do xóa *
          </label>
          <textarea
            id={`shipment-debit-delete-reason-${shipmentId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ví dụ: tạo trùng lô, sai khách hàng…"
            disabled={busy}
            aria-invalid={error ? true : undefined}
            style={{
              border: '1px solid var(--control-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              font: 'inherit',
              fontSize: 'var(--text-data-size)',
              background: 'var(--surface)',
              resize: 'vertical',
            }}
          />
          {error && (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-caption-size)' }}>{error}</span>
          )}
        </div>
      </Modal>
    </>
  );
}
