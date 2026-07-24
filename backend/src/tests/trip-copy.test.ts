import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FuelMode, LoadingType, TripStatus } from '@tingting/shared';
import * as schema from '../db/schema';
import {
  buildCopiedTripLegValues,
  buildCopiedTripValues,
} from '../services/trip-mutations.service';

type TripRow = typeof schema.trips.$inferSelect;
type TripLegRow = typeof schema.tripLegs.$inferSelect;

describe('trip copy field contract', () => {
  it('preserves planning and financial fields while resetting new-trip metadata', () => {
    const source = {
      id: 10,
      tripCode: 'TRP-202607-0010',
      version: 8,
      status: TripStatus.LOCKED,
      completedAt: new Date('2026-07-20T08:00:00Z'),
      createdBy: 3,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-20T08:00:00Z'),
      deletedAt: null,
      customerId: 11,
      routeId: 12,
      truckId: 13,
      driverId: 14,
      cargoTypeId: 15,
      departureDate: '2026-07-20',
      fuelMode: FuelMode.AUTO,
      fuelLiters: '166.00',
      fuelSupplementLiters: '4.00',
      totalFuelCost: '3652000',
      totalRoadAllowance: '1800000',
      roadAllowanceOverride: '1800000',
      driverSalary: '900000',
      totalCost: '6352000',
      revenue: '9200000',
      revenueOriginal: '8000000',
      revenueEmptyReturn: '8000000',
      revenueCombine: '1200000',
      twoPointDeliveryBonus: '200000',
      vehicleShiftAllowance: '150000',
      customerCommission: '300000',
      notes: 'Giữ nguyên ghi chú kế hoạch',
      revenueOverriddenBy: 4,
      revenueOverriddenAt: new Date('2026-07-10T00:00:00Z'),
    } as unknown as TripRow;

    const copied = buildCopiedTripValues(source, 'TRP-202607-0099', 99);

    assert.equal(copied.customerId, 11);
    assert.equal(copied.fuelLiters, '166.00');
    assert.equal(copied.totalRoadAllowance, '1800000');
    assert.equal(copied.totalCost, '6352000');
    assert.equal(copied.revenue, '9200000');
    assert.equal(copied.revenueOriginal, '9200000');
    assert.equal(copied.revenueEmptyReturn, '8000000');
    assert.equal(copied.revenueCombine, '1200000');
    assert.equal(copied.driverSalary, '900000');
    assert.equal(copied.notes, 'Giữ nguyên ghi chú kế hoạch');
    assert.equal(copied.tripCode, 'TRP-202607-0099');
    assert.equal(copied.version, 1);
    assert.equal(copied.status, TripStatus.CREATED);
    assert.equal(copied.completedAt, null);
    assert.equal(copied.createdBy, 99);
    assert.equal(copied.revenueOverriddenBy, null);
    assert.equal(copied.revenueOverriddenAt, null);
    assert.ok(!('id' in copied));
    assert.ok(!('createdAt' in copied));
    assert.ok(!('updatedAt' in copied));
  });

  it('copies the exact leg distance instead of regenerating it from the route', () => {
    const sourceLeg = {
      id: 1,
      tripId: 10,
      sequence: 1,
      origin: 'Lạch Huyện',
      destination: 'CCN Sông Thao, Cẩm Khê, Phú Thọ',
      km: 240,
      loadingType: LoadingType.HANG,
      calculatedLiters: '103.20',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TripLegRow;

    assert.deepEqual(buildCopiedTripLegValues(sourceLeg, 99), {
      tripId: 99,
      sequence: 1,
      origin: 'Lạch Huyện',
      destination: 'CCN Sông Thao, Cẩm Khê, Phú Thọ',
      km: 240,
      loadingType: LoadingType.HANG,
      calculatedLiters: '103.20',
    });
  });
});
