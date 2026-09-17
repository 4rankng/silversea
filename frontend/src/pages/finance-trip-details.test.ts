import { describe, expect, it } from 'vitest';
import { TripStatus, type TripDetail } from '@tingting/shared';
import { financeVehicleBucketId, groupFinanceTripDetails, toFinanceTripDetail } from './finance-trip-details';

const trip = (overrides: Partial<TripDetail> = {}): TripDetail => ({
  id: 12,
  tripCode: 'LC-0012',
  departureDate: '2026-07-10',
  carrierType: 'OWN',
  status: TripStatus.COMPLETED,
  truckId: 7,
  vatRate: '0.08',
  revenue: '10800000',
  customerCommission: '1000000',
  totalFuelCost: '3000000',
  totalRoadAllowance: '1200000',
  tollCost: '220000',
  tollsDiscount: '80000',
  driverSalary: '500000',
  twoPointDeliveryBonus: '100000',
  vehicleShiftAllowance: '200000',
  totalCost: '5300000',
  route: { name: 'Hải Phòng – Hà Nội' },
  ...overrides,
} as TripDetail);

describe('finance trip detail', () => {
  it('reconstructs own-truck cost inputs and ex-VAT revenue', () => {
    const detail = toFinanceTripDetail(trip());

    expect(detail.revenue).toBe(9_000_000);
    expect(detail.customerCommission).toBe(1_000_000);
    expect(detail.tollAndCompanyTickets).toBe(300_000);
    expect(detail.driverAndAllowances).toBe(800_000);
    expect(detail.totalCost).toBe(5_300_000);
    expect(detail.profit).toBe(3_700_000);
    expect(detail.costMatches).toBe(true);
    expect(detail.costDifference).toBe(0);
  });

  it('counts separately reconciled extras exactly once in visible cost reconstruction', () => {
    const detail = toFinanceTripDetail(trip({ reconciledExtraCost: '150000', totalCost: '5450000' }));
    expect(detail.reconciledExtraCost).toBe(150000);
    expect(detail.costDifference).toBe(0);
    expect(detail.costMatches).toBe(true);
  });

  it('flags a stored total that does not match its visible inputs', () => {
    const detail = toFinanceTripDetail(trip({ totalCost: '5400000' }));

    expect(detail.costMatches).toBe(false);
    expect(detail.costDifference).toBe(100_000);
  });

  it('uses external hire cost and the external vehicle bucket', () => {
    const external = trip({
      carrierType: 'EXTERNAL',
      truckId: null as unknown as number,
      externalFreightCost: '7000000',
      totalCost: '7000000',
    });
    const detail = toFinanceTripDetail(external);

    expect(financeVehicleBucketId(external)).toBe(0);
    expect(detail.fuelOrHireCost).toBe(7_000_000);
    expect(detail.roadAllowance).toBe(0);
    expect(detail.costMatches).toBe(true);
  });
});

describe('groupFinanceTripDetails', () => {
  it('excludes draft and in-transit trips from the fallback report view', () => {
    const grouped = groupFinanceTripDetails([
      trip({ id: 1, status: TripStatus.CREATED }),
      trip({ id: 2, status: TripStatus.IN_TRANSIT }),
      trip({ id: 3, status: TripStatus.COMPLETED }),
    ]);

    expect(grouped.get(7)?.map(detail => detail.id)).toEqual([3]);
  });

  it('uses the report snapshot so expanded rows reconcile with the summary', () => {
    const authoritative = {
      id: 1,
      tripCode: 'TRP-1',
      departureDate: '2026-07-01',
      routeName: 'Hải Phòng — Hà Nội',
      revenue: 9_000_000,
      customerCommission: 1_000_000,
      fuelOrHireCost: 2_000_000,
      roadAllowance: 1_000_000,
      tollAndCompanyTickets: 0,
      driverAndAllowances: 1_000_000,
      totalCost: 4_000_000,
      allocatedFleetFixedCost: 600_000,
      totalCostWithFleetFixedCost: 4_600_000,
      profit: 5_000_000,
      netProfitAfterFleetFixedCost: 4_400_000,
      costDifference: 0,
      costMatches: true,
      isExternal: false,
      vehicleBucketId: 15,
    };
    const staleRawTrip = trip({ id: 2, truckId: 15, revenue: '123000000' });

    const grouped = groupFinanceTripDetails([staleRawTrip], [authoritative]);

    expect(grouped.get(15)).toEqual([authoritative]);
  });
});
