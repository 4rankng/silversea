/**
 * Phân công lái xe — the consolidated shipment-independent driver<->truck
 * pairing surface. Replaces the Users/Fleet driver-profile form field that
 * used to write drivers.assignedTruckId: the write now goes through the
 * dispatch-owned reassign endpoint (end-old/start-new assignment rows).
 * Minimal by design — current pairing, one picker, nothing else.
 */
import { useEffect, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { Modal } from '../../../components/UI';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import type { Truck } from '@tingting/shared';

export interface AssignDriverDialogProps {
  isOpen: boolean;
  saving: boolean;
  error: string | null;
  truck: Truck | null;
  currentDriverName: string | null;
  driverOptions: Array<{ value: string; label: string }>;
  onsave: (driverId: number | null) => void;
  oncancel: () => void;
}

export function AssignDriverDialog({
  isOpen, saving, error, truck, currentDriverName, driverOptions, onsave, oncancel,
}: AssignDriverDialogProps) {
  const [driverId, setDriverId] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      // 0 = keep "— Chưa phân —"; the backend treats a null payload the same.
      setDriverId(0);
    }
  }, [isOpen, truck?.id]);

  if (!truck) return null;

  return (
    <Modal
      isOpen={isOpen}
      title={`Phân công lái xe — ${truck.licensePlate}`}
      onClose={oncancel}
      onConfirm={() => onsave(driverId || null)}
      maxWidth={520}
      footer={
        <div className="fleet-form-actions">
          <button className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button
            className="btn btn--primary btn--sm"
            disabled={saving}
            onClick={() => onsave(driverId || null)}
          >
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            Lưu phân công
          </button>
        </div>
      }
    >
      <div className="fleet-form">
        {error && <div className="dispatch-catalogs__error">{error}</div>}
        <div className="field fleet-form__field">
          <label>Tài xế hiện tại</label>
          <div className="dispatch-catalogs__current-driver">
            {currentDriverName ?? '— Chưa phân —'}
          </div>
        </div>
        <div className="field fleet-form__field">
          <label htmlFor="assign-driver-select">Phân công lái xe mới</label>
          <UuiSelectField
            id="assign-driver-select"
            label="Phân công lái xe mới"
            value={String(driverId)}
            onChange={(e) => setDriverId(Number(e.target.value) || 0)}
            options={[
              { value: '0', label: '— Chưa phân —' },
              ...driverOptions,
            ]}
            hideLabel
          />
        </div>
      </div>
    </Modal>
  );
}
