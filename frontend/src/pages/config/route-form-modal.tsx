import { useState, useEffect, useId, useRef } from 'react';
import { Loader2, Save, X, Hash, Route as RouteIcon, MapPin, Tag, FileText } from 'lucide-react';
import { Modal } from '../../components/UI';
import { Input } from '../../components/untitled-ui/base/input/input';
import { TextArea } from '../../components/untitled-ui/base/textarea/textarea';
import { EntityFormSection, UnitInput, RequiredHint } from '../../components/shared/EntityFormParts';
import type { Route as RouteType } from '@tingting/shared';
import './RoutesConfigPage.css';

export function RouteFormModal({ isOpen, saving, item, error, onsave, oncancel }: {
  isOpen: boolean; saving: boolean; item?: RouteType; error?: string | null; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [code, setCode] = useState('');
  const [distance, setDistance] = useState('');
  const [loadPoint, setLoadPoint] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setShortName(item?.shortName || item?.name || '');
      setCode(item?.code || '');
      setDistance(item?.distanceKm?.toString() || '');
      setLoadPoint(item?.loadPoint || '');
      setNote(item?.note || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  const handleSave = () => {
    if (saving || !name.trim() || !shortName.trim() || !formRef.current?.reportValidity()) return;
    onsave({
      name: name.trim(),
      shortName: shortName.trim(),
      code: code.trim() || null,
      distanceKm: distance.trim() ? Number(distance) : null,
      loadPoint: loadPoint.trim() || null,
      note: note.trim() || null,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? (item.shortName || item.name) : 'Thêm tuyến đường mới'}
      subtitle={item ? 'Sửa tuyến' : undefined}
      polished
      ariaLabel={item ? `Sửa tuyến — ${item.shortName || item.name}` : 'Thêm tuyến đường mới'}
      maxWidth={640}
      onClose={oncancel}
      onConfirm={() => formRef.current?.requestSubmit()}
      footer={
        <>
          <RequiredHint />
          <button type="button" className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button type="submit" form={formId} className="btn btn--primary btn--sm" disabled={saving || !name.trim() || !shortName.trim()}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm tuyến'}
          </button>
        </>
      }
    >
      <form id={formId} ref={formRef} className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
        <EntityFormSection icon={RouteIcon} label="Thông tin tuyến">
          <div className="route-form__compact-pair">
          <Input
            label="Mã tuyến"
            icon={Hash}
            value={code}
            onChange={setCode}
            placeholder="Ví dụ: T01"
            inputClassName="tabular-nums"
          />
          <UnitInput
            label="Khoảng cách"
            unit="km"
            icon={RouteIcon}
            value={distance}
            onChange={setDistance}
            min={1}
            max={2147483647}
            step={1}
            hint="Số km nguyên lớn hơn 0; để trống nếu chưa có."
            placeholder="Chưa có"
          />
          </div>
          <Input
            label="Tên tuyến"
            isRequired
            icon={MapPin}
            value={name}
            onChange={setName}
            placeholder="Tên dùng trên báo cáo"
            autoFocus
          />
          <Input
            label="Tên rút gọn"
            isRequired
            icon={Tag}
            value={shortName}
            onChange={setShortName}
            placeholder="Tên hiển thị trong vận hành"
          />
          <div className="col-span-full">
            <Input
              label="Điểm đóng trả"
              icon={MapPin}
              value={loadPoint}
              onChange={setLoadPoint}
              placeholder="Điểm đóng hoặc trả hàng"
            />
          </div>
        </EntityFormSection>
        <EntityFormSection icon={FileText} label="Ghi chú">
          <div className="col-span-full">
            <TextArea
              value={note}
              onChange={setNote}
              placeholder="Vé cầu đường, lưu ý đặc biệt..."
              rows={3}
            />
          </div>
        </EntityFormSection>
      </form>
      {error && <p className="cfg-form-error" role="alert">{error}</p>}
    </Modal>
  );
}
