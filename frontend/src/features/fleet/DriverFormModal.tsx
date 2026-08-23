import { useState, useEffect } from 'react';
import { Save, X, Loader2 } from 'lucide-react';
import { Modal } from '../../components/UI';
import type { Truck as TruckType, Driver } from '@tingting/shared';
import { DRIVER_STATUS } from './constants';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
// Own stylesheet: this modal also renders on /fleet/drivers (dispatch
// catalogs), whose route chunk never loads the /fleet page cards that
// normally pull FleetPage.css in.
import '../../pages/FleetPage.css';

export function DriverFormModal({ saving, item, trucks, onsave, oncancel, isOpen, showSalary = true }: {
  saving: boolean; item?: Driver; trucks: TruckType[]; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean;
  /** Dispatcher creates omit salary entirely — the payload strips it because
   * DISPATCHER cannot make the governance action a salaried create routes
   * into, so rendering an editable field would silently discard input. */
  showSalary?: boolean;
}) {
  const [name, setName] = useState(item?.name || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [baseSalary, setBaseSalary] = useState<string | number>(item?.baseSalary || '');
  const [truckId, setTruckId] = useState<number>(item?.assignedTruckId || 0);
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setPhone(item?.phone || '');
      setBaseSalary(item?.baseSalary || '');
      setTruckId(item?.assignedTruckId || 0);
      setStatus(item?.status || 'ACTIVE');
    }
  }, [isOpen, item?.id, item?.name, item?.phone, item?.baseSalary, item?.assignedTruckId, item?.status]);
  const handleSave = () => {
    if (!name.trim()) return;
    onsave({
      name: name.trim(),
      phone: phone.trim() || undefined,
      baseSalary: baseSalary ? Number(baseSalary) : undefined,
      assignedTruckId: truckId || null,
      status,
    });
  };
  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa lái xe ${item.name}` : 'Thêm lái xe'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={620}
      footer={
        <div className="fleet-form-actions">
          <button className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm lái xe'}
          </button>
        </div>
      }
    >
      {/* Compact 620px dialog → paired two-column grid (dense-dialog contract;
          four columns are reserved for 900px+ dialogs). Name spans both
          gutters, phone pairs with salary, and the assignment selects close
          as a pair. Dispatcher creates hide salary, so phone then spans the
          full row — no column slot ever sits empty. Selects carry an explicit
          label + hideLabel so every label shares one type treatment. */}
      <div className="fleet-form">
        <div className="fleet-form__grid fleet-form__grid--driver">
          <div className="field fleet-form__field fleet-form__field--wide">
            <label htmlFor="driver-name">
              Họ và tên <span>*</span>
            </label>
            <input
              id="driver-name"
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ví dụ: Nguyễn Văn A"
              autoFocus
            />
          </div>
          <div className={showSalary ? 'field fleet-form__field' : 'field fleet-form__field fleet-form__field--wide'}>
            <label htmlFor="driver-phone">Số điện thoại</label>
            <input
              id="driver-phone"
              className="input"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0912..."
            />
          </div>
          {showSalary && <div className="field fleet-form__field">
            <label htmlFor="driver-salary">Lương cơ bản (đ)</label>
            <input
              id="driver-salary"
              className="input"
              type="number"
              value={baseSalary}
              onChange={e => setBaseSalary(e.target.value)}
              placeholder="0"
            />
          </div>}
          <div className="field fleet-form__field">
            <label htmlFor="driver-truck">Xe phân công</label>
            <UuiSelectField
              id="driver-truck"
              label="Xe phân công"
              value={String(truckId)}
              onChange={(e) => setTruckId(Number(e.target.value))}
              options={[
                { value: '0', label: '— Chưa phân —' },
                ...trucks.filter((t) => t.status === 'ACTIVE').map((t) => ({ value: String(t.id), label: t.licensePlate })),
              ]}
              hideLabel
            />
          </div>
          <div className="field fleet-form__field">
            <label htmlFor="driver-status">Trạng thái</label>
            <UuiSelectField
              id="driver-status"
              label="Trạng thái"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={Object.entries(DRIVER_STATUS).map(([k, v]) => ({ value: k, label: v }))}
              hideLabel
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
