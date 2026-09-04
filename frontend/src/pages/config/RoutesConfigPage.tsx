import { useState, useCallback, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
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

      <div className="table-wrap">
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
                <th style={{ width: 88 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>Chưa có dữ liệu</td></tr>}
              {filtered.map(r => (
                <tr key={r.id}>
                  <td data-label="Mã tuyến" style={{ color: 'var(--fg-2)' }}>{r.code || '—'}</td>
                  <td data-label="Tên tuyến">
                    <div className="row-strong">{r.name}</div>
                  </td>
                  <td data-label="Tên rút gọn">{r.shortName || '—'}</td>
                  <td data-label="Điểm đóng trả">{r.loadPoint || '—'}</td>
                  <td className="num" data-label="Khoảng cách">{r.distanceKm != null ? `${r.distanceKm}` : '—'}</td>
                  <td data-label="Ghi chú" style={{ color: 'var(--fg-2)', fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note || '—'}</td>
                  <td data-label="" className="record-table__action">
                    <div className="row-actions">
                      <button
                        className="row-action"
                        title="Sửa tuyến"
                        onClick={() => crud.setEditingId(r.id)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="row-action"
                        title="Xóa tuyến"
                        disabled={crud.deleting === r.id}
                        onClick={async () => {
                          const ok = await confirm(`Xóa tuyến "${r.name}"?`, { confirmLabel: 'Xóa', variant: 'danger' });
                          if (ok) crud.doDelete(r.id);
                        }}
                        style={{ color: 'var(--danger)' }}
                      >
                        {crud.deleting === r.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <div className="table-foot">
          <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> tuyến đường</span>
        </div>
      </div>
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}
      {confirmDialog}
    </div>
  );
}
