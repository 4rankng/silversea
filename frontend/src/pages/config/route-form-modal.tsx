import { useState, useEffect } from 'react';
import { labelStyle } from '../../utils/formStyles';
import { Plus, Trash2, Loader2, Save, X, Mountain } from 'lucide-react';
import { Modal } from '../../components/UI';
import { UuiSelectField } from '../../design-system';
import { LocationAutocomplete } from '../../components/LocationAutocomplete';
import { calculateRoute } from '../../lib/maps';
import { LeafletMap } from '../../components/shared/LeafletMap';
import type { Route as RouteType } from '@tingting/shared';
import { LoadingType } from '@tingting/shared';

/**
 * RouteFormModal — replaces the tr-based inline add form, which was visually
 * cramped (6 fields squeezed into a single flex row) and hid the
 * route-config fields the trip-creation tooltip is promising. The modal
 * gives each field its own row with grouping (basic info / pricing
 * defaults), proper labels, and a clear save/cancel footer.
 */
export function RouteFormModal({ isOpen, saving, item, onsave, oncancel }: {
  isOpen: boolean; saving: boolean; item?: RouteType; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [distance, setDistance] = useState('');
  const [isMountain, setIsMountain] = useState(false);
  const [fuelAllowance, setFuelAllowance] = useState('');
  const [tollsStations, setTollsStations] = useState('');
  const [driverSalary, setDriverSalary] = useState('');

  type DefaultLeg = { id: string; origin: string; destination: string; km: string; loadingType: LoadingType; polylinePath?: string | null };
  const [defaultLegs, setDefaultLegs] = useState<DefaultLeg[]>([]);

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setShortName(item?.shortName || item?.name || '');
      setDistance(item?.distanceKm?.toString() || '');
      setIsMountain(item?.isMountain || false);
      setFuelAllowance(item?.fixedFuelAllowance || '');
      setTollsStations(item?.tollsStations?.toString() || '');
      setDriverSalary(item?.driverSalary || '');

      if (item?.defaultLegs && Array.isArray(item.defaultLegs)) {
        const mapped = item.defaultLegs.map(l => ({
          id: Math.random().toString(),
          origin: l.origin,
          destination: l.destination,
          km: l.km.toString(),
          loadingType: l.loadingType as LoadingType,
          polylinePath: null as string | null
        }));
        setDefaultLegs(mapped);

        // Polyline fetch is decorative; a 4xx/5xx must not block saving.
        mapped.forEach(async (leg) => {
          if (leg.origin && leg.destination && leg.origin !== leg.destination) {
            try {
              const res = await calculateRoute(leg.origin, leg.destination);
              if (res.polylinePath) {
                setDefaultLegs(prev => prev.map(l => l.id === leg.id ? { ...l, polylinePath: res.polylinePath } : l));
              }
            } catch (err) {
              console.warn('[RoutesConfigPage] polyline fetch failed for', leg.origin, '→', leg.destination, err);
            }
          }
        });
      } else {
        setDefaultLegs([]);
      }
    }
    // Reset form fields only when the modal opens or switches item; field-level
    // deps intentionally omitted to avoid clobbering in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  const handleSave = () => {
    if (!name.trim() || !shortName.trim()) return;
    onsave({
      name: name.trim(),
      shortName: shortName.trim(),
      distanceKm: distance && Number(distance) > 0 ? Number(distance) : undefined,
      isMountain,
      fixedFuelAllowance: fuelAllowance || null,
      tollsStations: tollsStations ? Number(tollsStations) : null,
      driverSalary: driverSalary || null,
      defaultLegs: defaultLegs.length > 0 ? defaultLegs.map(l => ({
        origin: l.origin,
        destination: l.destination,
        km: Number(l.km) || 0,
        loadingType: l.loadingType
      })) : null
    });
  };

  const addLeg = () => {
    setDefaultLegs([...defaultLegs, { id: Math.random().toString(), origin: '', destination: '', km: '', loadingType: LoadingType.HANG, polylinePath: null }]);
  };

  const updateLeg = async (id: string, field: keyof DefaultLeg, val: string) => {
    setDefaultLegs(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));

    // Fetch polyline for map visualization only — km is manual
    if (field === 'origin' || field === 'destination') {
      const legToUpdate = defaultLegs.find(l => l.id === id);
      if (legToUpdate) {
        const origin = field === 'origin' ? val : legToUpdate.origin;
        const destination = field === 'destination' ? val : legToUpdate.destination;
        if (origin && destination && origin !== destination) {
          try {
            const result = await calculateRoute(origin, destination);
            if (result.polylinePath) {
              setDefaultLegs(prev => prev.map(l => l.id === id ? {
                ...l,
                polylinePath: result.polylinePath
              } : l));
            }
          } catch (err) {
            // Polyline is decorative; a failure here must not block the leg save.
            console.warn('[RoutesConfigPage] polyline fetch failed for', origin, '→', destination, err);
          }
        }
      }
    }
  };

  const removeLeg = (id: string) => {
    setDefaultLegs(defaultLegs.filter(l => l.id !== id));
  };

  const hintStyle = { fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', marginTop: 4 } as const;
  const sectionLabelStyle = {
    fontSize: 12, lineHeight: 1.35, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', marginBottom: 8, marginTop: 4,
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa tuyến — ${item.shortName || item.name}` : 'Thêm tuyến đường mới'}
      maxWidth={1000}
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-8 items-start">

        {/* COLUMN 1: Basic Info & Fuel/Salary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Basic Info */}
          <div>
            <div style={sectionLabelStyle}>Thông tin cơ bản</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginBottom: 14 }}>
              <div className="field">
                <label htmlFor="route-name" style={labelStyle}>Tên đầy đủ <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input id="route-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Tên dùng trên báo cáo" autoFocus />
              </div>
              <div className="field">
                <label htmlFor="route-short-name" style={labelStyle}>Tên ngắn <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input id="route-short-name" className="input" value={shortName} onChange={e => setShortName(e.target.value)} placeholder="Tên hiển thị trong vận hành" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label htmlFor="route-distance" style={labelStyle}>Khoảng cách (km)</label>
                <input
                  id="route-distance"
                  className="input"
                  type="number"
                  value={distance}
                  onChange={e => setDistance(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label style={labelStyle}>Loại địa hình</label>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  padding: '9px 12px', border: '1px solid var(--line)',
                  borderRadius: 'var(--app-radius-md)', background: isMountain ? 'var(--warning-soft, #fef3c7)' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={isMountain}
                    onChange={e => setIsMountain(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <Mountain size={14} />
                  <span style={{ fontSize: 13 }}>Tuyến leo núi</span>
                </label>
              </div>
            </div>
          </div>

          {/* Fuel & Salary */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
            <div style={sectionLabelStyle}>Định mức nhiên liệu & Tiền lương</div>
            <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: '0 0 12px' }}>
              Các giá trị này sẽ được dùng để gợi ý khi tạo / sửa lệnh trên tuyến này.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label htmlFor="route-fuel" style={labelStyle}>Định mức dầu (lít)</label>
                <input
                  id="route-fuel"
                  className="input"
                  type="number"
                  step="0.01"
                  value={fuelAllowance}
                  onChange={e => setFuelAllowance(e.target.value)}
                  placeholder="0"
                />
                <p style={hintStyle}>Định mức cố định riêng cho tuyến (vd. tuyến núi).</p>
              </div>
              <div className="field">
                <label htmlFor="route-stations" style={labelStyle}>Số trạm thu phí</label>
                <input
                  id="route-stations"
                  className="input"
                  type="number"
                  value={tollsStations}
                  onChange={e => setTollsStations(e.target.value)}
                  placeholder="0"
                />
                <p style={hintStyle}>Trừ vào tiền đi đường.</p>
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="route-salary" style={labelStyle}>Tiền kết hợp (đ / chuyến)</label>
              <input
                id="route-salary"
                className="input"
                type="number"
                value={driverSalary}
                onChange={e => setDriverSalary(e.target.value)}
                placeholder="Ví dụ: 500000"
              />
              <p style={hintStyle}>Tiền kết hợp mặc định cho tuyến này. Để trống nếu dùng giá trị chung.</p>
            </div>
          </div>
        </div>

        {/* COLUMN 2: Default Legs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ ...sectionLabelStyle, margin: 0 }}>Hành trình chi tiết (Mặc định)</div>
              <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: '4px 0 0' }}>
                Khai báo sẵn các chặng để tự động điền khi tạo lệnh.
              </p>
            </div>
            <button type="button" className="btn btn--secondary btn--sm" onClick={addLeg} style={{ padding: '0 12px' }}>
              <Plus size={14} /> Thêm chặng
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {defaultLegs.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', background: 'var(--bg-2)', borderRadius: 'var(--app-radius-md)', border: '1px dashed var(--line)' }}>
                <span style={{ color: 'var(--fg-3)', fontSize: 13 }}>Chưa có chặng mặc định</span>
              </div>
            ) : defaultLegs.map((leg) => (
              <div key={leg.id} className="flex flex-wrap lg:grid lg:grid-cols-[1fr_1fr_70px_100px_30px] gap-2 items-center p-2 rounded-md" style={{ background: 'var(--bg-2)' }}>
                <div className="flex-1 min-w-[140px]">
                  <LocationAutocomplete className="input input--sm w-full" placeholder="Điểm đi" value={leg.origin} onChange={val => updateLeg(leg.id, 'origin', val)} />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <LocationAutocomplete className="input input--sm w-full" placeholder="Điểm đến" value={leg.destination} onChange={val => updateLeg(leg.id, 'destination', val)} />
                </div>
                <div className="w-[70px] shrink-0">
                  <input className="input input--sm w-full" type="number" placeholder="Km" value={leg.km} onChange={e => updateLeg(leg.id, 'km', e.target.value)} />
                </div>
                <div className="w-[100px] shrink-0">
                  <UuiSelectField
                    label="Loại hàng"
                    hideLabel
                    value={leg.loadingType}
                    onChange={e => updateLeg(leg.id, 'loadingType', e.target.value)}
                    options={[
                      { value: LoadingType.HANG, label: 'Có hàng' },
                      { value: LoadingType.VO, label: 'Vỏ rỗng' },
                    ]}
                    controlClassName="input--sm"
                    wrapperClassName="w-full"
                  />
                </div>
                <div className="w-[40px] shrink-0 flex justify-center">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`Xóa chặng ${leg.origin || leg.destination || ''}`.trim()}
                    onClick={() => removeLeg(leg.id)}
                    style={{ color: 'var(--danger)', minWidth: 36 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Live Map in RouteFormModal */}
          <div style={{ marginTop: 12 }}>
            <div style={sectionLabelStyle}>Bản đồ trực quan</div>
            {defaultLegs.some(l => l.polylinePath) ? (
              <LeafletMap legs={defaultLegs} height="240px" />
            ) : (
              <div style={{
                height: '240px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-2)',
                borderRadius: 'var(--app-radius-lg, 12px)',
                border: '1px dashed var(--line)',
                color: 'var(--fg-3)',
                fontSize: '13px'
              }}>
                Nhập địa điểm cho các chặng để trực quan hóa lộ trình trên bản đồ
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
