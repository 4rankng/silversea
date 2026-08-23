import { useState, useEffect } from 'react';
import { Save, X, Loader2 } from 'lucide-react';
import { Modal } from '../../components/UI';
import { TrailerType, TRAILER_TYPE_LABELS } from '@tingting/shared';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
// Own stylesheet — see TruckFormModal: keeps the dialog styled on any route
// that renders it without the /fleet page chunk.
import '../../pages/FleetPage.css';

/**
 * Modal for creating/editing a trailer (rơ-moóc).
 * Trailers are separate entities from trucks so a single trailer can be
 * reassigned across multiple đầu kéo over its lifetime, and so registration
 * / tyre / repair expenses can be tagged to a specific trailer (Pete's
 * requirement: "phần chi phí sửa chữa và chi phí đăng kiểm, thay lốp thì
 * nên tách theo rơ mooc và đầu kéo").
 */
export function TrailerFormModal({ saving, item, onsave, oncancel, isOpen }: {
  saving: boolean;
  item?: { id: number; licensePlate: string; type: string; status: string };
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  isOpen: boolean;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || '');
  const [type, setType] = useState<string>(item?.type || TrailerType.FT40);
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  useEffect(() => {
    if (isOpen) {
      setPlate(item?.licensePlate || '');
      setType(item?.type || TrailerType.FT40);
      setStatus(item?.status || 'ACTIVE');
    }
    // Sync form fields from the edited item when the modal opens or the
    // selected item changes. We intentionally key on isOpen/item?.id so
    // typing in the inputs doesn't reset the form mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);
  const handleSave = () => {
    if (!plate.trim()) return;
    onsave({ licensePlate: plate.trim(), type, status });
  };
  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa rơ-moóc ${item.licensePlate}` : 'Thêm rơ-moóc'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={600}
      footer={
        <div className="fleet-form-actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving || !plate.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm rơ-moóc'}
          </button>
        </div>
      }
    >
      <div className="fleet-form">
        <section className="fleet-form__section fleet-form__section--identity">
          <div className="fleet-form__section-head">
            <div>
              <h4>Thông tin rơ-moóc</h4>
              <p>Dùng để ghép với đầu kéo và tách chi phí bảo dưỡng.</p>
            </div>
          </div>
          <div className="fleet-form__grid">
            <div className="field fleet-form__field fleet-form__field--wide">
              <label htmlFor="trailer-plate-input">
                Biển số rơ-moóc <span>*</span>
              </label>
              <input
                id="trailer-plate-input"
                className="input"
                value={plate}
                onChange={e => setPlate(e.target.value)}
                placeholder="Ví dụ: 70C-12345"
                autoFocus
              />
            </div>
            <div className="fleet-form__field">
              <UuiSelectField
                id="trailer-type-input"
                label="Loại rơ-moóc"
                value={type}
                onChange={(e) => setType(e.target.value)}
                options={Object.entries(TRAILER_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              />
            </div>
            <div className="fleet-form__field">
              <UuiSelectField
                id="trailer-status-input"
                label="Trạng thái"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: 'ACTIVE', label: 'Hoạt động' },
                  { value: 'MAINTENANCE', label: 'Bảo trì' },
                  { value: 'INACTIVE', label: 'Ngưng' },
                ]}
              />
            </div>
          </div>
        </section>
        <div className="fleet-form__note">
          Sau khi thêm, gán rơ-moóc cho đầu kéo bằng cách sửa xe đầu kéo và chọn rơ-moóc trong danh sách.
        </div>
      </div>
    </Modal>
  );
}
