import { useState, useEffect } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useNavigate } from 'react-router-dom';
import { Save, Loader2 } from 'lucide-react';
import { useRoadConfig, useSaveRoadConfig } from '../../hooks/useCatalogQueries';
import { PageHeader, Panel } from '../../components/UI';
import { isGovernancePendingResponse } from '../../lib/governance';
import './config-page.css';

export default function TripExpenseConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const { data: roadConfig } = useRoadConfig();
  const saveRoad = useSaveRoadConfig();
  const [form, setForm] = useState({
    defaultDriverSalary: '400000',
    twoPointDeliveryBonus: '200000',
    vehicleShiftDefault: '200000',
    tollPerStation: '55000',
    returnCargoBonus: '300000',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (roadConfig) {
      setForm({
        defaultDriverSalary: roadConfig.defaultDriverSalary ?? '400000',
        twoPointDeliveryBonus: roadConfig.twoPointDeliveryBonus ?? '200000',
        vehicleShiftDefault: roadConfig.vehicleShiftDefault ?? '200000',
        tollPerStation: roadConfig.tollPerStation ?? '55000',
        returnCargoBonus: roadConfig.returnCargoBonus ?? '300000',
      });
    }
  }, [roadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveRoad.mutateAsync({
        tollPerStation: Number(form.tollPerStation),
        returnCargoBonus: Number(form.returnCargoBonus),
        defaultDriverSalary: Number(form.defaultDriverSalary),
        twoPointDeliveryBonus: Number(form.twoPointDeliveryBonus),
        vehicleShiftDefault: Number(form.vehicleShiftDefault),
      });
      if (isGovernancePendingResponse(result)) {
        setMessage('Đã gửi yêu cầu cập nhật chi phí chuyến đi để kiểm tra và phê duyệt. Cấu hình hiện chưa thay đổi.');
        return;
      }
      navigate('/config');
    } catch (e: unknown) { setError((e as Error)?.message || 'Lỗi lưu'); } finally { setSaving(false); }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const fmt = (v: string) => {
    const n = Number(v);
    return isNaN(n) ? '' : n.toLocaleString('vi-VN');
  };

  return (
    <div ref={pageRef} className="cfg-page cfg-page--trip-expense" style={{ maxWidth: 720, margin: '0 auto' }}>
      <PageHeader title="Chi phí chuyến đi" description="Tiền kết hợp · trả hàng 2 điểm · lưu ca xe · trạm BOT · thưởng chuyến về có hàng" onBack={() => navigate('/config')} iconName="trip-expense-rules" />
      <Panel title="Mặc định toàn công ty" subtitle="Áp dụng khi tuyến hoặc lái xe chưa có cấu hình riêng">
        <div className="cfg-form-grid">
          <div className="field">
            <label htmlFor="default-driver-salary">Tiền kết hợp mặc định (đ)</label>
            <input id="default-driver-salary" name="defaultDriverSalary" className="input mono" type="text" value={form.defaultDriverSalary} onChange={set('defaultDriverSalary')} placeholder="400.000" />
            <div className="cfg-field-hint">Áp dụng khi tuyến chưa thiết lập lương riêng. Hiện tại: <strong>{fmt(form.defaultDriverSalary)} đ</strong></div>
          </div>
          <div className="field">
            <label htmlFor="two-point-delivery-bonus">Trả hàng 2 điểm mặc định (đ)</label>
            <input id="two-point-delivery-bonus" name="twoPointDeliveryBonus" className="input mono" type="text" value={form.twoPointDeliveryBonus} onChange={set('twoPointDeliveryBonus')} placeholder="200.000" />
            <div className="cfg-field-hint">Gợi ý khi nhập trả hàng 2 điểm trên phiếu chuyến. Hiện tại: <strong>{fmt(form.twoPointDeliveryBonus)} đ</strong></div>
          </div>
        </div>

        <div className="cfg-form-grid">
          <div className="field">
            <label htmlFor="vehicle-shift-default">Lưu ca xe mặc định (đ)</label>
            <input id="vehicle-shift-default" name="vehicleShiftDefault" className="input mono" type="text" value={form.vehicleShiftDefault} onChange={set('vehicleShiftDefault')} placeholder="200.000" />
            <div className="cfg-field-hint">Thường 200k–400k/ngày. Hiện tại: <strong>{fmt(form.vehicleShiftDefault)} đ</strong></div>
          </div>
          <div className="field">
            <label htmlFor="toll-per-station">Tiền trạm thu phí (đ/trạm)</label>
            <input id="toll-per-station" name="tollPerStation" className="input mono" type="text" value={form.tollPerStation} onChange={set('tollPerStation')} placeholder="55.000" />
            <div className="cfg-field-hint">Trừ cho mỗi trạm BOT đi qua. Hiện tại: <strong>{fmt(form.tollPerStation)} đ</strong></div>
          </div>
        </div>

        <div className="cfg-form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="field">
            <label htmlFor="return-cargo-bonus">Thưởng chuyến về có hàng (đ)</label>
            <input id="return-cargo-bonus" name="returnCargoBonus" className="input mono" type="text" value={form.returnCargoBonus} onChange={set('returnCargoBonus')} placeholder="300.000" style={{ maxWidth: 320 }} />
            <div className="cfg-field-hint">Cộng khi chọn "chuyến về có hàng". Hiện tại: <strong>{fmt(form.returnCargoBonus)} đ</strong></div>
          </div>
        </div>

        <div className="cfg-form-actions">
          <button onClick={handleSave} disabled={saving} className="btn btn--primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Lưu cấu hình
          </button>
          {message && <span style={{ color: 'var(--success)', fontSize: 13 }}>{message}</span>}
          {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
        </div>
      </Panel>
    </div>
  );
}
