import { useState, useEffect } from 'react';
import { Save, X, Loader2, Truck, Weight, FileText } from 'lucide-react';
import { Modal } from '../../components/UI';
import { Input } from '../../components/untitled-ui/base/input/input';
import { TextArea } from '../../components/untitled-ui/base/textarea/textarea';
import { EntityFormSection, UnitInput, DateField, RequiredHint } from '../../components/shared/EntityFormParts';
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
      title={item ? item.licensePlate : 'Thêm rơ-moóc'}
      subtitle={item ? 'Sửa rơ-moóc' : undefined}
      polished
      ariaLabel={item ? `Sửa rơ-moóc ${item.licensePlate}` : 'Thêm rơ-moóc'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={600}
      footer={
        <>
          <RequiredHint />
          <button type="button" className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving || !plate.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm rơ-moóc'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <EntityFormSection icon={Truck} label="Thông tin rơ-moóc">
          <Input
            label="Biển số rơ-moóc"
            isRequired
            icon={Truck}
            value={plate}
            onChange={setPlate}
            placeholder="Ví dụ: 70C-12345"
            autoFocus
            inputClassName="uppercase tabular-nums"
          />
          <UuiSelectField
            id="trailer-type-input"
            label="Loại rơ-moóc"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={Object.entries(TRAILER_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          />
          <UnitInput
            label="Tải trọng tối đa"
            unit="tấn"
            icon={Weight}
            value={String(maxPayloadTons)}
            onChange={setMaxPayloadTons}
            min={0}
            placeholder="0"
          />
          <UnitInput
            label="Tải trọng dạt đầu"
            unit="tấn"
            icon={Weight}
            value={String(maxAxleLoadFrontTons)}
            onChange={setMaxAxleLoadFrontTons}
            min={0}
            placeholder="0"
          />
          <UnitInput
            label="Tải trọng dạt dưới"
            unit="tấn"
            icon={Weight}
            value={String(maxAxleLoadRearTons)}
            onChange={setMaxAxleLoadRearTons}
            min={0}
            placeholder="0"
          />
          <DateField
            id="trailer-inspectionDeadline"
            label="Hạn đăng kiểm"
            value={inspectionDeadline}
            onChange={setInspectionDeadline}
          />
        </EntityFormSection>
        <EntityFormSection icon={FileText} label="Ghi chú">
          <div className="col-span-full">
            <TextArea
              value={note}
              onChange={setNote}
              placeholder="Ghi chú"
              rows={2}
            />
          </div>
        </EntityFormSection>
        <p className="text-sm text-tertiary">
          Sau khi thêm, gán rơ-moóc cho đầu kéo bằng cách sửa xe đầu kéo và chọn rơ-moóc trong danh sách.
        </p>
      </div>
    </Modal>
  );
}
