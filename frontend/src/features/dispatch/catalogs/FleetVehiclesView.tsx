/**
 * Danh mục Xe nội bộ — dispatcher lookup of internal tractors. Dispatchers
 * may add new tractors (createRoles allowance) but not edit or retire
 * existing ones; those stay in the admin /fleet workspace.
 */
import { useMemo, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { KPI, StatusPill } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { useTrucksAndDrivers, useTrailers } from '../../../hooks/useCatalogQueries';
import { usePageAnimations } from '../../../hooks/animations';
import { TRUCK_STATUS } from '../../fleet';
import { TruckFormModal } from '../../fleet/TruckFormModal';
import { CatalogTableShell } from './CatalogTableShell';
import { useCatalogCreate } from './useCatalogCreate';
import './catalogs.css';

import type { Truck as TruckType } from '@tingting/shared';

export function FleetVehiclesView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const [search, setSearch] = useState('');
  const { data: fleetData, isLoading: loading, error } = useTrucksAndDrivers();
  // Trailer plate/type shown alongside each tractor (same source as FleetPage).
  const { data: trailers = [] } = useTrailers();
  const create = useCatalogCreate('/trucks');

  const trucks = useMemo(() => fleetData?.trucks ?? [], [fleetData?.trucks]);
  const drivers = useMemo(() => fleetData?.drivers ?? [], [fleetData?.drivers]);

  const { driverByTruck, trailerById, active, maintenance } = useMemo(() => {
    const driverByTruck = new Map<number, string>();
    drivers.forEach((d) => {
      if (d.assignedTruckId) driverByTruck.set(d.assignedTruckId, d.name);
    });
    const trailerById = new Map(trailers.map((t) => [t.id, t]));
    const active = trucks.filter((t) => t.status === 'ACTIVE').length;
    const maintenance = trucks.filter((t) => t.status === 'MAINTENANCE').length;
    return { driverByTruck, trailerById, active, maintenance };
  }, [trucks, drivers, trailers]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return trucks;
    return trucks.filter((t) => {
      const trailer = t.currentTrailerId ? trailerById.get(t.currentTrailerId) : undefined;
      return (
        t.licensePlate.toLowerCase().includes(needle) ||
        (trailer?.licensePlate ?? '').toLowerCase().includes(needle) ||
        (driverByTruck.get(t.id) ?? '').toLowerCase().includes(needle)
      );
    });
  }, [trucks, needle, driverByTruck, trailerById]);

  return (
    <div ref={rootRef}>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Danh mục Xe nội bộ' }]} />
      <div className="page-header-block dispatch-catalogs__page-header" style={{ marginBottom: 16 }}>
        <div className="dispatch-catalogs__page-heading">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Danh mục Xe nội bộ</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 14, marginTop: 4 }}>
            Tra cứu xe đầu kéo nội bộ để phân bổ kế hoạch điều độ
          </p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={create.showForm}>
          <Plus size={14} /> Thêm xe đầu kéo
        </button>
      </div>
      {create.error && <div className="dispatch-catalogs__error">{create.error}</div>}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Tổng xe đầu kéo" value={trucks.length} unit="xe" icon={Truck} />
        <KPI label="Hoạt động" value={active} unit="xe" icon={Truck} variant="success" />
        <KPI label="Bảo trì / Ngưng" value={maintenance} unit="xe" icon={Truck} variant="warn" />
      </div>
      {error && <div className="dispatch-catalogs__error">Không thể tải dữ liệu</div>}
      <CatalogTableShell
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm biển số hoặc tài xế…"
        totalLabel={`${filtered.length}/${trucks.length} xe`}
      >
        {loading ? (
          <div className="dispatch-catalogs__empty">Đang tải…</div>
        ) : !error && filtered.length === 0 ? (
          <div className="dispatch-catalogs__empty">
            {needle ? 'Không có xe khớp tìm kiếm' : 'Chưa có xe đầu kéo nào'}
          </div>
        ) : (
          <table className="dispatch-catalogs__table">
            <thead>
              <tr>
                <th>Biển số</th>
                <th>Rơ-moóc đang nối</th>
                <th>Tài xế được gán</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t: TruckType) => {
                const trailer = t.currentTrailerId ? trailerById.get(t.currentTrailerId) : undefined;
                return (
                  <tr key={t.id}>
                    <td className="dispatch-catalogs__plate">{t.licensePlate}</td>
                    <td>{trailer ? trailer.licensePlate : '—'}</td>
                    <td>{driverByTruck.get(t.id) ?? '—'}</td>
                    <td>
                      <StatusPill
                        variant={t.status === 'ACTIVE' ? 'success' : t.status === 'MAINTENANCE' ? 'warn' : 'neutral'}
                        dot
                      >
                        {TRUCK_STATUS[t.status] || t.status}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CatalogTableShell>
      <TruckFormModal
        isOpen={create.open}
        saving={create.saving}
        trailers={trailers}
        onsave={create.create}
        oncancel={create.closeForm}
      />
    </div>
  );
}
