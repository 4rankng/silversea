import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Route, Plus, Pencil, Trash2, Loader2, X, Mountain } from 'lucide-react';
import { configClient } from '../../api/configClient';
import { tripClient } from '../../api/tripClient';
import { formatCurrency } from '../../lib/format';
import { PageHeader, useConfirm } from '../../components/UI';
import { calculateRoute } from '../../lib/maps';
import { LeafletMap } from '../../components/shared/LeafletMap';
import { useCRUD } from '../../hooks/useCRUD';
import { qk } from '../../api/keys';
import type { Route as RouteType, RoadAllowance } from '@tingting/shared';
import './config-page.css';
import { RouteFormModal } from './route-form-modal';


export default function RoutesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const [routeFilter, setRouteFilter] = useState<'all' | 'plain' | 'mountain'>('all');
  const [search, setSearch] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedRouteLegs, setSelectedRouteLegs] = useState<Array<{ origin: string; destination: string; km: number; loadingType: string; polylinePath: string | null }>>([]);

  const fetchData = useCallback(async () => {
    const [routeList, tripRes, allowances] = await Promise.all([
      configClient.getRoutesList(search || undefined),
      tripClient.fetchAllTrips({}).then(r => r.items).catch(() => [] as Array<{ routeId?: number | null; departureDate?: string }>),
      configClient.getRoadAllowances().catch(() => [] as RoadAllowance[]),
    ]);
    return {
      routes: routeList,
      trips: tripRes,
      allowances,
    };
  }, [search]);

  const { data, refetch } = useQuery({
    queryKey: qk.tripForm.routesConfig(search),
    queryFn: fetchData,
    staleTime: 2 * 60 * 1000,
  });

  const routes = useMemo(() => data?.routes ?? [], [data]);

  const selectedRoute = useMemo(() => {
    return routes.find(r => r.id === selectedRouteId);
  }, [routes, selectedRouteId]);

  useEffect(() => {
    if (selectedRoute && selectedRoute.defaultLegs && Array.isArray(selectedRoute.defaultLegs)) {
      const legs = (selectedRoute.defaultLegs as NonNullable<RouteType['defaultLegs']>).map((l) => ({
        ...l,
        polylinePath: null as string | null
      }));
      setSelectedRouteLegs(legs);

      legs.forEach(async (leg, idx) => {
        if (leg.origin && leg.destination && leg.origin !== leg.destination) {
          try {
            const res = await calculateRoute(leg.origin, leg.destination);
            if (res.polylinePath) {
              setSelectedRouteLegs(prev => prev.map((l, i) => i === idx ? { ...l, polylinePath: res.polylinePath } : l));
            }
          } catch { /* polyline fetch is decorative */ }
        }
      });
    } else {
      setSelectedRouteLegs([]);
    }
  }, [selectedRoute]);

  const routeTripStats = useMemo(() => {
    const stats = new Map<number, number>();
    if (!data?.trips) return stats;
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    data.trips.forEach((t) => {
      const dep = t.departureDate || '';
      if (dep.startsWith(thisMonth)) {
        const rid = t.routeId;
        if (rid) stats.set(rid, (stats.get(rid) || 0) + 1);
      }
    });
    return stats;
  }, [data?.trips]);

  const routePriceMap = useMemo(() => {
    const priceMap = new Map<number, { ft20?: number; ft40?: number }>();
    if (!data?.allowances) return priceMap;
    data.allowances.forEach((ra) => {
      const rid = ra.routeId;
      if (!rid) return;
      const p = priceMap.get(rid) || {};
      if (ra.trailerType === '20FT') p.ft20 = parseFloat(ra.baseAmount ?? '0');
      if (ra.trailerType === '40FT') p.ft40 = parseFloat(ra.baseAmount ?? '0');
      priceMap.set(rid, p);
    });
    return priceMap;
  }, [data?.allowances]);

  const crud = useCRUD('/routes', async () => { await refetch(); });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const now = new Date();
  const monthLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
  const totalCount = routes.length;
  const mountainCount = routes.filter(r => r.isMountain).length;
  const usedThisMonth = routes.filter(r => (routeTripStats.get(r.id) || 0) > 0).length;

  let popularRoute: RouteType | undefined;
  let popularCount = 0;
  routes.forEach(r => { const c = routeTripStats.get(r.id) || 0; if (c > popularCount) { popularCount = c; popularRoute = r; } });

  const filtered = routes.filter(r => {
    if (routeFilter === 'plain') return !r.isMountain;
    if (routeFilter === 'mountain') return r.isMountain;
    return true;
  });

  return (
    <div ref={pageRef} className="cfg-page cfg-page--routes routes-config-page">
      <PageHeader
        title="Tuyến đường & Cự ly"
        description={<><strong>{totalCount}</strong> tuyến đang quản lý · {mountainCount} tuyến núi · {usedThisMonth} tuyến chạy trong {monthLabel}</>}
        onBack={handleBack}
        iconName="route-distance"
        action={
          <button className="btn btn--primary" onClick={() => crud.setShowAddForm(true)}><Plus size={14} /> Thêm tuyến</button>
        }
      />

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="kpi__top"><span className="kpi__label">Tổng tuyến</span></div>
          <div className="kpi__value">{totalCount}</div>
          <div className="kpi__meta kpi__meta--up">Tất cả tuyến đang hoạt động</div>
          <div className="kpi__watermark" aria-hidden="true"><MapPin size={72} /></div>
        </div>
        <div className="kpi kpi--success">
          <div className="kpi__top"><span className="kpi__label">Đang sử dụng {monthLabel}</span></div>
          <div className="kpi__value">{usedThisMonth}<span className="kpi__value-unit">/{totalCount}</span></div>
          <div className="kpi__meta">{totalCount > 0 ? Math.round((usedThisMonth / totalCount) * 100) : 0}% tuyến có chuyến</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
        </div>
        <div className="kpi kpi--warn">
          <div className="kpi__top"><span className="kpi__label">Tuyến núi</span></div>
          <div className="kpi__value">{mountainCount}</div>
          <div className="kpi__meta">Định mức dầu cao hơn</div>
          <div className="kpi__watermark" aria-hidden="true"><Mountain size={72} /></div>
        </div>
        <div className="kpi">
          <div className="kpi__top"><span className="kpi__label">Phổ biến nhất</span></div>
          <div className="kpi__value" style={{ fontSize: 16, lineHeight: 1.3 }}>{popularRoute ? popularRoute.name.split(' - ')[0] : '—'}</div>
          <div className="kpi__meta">{popularCount > 0 ? `${popularCount} chuyến ${monthLabel}` : 'Chưa có dữ liệu'}</div>
          <div className="kpi__watermark" aria-hidden="true"><Route size={72} /></div>
        </div>
      </div>

      {/* Modal-based create/edit — was an inline tr form earlier; the cramped
          layout hid the toll-station / fuel-allowance / driver-salary fields
          that the trip-creation tip refers to, so users couldn't configure
          them. Modal exposes them clearly with section grouping + hints. */}
      <RouteFormModal
        key={crud.editingId ?? (crud.showAddForm ? 'add' : 'closed')}
        isOpen={crud.showAddForm || crud.editingId != null}
        saving={crud.saving}
        item={crud.editingId != null ? routes.find(r => r.id === crud.editingId) : undefined}
        onsave={d => {
          if (crud.editingId != null) crud.doUpdate(crud.editingId, d);
          else crud.doCreate(d);
        }}
        oncancel={crud.cancelForm}
      />

      <div className="routes-config-grid" style={{
        display: 'grid',
        gridTemplateColumns: selectedRoute ? '1fr 380px' : '1fr',
        gap: '20px',
        alignItems: 'start',
        transition: 'grid-template-columns 0.3s ease'
      }}>
        <div className="table-wrap" style={{ margin: 0 }}>
          <div className="toolbar">
            {(['all', 'plain', 'mountain'] as const).map(f => {
              const labels = { all: `Tất cả · ${totalCount}`, plain: `Đồng bằng · ${totalCount - mountainCount}`, mountain: `Tuyến núi · ${mountainCount}` };
              return <button key={f} className={`filter-pill${routeFilter === f ? ' is-active' : ''}`} onClick={() => setRouteFilter(f)}>{labels[f]}</button>;
            })}
            <div className="toolbar__spacer" />
            <div className="toolbar__search">
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                type="text"
                name="routeSearch"
                aria-label="Tìm tuyến đường"
                placeholder="Tìm tuyến đường…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div style={{ padding: '6px 12px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-3)', fontSize: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Nhấn vào một hàng để xem chi tiết và chỉnh sửa tuyến đường
          </div>
          <div className="table-scroll">
            <table className="routes-table">
              <thead>
                <tr>
                  <th>Tuyến đường</th><th className="num">KM</th><th>Loại</th>
                  <th className="num">Trạm thu phí</th><th className="num">Tiền KH</th>
                  <th className="num">Chuẩn 20ft</th>
                  <th className="num">Chuẩn 40ft</th><th className="num">Sử dụng {monthLabel}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>Chưa có dữ liệu</td></tr>}
                {filtered.map(r => {
                  const prices = routePriceMap.get(r.id);
                  const trips = routeTripStats.get(r.id) || 0;
                  const isSelected = selectedRouteId === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRouteId(isSelected ? null : r.id)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--bg-2)' : undefined,
                      }}
                    >
                      <td data-label="Tuyến đường">
                        <div className="row-strong">{r.name}</div>
                        {r.fixedFuelAllowance && <div className="row-meta">Định mức dầu: {r.fixedFuelAllowance} L</div>}
                      </td>
                      <td className="num" data-label="KM">{r.distanceKm != null ? `${r.distanceKm}` : '—'}</td>
                      <td data-label="Loại">
                        {r.isMountain
                          ? <span className="pill pill--warn"><span className="dot" />Tuyến núi</span>
                          : <span className="pill pill--neutral">Đồng bằng</span>}
                      </td>
                      <td className="num" data-label="Trạm">{r.tollsStations != null ? r.tollsStations : '—'}</td>
                      <td className="num" data-label="Tiền KH">{r.driverSalary ? formatCurrency(Number(r.driverSalary)) : '—'}</td>
                      <td className="num" data-label="20ft">{prices?.ft20 ? formatCurrency(prices.ft20) : '—'}</td>
                      <td className="num" data-label="40ft">{prices?.ft40 ? formatCurrency(prices.ft40) : '—'}</td>
                      <td className="num" data-label={`Dùng ${monthLabel}`}>
                        {trips > 0 ? <strong style={{ color: 'var(--success)' }}>{trips}</strong> : <span style={{ color: 'var(--ink-3)' }}>0</span>}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> tuyến đường</span>
          </div>
        </div>

        {selectedRoute && (
          <div className="card sticky-card" style={{
            position: 'sticky',
            top: '20px',
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--shadow-md)',
            animation: 'slide-left 0.3s ease-out'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>
                Chi tiết tuyến đường
              </h3>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  title="Sửa tuyến"
                  onClick={() => { crud.setEditingId(selectedRoute.id); setSelectedRouteId(null); }}
                  style={{ color: 'var(--primary)' }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  title="Xóa tuyến"
                  disabled={crud.deleting === selectedRoute.id}
                  onClick={async () => {
                    const ok = await confirm(`Xóa tuyến "${selectedRoute.name}"?`, { confirmLabel: 'Xóa', variant: 'danger' });
                    if (ok) { setSelectedRouteId(null); crud.doDelete(selectedRoute.id); }
                  }}
                  style={{ color: 'var(--danger)' }}
                >
                  {crud.deleting === selectedRoute.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                </button>
                <div style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 2px' }} />
                <button
                  className="btn btn--ghost btn--icon btn--sm"
                  title="Đóng"
                  onClick={() => setSelectedRouteId(null)}
                  style={{ color: 'var(--fg-3)' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '4px' }}>
                {selectedRoute.name}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="pill pill--neutral">
                  {selectedRoute.distanceKm ? `${selectedRoute.distanceKm} km` : '— km'}
                </span>
                {selectedRoute.isMountain ? (
                  <span className="pill pill--warn"><span className="dot" />Tuyến núi</span>
                ) : (
                  <span className="pill pill--neutral">Đồng bằng</span>
                )}
              </div>
            </div>

            {/* Map Visualization */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-3)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Bản đồ tuyến đường
              </div>
              {selectedRouteLegs.length > 0 ? (
                <LeafletMap legs={selectedRouteLegs} height="220px" />
              ) : (
                <div style={{
                  height: '220px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-2)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px dashed var(--line)',
                  color: 'var(--fg-3)',
                  fontSize: '13px'
                }}>
                  Chưa khai báo chặng để hiển thị bản đồ
                </div>
              )}
            </div>

            {/* Configuration default values */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--bg-2)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--fg-3)' }}>Định mức dầu:</span>
                <strong style={{ color: 'var(--fg-1)' }}>
                  {selectedRoute.fixedFuelAllowance ? `${selectedRoute.fixedFuelAllowance} L` : 'Theo công thức'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--fg-3)' }}>Trạm thu phí:</span>
                <strong style={{ color: 'var(--fg-1)' }}>
                  {selectedRoute.tollsStations != null ? `${selectedRoute.tollsStations} trạm` : '—'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--fg-3)' }}>Tiền kết hợp:</span>
                <strong style={{ color: 'var(--fg-1)' }}>
                  {selectedRoute.driverSalary ? formatCurrency(Number(selectedRoute.driverSalary)) : 'Theo công thức'}
                </strong>
              </div>
            </div>

            {/* Default legs itinerary */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-3)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Lộ trình chi tiết ({selectedRouteLegs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {selectedRouteLegs.length === 0 ? (
                  <div style={{ fontSize: '13px', color: 'var(--fg-3)', fontStyle: 'italic' }}>Chưa cấu hình chặng mặc định.</div>
                ) : (
                  selectedRouteLegs.map((leg, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      background: 'var(--bg-2)',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Chặng {i + 1}</span>
                        <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>
                          {leg.km} km · {leg.loadingType === 'HANG' ? 'Có hàng' : 'Vỏ rỗng'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: 'var(--success)' }}>●</span> {leg.origin}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: 'var(--danger)' }}>●</span> {leg.destination}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}
      {confirmDialog}
    </div>
  );
}
