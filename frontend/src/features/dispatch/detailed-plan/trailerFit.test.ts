import { describe, expect, it } from 'vitest';
import type { DispatchTruck } from '../../../api/dispatchPlanningClient';
import { capacityOverloadSuffix, exceedsCapacity, ownTruckLabel, requiredTrailerTypeForContainer, trailerFitRank, trailerMismatchSuffix, vehicleWarningSuffix } from './trailerFit';

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
    // Card 091026164810 — a 40FT moóc carrying a 20' requirement is LEGAL
    // (Kẹp clamp pair rides one 40' rig; the BE gate took trailer length as a
    // floor in 80c94347). The advisory must not contradict the gate, so this
    // combination is silent on the trailer and keeps only the overload line.
    expect(ownTruckLabel(truck({ trailerType: '40FT', capacityKg: '18000.00' }), '20FT', '21500.00'))
      .toBe(`51D-12345 — Nguyễn Văn A${OVERLOAD}`);
  });

  // Card 091026164810 — only a PROVABLY UNDERSIZED moóc (40' requirement on
  // a 20' moóc) is a mismatch, mirroring TRAILER_LENGTH_RANK in
  // dispatch-planning-commands.service.ts.
  it('warns only on an undersized moóc, never on a longer one', () => {
    expect(trailerMismatchSuffix('20FT', '40FT')).toBe(' — ⚠ rơ-moóc 20FT, cần 40FT');
    expect(trailerMismatchSuffix('40FT', '20FT')).toBe('');
    expect(trailerMismatchSuffix('20FT', '20FT')).toBe('');
    expect(trailerMismatchSuffix('40FT', '40FT')).toBe('');
    expect(trailerMismatchSuffix(null, '40FT')).toBe('');
    expect(trailerMismatchSuffix('20FT', null)).toBe('');
  });

  // Card 091026164810 — the picker's sort rank must agree with the same
  // floor: a 40' moóc on a 20' requirement is a normal fit (rank 0), not a
  // mismatch to sink (rank 2).
  it('ranks the longer moóc as a fit under the length-floor rule', () => {
    expect(trailerFitRank('40FT', '20FT')).toBe(0);
    expect(trailerFitRank('20FT', '40FT')).toBe(2);
    expect(trailerFitRank('20FT', '20FT')).toBe(0);
    expect(trailerFitRank('40FT', '40FT')).toBe(0);
    expect(trailerFitRank(null, '20FT')).toBe(1);
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
    // Card 091026164810 — a 40FT moóc on a 20' requirement is a legal fit
    // under the length-floor rule, so only the overload advisory remains. The
    // stacked case is now driven by an UNDERSIZED moóc, which still warns.
    expect(vehicleWarningSuffix({ trailerType: '40FT', capacityKg: '18000.00' }, '20FT', '21500.00'))
      .toBe(OVERLOAD);
    expect(vehicleWarningSuffix({ trailerType: '20FT', capacityKg: '18000.00' }, '40FT', '21500.00'))
      .toBe(` — ⚠ rơ-moóc 20FT, cần 40FT${OVERLOAD}`);
    expect(vehicleWarningSuffix({ trailerType: '20FT', capacityKg: '30000.00' }, '20FT', '21500.00')).toBe('');
    expect(vehicleWarningSuffix(undefined, '20FT', '21500.00')).toBe('');
  });
});

describe('requiredTrailerTypeForContainer', () => {
  it('derives the requirement from the container code for the cont models', () => {
    expect(requiredTrailerTypeForContainer('20DC', 'SINGLE')).toBe('20FT');
    expect(requiredTrailerTypeForContainer('40HC', 'SINGLE')).toBe('40FT');
    // Kẹp pairs two 20' shells on one 40' moóc.
    expect(requiredTrailerTypeForContainer('20DC', 'DOUBLE')).toBe('40FT');
  });

  it('forces a 40FT moóc for Lấy Lẻ whatever the lot code says', () => {
    // The run carries the truck's own empty shell, so a 20' lot code must
    // not downgrade the moóc requirement and 409 the issue later.
    expect(requiredTrailerTypeForContainer('20DC', 'LCL_PICKUP')).toBe('40FT');
    expect(requiredTrailerTypeForContainer('40HC', 'LCL_PICKUP')).toBe('40FT');
    // Even with no container info at all the run still needs the 40' moóc.
    expect(requiredTrailerTypeForContainer(null, 'LCL_PICKUP')).toBe('40FT');
  });

  it('stays silent without a container code on the other classifications', () => {
    expect(requiredTrailerTypeForContainer(null, 'SINGLE')).toBeNull();
    expect(requiredTrailerTypeForContainer('', 'LCL')).toBeNull();
  });
});
