/**
 * Danh mục Tài xế — dispatcher lookup of internal drivers. Dispatchers may
 * add drivers (createRoles allowance), but salary/social-insurance fields
 * are material config for every role: the dispatcher save strips them so
 * the create stays direct instead of routing into a governance action the
 * DISPATCHER role cannot make.
 */
import { useMemo, useState } from 'react';
import { Plus, Users, UserCheck, Truck as TruckIcon } from 'lucide-react';
import { KPI, StatusPill } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { useTrucksAndDrivers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { DRIVER_STATUS } from '../../fleet';
import { DriverFormModal } from '../../fleet/DriverFormModal';
import { CatalogTableShell } from './CatalogTableShell';
import { useCatalogCreate } from './useCatalogCreate';
import './catalogs.css';



export function FleetDriversView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const [search, setSearch] = useState('');
  const { data: fleetData, isLoading: loading, error } = useTrucksAndDrivers();
  const create = useCatalogCreate('/drivers');
  const saveDriver = (body: Record<string, unknown>) => {
    const driverFields = { ...body };
    delete driverFields.baseSalary;
    return create.create(driverFields);
  };

  const drivers = useMemo(() => fleetData?.drivers ?? [], [fleetData?.drivers]);
  const trucks = useMemo(() => fleetData?.trucks ?? [], [fleetData?.trucks]);

  const { plateByTruck, activeCount, assignedCount } = useMemo(() => {
    const plateByTruck = new Map(trucks.map((t) => [t.id, t.licensePlate]));
    const activeCount = drivers.filter((d) => d.status === 'ACTIVE').length;
    const assignedCount = drivers.filter((d) => d.assignedTruckId).length;
    return { plateByTruck, activeCount, assignedCount };
  }, [drivers, trucks]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(needle) ||
        (d.phone ?? '').toLowerCase().includes(needle) ||
        (d.assignedTruckId ? plateByTruck.get(d.assignedTruckId) ?? '' : '').toLowerCase().includes(needle),
    );
  }, [drivers, needle, plateByTruck]);

  return (
    <div ref={rootRef}>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Danh mục Tài xế' }]} />
      <div className="page-header-block" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Danh mục Tài xế</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 14, marginTop: 4 }}>
            Tra cứu tài xế nội bộ để gán chuyến trong kế hoạch điều độ
          </p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={create.showForm}>
          <Plus size={14} /> Thêm tài xế
        </button>
      </div>
      {create.error && <div className="dispatch-catalogs__error">{create.error}</div>}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Tổng tài xế" value={drivers.length} unit="người" icon={Users} />
        <KPI label="Đang hoạt động" value={activeCount} unit="người" icon={UserCheck} variant="success" />
        <KPI label="Đã gán xe" value={assignedCount} unit="người" icon={TruckIcon} variant="info" />
      </div>
      {error && <div className="dispatch-catalogs__error">Không thể tải dữ liệu</div>}
      <CatalogTableShell
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm tên, SĐT hoặc biển số xe…"
        totalLabel={`${filtered.length}/${drivers.length} tài xế`}
      >
        {loading ? (
          <div className="dispatch-catalogs__empty">Đang tải…</div>
        ) : !error && filtered.length === 0 ? (
          <div className="dispatch-catalogs__empty">
            {needle ? 'Không có tài xế khớp tìm kiếm' : 'Chưa có tài xế nào'}
          </div>
        ) : (
          <table className="dispatch-catalogs__table">
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Số điện thoại</th>
                <th>Xe đang gán</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td>{d.phone ?? '—'}</td>
                  <td className="dispatch-catalogs__plate">
                    {d.assignedTruckId ? plateByTruck.get(d.assignedTruckId) ?? '—' : '—'}
                  </td>
                  <td>
                    <StatusPill variant={d.status === 'ACTIVE' ? 'success' : 'neutral'} dot>
                      {DRIVER_STATUS[d.status] || d.status}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CatalogTableShell>
      <DriverFormModal
        isOpen={create.open}
        saving={create.saving}
        trucks={trucks}
        onsave={saveDriver}
        oncancel={create.closeForm}
      />
    </div>
  );
}

