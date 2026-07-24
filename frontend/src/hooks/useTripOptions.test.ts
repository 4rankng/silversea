import { describe, expect, it } from 'vitest';
import { toDriverOption } from './useTripOptions';

describe('toDriverOption', () => {
  it('preserves the configured base salary used by trip salary auto-fill', () => {
    expect(toDriverOption({
      id: 7,
      name: 'Nguyễn Văn A',
      assignedTruckId: null,
      baseSalary: '12000000',
    })).toEqual({
      id: 7,
      label: 'Nguyễn Văn A',
      baseSalary: 12_000_000,
    });
  });
});
