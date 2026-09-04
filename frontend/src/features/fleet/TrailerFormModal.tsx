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
  item?: { id: number; licensePlate: string; type: string; maxPayloadTons?: number | null; maxAxleLoadFrontTons?: number | null; maxAxleLoadRearTons?: number | null; inspectionDeadline?: string | null; note?: string | null };
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  isOpen: boolean;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || '');
  const [type, setType] = useState<string>(item?.type || TrailerType.FT40);
  const [maxPayloadTons, setMaxPayloadTons] = useState<string | number>(item?.maxPayloadTons ?? '');
  const [maxAxleLoadFrontTons, setMaxAxleLoadFrontTons] = useState<string | number>(item?.maxAxleLoadFrontTons ?? '');
  const [maxAxleLoadRearTons, setMaxAxleLoadRearTons] = useState<string | number>(item?.maxAxleLoadRearTons ?? '');
  const [inspectionDeadline, setInspectionDeadline] = useState(item?.inspectionDeadline || '');
  const [note, setNote] = useState(item?.note || '');
  useEffect(() => {
    if (isOpen) {
      setPlate(item?.licensePlate || '');
      setType(item?.type || TrailerType.FT40);
      setMaxPayloadTons(item?.maxPayloadTons ?? '');
      setMaxAxleLoadFrontTons(item?.maxAxleLoadFrontTons ?? '');
      setMaxAxleLoadRearTons(item?.maxAxleLoadRearTons ?? '');
      setInspectionDeadline(item?.inspectionDeadline || '');
      setNote(item?.note || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);
  const handleSave = () => {
    if (!plate.trim()) return;
    onsave({
      licensePlate: plate.trim(),
      type,
      maxPayloadTons: maxPayloadTons !== '' ? Number(maxPayloadTons) : null,
      maxAxleLoadFrontTons: maxAxleLoadFrontTons !== '' ? Number(maxAxleLoadFrontTons) : null,
      maxAxleLoadRearTons: maxAxleLoadRearTons !== '' ? Number(maxAxleLoadRearTons) : null,
      inspectionDeadline: inspectionDeadline || null,
      note: note.trim() || undefined,
    });
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
              <label htmlFor="trailer-maxPayloadTons">Tải trọng tối đa (tấn)</label>
              <input
                id="trailer-maxPayloadTons"
                className="input"
                type="number"
                value={maxPayloadTons}
                onChange={e => setMaxPayloadTons(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="fleet-form__field">
              <label htmlFor="trailer-maxAxleLoadFrontTons">Tải trọng dạt đầu (tấn)</label>
              <input
                id="trailer-maxAxleLoadFrontTons"
                className="input"
                type="number"
                value={maxAxleLoadFrontTons}
                onChange={e => setMaxAxleLoadFrontTons(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="fleet-form__field">
              <label htmlFor="trailer-maxAxleLoadRearTons">Tải trọng dạt dưới (tấn)</label>
              <input
                id="trailer-maxAxleLoadRearTons"
                className="input"
                type="number"
                value={maxAxleLoadRearTons}
                onChange={e => setMaxAxleLoadRearTons(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="fleet-form__field">
              <label htmlFor="trailer-inspectionDeadline">Hạn đăng kiểm</label>
              <input
                id="trailer-inspectionDeadline"
                className="input"
                type="date"
                value={inspectionDeadline}
                onChange={e => setInspectionDeadline(e.target.value)}
              />
            </div>
            <div className="fleet-form__field fleet-form__field--wide">
              <label htmlFor="trailer-note">Ghi chú</label>
              <input
                id="trailer-note"
                className="input"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Ghi chú"
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
