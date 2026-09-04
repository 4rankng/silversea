import { useState, useCallback, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Loader2, X, Pencil, Trash2 } from 'lucide-react';
import { configClient } from '../../api/configClient';
import { PageHeader, useConfirm } from '../../components/UI';
import { useCRUD } from '../../hooks/useCRUD';
import { qk } from '../../api/keys';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './config-page.css';
import { RouteFormModal } from './route-form-modal';


export default function RoutesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    const routeList = await configClient.getRoutesList(search || undefined);
    return { routes: routeList };
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

  const crud = useCRUD('/routes', async () => { await refetch(); });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const totalCount = routes.length;

  const filtered = useMemo(() => sortClientSide(
    routes,
    sort,
    {
      code: r => r.code,
      name: r => r.name,
      shortName: r => r.shortName,
      loadPoint: r => r.loadPoint,
      distanceKm: r => r.distanceKm,
    },
    (a, b) => b.id - a.id,
  ), [routes, sort]);

  return (
    <div ref={pageRef} className="cfg-page cfg-page--routes routes-config-page">
      <PageHeader
        title="Tuyến đường & Cự ly"
        description={<><strong>{totalCount}</strong> tuyến đang quản lý</>}
        onBack={handleBack}
        iconName="route-distance"
        action={
          <button className="btn btn--primary" onClick={() => crud.setShowAddForm(true)}><Plus size={14} /> Thêm tuyến</button>
        }
      />

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
            <div className="record-table-wrap">
            <table className="record-table ops-table routes-table">
              <thead>
                <tr>
                  <SortHeader label="Mã tuyến" sortKey="code" sort={sort} onSortChange={handleSort} />
                  <SortHeader label="Tên tuyến" sortKey="name" sort={sort} onSortChange={handleSort} />
                  <SortHeader label="Tên rút gọn" sortKey="shortName" sort={sort} onSortChange={handleSort} />
                  <SortHeader label="Điểm đóng trả" sortKey="loadPoint" sort={sort} onSortChange={handleSort} />
                  <SortHeader className="num" label="Khoảng cách" sortKey="distanceKm" sort={sort} onSortChange={handleSort} />
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} data-label="" style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>Chưa có dữ liệu</td></tr>}
                {filtered.map(r => {
                  const isSelected = selectedRouteId === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={isSelected ? 'is-selected' : undefined}
                      onClick={() => setSelectedRouteId(isSelected ? null : r.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td data-label="Mã tuyến" style={{ color: 'var(--fg-2)' }}>{r.code || '—'}</td>
                      <td data-label="Tên tuyến">
                        <div className="row-strong">{r.name}</div>
                      </td>
                      <td data-label="Tên rút gọn">{r.shortName || '—'}</td>
                      <td data-label="Điểm đóng trả">{r.loadPoint || '—'}</td>
                      <td className="num" data-label="Khoảng cách">{r.distanceKm != null ? `${r.distanceKm}` : '—'}</td>
                      <td data-label="Ghi chú" style={{ color: 'var(--fg-2)', fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
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
            borderRadius: 'var(--app-radius-lg)',
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
                {selectedRoute.shortName || selectedRoute.name}
              </div>
              {selectedRoute.shortName && selectedRoute.shortName !== selectedRoute.name && <div style={{ color: 'var(--fg-3)', fontSize: 12, marginBottom: 8 }}>{selectedRoute.name}</div>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--bg-2)', padding: '12px', borderRadius: 'var(--app-radius-md)' }}>
              {selectedRoute.code && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--fg-3)' }}>Mã tuyến:</span>
                  <strong style={{ color: 'var(--fg-1)' }}>{selectedRoute.code}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--fg-3)' }}>Khoảng cách:</span>
                <strong style={{ color: 'var(--fg-1)' }}>{selectedRoute.distanceKm ? `${selectedRoute.distanceKm} km` : '—'}</strong>
              </div>
              {selectedRoute.loadPoint && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--fg-3)' }}>Điểm đóng trả:</span>
                  <strong style={{ color: 'var(--fg-1)' }}>{selectedRoute.loadPoint}</strong>
                </div>
              )}
              {selectedRoute.note && (
                <div style={{ fontSize: '13px' }}>
                  <span style={{ color: 'var(--fg-3)' }}>Ghi chú:</span>
                  <div style={{ color: 'var(--fg-1)', marginTop: 4 }}>{selectedRoute.note}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}
      {confirmDialog}
    </div>
  );
}
