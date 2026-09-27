import { describe, expect, it } from 'vitest';
import { applyVehicleDriver, vehicleDriverValue } from './DetailedPlanVehicleFilters';
import { EMPTY_DETAILED_PLAN_FILTERS, type DetailedPlanFilterState } from './detailPlanFilters';

describe('Xe / Tài xế codec (card 20260927_61)', () => {
  it('round-trips every select encoding through the three filter fields', () => {
    const base = { ...EMPTY_DETAILED_PLAN_FILTERS };
    // '' clears all three
    let filters: DetailedPlanFilterState = { ...base, truckPlate: '51A-1.1', driverId: 7, assignmentStatus: 'UNASSIGNED' };
    applyVehicleDriver('', (patch) => { filters = { ...filters, ...patch }; });
    expect(filters.truckPlate).toBe('');
    expect(filters.driverId).toBeNull();
    expect(filters.assignmentStatus).toBe('');
    // UNASSIGNED maps to assignmentStatus only
    applyVehicleDriver('UNASSIGNED', (patch) => { filters = { ...filters, ...patch }; });
    expect(filters.assignmentStatus).toBe('UNASSIGNED');
    expect(vehicleDriverValue(filters)).toBe('UNASSIGNED');
    // plate wins over driver by construction
    applyVehicleDriver('T:29A-12.34', (patch) => { filters = { ...filters, ...patch }; });
    expect(filters.truckPlate).toBe('29A-12.34');
    expect(filters.driverId).toBeNull();
    expect(filters.assignmentStatus).toBe('');
    expect(vehicleDriverValue(filters)).toBe('T:29A-12.34');
    applyVehicleDriver('D:42', (patch) => { filters = { ...filters, ...patch }; });
    expect(filters.truckPlate).toBe('');
    expect(filters.driverId).toBe(42);
    expect(vehicleDriverValue(filters)).toBe('D:42');
  });
});
