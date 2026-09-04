/**
 * Nhà thầu phụ — dispatcher lookup of subcontractors. Deliberately leaner
 * than admin SupplierListPage: no payables KPIs (financial is Casbin-denied
 * for DISPATCHER), no payable-detail links. Dispatchers may add new
 * subcontractors (createRoles allowance); edit/delete stay with admin.
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
import { useSuppliers, useAllCustomers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { SUPPLIER_TYPE_LABELS } from '@tingting/shared';
import { nextTableSort, type TableSortState } from '../../../lib/table-sort';
import { SupplierFormModal } from '../../../pages/SupplierListPage';
import { CatalogTableShell } from './CatalogTableShell';
import { Pagination } from '../../../design-system';
import { useCatalogCreate } from './useCatalogCreate';
import './catalogs.css';

const PAGE_SIZE = 10;

export function SuppliersView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const create = useCatalogCreate('/suppliers');
  const { data: customers = [] } = useAllCustomers();

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
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Nhà thầu phụ' }]} />
      <div className="page-header-block dispatch-catalogs__page-header" style={{ marginBottom: 16 }}>
        <div className="dispatch-catalogs__page-heading">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Nhà thầu phụ</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 14, marginTop: 4 }}>
            Tra cứu nhà thầu phụ để phân bổ năng lực vận chuyển ngoài
          </p>
        </div>
        <Button size="sm" color="primary" iconLeading={Plus} onPress={create.showForm}>
          Thêm nhà thầu phụ
        </Button>
      </div>
      {create.error && <div className="dispatch-catalogs__error">{create.error}</div>}
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
                  <tr key={s.id}>
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
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={setPage} disabled={loading} />}
          </>
        )}
      </CatalogTableShell>
      <SupplierFormModal
        isOpen={create.open}
        saving={create.saving}
        onsave={create.create}
        oncancel={create.closeForm}
      />
    </div>
  );
}
