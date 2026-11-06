import { useEffect, useState } from 'react';
import { Modal } from '../../../components/UI';
import { UTextField } from './uui-fields';

interface ShippingLineAddDialogProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  /** Persists the name to the shared catalog (server) and applies it to the
   *  lot; rejects keep the dialog open with the error (FB-114 171026185348). */
  onApply: (name: string) => Promise<void>;
}

/** Makes the existing free-text shipping-line contract explicit and discoverable. */
export function ShippingLineAddDialog({ isOpen, currentName, onClose, onApply }: ShippingLineAddDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(currentName);
    setError(null);
    setPending(false);
  }, [currentName, isOpen]);

  async function apply() {
    if (pending) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Vui lòng nhập tên hãng tàu.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onApply(normalizedName);
    } catch (submitError) {
      // Persist failed (validation, name conflict, network): surface the real
      // message and keep the dialog open — never claim a save that did not
      // happen.
      setError(submitError instanceof Error && submitError.message.trim()
        ? submitError.message.trim()
        : 'Không lưu được hãng tàu vào danh mục chung. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Đặt tên hãng tàu cho lô này"
      onClose={onClose}
      onConfirm={apply}
      maxWidth={480}
    >
      <div className="csc-shipping-line-dialog">
        {/* SIL-335 (owner ruling 06/11 "ten hang tau go tay must be saved to
            db"): the name is BOTH a shared-catalog entry and this lot's
            shipping line — the copy must say so, not pretend a per-lot-only
            save ("sẽ được lưu cùng lô hàng hiện tại" was the verify-fail's
            smoking gun). */}
        <p>Tên hãng tàu sẽ được lưu vào danh mục hãng tàu chung và dùng cho lô này.</p>
        {error && <div role="alert" className="csc-shipping-line-dialog__error">{error}</div>}
        <div className="csc-shipping-line-dialog__name-action">
          <div className="csc-shipping-line-dialog__name-field">
            <UTextField
              label="Tên hãng tàu"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              maxLength={255}
              placeholder="Ví dụ: MSC, Maersk, ONE"
              error={error ?? undefined}
            />
          </div>
          <button type="button" className="btn btn--primary csc-shipping-line-dialog__submit" onClick={apply} disabled={pending}>Áp dụng</button>
        </div>
      </div>
    </Modal>
  );
}
