import { describe, expect, it } from 'vitest';
import { LoadingType } from '@tingting/shared';
import {
  createFallbackLegsFromRouteName,
  resolveCommonContainerTypeId,
  resolveContainerCount,
} from './tripFormDispatchUtils';

describe('tripFormDispatchUtils', () => {
  it('clamps container count to the supported trip-form range', () => {
    expect(resolveContainerCount('')).toBe(1);
    expect(resolveContainerCount('0')).toBe(1);
    expect(resolveContainerCount('3')).toBe(3);
    expect(resolveContainerCount('99')).toBe(10);
  });

  it('restores a planned type from persisted containers without container numbers', () => {
    expect(resolveCommonContainerTypeId([
      { containerTypeId: 4 },
      { containerTypeId: 4 },
    ])).toBe('4');
  });

  it('does not invent one planned type for a mixed-container trip', () => {
    expect(resolveCommonContainerTypeId([
      { containerTypeId: 1 },
      { containerTypeId: 4 },
    ])).toBe('');
  });

  it('does not fill partial, untyped, or missing persisted container rows', () => {
    expect(resolveCommonContainerTypeId([
      { containerTypeId: 4 },
      { containerTypeId: null },
    ])).toBe('');
    expect(resolveCommonContainerTypeId([
      { containerTypeId: null },
      { containerTypeId: null },
    ])).toBe('');
    expect(resolveCommonContainerTypeId([])).toBe('');
  });

  it('builds fallback return legs from a dashed route name', () => {
    const ids = ['outbound', 'return'];
    const legs = createFallbackLegsFromRouteName('Cát Lái - Bình Dương', () => ids.shift() ?? 'extra');

    expect(legs).toEqual([
      {
        id: 'outbound',
        sequence: 1,
        origin: 'Cát Lái',
        destination: 'Bình Dương',
        km: '',
        loadingType: LoadingType.HANG,
      },
      {
        id: 'return',
        sequence: 2,
        origin: 'Bình Dương',
        destination: 'Cát Lái',
        km: '',
        loadingType: LoadingType.VO,
      },
    ]);
  });
});

describe('trip editor completion date seeding', () => {
  // The QA-022-family lock: the wire instant is UTC; slicing its first ten
  // characters yields the UTC calendar day, one behind the Vietnam wall date
  // the detail shows. The editor must seed from the VN business date.
  it('seeds the VN business date from a UTC evening instant', async () => {
    const { businessDateISO } = await import('../lib/format');
    const instant = '2026-09-13T17:30:00.000Z'; // 00:30 +07 on 14/09
    expect(businessDateISO(new Date(instant))).toBe('2026-09-14');
  });
});
