/**
 * Nhà thầu — dispatcher CRUD for subcontractors. Deliberately leaner than
 * admin SupplierListPage: no payables KPIs (financial is Casbin-denied for
 * DISPATCHER), no payable-detail links. Dispatchers may add, edit, and
 * delete subcontractors.
 */
import { useEffect, useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { Plus } from '@untitledui/icons';
import { KPI } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { SkeletonTable } from '../../../components/shared/Skeleton';
import { SortHeader } from '../../../components/shared/SortHeader';
import { BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { Button } from '../../../components/untitled-ui/base/buttons/button';
import { useSuppliers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { SUPPLIER_TYPE_LABELS } from '@tingting/shared';
import { nextTableSort, type TableSortState } from '../../../lib/table-sort';
import { SupplierFormModal } from '../../../pages/SupplierListPage';
import { CatalogTableShell } from './CatalogTableShell';
import { Pagination } from '../../../design-system';
import { useCatalogCreate } from './useCatalogCreate';
import { useConfirm } from '../../../components/UI';
import './catalogs.css';

const PAGE_SIZE = 10;

export function SuppliersView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const crud = useCatalogCreate('/suppliers');
  const { confirm, dialog } = useConfirm();

  // Server-side pagination + search + sort (same contract as the admin page);
  // typing resets to page 1 after a short debounce, sorting resets immediately.
  useEffect(() => {
    if (search === '') {
      setPage(1);
      return;
    }
    const t = setTimeout(() => setPage(1), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: suppliersData, isLoading: loading, error } = useSuppliers(page, search, sort);
  const applySort = (key: string) => {
    setPage(1);
    setSort((current) => nextTableSort(current, key));
  };
  const suppliers = useMemo(() => suppliersData?.items ?? [], [suppliersData]);
  const total = suppliersData?.total ?? 0;
  const activeCount = useMemo(() => suppliers.filter((s) => s.status === 'ACTIVE').length, [suppliers]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div ref={rootRef}>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Nhà thầu' }]} />
      <div className="page-header-block dispatch-catalogs__page-header" style={{ marginBottom: 16 }}>
        <div className="dispatch-catalogs__page-heading">
          <h1 style={{ fontSize: 'var(--text-title-size)', fontWeight: 700 }}>Nhà thầu</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', marginTop: 4 }}>
            Tra cứu nhà thầu phụ để phân bổ năng lực vận chuyển ngoài
          </p>
        </div>
        <Button size="sm" color="primary" iconLeading={Plus} onPress={crud.showForm}>
          Thêm nhà thầu phụ
        </Button>
      </div>
      {crud.error && <div className="dispatch-catalogs__error">{crud.error}</div>}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Tổng (toàn bộ trang)" value={total} unit="NCC" icon={Store} />
        <KPI label="Đang hoạt động (trang này)" value={activeCount} unit="NCC" icon={Store} variant="success" />
      </div>
      {error && <div className="dispatch-catalogs__error">Không thể tải dữ liệu</div>}
      <CatalogTableShell
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm tên nhà thầu phụ…"
        totalLabel={total > 0 ? `${total} nhà thầu phụ` : ''}
      >
        {loading ? (
          <div role="status">
            <SkeletonTable rows={6} cols={5} />
            <span className="sr-only">Đang tải…</span>
          </div>
        ) : !error && suppliers.length === 0 ? (
          <div className="dispatch-catalogs__empty">
            {search ? 'Không có nhà thầu phụ khớp tìm kiếm' : 'Chưa có nhà thầu phụ nào'}
          </div>
        ) : (
          <>
            <table className="dispatch-catalogs__table">
              <thead>
                <tr>
                  <SortHeader label="Tên" sortKey="name" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                  <SortHeader label="SĐT" sortKey="phone" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Loại" sortKey="types" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Trạng thái" sortKey="status" sort={sort} onSortChange={applySort} />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr
                    key={s.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => crud.showEdit(s.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); crud.showEdit(s.id); } }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Chỉnh sửa nhà thầu ${s.shortName || s.name}`}
                  >
                    <td data-label="Tên" style={{ fontWeight: 600 }}>{s.shortName || s.name}</td>
                    <td data-label="Liên hệ">{s.contactPerson ?? '—'}</td>
                    <td data-label="SĐT">{s.phone ?? '—'}</td>
                    <td data-label="Loại">
                      {(s.types ?? [])
                        .map((t) => SUPPLIER_TYPE_LABELS[t] || t)
                        .join(', ') || '—'}
                    </td>
                    <td data-label="Trạng thái">
                      <BadgeWithDot size="sm" color={s.status === 'ACTIVE' ? 'success' : 'gray'}>
                        {s.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng hoạt động'}
                      </BadgeWithDot>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn--danger-outline btn--sm"
                        onClick={async () => {
                          const ok = await confirm(`Xóa nhà thầu ${s.shortName || s.name}?`, { variant: 'danger', confirmLabel: 'Xóa' });
                          if (ok) await crud.remove(s.id);
                        }}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={setPage} disabled={loading} />}
          </>
        )}
      </CatalogTableShell>
      <SupplierFormModal
        isOpen={crud.open}
        saving={crud.saving}
        item={crud.editingId != null ? suppliers.find((s) => s.id === crud.editingId) : undefined}
        onsave={(d) => crud.editingId != null ? crud.update(crud.editingId, d) : crud.create(d)}
        oncancel={crud.closeForm}
      />
      {dialog}
    </div>
  );
}
