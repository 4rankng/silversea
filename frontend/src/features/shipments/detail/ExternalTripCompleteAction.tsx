import { useState } from 'react';
import { ConfirmDialog } from '../../../components/UI';
import './ExternalTripCompleteAction.css';

/**
 * SIL-592 (id 692) — the CUS staff close ("Hoàn thành") for external-carrier
 * trips, shared by the Chi tiết lô hàng workboard and the lot drawer. External
 * drivers never use the app, so CUS/điều vận close their trips on the driver's
 * behalf (`POST /trips/:id/complete-external`, backend allowlist
 * ADMIN/MANAGER/DISPATCHER/CUS). This component owns the confirm dialog and
 * the busy state only; the parent owns the mutation, toast and refetch (the
 * same feedback contract as the workboard's copy actions). A rejected
 * `onComplete` keeps the dialog open so the operator can retry or cancel —
 * wording matches the dispatcher's own close dialog.
 */
export function ExternalTripCompleteAction({ identity, onComplete }: {
  /** Row identity for the labels — container number, bill/booking, or cont N. */
  identity: string;
  /** Performs the close. Resolves on success (dialog closes); rejects on
   *  failure after the parent surfaced the error. */
  onComplete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onComplete();
      setOpen(false);
    } catch {
      // The parent already toasted the reason; keep the dialog open for retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="external-trip-complete"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label={`Hoàn thành chuyến xe ngoài của ${identity}`}
        title="Hoàn thành chuyến với xe ngoài — xe ngoài không dùng app nên điều vận/CUS chốt thay"
      >
        {busy ? 'Đang…' : 'Hoàn thành'}
      </button>
      <ConfirmDialog
        isOpen={open}
        message={`Hoàn thành chuyến với xe ngoài ${identity}? Xe ngoài không dùng app nên điều vận/CUS chốt chuyến thay tài xế.`}
        confirmLabel={busy ? 'Đang hoàn thành…' : 'Hoàn thành chuyến'}
        onConfirm={() => void run()}
        onCancel={() => { if (!busy) setOpen(false); }}
      />
    </>
  );
}
