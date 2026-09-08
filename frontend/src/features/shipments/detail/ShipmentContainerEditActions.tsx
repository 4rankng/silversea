// Save/cancel footer actions shared by every inline editor mode of the
// shipment-container ledger. Split out of ShipmentContainerLedger.tsx
// (structure-guard ratchet) — behavior is verbatim from the ledger file.
import { Save01, XClose } from '@untitledui/icons';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';

export function EditActions({
  saving,
  saveDisabled,
  label,
  onSave,
  onCancel,
}: {
  saving: boolean;
  saveDisabled: boolean;
  label: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="shipment-container-ledger__edit-actions">
      <UUIButton
        size="xs"
        color="primary"
        className="shipment-container-ledger__edit-action"
        onPress={onSave}
        isDisabled={saveDisabled || saving}
        isLoading={saving}
        iconLeading={!saving ? Save01 : undefined}
        aria-label={`Lưu ${label}`}
      >Lưu</UUIButton>
      <UUIButton
        size="xs"
        color="secondary"
        className="shipment-container-ledger__edit-action"
        onPress={onCancel}
        isDisabled={saving}
        iconLeading={XClose}
        aria-label={`Hủy ${label}`}
      >Hủy</UUIButton>
    </div>
  );
}
