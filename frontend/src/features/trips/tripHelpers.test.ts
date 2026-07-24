import { describe, expect, it } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import { getTripDisplayGrossProfit } from './tripHelpers';

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
