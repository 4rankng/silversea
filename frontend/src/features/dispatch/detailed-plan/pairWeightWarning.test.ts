import { describe, expect, it } from 'vitest';

import {
  KEP_WEIGHT_WARNING_MESSAGE,
  PAIR_CAPACITY_MISSING_MESSAGE,
  pairWeightPreSaveWarning,
} from './pairWeightWarning';

describe('pairWeightPreSaveWarning — SIL-969 pre-save mirror of the pair weight advisories', () => {
  it('keeps the DOC verbatim texts (backend strings are the source of truth)', () => {
    expect(KEP_WEIGHT_WARNING_MESSAGE).toBe('Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại');
    expect(PAIR_CAPACITY_MISSING_MESSAGE).toBe('Xe chưa khai tải trọng trong danh mục — hệ thống không đối chiếu được tổng trọng lượng cặp. Điều vận chịu trách nhiệm kiểm tra tải trước khi chạy.');
  });

  it('warns the overload text only when the proven total exceeds capacity', () => {
    // The SIL-969 shape: 2×18.5t on a rig that declares less.
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 18500, vehicleCapacityKg: 20000 },
      { cargoWeightKg: 18500, vehicleCapacityKg: 20000 },
    )).toBe(KEP_WEIGHT_WARNING_MESSAGE);
    // Exactly at capacity is NOT overload (kepPairWeightVerdict semantics).
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 11000, vehicleCapacityKg: 22000 },
      { cargoWeightKg: 11000, vehicleCapacityKg: 22000 },
    )).toBeNull();
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000 },
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000 },
    )).toBeNull();
  });

  it('a missing capacity on either leg takes the missing-capacity advisory', () => {
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 18500, vehicleCapacityKg: null },
      { cargoWeightKg: 18500, vehicleCapacityKg: null },
    )).toBe(PAIR_CAPACITY_MISSING_MESSAGE);
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 18500, vehicleCapacityKg: 20000 },
      { cargoWeightKg: 18500, vehicleCapacityKg: null },
    )).toBe(PAIR_CAPACITY_MISSING_MESSAGE);
  });

  it('the backend hard-422 case and unprovable totals get no soft warning here', () => {
    // Two DECLARED but differing ratings: the backend refuses with 422 before
    // any advisory — nothing soft to mirror.
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 18500, vehicleCapacityKg: 20000 },
      { cargoWeightKg: 18500, vehicleCapacityKg: 30000 },
    )).toBeNull();
    // A non-finite weight is 'unprovable' in the backend verdict — silent.
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: Number.NaN, vehicleCapacityKg: 20000 },
      { cargoWeightKg: 5000, vehicleCapacityKg: 20000 },
    )).toBeNull();
  });
});
