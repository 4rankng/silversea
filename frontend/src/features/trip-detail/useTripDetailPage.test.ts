import { describe, expect, it } from 'vitest';
import { resolveExpectedFuelLiters } from './useTripDetailPage';

describe('resolveExpectedFuelLiters', () => {
  it('includes a legitimate supplement on top of a fixed route allowance', () => {
    expect(resolveExpectedFuelLiters({
      fuelMode: 'AUTO',
      fuelFixedAllowanceApplied: '180',
      fuelSupplementLiters: '10',
      fuelSupplementNormApplied: '5',
      legs: [{ calculatedLiters: '60' }],
    })).toBe(190);
  });

  it('uses configured and manual supplements only for per-leg AUTO mode', () => {
    expect(resolveExpectedFuelLiters({
      fuelMode: 'AUTO',
      fuelSupplementNormApplied: '5',
      fuelSupplementLiters: '10',
      legs: [{ calculatedLiters: '60' }, { calculatedLiters: '20' }],
    })).toBe(95);
  });

  it('adds the manual supplement to a flat-rate override', () => {
    expect(resolveExpectedFuelLiters({
      fuelMode: 'FLAT_RATE',
      fuelLitersOverride: '100',
      fuelSupplementLiters: '10',
      fuelSupplementNormApplied: '5',
    })).toBe(110);
  });
});
