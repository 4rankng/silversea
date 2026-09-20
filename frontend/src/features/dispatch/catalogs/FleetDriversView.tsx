/**
 * Danh mục Tài xế — dispatcher CRUD for internal drivers. Dispatchers may
 * add and edit drivers; there is no delete (spec §4.2 — the drivers router
 * answers 405 "Không hỗ trợ xóa"), so the table offers no Xóa button.
 * Salary/social-insurance fields are stripped by the backend for DISPATCHER
 * to keep mutations direct.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Users } from 'lucide-react';
import { Plus } from '@untitledui/icons';
import { KPI } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { SkeletonTable } from '../../../components/shared/Skeleton';
import { SortHeader } from '../../../components/shared/SortHeader';
import { Button } from '../../../components/untitled-ui/base/buttons/button';
import { useTrucksAndDrivers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { nextTableSort, sortClientSide, type TableSortState } from '../../../lib/table-sort';
import { formatISODate, businessDateISO } from '../../../lib/format';
import { DriverFormModal } from '../../fleet/DriverFormModal';
import { CatalogTableShell } from './CatalogTableShell';
import { matchesCatalogSearch } from './catalog-search';
import { useCatalogCreate } from './useCatalogCreate';
import './catalogs.css';

// License-expiry risk states (card _44): a driver's license is the compliance
// field that gates whether they may drive at all. Overdue reads in oxblood
// with an icon and day-count label; ≤30 days reads in the lighter bronze;
// longer or missing dates stay neutral so the table carries no extra color.
export const LICENSE_SOON_WINDOW_DAYS = 30;

export function licenseExpiryState(
  licenseExpiryDate: string,
  todayIso: string,
): { level: 'overdue' | 'soon'; days: number } | null {
  const parse = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const days = Math.round((parse(licenseExpiryDate) - parse(todayIso)) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { level: 'overdue', days: Math.abs(days) };
  if (days <= LICENSE_SOON_WINDOW_DAYS) return { level: 'soon', days };
  return null;
}



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
  const todayIso = businessDateISO();
  const filtered = useMemo(() => {
    if (!needle) return drivers;
    return drivers.filter((driver) => {
      const plate = driver.assignedTruckId ? plateByTruck.get(driver.assignedTruckId) : undefined;
      return matchesCatalogSearch(needle, [driver.name, driver.code, driver.phone, plate], [driver.code, driver.phone, plate]);
    });
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
          <h1 style={{ fontSize: 'var(--text-title-size)', fontWeight: 700 }}>Danh mục Tài xế</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', marginTop: 4 }}>
            Tra cứu tài xế nội bộ để gán chuyến trong kế hoạch điều độ
          </p>
        </div>
        <Button size="sm" color="primary" iconLeading={Plus} onPress={crud.showForm}>
          Thêm tài xế
        </Button>
      </div>
      {crud.error && <div className="dispatch-catalogs__error">{crud.error}</div>}
      <div className="kpi-grid dispatch-catalogs__summary" style={{ marginBottom: 16 }}>
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
                >
                  <td data-label="Mã tài xế" style={{ fontWeight: 600 }}>
                    <button type="button" className="dispatch-catalogs__edit" aria-label={`Chỉnh sửa tài xế ${d.name}`} onClick={(event) => { event.stopPropagation(); crud.showEdit(d.id); }}>
                      <span className="dispatch-catalogs__desktop-driver-code">{d.code || '—'}</span>
                      <span className="dispatch-catalogs__compact-driver-name">{d.name}</span>
                    </button>
                    {d.code?.trim() && <span className="dispatch-catalogs__compact-driver-code">Mã: {d.code}</span>}
                  </td>
                  <td data-label="Họ tên" className="dispatch-catalogs__desktop-driver-name">{d.name}</td>
                  <td data-label="Số CCCD" data-empty={!d.idNumber?.trim() || undefined}>{d.idNumber || '—'}</td>
                  <td data-label="GPLX" data-empty={!d.licenseNumber?.trim() || undefined}>{d.licenseNumber || '—'}</td>
                  <td data-label="Hạn bằng lái" data-empty={!d.licenseExpiryDate || undefined}>
                    {d.licenseExpiryDate ? (
                      <>
                        <span className="dispatch-catalogs__license-date">{formatISODate(d.licenseExpiryDate)}</span>
                        {(() => {
                          const flag = licenseExpiryState(d.licenseExpiryDate, todayIso);
                          if (!flag) return null;
                          return (
                            <span className={`dispatch-catalogs__license-flag dispatch-catalogs__license-flag--${flag.level}`}>
                              <AlertTriangle size={12} aria-hidden="true" />
                              {flag.level === 'overdue' ? `Quá hạn ${flag.days} ngày` : `Còn ${flag.days} ngày`}
                            </span>
                          );
                        })()}
                      </>
                    ) : '—'}
                  </td>
                  <td data-label="Số điện thoại" data-empty={!d.phone?.trim() || undefined}>{d.phone || '—'}</td>
                  <td data-label="Ngân hàng nhận tiền" data-empty={!d.bankName?.trim() || undefined} title={d.bankName || undefined}>{d.bankName || '—'}</td>
                  <td data-label="Số TK nhận tiền" data-empty={!d.bankAccount?.trim() || undefined}>{d.bankAccount || '—'}</td>
                  <td data-label="Hình thức lương" data-empty={!d.salaryType?.trim() || undefined}>{d.salaryType || '—'}</td>
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
