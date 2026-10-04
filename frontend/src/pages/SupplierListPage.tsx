import { useState, useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, Plus, Download,
  MoreHorizontal, Pencil, Trash2, Loader2,
} from 'lucide-react';
import { Truck as TruckIcon } from 'lucide-react';
import { useConfirm } from '../components/UI';
import { SupplierCarrierTrucksSection } from '../features/suppliers/SupplierCarrierTrucksSection';
import { api } from '../lib/api';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { PageHeader, KPI, StatusPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { useDropdownDismiss } from '../hooks/useDropdownDismiss';
import { EmptyState, FilterBar, Pagination, useTableQueryState } from '../design-system';
import { SupplierType, CONFIG, type Supplier } from '@tingting/shared';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import { usePayablesSummary } from '../hooks/useFinancialQueries';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Money } from '../components/shared/Money';
import { StatusStrip, StatusDot } from '../components/shared/StatusStrip';
import { usePageAnimations } from '../hooks/animations';
import '../styles/operational-table-typography.css';
import '../styles/record-table.css';
import './SupplierListPage.css';

type FilterKey = 'all' | 'active' | 'inactive';

/** Sort keys mirror the backend /suppliers sortBy whitelist (server-side sort). */
type SupplierTableFilters = {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

/** Numeric header cells right-align to match the .num body cells. Every other
 * header property (padding, background, case, tracking, sticky pinning) is the
 * shared record-table base. */
const thMoneyStyle: CSSProperties = { textAlign: 'right' };

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Hoạt động',
  INACTIVE: 'Ngừng hoạt động',
};

import { SupplierFormModal } from '../features/suppliers/SupplierFormModal';


export default function SupplierListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  // Card 20260926_58 (CHIEF): status pills count the WHOLE dataset, never
  // the loaded pagination chunk ('TRANG NÀY' anti-pattern).
  const statusCountsQuery = useQuery({
    queryKey: qk.suppliersStatusCounts,
    queryFn: () => api.get<{ all: number; active: number; inactive: number; vehicles: Record<string, number> }>('/suppliers/status-counts'),
  });
  const vehicleCounts = statusCountsQuery.data?.vehicles ?? {};
  const [typeFilter, setTypeFilter] = useState<'all' | 'carrier' | 'other'>('all');

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  // Card 20260926_2: expanded carrier row showing its 'Xe của nhà thầu' section.
  const [trucksOpenId, setTrucksOpenId] = useState<number | null>(null);
  // Row kebab menus join the global click-away / Escape dismissal layer.
  useDropdownDismiss(menuOpenId !== null, () => setMenuOpenId(null));

  const { confirm, dialog: confirmDialog } = useConfirm();

  // Card (freeze-halting small, lead 2026-10-03): the sort pair in the URL
  // seeds the filters bag on mount — a ?sortBy=&sortDir= deep link is
  // honored by the first server fetch instead of being ignored until a
  // header press. Invalid/absent values drop out via readTableSort.
  const urlSortSeed = (() => {
    const p = new URLSearchParams(window.location.search);
    const by = p.get('sortBy');
    if (!by) return {};
    return { sortBy: by, sortDir: p.get('sortDir') === 'desc' ? 'desc' : 'asc' } as Partial<SupplierTableFilters>;
  })();

  const table = useTableQueryState<Supplier, SupplierTableFilters>({
    endpoint: (params) => configClient.getSuppliers(
      params.page ?? 1,
      params.search ?? '',
      readTableSort(params.sortBy, params.sortDir),
    ),
    initialFilters: urlSortSeed,
    queryKey: qk.catalogs.suppliersTable,
    defaultPageSize: 10,
    debounceMs: 300,
  });
  const { page, setPage, pageSize, search, setSearch, rows: suppliers, total, isLoading: loading, error: queryError, setFilter: setSortFilter } = table;
  const refetchSuppliers = table.query.refetch;
  const { rootRef } = usePageAnimations({ ready: !loading });

  // Server-side sorting: the sort pair rides the filters bag so setFilter's
  // built-in page reset applies (page 1 whenever the sort changes).
  const sort = readTableSort(table.filters.sortBy, table.filters.sortDir);
  const applySort = (key: string) => {
    const next = nextTableSort(sort, key);
    setSortFilter('sortBy', next.by);
    setSortFilter('sortDir', next.dir);
  };

  // AP outstanding per supplier — fetched once from the payables summary.
  // Each PayableSummary item exposes a nested `supplier.id` + `totalOutstanding`.
  const { data: payablesData } = usePayablesSummary();
  const payableBySupplier = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of payablesData?.items ?? []) {
      map.set(item.supplier.id, item.totalOutstanding);
    }
    return map;
  }, [payablesData]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const error = queryError ? 'Không thể tải dữ liệu' : mutationError;

  const { activeCount, inactiveCount, filtered } = useMemo(() => {
    const activeCount = statusCountsQuery.data?.active ?? suppliers.filter(s => s.status === 'ACTIVE').length;
    const inactiveCount = statusCountsQuery.data?.inactive ?? suppliers.filter(s => s.status !== 'ACTIVE').length;
    const filtered = suppliers.filter(s => {
      if (typeFilter === 'carrier' && !s.types?.includes(SupplierType.CARRIER)) return false;
      if (typeFilter === 'other' && s.types?.includes(SupplierType.CARRIER)) return false;
      if (filter === 'active') return s.status === 'ACTIVE';
      if (filter === 'inactive') return s.status !== 'ACTIVE';
      return true;
    });
    return { activeCount, inactiveCount, filtered };
  }, [suppliers, filter, typeFilter, statusCountsQuery.data]);
  // Directory KPIs share the status-count population; table total is scoped
  // to the current search and remains the pagination/result count.
  const directoryCounts = statusCountsQuery.data;
  const directoryCountHint = statusCountsQuery.isError ? 'Không thể tải số liệu' : 'Đang tải số liệu';

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function doCreate(body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.post(CONFIG.SUPPLIERS, body);
      setShowAddForm(false);
      await refetchSuppliers();
    } catch (e: unknown) { setMutationError(e instanceof Error ? e.message : 'Lỗi lưu'); } finally { setSaving(false); }
  }

  async function doUpdate(id: number, body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.put(CONFIG.SUPPLIER(id), body);
      setEditingId(null);
      setMenuOpenId(null);
      await refetchSuppliers();
    } catch (e: unknown) { setMutationError(e instanceof Error ? e.message : 'Lỗi cập nhật'); } finally { setSaving(false); }
  }

  async function doDelete(id: number) {
    if (!await confirm('Bạn có chắc chắn muốn xóa?', { variant: 'danger' })) return;
    setDeleting(id);
    try {
      await api.delete(CONFIG.SUPPLIER(id));
      setMenuOpenId(null);
      await refetchSuppliers();
    } catch (e: unknown) { setMutationError(e instanceof Error ? e.message : 'Lỗi xóa'); } finally { setDeleting(null); }
  }

  return (
    <div ref={rootRef} className="suppliers-page">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>

      <Breadcrumbs
        className="suppliers-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Nhà cung cấp' },
        ]}
      />
      <PageHeader
        title="Nhà cung cấp"
        iconName="supplier"
        description={`${total} nhà cung cấp đang quản lý`}
        action={
          <>
            <button className="btn btn--secondary" onClick={async () => {
              const headers = ['Tên NCC', 'Người liên hệ', 'Điện thoại', 'MST', 'Là nhà CC nhiên liệu', 'Trạng thái'];
              const rows = filtered.map(s => [
                s.name,
                s.contactPerson || '',
                s.phone || '',
                s.taxCode || '',
                s.isFuelSupplier ? 'Có' : 'Không',
                STATUS_LABELS[s.status] || s.status,
              ]);
              await downloadCSV(`nha-cung-cap-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
                title: 'DANH SÁCH NHÀ CUNG CẤP',
                subtitle: `${filtered.length} nhà cung cấp đang quản lý`,
                columnTypes: ['text', 'text', 'text', 'text', 'text', 'text'],
                hideTotals: true,
              });
            }}>
              <Download size={14} /> Xuất Excel
            </button>
            <button className="btn btn--primary" onClick={() => { setShowAddForm(true); setEditingId(null); }}>
              <Plus size={14} /> Thêm nhà cung cấp
            </button>
          </>
        }
      />

      <div className="kpi-grid">
        <KPI
          label="Tổng nhà cung cấp"
          value={directoryCounts?.all ?? '—'}
          icon={Users}
          assetIconName="supplier"
          meta={directoryCounts ? <span>{directoryCounts.all} nhà cung cấp</span> : directoryCountHint}
        />
        <KPI
          label="Đang hoạt động"
          value={directoryCounts?.active ?? '—'}
          unit={directoryCounts ? `/ ${directoryCounts.all}` : undefined}
          variant="success"
          icon={UserCheck}
          assetIconName="active-supplier"
          meta={directoryCounts ? `${directoryCounts.active}/${directoryCounts.all} đang hoạt động` : directoryCountHint}
        />
      </div>

      {/* The strip IS the shared `FilterBar` (card 20260927_152): the page
          declares no bar markup, no search shell and no spacer — the component
          owns `.filter-bar`, its search cell and its pinning. The six toggles
          narrow the same list (they are quick filters, not secondary criteria),
          so they ride `quickFilters` with the shared chip shape. */}
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Tên nhà thầu, MST, người liên hệ, SĐT…',
          ariaLabel: 'Tìm nhà cung cấp theo tên',
          inputProps: { name: 'supplierSearch' },
        }}
        quickFiltersLabel="Lọc nhà cung cấp"
        quickFilters={(
          <>
            <button type="button" aria-pressed={filter === 'all'} className={`filter-chip${filter === 'all' ? ' is-active' : ''}`} onClick={() => setFilter('all')}>Tất cả · {statusCountsQuery.data?.all ?? total}</button>
            <button type="button" aria-pressed={filter === 'active'} className={`filter-chip${filter === 'active' ? ' is-active' : ''}`} onClick={() => setFilter('active')}>
              <StatusDot status="ACTIVE" style={{ marginRight: 4 }} />
              Hoạt động · {activeCount}
            </button>
            <button type="button" aria-pressed={filter === 'inactive'} className={`filter-chip${filter === 'inactive' ? ' is-active' : ''}`} onClick={() => setFilter('inactive')}>
              <StatusDot status="INACTIVE" style={{ marginRight: 4 }} />
              Ngừng HĐ · {inactiveCount}
            </button>
            <button type="button" aria-pressed={typeFilter === 'all'} className={`filter-chip${typeFilter === 'all' ? ' is-active' : ''}`} onClick={() => setTypeFilter('all')}>Mọi loại</button>
            <button type="button" aria-pressed={typeFilter === 'carrier'} className={`filter-chip${typeFilter === 'carrier' ? ' is-active' : ''}`} onClick={() => setTypeFilter('carrier')}>Nhà xe</button>
            <button type="button" aria-pressed={typeFilter === 'other'} className={`filter-chip${typeFilter === 'other' ? ' is-active' : ''}`} onClick={() => setTypeFilter('other')}>Nhà cung cấp khác</button>
          </>
        )}
      />

      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>Đang tải…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              context="clients"
              title="Chưa có nhà cung cấp"
              description="Thêm nhà cung cấp đầu tiên để bắt đầu quản lý chi phí."
              action={<button className="btn btn--primary" onClick={() => { setShowAddForm(true); setEditingId(null); }}><Plus size={14} /> Thêm nhà cung cấp</button>}
            />
          ) : (
            filtered.map(s => (
              <ClickableCard key={s.id} className="m-card" style={{ position: 'relative' }} onClick={() => navigate(`/suppliers/${s.id}`)}>
                <StatusStrip status={s.status} />
                <div className="m-card__top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-card__title">{s.shortName || s.name}</span>
                    {s.isFuelSupplier && (
                      <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 700, color: 'var(--brand, #10B981)', background: 'var(--brand-soft, #E6FBF3)', border: '1px solid var(--brand-border, #A7F3D0)', borderRadius: 4, padding: '1px 5px' }}>
                        Nhiên liệu
                      </span>
                    )}
                  </div>
                  <StatusPill variant={s.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {STATUS_LABELS[s.status] || s.status}
                  </StatusPill>
                </div>
                {s.contactPerson && (
                  <div className="m-card__meta">
                    {s.contactPerson}
                    {s.phone && <><span className="m-card__meta-sep">·</span><span className="data-token">{s.phone}</span></>}
                  </div>
                )}
                <div className="m-card__meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>Công nợ</span>
                  <Money value={payableBySupplier.get(s.id) ?? 0} />
                </div>
                {s.linkedCustomerId != null && (
                  <div className="m-card__meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>Xe đang gán</span>
                    <span style={{ fontFamily: 'var(--font-data)' }}>{vehicleCounts[String(s.linkedCustomerId)] ?? 0}</span>
                  </div>
                )}
                {s.taxCode && (
                  <div className="m-card__meta" style={{ fontFamily: 'var(--font-data)' }}>
                    MST <span className="data-token">{s.taxCode}</span>
                  </div>
                )}
                <div className="m-card-edit-row">
                  {s.types?.includes(SupplierType.CARRIER) && (
                    <button className="btn btn--ghost btn--sm" aria-expanded={trucksOpenId === s.id} onClick={(e) => { e.stopPropagation(); setTrucksOpenId(trucksOpenId === s.id ? null : s.id); }}>
                      Xe của nhà thầu
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setEditingId(s.id); setShowAddForm(false); }}>
                    Sửa
                  </button>
                </div>
                {trucksOpenId === s.id && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <SupplierCarrierTrucksSection supplierName={s.name} carrierId={s.linkedCustomerId ?? null} />
                  </div>
                )}
              </ClickableCard>
            ))
          )}
        </div>
        <div className="table-foot">
          <span>Hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> nhà cung cấp</span>
        </div>
      </div>

      <div className="desktop-only table-wrap suppliers-page__workspace">
        <div className="record-table-wrap suppliers-page__grid-wrapper">
          <table className="record-table ops-table suppliers-page__grid" style={{ tableLayout: 'fixed' }}>
            {/* Card 20261004_335: the action column budgets the worst-case
                row-action run (2 × coarse 40px square + 6px gap = 86px + 24px
                cell padding → 112px, card-324 idiom). The data shares sum to
                89% so 89% × 1100px + 112px fits the table-mode floor — the
                shared record-table card band starts below 1100px — and the
                frozen column can never be squeezed below its budget. The
                grant is funded from the wrap-yield name / Mã NCC / contact
                columns; the tax-code, phone and money token columns keep
                their widths (styles test: action-column-width-budget). */}
            <colgroup>
              <col style={{ width: '21%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: 112 }} />
            </colgroup>
            <thead>
              <tr>
                <SortHeader label="Tên nhà cung cấp" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Tên viết tắt" sortKey="shortName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã NCC" sortKey="shortName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã số thuế" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                <SortHeader label="Người liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                <SortHeader label="SĐT" sortKey="phone" sort={sort} onSortChange={applySort} />
                <SortHeader label="Công nợ" sortKey="payable" sort={sort} onSortChange={applySort} style={thMoneyStyle} />
                <th style={{ width: 112 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 'var(--text-data-size)' }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={8} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchSuppliers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <EmptyState variant="compact" context="clients" title="Chưa có dữ liệu" />
                </td></tr>
              )}
              {filtered.map((s, index) => [
                  <tr key={s.id} role="button" tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/suppliers/${s.id}`)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/suppliers/${s.id}`); } }}
                  >
                    <td className="suppliers-page__cell suppliers-page__cell--name" data-label="Tên nhà cung cấp" style={{ position: 'relative' }}>
                      <StatusStrip status={s.status} />
                      <span style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
                        {s.name}
                      </span>
                    </td>
                    <td className="suppliers-page__cell" data-label="Tên viết tắt">
                      {s.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell" data-label="Mã NCC">
                      {s.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data" data-label="Mã số thuế">
                      <span className="data-token">{s.taxCode || <span style={{ color: 'var(--ink-3)' }}>—</span>}</span>
                    </td>
                    <td className="suppliers-page__cell" data-label="Người liên hệ">
                      {s.contactPerson || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data" data-label="SĐT">
                      <span className="data-token">{s.phone || <span style={{ color: 'var(--ink-3)' }}>—</span>}</span>
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data suppliers-page__cell--money num" data-label="Công nợ">
                      <Money value={payableBySupplier.get(s.id) ?? 0} />
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--actions record-table__action" data-label="" data-dropdown-root={menuOpenId === s.id ? '' : undefined} style={{ position: 'relative' }}>
                      <div className="row-actions">
                        {s.types?.includes(SupplierType.CARRIER) && (
                          <button type="button" className="row-action" aria-label={`Xe của nhà thầu ${s.name}`} aria-expanded={trucksOpenId === s.id}
                            onClick={(e) => { e.stopPropagation(); setTrucksOpenId(trucksOpenId === s.id ? null : s.id); }}>
                            <TruckIcon size={14} />
                          </button>
                        )}
                        <button type="button" className="row-action" aria-label={`Tùy chọn nhà cung cấp ${s.name}`} aria-expanded={menuOpenId === s.id} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === s.id ? null : s.id); }}>
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                      {menuOpenId === s.id && (
                        <div style={{
                          position: 'absolute', right: 12, zIndex: 20,
                          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
                          overflow: 'hidden', minWidth: 140,
                          ...(index >= filtered.length - 2 && filtered.length > 2
                            ? { bottom: '100%', marginBottom: 4 }
                            : { top: '100%' }),
                        }} onClick={(e) => e.stopPropagation()}>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 'var(--text-data-size)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                            onClick={() => { setEditingId(s.id); setShowAddForm(false); }}>
                            <Pencil size={13} /> Sửa
                          </button>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 'var(--text-data-size)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
                            disabled={deleting === s.id}
                            onClick={() => doDelete(s.id)}>
                            {deleting === s.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>,
                  trucksOpenId === s.id && (
                    <tr key={`${s.id}-trucks`} className="supplier-carrier-trucks-row">
                      <td colSpan={8}>
                        <SupplierCarrierTrucksSection supplierName={s.name} carrierId={s.linkedCustomerId ?? null} />
                      </td>
                    </tr>
                  ),
              ])}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={pageSize} onChange={setPage} />
      </div>

      <SupplierFormModal
        isOpen={showAddForm || editingId != null}
        saving={saving}
        item={editingId != null ? suppliers.find(s => s.id === editingId) : undefined}
        onsave={d => {
          if (editingId != null) doUpdate(editingId, d);
          else doCreate(d);
        }}
        oncancel={() => { setEditingId(null); setShowAddForm(false); }}
      />
    {confirmDialog}
    </div>
  );
}
