/**
 * Nhà thầu phụ — dispatcher read-only lookup of subcontractors.
 * Deliberately leaner than admin SupplierListPage: no payables KPIs
 * (financial is Casbin-denied for DISPATCHER), no payable-detail links,
 * no create/edit/delete — dispatchers only need contact + type + status
 * to allocate external capacity.
 */
import { useEffect, useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { KPI, StatusPill } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { useSuppliers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { SUPPLIER_TYPE_LABELS } from '@tingting/shared';
import { CatalogTableShell } from './CatalogTableShell';
import { Pagination } from '../../../design-system';
import './catalogs.css';

const PAGE_SIZE = 10;

export function SuppliersView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // Server-side pagination + search (same contract as the admin page);
  // typing resets to page 1 after a short debounce.
  useEffect(() => {
    if (search === '') {
      setPage(1);
      return;
    }
    const t = setTimeout(() => setPage(1), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: suppliersData, isLoading: loading, error } = useSuppliers(page, search);
  const suppliers = useMemo(() => suppliersData?.items ?? [], [suppliersData]);
  const total = suppliersData?.total ?? 0;
  const activeCount = useMemo(() => suppliers.filter((s) => s.status === 'ACTIVE').length, [suppliers]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div ref={rootRef}>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Nhà thầu phụ' }]} />
      <div className="page-header-block" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Nhà thầu phụ</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 14, marginTop: 4 }}>
            Tra cứu nhà thầu phụ để phân bổ năng lực vận chuyển ngoài
          </p>
        </div>
      </div>
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
          <div className="dispatch-catalogs__empty">Đang tải…</div>
        ) : !error && suppliers.length === 0 ? (
          <div className="dispatch-catalogs__empty">
            {search ? 'Không có nhà thầu phụ khớp tìm kiếm' : 'Chưa có nhà thầu phụ nào'}
          </div>
        ) : (
          <>
            <table className="dispatch-catalogs__table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Liên hệ</th>
                  <th>SĐT</th>
                  <th>Loại</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td>{s.contactPerson ?? '—'}</td>
                    <td>{s.phone ?? '—'}</td>
                    <td>
                      {(s.types ?? [])
                        .map((t) => SUPPLIER_TYPE_LABELS[t] || t)
                        .join(', ') || '—'}
                    </td>
                    <td>
                      <StatusPill variant={s.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                        {s.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng hoạt động'}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={setPage} disabled={loading} />}
          </>
        )}
      </CatalogTableShell>
    </div>
  );
}
