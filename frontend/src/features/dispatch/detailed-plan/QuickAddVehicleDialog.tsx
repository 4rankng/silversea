import { useEffect, useState } from 'react';
import { Modal } from '../../../components/UI';
import { normalizePlate } from './DispatchPlanCellValues';
import { createCarrierFleetVehicle } from '../../../api/dispatchPlanningClient';
import './QuickAddVehicleDialog.css';

interface QuickAddVehicleDialogProps {
  isOpen: boolean;
  /** The externally selected nhà xe the plate registers under (Xe ngoài path). */
  carrierId: number;
  carrierName: string;
  onClose: () => void;
  onCreated: (vehicleId: number, licensePlate: string) => void;
}

/** Card 20261004_357 — quick-add a plate for the selected external carrier
 *  straight from the dispatch editor, through the SAME API the sidebar Xe
 *  ngoài registration uses (POST /api/shipments/carrier-fleet-vehicles). */
export function QuickAddVehicleDialog({ isOpen, carrierId, carrierName, onClose, onCreated }: QuickAddVehicleDialogProps) {
  const [plate, setPlate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPlate('');
      setError(null);
      setSaving(false);
    }
  }, [isOpen]);

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
    createCarrierFleetVehicle({ carrierId, licensePlate: normalized })
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
        <p className="quick-add-vehicle__context">
          Nhà xe: <strong>{carrierName || '—'}</strong>
        </p>
        <p className="quick-add-vehicle__hint">Xe được lưu vào danh sách Xe ngoài của nhà xe này (giống đăng ký ở menu Danh mục).</p>
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
