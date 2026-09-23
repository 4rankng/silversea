import { useState, useCallback, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { configClient } from '../../api/configClient';
import { PageHeader, useConfirm } from '../../components/UI';
import { useCRUD } from '../../hooks/useCRUD';
import { useDropdownDismiss } from '../../hooks/useDropdownDismiss';
import { qk } from '../../api/keys';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './config-page.css';
import './RoutesConfigPage.css';
import { RouteFormModal } from './route-form-modal';
import { EmptyState } from '../../design-system';
import { ListFilterBar } from '../../components/ListFilterBar';

export default function RoutesConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const [search, setSearch] = useState('');
  const searchQuery = search.trim().replace(/\s+/g, ' ');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  useDropdownDismiss(menuOpenId !== null, () => setMenuOpenId(null));

  const fetchData = useCallback(async () => {
    const routeList = await configClient.getRoutesList(searchQuery || undefined);
    return { routes: routeList };
  }, [searchQuery]);

  const { data, refetch, isPending, isFetching, isError } = useQuery({
    queryKey: qk.tripForm.routesConfig(searchQuery),
    queryFn: fetchData,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
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
      tollsStations: r => r.tollsStations,
    },
    (a, b) => b.id - a.id,
  ), [routes, sort]);

  // Card 20260922_22 — a column no row in the current result fills hides
  // itself: the equal-split fixed layout was spending over half the table
  // width on "—" placeholders. Mandatory columns (Tên tuyến) always render;
  // hidden columns return as soon as any row carries data.
  const colPresence = useMemo(() => {
    const present: Record<string, boolean> = {};
    for (const r of filtered) {
      if (r.code?.trim()) present.code = true;
      if (r.shortName?.trim() && r.shortName !== r.name) present.shortName = true;
      if (r.loadPoint?.trim()) present.loadPoint = true;
      if (r.distanceKm != null) present.distanceKm = true;
      if (r.tollsStations != null) present.tollsStations = true;
      if (r.note?.trim()) present.note = true;
    }
    return present;
  }, [filtered]);

  return (
    <div ref={pageRef} className="cfg-page cfg-page--routes routes-config-page">
      <PageHeader
        title="Tuyến đường"
        description={isPending ? 'Đang tải tuyến đường…' : <><strong>{totalCount}</strong> tuyến đang quản lý</>}
        onBack={handleBack}
        iconName="route-distance"
        action={
          <button className="btn btn--primary" onClick={() => { crud.setError(null); crud.setShowAddForm(true); }}><Plus size={14} /> Thêm tuyến</button>
        }
      />

      <RouteFormModal
        isOpen={crud.showAddForm || crud.editingId != null}
        saving={crud.saving}
        error={crud.error}
        item={crud.editingId != null ? routes.find(r => r.id === crud.editingId) : undefined}
        onsave={d => {
          crud.setError(null);
          if (crud.editingId != null) crud.doUpdate(crud.editingId, d);
          else crud.doCreate(d);
        }}
        oncancel={crud.cancelForm}
      />

      <div className="table-wrap">
        {/* Shared filter-bar contract (card 20260922_38): the routes search
            lives in the bar's typed search slot. */}
        <ListFilterBar
          search={{ value: search, onChange: setSearch, placeholder: 'Tìm tuyến đường…', ariaLabel: 'Tìm tuyến đường' }}
        />
        <div className="table-scroll">
          <div className="record-table-wrap">
          <table className="record-table ops-table routes-table" aria-busy={isFetching}>
            <thead>
              <tr>
                {colPresence.code && <SortHeader label="Mã Tuyến" sortKey="code" sort={sort} onSortChange={handleSort} />}
                <SortHeader label="Tên tuyến" sortKey="name" sort={sort} onSortChange={handleSort} />
                {colPresence.shortName && <SortHeader label="Tên tuyến rút gọn" sortKey="shortName" sort={sort} onSortChange={handleSort} />}
                {colPresence.loadPoint && <SortHeader label="Điểm đóng/trả" sortKey="loadPoint" sort={sort} onSortChange={handleSort} />}
                {colPresence.distanceKm && <SortHeader className="num" label="Khoảng Cách (km)" sortKey="distanceKm" sort={sort} onSortChange={handleSort} />}
                {colPresence.tollsStations && <SortHeader className="num" label="Vé cầu đường" sortKey="tollsStations" sort={sort} onSortChange={handleSort} />}
                {colPresence.note && <th>Ghi chú</th>}
                <th style={{ width: 88 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={2 + Object.keys(colPresence).length} data-label="" style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>{isPending ? 'Đang tải tuyến đường…' : isError ? 'Không tải được tuyến đường.' : (
                <EmptyState variant="compact" illustration="trips" title={search ? 'Không có tuyến đường phù hợp.' : 'Chưa có dữ liệu'} />
              )}</td></tr>}
              {filtered.map((r, index) => (
                <tr key={r.id}>
                  {colPresence.code && <td data-label="Mã tuyến" data-empty={!r.code?.trim() || undefined} className="routes-table__code" style={{ color: 'var(--fg-2)' }}>{r.code || '—'}</td>}
                  <td data-label="Tên tuyến" className="routes-table__name">
                    <div className="row-strong">{r.name}</div>
                  </td>
                  {colPresence.shortName && <td data-label="Tên rút gọn" data-empty={!r.shortName?.trim() || r.shortName === r.name || undefined}>{r.shortName || '—'}</td>}
                  {colPresence.loadPoint && <td data-label="Điểm đóng trả" data-empty={!r.loadPoint?.trim() || undefined}>{r.loadPoint || '—'}</td>}
                  {colPresence.distanceKm && <td className="num routes-table__distance" data-label="Khoảng cách" data-empty={r.distanceKm == null || undefined}>{r.distanceKm != null ? `${r.distanceKm}` : '—'}</td>}
                  {colPresence.tollsStations && <td className="num" data-label="Vé cầu đường" data-empty={r.tollsStations == null || undefined}>{r.tollsStations ?? '—'}</td>}
                  {colPresence.note && <td data-label="Ghi chú" data-empty={!r.note?.trim() || undefined} className="routes-table__note" style={{ color: 'var(--fg-2)', fontSize: 'var(--text-data-size)', overflowWrap: 'anywhere' }}>{r.note || '—'}</td>}
                  <td
                    data-label=""
                    className="record-table__action"
                    data-dropdown-root={menuOpenId === r.id ? '' : undefined}
                  >
                    <div className="row-actions">
                      <button
                        className="row-action"
                        title="Tùy chọn"
                        aria-label={`Tùy chọn tuyến ${r.name}`}
                        aria-expanded={menuOpenId === r.id}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === r.id ? null : r.id); }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                    {menuOpenId === r.id && (
                      <div style={{
                        position: 'absolute', right: 12, zIndex: 20,
                        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
                        overflow: 'hidden', minWidth: 140,
                        ...(index >= filtered.length - 2 && filtered.length > 2
                          ? { bottom: '100%', marginBottom: 4 }
                          : { top: '100%', marginTop: 4 }),
                      }} onClick={(e) => e.stopPropagation()}>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                          onClick={() => { setMenuOpenId(null); crud.setError(null); crud.setEditingId(r.id); }}>
                          <Pencil size={13} /> Sửa
                        </button>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
                          disabled={crud.deleting === r.id}
                          onClick={async () => {
                            const ok = await confirm(`Xóa tuyến "${r.name}"?`, { confirmLabel: 'Xóa', variant: 'danger' });
                            if (ok) { setMenuOpenId(null); crud.doDelete(r.id); }
                          }}>
                          {crud.deleting === r.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <div className="table-foot">
          {isFetching ? <span role="status">Đang cập nhật tuyến đường…</span> : <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> tuyến đường</span>}
        </div>
      </div>
      {isError && <div className="cfg-form-error" role="alert">Không thể cập nhật danh sách tuyến đường. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void refetch()}>Thử lại</button></div>}
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}
      {confirmDialog}
    </div>
  );
}
