import { describe, expect, it } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import { getTripDisplayGrossProfit, isMissingGroundPrice15T } from './tripHelpers';

describe('getTripDisplayGrossProfit', () => {
  it('uses ex-VAT revenue and ex-VAT hire cost for external trips', () => {
    const trip = {
      carrierType: 'EXTERNAL',
      revenue: '24130980',
      externalFreightCost: '23220000',
      vatRate: '0.080',
      grossProfit: '-876500',
    } as TripDetail;

    expect(getTripDisplayGrossProfit(trip)).toBe(843500);
  });

  it('keeps stored gross profit for own-truck trips', () => {
    const trip = {
      carrierType: 'OWN',
      revenue: '24130980',
      totalCost: '23220000',
      grossProfit: '-876500',
    } as TripDetail;

    expect(getTripDisplayGrossProfit(trip)).toBe(-876500);
  });
});

describe('isMissingGroundPrice15T (D2 chip predicate)', () => {
  const base = { status: 'COMPLETED' } as TripDetail;

  it('chips a 15T truck row with missing revenue', () => {
    const trip = { ...base, truck: { id: 1, licensePlate: '29A-111.11', vehicleClass: '15T' } } as TripDetail;
    expect(isMissingGroundPrice15T(trip)).toBe(true);
  });

  it('does not chip a 15T row that has a price', () => {
    const trip = { ...base, revenue: '350000', truck: { id: 1, licensePlate: '29A-111.11', vehicleClass: '15T' } } as TripDetail;
    expect(isMissingGroundPrice15T(trip)).toBe(false);
  });

  it('does not chip non-15T rows even when revenue is missing', () => {
    for (const cls of ['10T', 'CONT20', 'CONT40', null]) {
      const trip = { ...base, truck: { id: 1, licensePlate: '29A-111.11', vehicleClass: cls } } as TripDetail;
      expect(isMissingGroundPrice15T(trip)).toBe(false);
    }
  });

  it('does not chip when the trip has no truck (external carrier)', () => {
    const trip = { ...base, truck: undefined } as TripDetail;
    expect(isMissingGroundPrice15T(trip)).toBe(false);
  });
});
