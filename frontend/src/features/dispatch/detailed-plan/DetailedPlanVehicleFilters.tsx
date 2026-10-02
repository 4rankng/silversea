/**
 * Card 20260927_61 — vehicle/driver select + the fleet/trailer/route drawer
 * group for the Kế hoạch Chi tiết filters. Extracted to its own module so
 * DetailedPlanFilters.tsx stays under its frozen structure ceiling; the
 * option sources (dispatch fleet + config routes) live here too.
 */
import { useEffect, useState } from 'react';
import { SearchableSelect } from '../../../design-system';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import { configClient } from '../../../api/configClient';
import type { DetailedPlanFilterState } from './useDispatchDetailPlan';

type FleetOptions = { plates: Array<{ plate: string; driverName: string | null }>; drivers: Array<{ id: number; name: string }> };

/** Fleet plates + drivers, and the route catalog for the Tuyến facet. */
export function useVehicleRouteOptions() {
  const [fleetOptions, setFleetOptions] = useState<FleetOptions>({ plates: [], drivers: [] });
  const [routeOptions, setRouteOptions] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listDispatchFleetResources('TRUCK', { limit: 100 }),
      listDispatchFleetResources('DRIVER', { limit: 100 }),
      configClient.getRoutesList(),
    ]).then(([trucks, drivers, routes]) => {
      if (cancelled) return;
      setFleetOptions({
        plates: trucks.items.map((item) => ({ plate: item.licensePlate, driverName: item.assignedDriverName ?? null })),
        drivers: drivers.items.map((item) => ({ id: item.id, name: item.name })),
      });
      setRouteOptions(routes.map((route) => ({ id: route.id, name: route.name })));
    }).catch(() => {
      if (cancelled) return;
      setFleetOptions({ plates: [], drivers: [] });
      setRouteOptions([]);
    });
    return () => { cancelled = true; };
  }, []);
  return { fleetOptions, routeOptions };
}

/** Combined Xe / Tài xế codec: one control drives three filter fields — ''
 *  clears all three; 'UNASSIGNED' maps to assignmentStatus; 'T:<plate>' and
 *  'D:<id>' select the effective assignment (mutually exclusive). */
export function vehicleDriverValue(filters: DetailedPlanFilterState): string {
  if (filters.assignmentStatus === 'UNASSIGNED') return 'UNASSIGNED';
  if (filters.truckPlate !== '') return `T:${filters.truckPlate}`;
  if (filters.driverId != null) return `D:${filters.driverId}`;
  return '';
}

export function applyVehicleDriver(
  value: string,
  onChange: (patch: Partial<DetailedPlanFilterState>) => void,
) {
  if (value === '') {
    onChange({ truckPlate: '', driverId: null, assignmentStatus: '' });
  } else if (value === 'UNASSIGNED') {
    onChange({ truckPlate: '', driverId: null, assignmentStatus: 'UNASSIGNED' });
  } else if (value.startsWith('T:')) {
    onChange({ truckPlate: value.slice(2), driverId: null, assignmentStatus: '' });
  } else if (value.startsWith('D:')) {
    onChange({ truckPlate: '', driverId: Number(value.slice(2)), assignmentStatus: '' });
  }
}

/** The Xe / Tài xế quick facet — Tất cả / Chưa phân xe / plates / drivers. */
export function VehicleDriverSelect(props: {
  filters: DetailedPlanFilterState;
  fleetOptions: FleetOptions;
  onChange: (patch: Partial<DetailedPlanFilterState>) => void;
}) {
  return (
    <SearchableSelect
      id="detailed-plan-vehicle-driver"
      value={vehicleDriverValue(props.filters)}
      onChange={(value) => applyVehicleDriver(value, props.onChange)}
      options={[
        { value: '', label: 'Xe / Tài xế: Tất cả' },
        { value: 'UNASSIGNED', label: 'Chưa phân xe' },
        ...props.fleetOptions.plates.map((item) => ({ value: `T:${item.plate}`, label: item.driverName ? `${item.plate} — ${item.driverName}` : item.plate })),
        ...props.fleetOptions.drivers.map((item) => ({ value: `D:${item.id}`, label: item.name })),
      ]}
      placeholder="Xe / Tài xế: Tất cả"
      searchPlaceholder="Tìm biển số hoặc tài xế…"
      emptyMessage="Không tìm thấy xe/tài xế phù hợp."
      clearable
      clearLabel="Xe / Tài xế: Tất cả"
      size="sm"
    />
  );
}

/** The Đội xe / rơ-moóc / tuyến drawer group. */
export function FleetFilterFields(props: {
  filters: DetailedPlanFilterState;
  routeOptions: Array<{ id: number; name: string }>;
  onChange: (patch: Partial<DetailedPlanFilterState>) => void;
}) {
  return (
    <section className="detailed-plan-filter-panel__group" aria-labelledby="detailed-plan-filter-fleet">
      <h3 id="detailed-plan-filter-fleet" className="detailed-plan-filter-panel__title">Đội xe, rơ-moóc & tuyến</h3>
      <div className="detailed-plan-filter-panel__fields">
        <div className="detailed-plan-filters__field">
          <span className="detailed-plan-filters__label">Đội xe</span>
          <UUISelect size="sm" aria-label="Đội xe" selectedKey={props.filters.carrierClass || 'ALL_CLASSES'} onSelectionChange={(key) => props.onChange({ carrierClass: key === 'ALL_CLASSES' ? '' : key as DetailedPlanFilterState['carrierClass'] })} items={[
            { id: 'ALL_CLASSES', label: 'Tất cả' },
            { id: 'OWN', label: 'Xe nhà (nội bộ)' },
            { id: 'EXTERNAL', label: 'Thầu ngoài' },
          ]}>
            {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
          </UUISelect>
        </div>
        <div className="detailed-plan-filters__field">
          <span className="detailed-plan-filters__label">Loại rơ-moóc</span>
          <UUISelect size="sm" aria-label="Loại rơ-moóc" selectedKey={props.filters.trailerType || 'ALL_TRAILERS'} onSelectionChange={(key) => props.onChange({ trailerType: key === 'ALL_TRAILERS' ? '' : key as DetailedPlanFilterState['trailerType'] })} items={[
            { id: 'ALL_TRAILERS', label: 'Tất cả' },
            { id: '20FT', label: '20 feet' },
            { id: '40FT', label: '40 feet' },
          ]}>
            {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
          </UUISelect>
        </div>
        <div className="detailed-plan-filters__field">
          <span className="detailed-plan-filters__label">Tuyến đường</span>
          <UUISelect size="sm" aria-label="Tuyến đường" selectedKey={props.filters.routeId == null ? 'ALL_ROUTES' : String(props.filters.routeId)} onSelectionChange={(key) => props.onChange({ routeId: key === 'ALL_ROUTES' ? null : Number(key) })} items={[
            { id: 'ALL_ROUTES', label: 'Tất cả' },
            ...props.routeOptions.map((route) => ({ id: String(route.id), label: route.name })),
          ]}>
            {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
          </UUISelect>
        </div>
      </div>
    </section>
  );
}
