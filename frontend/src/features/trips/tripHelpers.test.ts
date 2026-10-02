import { describe, expect, it } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import { buildTripCode, getTripDisplayGrossProfit, isMissingGroundPrice15T, getMissingIndicators } from './tripHelpers';
import { billBookingReference } from '../../lib/business-reference';

describe('trip business identity (QA-AUDIT-ID-02)', () => {
  it('shows the originating Bill instead of the system trip code', () => {
    const trip = { customerReference: 'QA-WF04-114144', tripCode: 'TRP-202610-0001' };
    expect(buildTripCode(trip)).toBe('QA-WF04-114144');
  });

  it('names the missing reference instead of substituting an internal code', () => {
    for (const customerReference of [null, '', '  ']) {
      const trip = { customerReference, tripCode: 'TRP-202610-0001' };
      expect(buildTripCode(trip)).toBe('Chưa có số Bill/Booking');
    }
  });

  it('keeps the Bill before Booking and accepts Booking when the Bill is blank', () => {
    expect(billBookingReference(' BL-001 ', 'BOOK-001')).toBe('BL-001');
    expect(billBookingReference('  ', ' BOOK-001 ')).toBe('BOOK-001');
  });
});

describe('getTripDisplayGrossProfit', () => {
  it('uses ex-VAT revenue and inclusive hire cost for external trips (QA-AUDIT-FIN-01)', () => {
    const trip = {
      carrierType: 'EXTERNAL',
      revenue: '24130980',
      externalFreightCost: '23220000',
      vatRate: '0.080',
      grossProfit: '-876500',
    } as TripDetail;

    expect(getTripDisplayGrossProfit(trip)).toBe(-876500);
  });

  it('deducts commission and does not substitute stale profit when external hire or revenue is blank', () => {
    const trip = { carrierType: 'EXTERNAL', revenue: '10800000', externalFreightCost: '5400000',
      vatRate: '0.08', customerCommission: '500000', grossProfit: '999999' } as TripDetail;
    expect(getTripDisplayGrossProfit(trip)).toBe(4100000);
    expect(getTripDisplayGrossProfit({ ...trip, externalFreightCost: null })).toBe(9500000);
    expect(getTripDisplayGrossProfit({ ...trip, revenue: null })).toBe(-5900000);
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


describe('FIN01 carrier-specific missing inputs', () => {
  it('keeps absent revenue visible but never requests OWN fuel on EXTERNAL trips', () => {
    const external = { carrierType: 'EXTERNAL', status: 'COMPLETED', revenue: '10800000', fuelLiters: null } as TripDetail;
    expect(getMissingIndicators(external)).toEqual([]);
    expect(getMissingIndicators({ ...external, revenue: null }).map(row => row.label)).toEqual(['Chưa nhập doanh thu']);
    expect(getMissingIndicators({ ...external, carrierType: 'OWN' }).map(row => row.label)).toEqual(['Chưa khai báo dầu']);
  });
});
