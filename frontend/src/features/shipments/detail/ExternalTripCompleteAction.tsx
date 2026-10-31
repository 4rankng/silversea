import { useState } from 'react';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { ConfirmDialog } from '../../../components/UI';
import './ExternalTripCompleteAction.css';

/**
 * SIL-592 (id 692) / SIL-620 (id 724) — the CUS staff close ("Hoàn thành") for
 * external-carrier trips, styled as a clean text button (no pill chrome) that
 * sits neatly on 1 line next to the dispatch chip. External drivers never use
 * the app, so CUS/điều vận close their trips on the driver's behalf
 * (`POST /trips/:id/complete-external`, backend allowlist ADMIN/MANAGER/DISPATCHER/CUS).
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
      <UUIButton
        size="sm"
        color="link-color"
        className="external-trip-complete"
        onPress={() => setOpen(true)}
        onClick={() => setOpen(true)}
        isDisabled={busy}
        aria-label={`Hoàn thành chuyến xe ngoài của ${identity}`}
        title="Hoàn thành chuyến với xe ngoài — xe ngoài không dùng app nên điều vận/CUS chốt thay"
      >
        {busy ? 'Đang…' : 'Hoàn thành'}
      </UUIButton>
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
