import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { Breadcrumbs, Alert } from '../components/shared';
import { EmptyState } from '../design-system';
import { useDispatchData } from '../hooks/useQueries';
import { useLiveFleet } from '../hooks/useTripQueries';
import { useAppSettings } from '../hooks/useAppSettings';
import { useCatalogs } from '../hooks/useCatalogs';
import type { NormalizedTrip } from '../hooks/useTripQueries';
import { LiveFleetMap } from '../features/dispatch/components/LiveFleetMap';
import { useDispatchMutations, useReassignMutations } from '../features/dispatch/hooks/useDispatchMutations';
import { DispatchTripCard } from '../features/dispatch/components/DispatchTripCard';
import { DispatchFilters } from '../features/dispatch/components/DispatchFilters';
import { FleetGrid } from '../features/dispatch/components/FleetGrid';
import { formatFullDate } from '../features/dispatch/utils';
import type { Driver, Truck, FleetFilter } from '../features/dispatch/utils';
import { usePageAnimations } from '../hooks/animations';
import './DispatchPage.css';

export default function DispatchPage() {
  const navigate = useNavigate();
  const { data, isLoading: loading, error: queryError } = useDispatchData();
  const { data: live } = useLiveFleet();
  const { data: appSettings } = useAppSettings();
  const gpsEnabled = appSettings?.gpsEnabled ?? false;
  const { rootRef } = usePageAnimations({ ready: !loading });
  const drivers = useMemo(() => (data?.drivers ?? []) as Driver[], [data]);
  const trucks: Truck[] = useMemo(() => (data?.trucks ?? []).map((t) => ({ id: t.id, licensePlate: t.licensePlate ?? '', status: t.status ?? '' })), [data]);
  const pendingTrips: NormalizedTrip[] = data?.pendingTrips ?? [];
  const activeTrips = useMemo<NormalizedTrip[]>(() => data?.activeTrips ?? [], [data]);
  const pendingTotal: number = data?.pendingTotal ?? 0;
  const { data: catalogData } = useCatalogs();
  const carrierCustomers = useMemo(() => 
    catalogData?.customers.filter(c => c.isCarrier).map(c => ({ id: c.id, label: c.name })) ?? [],
  [catalogData]);
  const error = queryError ? 'Không thể tải dữ liệu điều vận. Vui lòng tải lại trang.' : null;

  const { actionLoading, dispatching, toasts, setToasts, handleDispatch, confirmDialog } = useDispatchMutations(pendingTrips);
  const { reassignOpen, reassignState, setReassignState, openReassign, closeReassign, handleReassign } = useReassignMutations();
  const [fleetFilter, setFleetFilter] = useState<FleetFilter>('all');

  const getActive = useCallback((id: number) => activeTrips.find((t) => t.truckId === id), [activeTrips]);
  const getDefault = useCallback((id: number) => drivers.find((d) => d.assignedTruckId === id), [drivers]);

  const fleetCounts = useMemo(() => {
    let running = 0, ready = 0, noassign = 0, maint = 0;
    for (const t of trucks) { if (t.status === 'MAINTENANCE') { maint++; continue; } if (getActive(t.id)) running++; else if (getDefault(t.id)) ready++; else noassign++; }
    return { running, ready, noassign, maint, all: trucks.length };
  }, [trucks, getActive, getDefault]);

  const utilizationPct = useMemo(() => { const a = fleetCounts.all - fleetCounts.maint; return a <= 0 ? 0 : Math.round((fleetCounts.running / a) * 100); }, [fleetCounts]);
  const noteCount = fleetCounts.maint + fleetCounts.noassign;

  const filteredTrucks = useMemo(() => {
    if (fleetFilter === 'all') return trucks;
    return trucks.filter((t) => { if (fleetFilter === 'maint') return t.status === 'MAINTENANCE'; if (t.status === 'MAINTENANCE') return false; const ha = !!getActive(t.id); if (fleetFilter === 'running') return ha; const hd = !!getDefault(t.id); if (fleetFilter === 'ready') return !ha && hd; if (fleetFilter === 'noassign') return !ha && !hd; return true; });
  }, [trucks, fleetFilter, getActive, getDefault]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spin" style={{ width: 32, height: 32, border: '4px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%' }} /></div>;

  return (
    <div ref={rootRef} className="dispatch-page" style={{ paddingBottom: 40 }}>
      {toasts.length > 0 && createPortal(
        <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {toasts.map(t => (<div key={t.id} role="status" style={{ minWidth: 280, maxWidth: 480, padding: '12px 16px', borderRadius: 8, background: t.kind === 'success' ? 'var(--accent)' : 'var(--danger)', color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 10px 28px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}><span style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%', opacity: 0.9 }} /><span style={{ flex: 1 }}>{t.text}</span></div>))}
        </div>, document.body)}
      <Breadcrumbs
        className="dispatch-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Điều vận' },
        ]}
        renderLink={(to, children) => (
          <a onClick={() => navigate(to)} style={{ cursor: 'pointer' }}>{children}</a>
        )}
      />
      {error && (
        <Alert
          variant="error"
          style="soft"
          icon={<AlertTriangle size={16} />}
          className="mb-5"
        >
          {error}
        </Alert>
      )}

      <section className="hero">
        <div className="hero-top fade-up-2">
          <div className="hero-title-block">
            <div className="hero-eyebrow">Phiên điều vận đang mở</div>
            <h1 className="hero-h1" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/assets/icons/02-dispatch-dieu-phoi.png" alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
              Điều vận hôm nay
            </h1>
            <div className="hero-sub">{formatFullDate(new Date())} · {pendingTotal} đơn hàng chờ phân xe</div>
          </div>
          <div className="hero-actions">
            <button className="btn btn--primary" type="button" onClick={() => navigate('/trips/new')}><Plus size={15} /> Tạo chuyến mới</button>
          </div>
        </div>
        <div className="metrics fade-up-3">
          <div className="metric featured"><div className="metric-label">Tỉ lệ sử dụng</div><div className="metric-value">{utilizationPct}<span className="metric-unit">%</span></div><div className="utilization-bar"><div className="utilization-fill" style={{ width: `${utilizationPct}%` }} /></div></div>
          <div className="metric"><div className="metric-label">Tổng đội xe</div><div className="metric-value d-mono">{fleetCounts.all}</div><div className="metric-delta delta-flat">— xe đăng ký</div></div>
          <div className="metric"><div className="metric-label">Xe đang chạy</div><div className="metric-value d-mono">{fleetCounts.running}<span className="metric-value-unit">/{fleetCounts.all}</span></div><div className="metric-delta delta-up"><TrendingUp size={10} strokeWidth={2.5} /> hoạt động</div></div>
          <div className="metric"><div className="metric-label">Sẵn sàng</div><div className="metric-value d-mono">{fleetCounts.ready}</div><div className="metric-delta delta-up"><TrendingUp size={10} strokeWidth={2.5} /> khả dụng</div></div>
          <div className="metric"><div className="metric-label">Cần lưu ý</div><div className="metric-value d-mono">{noteCount}</div><div className="metric-delta delta-down"><TrendingDown size={10} strokeWidth={2.5} /> {fleetCounts.maint} bảo dưỡng · {fleetCounts.noassign} chờ giao</div></div>
        </div>
      </section>

      {gpsEnabled && (
        <>
          <div className="section-head">
            <div className="section-title"><h2>Vị trí thời gian thực</h2><span className="count">{live?.vehicles.length ?? 0} xe</span></div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-2, #6B7280)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 9, height: 9, background: '#00B14F', borderRadius: '50%', display: 'inline-block' }} />Đang chạy</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 9, height: 9, background: '#F59E0B', borderRadius: '50%', display: 'inline-block' }} />Dừng</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 9, height: 9, background: '#94A3B8', borderRadius: '50%', display: 'inline-block' }} />Mất tín hiệu</span>
              <span style={{ color: 'var(--text-3, #9CA3AF)' }}>· Cập nhật mỗi 10 giây</span>
            </div>
          </div>
          {live?.error ? (
            <div style={{ padding: '14px 16px', background: 'rgba(245,166,35,0.12)', color: '#B45309', borderRadius: 10, border: '1px solid rgba(245,166,35,0.35)', fontSize: 13, marginBottom: 20 }}>
              Dữ liệu GPS tạm thời không khả dụng. {live.error === 'GPS provider not configured' ? 'Chưa cấu hình nhà cung cấp GPS.' : 'Vui lòng thử lại sau.'}
            </div>
          ) : live && live.vehicles.length > 0 ? (
            <LiveFleetMap vehicles={live.vehicles} />
          ) : (
            <div style={{ padding: '14px 16px', background: 'var(--surface-2, #F5F7F6)', color: 'var(--text-2, #6B7280)', borderRadius: 10, fontSize: 13, marginBottom: 20 }}>
              Chưa có xe nào đang chạy để theo dõi.
            </div>
          )}
        </>
      )}

      <div className="section-head">
        <div className="section-title"><h2>Trạng thái đội xe</h2><span className="count">{fleetCounts.all} xe</span></div>
        <DispatchFilters fleetFilter={fleetFilter} fleetCounts={fleetCounts} onFilterChange={setFleetFilter} />
      </div>
      <FleetGrid trucks={filteredTrucks} activeTrips={activeTrips} drivers={drivers} onTripClick={(id) => navigate(`/trips/${id}`)} />

      <div className="section-head"><div className="section-title"><h2>Đơn hàng cần điều vận</h2><span className="count">{pendingTrips.length} đơn</span></div></div>
      <div className="orders-card">
        {pendingTrips.length > 0 && <div className="orders-head"><div>Ngày</div><div>Tuyến</div><div>Khách hàng</div><div className="col-assign">Xe & Lái xe</div><div className="right">Thao tác</div></div>}
        {pendingTrips.length === 0 ? (
          <EmptyState
            illustration="/assets/illustrations/empty-dispatch.svg"
            title="Không có đơn hàng nào chờ khởi hành"
            description="Tất cả các chuyến đi đã xuất phát hoặc chưa tạo."
            action={<button className="btn btn--primary" onClick={() => navigate('/trips/new')}><Plus size={15} /> Tạo chuyến mới</button>}
          />
        ) : pendingTrips.map((trip) => (
          <DispatchTripCard key={trip.id} trip={trip} isEditing={reassignOpen === trip.id} reassignState={reassignState} setReassignState={setReassignState} trucks={trucks} drivers={drivers} carrierCustomers={carrierCustomers} onDispatch={() => handleDispatch(trip.id)} onOpenReassign={() => openReassign(trip)} onCloseReassign={closeReassign} onReassign={() => handleReassign(trip.id)} dispatching={dispatching} actionLoadingId={actionLoading} />
        ))}
        {pendingTrips.length > 0 && <div className="orders-foot"><span>{pendingTotal} đơn hàng</span><Link to='/trips'>Lịch sử điều vận →</Link></div>}
      </div>
      {confirmDialog}
    </div>
  );
}
