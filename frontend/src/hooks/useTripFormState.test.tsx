import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import { useTripFormState } from './useTripFormState';

// FB-069 (verify-fail of card 101026163030): the display side was fixed onto
// the formatWeight/formatQuantity axis, but the EDIT form still hydrates its
// numeric inputs straight from Postgres numeric strings, which carry two dead
// decimals ("15000.00"). The money inputs are worse — InputWithPrefix
// type="money" strips non-digits, so a hydrated "1250000.00" renders as
// "125.000.000". Edit inputs must hydrate without the dead decimals while a
// genuine decimal keeps its significant digit ("21500.50" -> "21500.5").
const storageDecimalTrip = {
  id: 127,
  externalFreightCost: '1250000.00',
  fuelLitersOverride: '55.00',
  fuelSupplementLiters: '0.00',
  tollsDiscount: '400.00',
  tollsAddition: '2700.00',
  driverSalary: '850000.00',
  twoPointDeliveryBonus: '200.00',
  vehicleShiftAllowance: '150.00',
  roadAllowanceOverride: '150000.00',
  fuelActualUnitPrice: '21500.00',
  revenue: '4200000.00',
  revenueEmptyReturn: '4200000.00',
  revenueCombine: '0.00',
  customerCommission: '0.00',
} as unknown as TripDetail;

describe('useTripFormState edit hydration strips storage decimals', () => {
  it('hydrates every numeric input without dead trailing zeros', () => {
    const { result } = renderHook(() =>
      useTripFormState({ isEditMode: true, existingTrip: storageDecimalTrip }),
    );
    const s = result.current;
    expect(s.externalFreightCost).toBe('1250000');
    expect(s.fuelLitersOverride).toBe('55');
    expect(s.fuelSupplementLiters).toBe('0');
    expect(s.tollsDiscount).toBe('400');
    expect(s.tollsAddition).toBe('2700');
    expect(s.driverSalary).toBe('850000');
    expect(s.twoPointDeliveryBonus).toBe('200');
    expect(s.vehicleShiftAllowance).toBe('150');
    expect(s.roadAllowanceOverride).toBe('150000');
    expect(s.fuelActualUnitPrice).toBe('21500');
    expect(s.revenue).toBe('4200000');
    expect(s.revenueEmptyReturn).toBe('4200000');
    expect(s.revenueCombine).toBe('0');
    expect(s.customerCommission).toBe('0');
  });

  it('keeps a genuine decimal digit and leaves blank storage blank', () => {
    const { result } = renderHook(() =>
      useTripFormState({
        isEditMode: true,
        existingTrip: {
          ...storageDecimalTrip,
          fuelActualUnitPrice: '21500.50',
          fuelSupplementLiters: null,
          externalFreightCost: null,
        } as unknown as TripDetail,
      }),
    );
    expect(result.current.fuelActualUnitPrice).toBe('21500.5');
    expect(result.current.fuelSupplementLiters).toBe('');
    expect(result.current.externalFreightCost).toBe('');
  });
});
