import { useEffect, useState } from 'react';
import { Modal } from '../../../components/UI';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { normalizePlate } from './DispatchPlanCellValues';
import { createCarrierFleetVehicle, createInternalTruck } from '../../../api/dispatchPlanningClient';
import './QuickAddVehicleDialog.css';

interface QuickAddVehicleDialogProps {
  isOpen: boolean;
  /** The selected nhà xe the plate registers under (Xe ngoài path); null =
   *  đội xe nội bộ — the plate registers as an own-fleet tractor (POST /trucks).
   *  Card 101026043010: one dialog serves both pickers, never a variant. */
  carrierId: number | null;
  carrierName: string;
  /** FB-066 lần 3 (card 201026101600): pre-fill the plate — the picker's
   *  "Thêm mới: <số>" dropdown option hands its typed number here so the
   *  operator confirms instead of retyping it. */
  initialPlate?: string;
  /** FB-066 lần 3 — "hãng/nhà xe nếu cần": a surface whose lot has NO planned
   *  nhà xe yet cannot resolve the registration target, so the dialog asks
   *  (đội xe nội bộ + every active nhà xe). Omitted (or one choice) = no
   *  question, the fixed `carrierId`/`carrierName` above stand. */
  carrierChoices?: Array<{ carrierId: number | null; label: string }>;
  onClose: () => void;
  onCreated: (vehicleId: number, licensePlate: string) => void;
}

/** Card 20261004_357 — quick-add a plate straight from the dispatch editor,
 *  through the SAME API the matching sidebar registration uses: the external
 *  path posts to the Xe ngoài list (POST /api/shipments/carrier-fleet-vehicles),
 *  the internal path (card 101026043010) to the truck catalog (POST /api/trucks). */
export function QuickAddVehicleDialog({ isOpen, carrierId, carrierName, initialPlate = '', carrierChoices, onClose, onCreated }: QuickAddVehicleDialogProps) {
  const [plate, setPlate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // FB-066 lần 3 — the ask-carrier picker's selection (index into
  // `carrierChoices`); seeded to the fixed carrier when it is one of them.
  const [choiceIndex, setChoiceIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setPlate(initialPlate);
      setError(null);
      setSaving(false);
      const fixedIndex = carrierChoices?.findIndex((choice) => choice.carrierId === carrierId) ?? -1;
      setChoiceIndex(fixedIndex >= 0 ? fixedIndex : 0);
    }
  }, [isOpen, initialPlate, carrierChoices, carrierId]);

  const askingCarrier = (carrierChoices?.length ?? 0) > 1;
  const target = askingCarrier ? carrierChoices![choiceIndex]! : { carrierId, label: carrierName };

  function apply() {
    const normalized = normalizePlate(plate);
    if (!normalized) {
      setError('Vui lòng nhập biển số.');
      return;
    }
    if (normalized.length > 20) {
      setError('Biển số tối đa 20 ký tự.');
      return;
    }
    setSaving(true);
    // Card 101026043010 — an internal quick-add registers an own-fleet
    // tractor (fleet-catalog create); the external path keeps the Xe ngoài API.
    (target.carrierId == null
      ? createInternalTruck({ licensePlate: normalized })
      : createCarrierFleetVehicle({ carrierId: target.carrierId, licensePlate: normalized }))
      .then((vehicle) => {
        onCreated(vehicle.id, vehicle.licensePlate);
      })
      .catch((createError: unknown) => {
        setError(createError instanceof Error ? createError.message : 'Không thể thêm xe.');
        setSaving(false);
      });
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Thêm nhanh biển số xe"
      onClose={onClose}
      onConfirm={saving ? undefined : apply}
      maxWidth={440}
    >
      <div className="quick-add-vehicle">
        {/* Asking mode: the picker below IS the carrier display (one concept,
            one place — design-guidelines §1); fixed mode names the context. */}
        {!askingCarrier && (
          <p className="quick-add-vehicle__context">
            Nhà xe: <strong>{target.label || '—'}</strong>
          </p>
        )}
        {askingCarrier && (
          <UuiSelectField
            label="Nhà xe"
            value={String(choiceIndex)}
            onChange={(event) => setChoiceIndex(Number(event.target.value))}
            options={carrierChoices!.map((choice, index) => ({ value: String(index), label: choice.label }))}
            disabled={saving}
            size="sm"
          />
        )}
        <p className="quick-add-vehicle__hint">
          {target.carrierId == null
            ? 'Xe được lưu vào danh sách xe nội bộ (giống đăng ký ở menu Danh mục).'
            : 'Xe được lưu vào danh sách Xe ngoài của nhà xe này (giống đăng ký ở menu Danh mục).'}
        </p>
        {error && <div role="alert" className="quick-add-vehicle__error">{error}</div>}
        <div className="quick-add-vehicle__field">
          {/* Plain <label htmlFor> is wired to the input below; the a11y rule
              this disable once targeted is not registered in the flat config. */}
          <label htmlFor="quick-add-vehicle-plate">Biển số xe</label>
          <input
            id="quick-add-vehicle-plate"
            value={plate}
            onChange={(event) => {
              setPlate(event.target.value);
              setError(null);
            }}
            maxLength={30}
            placeholder="Ví dụ: 29C-111.22"
            autoComplete="off"
            disabled={saving}
            aria-invalid={error ? true : undefined}
          />
          <button type="button" className="btn btn--primary" onClick={apply} disabled={saving}>
            Áp dụng
          </button>
        </div>
      </div>
    </Modal>
  );
}
