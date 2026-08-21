import { useEffect, useState } from 'react';
import { Modal } from '../../../components/UI';
import { UTextField } from './uui-fields';

interface ShippingLineAddDialogProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onApply: (name: string) => void;
}

/** Makes the existing free-text shipping-line contract explicit and discoverable. */
export function ShippingLineAddDialog({ isOpen, currentName, onClose, onApply }: ShippingLineAddDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(currentName);
    setError(null);
  }, [currentName, isOpen]);

  function apply() {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Vui lòng nhập tên hãng tàu.');
      return;
    }
    onApply(normalizedName);
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Thêm hãng tàu"
      onClose={onClose}
      onConfirm={apply}
      maxWidth={480}
    >
      <div className="csc-shipping-line-dialog">
        <p>Tên hãng tàu sẽ được lưu cùng lô hàng hiện tại.</p>
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
          <button type="button" className="btn btn--primary csc-shipping-line-dialog__submit" onClick={apply}>Áp dụng</button>
        </div>
      </div>
    </Modal>
  );
}
