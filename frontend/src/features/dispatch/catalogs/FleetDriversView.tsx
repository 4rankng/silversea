/**
 * Danh mục Tài xế — dispatcher CRUD for internal drivers. Dispatchers may
 * add and edit drivers; there is no delete (spec §4.2 — the drivers router
 * answers 405 "Không hỗ trợ xóa"), so the table offers no Xóa button.
 * Salary/social-insurance fields are stripped by the backend for DISPATCHER
 * to keep mutations direct.
 */
import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Plus } from '@untitledui/icons';
import { KPI } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { SkeletonTable } from '../../../components/shared/Skeleton';
import { SortHeader } from '../../../components/shared/SortHeader';
import { Button } from '../../../components/untitled-ui/base/buttons/button';
import { useTrucksAndDrivers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { nextTableSort, sortClientSide, type TableSortState } from '../../../lib/table-sort';
import { DriverFormModal } from '../../fleet/DriverFormModal';
import { CatalogTableShell } from './CatalogTableShell';
import { useCatalogCreate } from './useCatalogCreate';
import './catalogs.css';



export function FleetDriversView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const { data: fleetData, isLoading: loading, error } = useTrucksAndDrivers();
  const crud = useCatalogCreate('/drivers');

  const drivers = useMemo(() => fleetData?.drivers ?? [], [fleetData?.drivers]);
  const trucks = useMemo(() => fleetData?.trucks ?? [], [fleetData?.trucks]);

  const { plateByTruck } = useMemo(() => {
    const plateByTruck = new Map(trucks.map((t) => [t.id, t.licensePlate]));
    return { plateByTruck };
  }, [trucks]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(needle) ||
        (d.code ?? '').toLowerCase().includes(needle) ||
        (d.phone ?? '').toLowerCase().includes(needle) ||
        (d.assignedTruckId ? plateByTruck.get(d.assignedTruckId) ?? '' : '').toLowerCase().includes(needle),
    );
  }, [drivers, needle, plateByTruck]);

  const rows = useMemo(
    () => sortClientSide(filtered, sort, {
      code: (d) => d.code,
      name: (d) => d.name,
      idNumber: (d) => d.idNumber,
      licenseNumber: (d) => d.licenseNumber,
      licenseExpiryDate: (d) => d.licenseExpiryDate,
      phone: (d) => d.phone,
      bankName: (d) => d.bankName,
      bankAccount: (d) => d.bankAccount,
      salaryType: (d) => d.salaryType,
    }, (a, b) => a.id - b.id),
    [filtered, sort],
  );
  const applySort = (key: string) => setSort((current) => nextTableSort(current, key));

  return (
    <div ref={rootRef}>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Danh mục Tài xế' }]} />
      <div className="page-header-block dispatch-catalogs__page-header" style={{ marginBottom: 16 }}>
        <div className="dispatch-catalogs__page-heading">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Danh mục Tài xế</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 14, marginTop: 4 }}>
            Tra cứu tài xế nội bộ để gán chuyến trong kế hoạch điều độ
          </p>
        </div>
        <Button size="sm" color="primary" iconLeading={Plus} onPress={crud.showForm}>
          Thêm tài xế
        </Button>
      </div>
      {crud.error && <div className="dispatch-catalogs__error">{crud.error}</div>}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Tổng tài xế" value={drivers.length} unit="người" icon={Users} />
      </div>
      {error && <div className="dispatch-catalogs__error">Không thể tải dữ liệu</div>}
      <CatalogTableShell
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm mã, tên, SĐT hoặc biển số xe…"
        totalLabel={`${filtered.length}/${drivers.length} tài xế`}
      >
        {loading ? (
          <div role="status">
            <SkeletonTable rows={6} cols={9} />
            <span className="sr-only">Đang tải…</span>
          </div>
        ) : !error && filtered.length === 0 ? (
          <div className="dispatch-catalogs__empty">
            {needle ? 'Không có tài xế khớp tìm kiếm' : 'Chưa có tài xế nào'}
          </div>
        ) : (
          <table className="dispatch-catalogs__table">
            <thead>
              <tr>
                <SortHeader label="Mã tài xế" sortKey="code" sort={sort} onSortChange={applySort} />
                <SortHeader label="Họ tên" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Số CCCD" sortKey="idNumber" sort={sort} onSortChange={applySort} />
                <SortHeader label="GPLX" sortKey="licenseNumber" sort={sort} onSortChange={applySort} />
                <SortHeader label="Hạn bằng lái" sortKey="licenseExpiryDate" sort={sort} onSortChange={applySort} />
                <SortHeader label="Số điện thoại" sortKey="phone" sort={sort} onSortChange={applySort} />
                <SortHeader label="Ngân hàng nhận tiền" sortKey="bankName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Số TK nhận tiền" sortKey="bankAccount" sort={sort} onSortChange={applySort} />
                <SortHeader label="Hình thức lương" sortKey="salaryType" sort={sort} onSortChange={applySort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr
                  key={d.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => crud.showEdit(d.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); crud.showEdit(d.id); } }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Chỉnh sửa tài xế ${d.name}`}
                >
                  <td data-label="Mã tài xế" style={{ fontWeight: 600 }}>{d.code ?? '—'}</td>
                  <td data-label="Họ tên">{d.name}</td>
                  <td data-label="Số CCCD">{d.idNumber ?? '—'}</td>
                  <td data-label="GPLX">{d.licenseNumber ?? '—'}</td>
                  <td data-label="Hạn bằng lái">{d.licenseExpiryDate ?? '—'}</td>
                  <td data-label="Số điện thoại">{d.phone ?? '—'}</td>
                  <td data-label="Ngân hàng nhận tiền">{d.bankName ?? '—'}</td>
                  <td data-label="Số TK nhận tiền">{d.bankAccount ?? '—'}</td>
                  <td data-label="Hình thức lương">{d.salaryType ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CatalogTableShell>
      <DriverFormModal
        isOpen={crud.open}
        saving={crud.saving}
        item={crud.editingId != null ? drivers.find((d) => d.id === crud.editingId) : undefined}
        onsave={(d) => crud.editingId != null ? crud.update(crud.editingId, d) : crud.create(d)}
        oncancel={crud.closeForm}
      />
    </div>
  );
}
