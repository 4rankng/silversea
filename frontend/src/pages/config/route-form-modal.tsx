import { useState, useEffect } from 'react';
import { labelStyle } from '../../utils/formStyles';
import { Loader2, Save, X } from 'lucide-react';
import { Modal } from '../../components/UI';
import type { Route as RouteType } from '@tingting/shared';

export function RouteFormModal({ isOpen, saving, item, onsave, oncancel }: {
  isOpen: boolean; saving: boolean; item?: RouteType; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
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
    if (!name.trim() || !shortName.trim()) return;
    onsave({
      name: name.trim(),
      shortName: shortName.trim(),
      code: code.trim() || null,
      distanceKm: distance && Number(distance) > 0 ? Number(distance) : undefined,
      loadPoint: loadPoint.trim() || null,
      note: note.trim() || null,
    });
  };

  const sectionLabelStyle = {
    fontSize: 12, lineHeight: 1.35, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', marginBottom: 8, marginTop: 4,
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa tuyến — ${item.shortName || item.name}` : 'Thêm tuyến đường mới'}
      maxWidth={640}
      onClose={oncancel}
      onConfirm={handleSave}
      footer={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving || !name.trim() || !shortName.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm tuyến'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <div style={sectionLabelStyle}>Thông tin cơ bản</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="route-code" style={labelStyle}>Mã tuyến</label>
              <input id="route-code" className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="VD: T01" />
            </div>
            <div className="field">
              <label htmlFor="route-distance" style={labelStyle}>Khoảng cách (km)</label>
              <input id="route-distance" className="input" type="number" value={distance} onChange={e => setDistance(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 14 }}>
            <div className="field">
              <label htmlFor="route-name" style={labelStyle}>Tên tuyến <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input id="route-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Tên dùng trên báo cáo" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="route-short-name" style={labelStyle}>Tên rút gọn <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input id="route-short-name" className="input" value={shortName} onChange={e => setShortName(e.target.value)} placeholder="Tên hiển thị trong vận hành" />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="route-load-point" style={labelStyle}>Điểm đóng trả</label>
            <input id="route-load-point" className="input" value={loadPoint} onChange={e => setLoadPoint(e.target.value)} placeholder="Điểm đóng hoặc trả hàng" />
          </div>
          <div className="field">
            <label htmlFor="route-note" style={labelStyle}>Ghi chú</label>
            <textarea id="route-note" className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Vé cầu đường, lưu ý đặc biệt..." />
          </div>
        </div>
      </div>
    </Modal>
  );
}
