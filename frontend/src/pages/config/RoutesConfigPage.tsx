import { useState, useCallback, useEffect, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

  // ⌘K / Ctrl+K focuses the route search (the search shell carries the ⌘K
  // badge); the input lives inside the shared ListFilterBar, so focus via
  // the page root query.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        pageRef.current?.querySelector<HTMLInputElement>('.filter-bar__search input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageRef]);

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

  // Chief spec 20260926_53: MÃ TUYẾN / TÊN TUYẾN RÚT GỌN / KHOẢNG CÁCH are
  // mandatory columns — they always render, with a muted dash for missing
  // data. Card 20260922_22's presence auto-hide survives only for the
  // beyond-spec columns (Điểm đóng/trả, Vé cầu đường, Ghi chú).
  const colPresence = useMemo(() => {
    const present: Record<string, boolean> = {};
    for (const r of filtered) {
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
        title={<>Tuyến đường <span className="routes-title-count">({totalCount})</span></>}
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
          search={{ value: search, onChange: setSearch, placeholder: 'Tìm mã, tên tuyến…', ariaLabel: 'Tìm tuyến đường', shortcut: '⌘K' }}
        />
        <div className="table-scroll">
          <div className="record-table-wrap">
          <table className="record-table ops-table routes-table" aria-busy={isFetching}>
            <thead>
              <tr>
                <SortHeader className="routes-table__code" label="Mã Tuyến" sortKey="code" sort={sort} onSortChange={handleSort} />
                <SortHeader className="routes-table__name" label="Tên tuyến" sortKey="name" sort={sort} onSortChange={handleSort} />
                <SortHeader className="routes-table__short" label="Tên tuyến rút gọn" sortKey="shortName" sort={sort} onSortChange={handleSort} />
                {colPresence.loadPoint && <SortHeader label="Điểm đóng/trả" sortKey="loadPoint" sort={sort} onSortChange={handleSort} />}
                <SortHeader className="num routes-table__distance" label="Khoảng cách" sortKey="distanceKm" sort={sort} onSortChange={handleSort} />
                {colPresence.tollsStations && <SortHeader className="num" label="Vé cầu đường" sortKey="tollsStations" sort={sort} onSortChange={handleSort} />}
                {colPresence.note && <th>Ghi chú</th>}
                <th className="routes-table__actions"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={2 + Object.keys(colPresence).length} data-label="" style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>{isPending ? 'Đang tải tuyến đường…' : isError ? 'Không tải được tuyến đường.' : (
                <EmptyState variant="compact" illustration="trips" title={search ? 'Không có tuyến đường phù hợp.' : 'Chưa có dữ liệu'} />
              )}</td></tr>}
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Mã tuyến" data-empty={!r.code?.trim() || undefined} className="routes-table__code">{r.code || '—'}</td>
                  <td data-label="Tên tuyến" className="routes-table__name">
                    <div className="row-strong" title={r.name}>{r.name}</div>
                  </td>
                  <td data-label="Tên rút gọn" data-empty={!r.shortName?.trim() || r.shortName === r.name || undefined}>{r.shortName || '—'}</td>
                  {colPresence.loadPoint && <td data-label="Điểm đóng trả" data-empty={!r.loadPoint?.trim() || undefined}>{r.loadPoint || '—'}</td>}
                  <td className="num routes-table__distance" data-label="Khoảng cách" data-empty={r.distanceKm == null || undefined}>{r.distanceKm != null ? `${r.distanceKm} km` : '—'}</td>
                  {colPresence.tollsStations && <td className="num" data-label="Vé cầu đường" data-empty={r.tollsStations == null || undefined}>{r.tollsStations ?? '—'}</td>}
                  {colPresence.note && <td data-label="Ghi chú" data-empty={!r.note?.trim() || undefined} className="routes-table__note" style={{ color: 'var(--fg-2)', fontSize: 'var(--text-data-size)', overflowWrap: 'anywhere' }}>{r.note || '—'}</td>}
                  <td
                    data-label=""
                    className="record-table__action routes-table__actions-cell"
                  >
                    <div className="row-actions">
                      <button
                        className="row-action"
                        title="Sửa tuyến"
                        aria-label={`Sửa tuyến ${r.name}`}
                        onClick={() => { crud.setError(null); crud.setEditingId(r.id); }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="row-action row-action--danger"
                        title="Xoá tuyến"
                        aria-label={`Xoá tuyến ${r.name}`}
                        disabled={crud.deleting === r.id}
                        onClick={async () => {
                          const ok = await confirm(`Xóa tuyến "${r.name}"?`, { confirmLabel: 'Xóa', variant: 'danger' });
                          if (ok) crud.doDelete(r.id);
                        }}
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
          {isFetching ? <span role="status">Đang cập nhật tuyến đường…</span> : <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> tuyến đường</span>}
        </div>
      </div>
      {isError && <div className="cfg-form-error" role="alert">Không thể cập nhật danh sách tuyến đường. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void refetch()}>Thử lại</button></div>}
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}
      {confirmDialog}
    </div>
  );
}
