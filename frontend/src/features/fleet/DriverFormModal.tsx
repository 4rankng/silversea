import { useState, useEffect } from 'react';
import { Save, X, Loader2 } from 'lucide-react';
import { Modal } from '../../components/UI';
import type { Truck as TruckType, Driver } from '@tingting/shared';
import { DRIVER_STATUS } from './constants';

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
          <button className="btn btn--ghost btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm lái xe'}
          </button>
        </div>
      }
    >
      <div className="fleet-form">
        <section className="fleet-form__section fleet-form__section--identity">
          <div className="fleet-form__section-head">
            <div>
              <h4>Hồ sơ lái xe</h4>
              <p>Thông tin liên hệ, lương cơ bản và trạng thái làm việc.</p>
            </div>
          </div>
          <div className="fleet-form__grid">
            <div className="field fleet-form__field fleet-form__field--wide">
              <label htmlFor="driver-name">
                Họ và tên <span>*</span>
              </label>
              <input
                id="driver-name"
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="VD: Nguyễn Văn A"
                autoFocus
              />
            </div>
            <div className="field fleet-form__field">
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
          </div>
        </section>

        <section className="fleet-form__section">
          <div className="fleet-form__section-head">
            <div>
              <h4>Phân công</h4>
              <p>Gán lái xe vào một đầu kéo đang hoạt động.</p>
            </div>
          </div>
          <div className="fleet-form__grid">
            <div className="field fleet-form__field">
              <label htmlFor="driver-truck">Xe phân công</label>
              <select id="driver-truck" className="input" value={truckId} onChange={e => setTruckId(Number(e.target.value))}>
                <option value={0}>— Chưa phân —</option>
                {trucks.filter(t => t.status === 'ACTIVE').map(t => <option key={t.id} value={t.id}>{t.licensePlate}</option>)}
              </select>
            </div>
            <div className="field fleet-form__field">
              <label htmlFor="driver-status">Trạng thái</label>
              <select id="driver-status" className="input" value={status} onChange={e => setStatus(e.target.value)}>
                {Object.entries(DRIVER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
