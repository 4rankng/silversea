/**
 * Danh mục Xe nội bộ — dispatcher CRUD for internal tractors. Dispatchers
 * may add, edit, and retire tractors from this view.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { Plus } from '@untitledui/icons';
import { KPI } from '../../../components/UI';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { SortHeader } from '../../../components/shared/SortHeader';
import { BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { Button } from '../../../components/untitled-ui/base/buttons/button';
import { useTrucksAndDrivers, useTrailers } from '../../../hooks/useCatalogQueries';
import { useQueryClient } from '@tanstack/react-query';
import { usePageAnimations } from '../../../hooks/animations';
import { invalidateAllCatalogs, qk } from '../../../api/keys';
import { listDispatchFleetResources, reassignTruckDriver } from '../../../api/dispatchPlanningClient';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { AssignDriverDialog } from './AssignDriverDialog';
import { AssignOpsDialog } from '../../ops/AssignOpsDialog';
import { opsClient } from '../../../api/opsClient';
import { useAuth } from '../../../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { nextTableSort, sortClientSide, type TableSortState } from '../../../lib/table-sort';
import { TRUCK_STATUS } from '../../fleet';
import { TruckFormModal } from '../../fleet/TruckFormModal';
import { CatalogTableShell } from './CatalogTableShell';
import { useCatalogCreate } from './useCatalogCreate';
import { useConfirm } from '../../../components/UI';
import './catalogs.css';

import type { Truck as TruckType } from '@tingting/shared';

export function FleetVehiclesView() {
  const { rootRef } = usePageAnimations({ ready: true });
  const auth = useAuth();
  const isAdmin = auth?.user?.role === 'ADMIN';
  // OpsVanHanh §2: only ADMIN configures "Ops phụ trách".
  const { data: opsAssignments } = useQuery({
    queryKey: qk.ops.truckOpsAssignments,
    queryFn: () => opsClient.getTruckOpsAssignments(),
    enabled: isAdmin,
    staleTime: 30_000,
  });
  const opsByTruck = new Map(
    (opsAssignments?.items ?? []).map((item) => [item.truckId, item.opsUserName]),
  );
  const [assignOpsTruck, setAssignOpsTruck] = useState<TruckType | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const { data: fleetData, isLoading: loading, error } = useTrucksAndDrivers();
  // Trailer plate/type shown alongside each tractor (same source as FleetPage).
  const { data: trailers = [] } = useTrailers();
  const crud = useCatalogCreate('/trucks');
  const { confirm, dialog } = useConfirm();

  const queryClient = useQueryClient();
  const trucks = useMemo(() => fleetData?.trucks ?? [], [fleetData?.trucks]);
  const drivers = useMemo(() => fleetData?.drivers ?? [], [fleetData?.drivers]);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTruck, setAssignTruck] = useState<TruckType | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const openAssign = useCallback((truck: TruckType) => {
    setAssignTruck(truck);
    setAssignError(null);
    setAssignOpen(true);
  }, []);

  const saveAssign = useCallback(async (driverId: number | null) => {
    if (assignTruck == null) return;
    setAssignSaving(true);
    setAssignError(null);
    try {
      await reassignTruckDriver(assignTruck.id, driverId);
      setAssignOpen(false);
      await invalidateAllCatalogs(queryClient);
    } catch (e: unknown) {
      setAssignError(e instanceof Error && e.message ? e.message : 'Không thể lưu phân công.');
    } finally {
      setAssignSaving(false);
    }
  }, [assignTruck, queryClient]);

  // Driver picker options — show each driver's current pairing so picking a
  // driver already on another truck is an informed choice (the backend moves
  // them: one active assignment per driver, one per truck).
  const driverOptions = useMemo(() => {
    const plateByTruckId = new Map(trucks.map((t) => [t.id, t.licensePlate]));
    return drivers
      .filter((d) => d.status === 'ACTIVE')
      .map((d) => ({
        value: String(d.id),
        label: d.assignedTruckId && plateByTruckId.get(d.assignedTruckId)
          ? `${d.name} — đang chạy ${plateByTruckId.get(d.assignedTruckId)}`
          : d.name,
      }));
  }, [drivers, trucks]);

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
  // Carrier-link (docx4 BUG 3): owning carrier per tractor. Options come from
  // the same EXTERNAL_CARRIER fleet list every carrier dropdown uses; the
  // filter is client-side until GET /trucks grows the generic carrierId param.
  const [carriers, setCarriers] = useState<Array<{ id: number; name: string }>>([]);
  const [carrierFilter, setCarrierFilter] = useState('');
  useEffect(() => {
    let cancelled = false;
    listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 }).then((response) => {
      if (cancelled) return;
      setCarriers(response.items.map((c) => ({ id: c.id, name: c.name })));
    }).catch(() => { if (!cancelled) setCarriers([]); });
    return () => { cancelled = true; };
  }, []);
  const carrierNameById = useMemo(() => new Map(carriers.map((c) => [c.id, c.name])), [carriers]);
  const filtered = useMemo(() => {
    const byCarrier = carrierFilter === ''
      ? trucks
      : trucks.filter((t) => (carrierFilter === 'UNASSIGNED' ? t.carrierId == null : t.carrierId === Number(carrierFilter)));
    if (!needle) return byCarrier;
    return byCarrier.filter((t) => {
      const trailer = t.currentTrailerId ? trailerById.get(t.currentTrailerId) : undefined;
      return (
        t.licensePlate.toLowerCase().includes(needle) ||
        (trailer?.licensePlate ?? '').toLowerCase().includes(needle) ||
        (driverByTruck.get(t.id) ?? '').toLowerCase().includes(needle)
      );
    });
  }, [trucks, needle, carrierFilter, driverByTruck, trailerById]);

  // Full catalog is already client-side (unpaginated lookup table), so sorting
  // happens locally with the shared contract: empty cells last, id tiebreaker.
  const rows = useMemo(
    () => sortClientSide(filtered, sort, {
      licensePlate: (t) => t.licensePlate,
      trailerPlate: (t) => (t.currentTrailerId ? trailerById.get(t.currentTrailerId)?.licensePlate ?? null : null),
      driverName: (t) => driverByTruck.get(t.id) ?? null,
      status: (t) => t.status,
    }, (a, b) => a.id - b.id),
    [filtered, sort, driverByTruck, trailerById],
  );
  const applySort = (key: string) => setSort((current) => nextTableSort(current, key));

  return (
    <div ref={rootRef}>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Danh mục Xe nội bộ' }]} />
      <div className="page-header-block dispatch-catalogs__page-header" style={{ marginBottom: 16 }}>
        <div className="dispatch-catalogs__page-heading">
          <h1 style={{ fontSize: 'var(--text-title-size)', fontWeight: 700 }}>Danh mục Xe nội bộ</h1>
          <p style={{ color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)', marginTop: 4 }}>
            Tra cứu xe đầu kéo nội bộ để phân bổ kế hoạch điều độ
          </p>
        </div>
        <Button size="sm" color="primary" iconLeading={Plus} onPress={crud.showForm}>
          Thêm xe đầu kéo
        </Button>
      </div>
      {crud.error && <div className="dispatch-catalogs__error">{crud.error}</div>}
      <div className="kpi-grid dispatch-catalogs__vehicle-summary" style={{ marginBottom: 16 }}>
        <KPI label="Tổng xe đầu kéo" value={trucks.length} unit="xe" icon={Truck} />
        <KPI label="Hoạt động" value={active} unit="xe" icon={Truck} variant="success" />
        <KPI label="Bảo trì / Ngưng" value={maintenance} unit="xe" icon={Truck} variant="warn" />
      </div>
      {error && <div className="dispatch-catalogs__error">Không thể tải dữ liệu</div>}
      <UuiSelectField
        label="Lọc theo nhà xe"
        hideLabel
        ariaLabel="Lọc theo nhà xe"
        inline
        width="content"
        value={carrierFilter}
        onChange={(e) => setCarrierFilter(e.target.value)}
        options={[
          { value: '', label: 'Tất cả nhà xe' },
          { value: 'UNASSIGNED', label: 'Chưa phân nhà xe' },
          ...carriers.map((c) => ({ value: String(c.id), label: c.name })),
        ]}
      />
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
                <SortHeader label="Biển số" sortKey="licensePlate" sort={sort} onSortChange={applySort} />
                <SortHeader label="Nhà xe" sortKey="carrierName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Rơ-moóc đang nối" sortKey="trailerPlate" sort={sort} onSortChange={applySort} />
                <SortHeader label="Tài xế được gán" sortKey="driverName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Trạng thái" sortKey="status" sort={sort} onSortChange={applySort} />
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t: TruckType) => {
                const trailer = t.currentTrailerId ? trailerById.get(t.currentTrailerId) : undefined;
                return (
                  <tr
                    key={t.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => crud.showEdit(t.id)}
                    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); crud.showEdit(t.id); } }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Chỉnh sửa xe ${t.licensePlate}`}
                  >
                    <td data-label="Biển số" className="dispatch-catalogs__plate">{t.licensePlate}</td>
                    <td data-label="Nhà xe">{t.carrierId != null ? carrierNameById.get(t.carrierId) ?? 'Nhà xe chưa xác định' : '—'}</td>
                    <td data-label="Rơ-moóc đang nối">{trailer ? trailer.licensePlate : '—'}</td>
                    <td data-label="Tài xế được gán">{driverByTruck.get(t.id) ?? '—'}</td>
                    <td data-label="Trạng thái">
                      <BadgeWithDot
                        size="sm"
                        color={t.status === 'ACTIVE' ? 'success' : t.status === 'MAINTENANCE' ? 'warning' : 'gray'}
                      >
                        {TRUCK_STATUS[t.status] || t.status}
                      </BadgeWithDot>
                    </td>
                    <td data-label="Thao tác" onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => openAssign(t)}
                        >
                          Phân công lái xe
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setAssignOpsTruck(t)}
                            title={opsByTruck.get(t.id) ? `Ops: ${opsByTruck.get(t.id)}` : 'Chưa gán Ops'}
                          >
                            Ops phụ trách{opsByTruck.get(t.id) ? ' •' : ''}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--danger-outline btn--sm"
                          onClick={async () => {
                            const ok = await confirm(`Xóa xe đầu kéo ${t.licensePlate}?`, { variant: 'danger', confirmLabel: 'Xóa' });
                            if (ok) await crud.remove(t.id);
                          }}
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CatalogTableShell>
      <TruckFormModal
        isOpen={crud.open}
        saving={crud.saving}
        item={crud.editingId != null ? trucks.find((t) => t.id === crud.editingId) : undefined}
        carrierOptions={carriers}
        trailerOptions={trailers
          .filter((t) => (t as { status?: string }).status === 'ACTIVE')
          .map((t) => ({
            id: t.id,
            licensePlate: t.licensePlate,
            type: (t as { type?: string | null }).type ?? null,
            coupledToPlate: trucks.find((truck) => truck.currentTrailerId === t.id)?.licensePlate ?? null,
          }))}
        onsave={(d) => crud.editingId != null ? crud.update(crud.editingId, d) : crud.create(d)}
        oncancel={crud.closeForm}
      />
      {dialog}
      <AssignDriverDialog
        isOpen={assignOpen}
        saving={assignSaving}
        error={assignError}
        truck={assignTruck}
        currentDriverName={assignTruck ? driverByTruck.get(assignTruck.id) ?? null : null}
        driverOptions={driverOptions}
        onsave={saveAssign}
        oncancel={() => setAssignOpen(false)}
      />
      {assignOpsTruck && (
        <AssignOpsDialog
          truck={assignOpsTruck}
          currentOpsName={opsByTruck.get(assignOpsTruck.id) ?? null}
          onClose={() => setAssignOpsTruck(null)}
        />
      )}
    </div>
  );
}
