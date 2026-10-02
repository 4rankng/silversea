import { describe, expect, it } from 'vitest';
import type { DispatchTruck } from '../../../api/dispatchPlanningClient';
import { capacityOverloadSuffix, exceedsCapacity, ownTruckLabel, vehicleWarningSuffix } from './trailerFit';

function truck(overrides: Partial<DispatchTruck> = {}): DispatchTruck {
  return {
    id: 1,
    licensePlate: '51D-12345',
    status: 'ACTIVE',
    trailerType: '40FT',
    currentTrailerId: null,
    currentTrailerPlate: null,
    capacityKg: '30000.00',
    assignedDriverId: null,
    assignedDriverName: 'Nguyễn Văn A',
    carrierId: null,
    carrierName: null,
    ...overrides,
  };
}

const OVERLOAD = ' — ⚠ Vượt tải trọng khả dụng';

describe('exceedsCapacity (AC DISP-MP-02)', () => {
  it('flags a load above the vehicle capacity and clears a load that fits', () => {
    expect(exceedsCapacity('18000.00', '21500.00')).toBe(true);
    expect(exceedsCapacity('30000.00', '21500.00')).toBe(false);
    // Exactly at capacity is not an overload — the backend gate is `>`.
    expect(exceedsCapacity('21500.00', '21500.00')).toBe(false);
  });

  it('stays silent on unknown or non-positive capacity/weight instead of guessing', () => {
    expect(exceedsCapacity(null, '21500.00')).toBe(false);
    expect(exceedsCapacity(undefined, '21500.00')).toBe(false);
    expect(exceedsCapacity('', '21500.00')).toBe(false);
    expect(exceedsCapacity('0', '21500.00')).toBe(false);
    expect(exceedsCapacity('30000', null)).toBe(false);
    expect(exceedsCapacity('30000', undefined)).toBe(false);
    expect(exceedsCapacity('30000', '')).toBe(false);
    expect(exceedsCapacity('không rõ', '21500')).toBe(false);
    expect(exceedsCapacity('30000', 'không rõ')).toBe(false);
  });
});

describe('capacityOverloadSuffix', () => {
  it('marks an overloaded option with Vietnamese copy and leaves a fitting one unmarked', () => {
    expect(capacityOverloadSuffix('18000.00', '21500.00')).toBe(OVERLOAD);
    expect(capacityOverloadSuffix('30000.00', '21500.00')).toBe('');
    expect(capacityOverloadSuffix(null, '21500.00')).toBe('');
  });
});

describe('ownTruckLabel', () => {
  it('keeps plate + driver and appends the capacity advisory only when overloaded', () => {
    expect(ownTruckLabel(truck({ capacityKg: '18000.00' }), '40FT', '21500.00'))
      .toBe(`51D-12345 — Nguyễn Văn A${OVERLOAD}`);
    expect(ownTruckLabel(truck({ capacityKg: '30000.00' }), '40FT', '21500.00'))
      .toBe('51D-12345 — Nguyễn Văn A');
  });

  it('stacks the trailer mismatch and the capacity advisory in one label', () => {
    expect(ownTruckLabel(truck({ trailerType: '40FT', capacityKg: '18000.00' }), '20FT', '21500.00'))
      .toBe(`51D-12345 — Nguyễn Văn A — ⚠ rơ-moóc 40FT, cần 20FT${OVERLOAD}`);
  });

  it('falls back to the no-driver copy and stays silent without a weight', () => {
    expect(ownTruckLabel(truck({ assignedDriverName: null, capacityKg: null }), null, null))
      .toBe('51D-12345 — Chưa gán tài xế');
    expect(ownTruckLabel(truck({ capacityKg: '18000.00' }), '40FT', null))
      .toBe('51D-12345 — Nguyễn Văn A');
  });
});

describe('vehicleWarningSuffix', () => {
  it('builds both advisories from the fit facts and nothing for an unknown truck', () => {
    expect(vehicleWarningSuffix({ trailerType: '40FT', capacityKg: '18000.00' }, '20FT', '21500.00'))
      .toBe(` — ⚠ rơ-moóc 40FT, cần 20FT${OVERLOAD}`);
    expect(vehicleWarningSuffix({ trailerType: '20FT', capacityKg: '30000.00' }, '20FT', '21500.00')).toBe('');
    expect(vehicleWarningSuffix(undefined, '20FT', '21500.00')).toBe('');
  });
});
