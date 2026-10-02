import { describe, expect, it } from 'vitest';
import { LoadingType, type TripDetail } from '@tingting/shared';
import { findInvalidLeg, reconcilePayload, externalCarrierEditValue, requiresLegacyCarrierSelection } from './tripSubmitReconcile';

const trip = (values: Partial<TripDetail>) => ({ id: 6, version: 3, legs: [], ...values }) as TripDetail;
describe('KSHIP-004: three-way trip edit reconciliation', () => {
  it('keeps a concurrent revenue change while merging local notes', () => {
    const original = trip({ revenueEmptyReturn: '1000000', notes: 'old' });
    const latest = trip({ version: 4, revenueEmptyReturn: '2000000', notes: 'old' });
    const { merged, conflicts } = reconcilePayload({ version: 3, revenueEmptyReturn: 1000000, notes: 'new', legs: [] }, original, latest);
    expect(conflicts).toEqual([]);
    expect(merged).toMatchObject({ version: 4, revenueEmptyReturn: '2000000', notes: 'new' });
  });
  it('requires review for different edits of the same field but accepts identical values', () => {
    const original = trip({ notes: 'old' });
    expect(reconcilePayload({ notes: 'mine' }, original, trip({ version: 4, notes: 'theirs' })).conflicts).toContain('notes');
    expect(reconcilePayload({ notes: 'mine' }, original, trip({ version: 4, notes: 'mine' })).conflicts).toEqual([]);
  });
  it('normalizes completion calendar dates and honors omitted fields', () => {
    const original = trip({ completedAt: '2026-09-13T18:00:00.000Z', driverSalary: '100000' });
    const latest = trip({ version: 4, completedAt: '2026-09-14T18:00:00.000Z', driverSalary: '200000' });
    const result = reconcilePayload({ completedAt: '2026-09-14', driverSalary: undefined }, original, latest);
    expect(result.conflicts).toEqual([]);
    expect(result.merged.completedAt).toBe(latest.completedAt);
    expect(result.merged.driverSalary).toBeUndefined();
  });
});

it.each(['Infinity', '-Infinity', 'NaN', '-1'])('rejects non-finite or negative leg distance %s before create', km => {
  const leg = { id: 'leg-1', sequence: 1, loadingType: LoadingType.HANG, origin: 'A', destination: 'B', km };
  expect(findInvalidLeg([leg])).toBe(leg);
});

 describe('legacy supplier carrier edit identity', () => {
  it('omits an untouched unresolved supplier while preserving explicit carrier changes', () => {
    const original = trip({ carrierType: 'EXTERNAL', externalEntityType: 'SUPPLIER', externalCarrierId: null });
    expect(externalCarrierEditValue(original, 'EXTERNAL', null)).toBeUndefined();
    expect(externalCarrierEditValue(original, 'EXTERNAL', 9)).toBe(9);
    expect(externalCarrierEditValue(original, 'OWN', null)).toBeNull();
  });
  it('retains normal customer clearing and linked supplier selections', () => {
    expect(externalCarrierEditValue(trip({ externalEntityType: 'CUSTOMER', externalCarrierId: 9 }), 'EXTERNAL', null)).toBeNull();
    expect(externalCarrierEditValue(trip({ externalEntityType: 'SUPPLIER', externalCarrierId: 9 }), 'EXTERNAL', 9)).toBeUndefined();
  });
});

it('requires an explicit canonical carrier before reassigning an unresolved legacy supplier', () => {
  expect(requiresLegacyCarrierSelection('SUPPLIER', 'EXTERNAL', '')).toBe(true);
  expect(requiresLegacyCarrierSelection('SUPPLIER', 'EXTERNAL', '9')).toBe(false);
  expect(requiresLegacyCarrierSelection('SUPPLIER', 'OWN', '')).toBe(false);
  expect(requiresLegacyCarrierSelection('CUSTOMER', 'EXTERNAL', '')).toBe(false);
});
