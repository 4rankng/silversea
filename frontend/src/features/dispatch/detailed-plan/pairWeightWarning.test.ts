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

describe('pairWeightPreSaveWarning — SIL-1148 declared rating owns the verdict when the trailer fact resolves', () => {
  it('undeclared trailer rating → missing-capacity advisory naming the total (QA r40b: 2×20DC 5t)', () => {
    // The snapshot bucket may read non-null (mooc 20FT → 18000) while the
    // rig's own 'Tải trọng tối đa' is empty — the DECLARED fact decides.
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: null },
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: null },
    )).toBe(`${PAIR_CAPACITY_MISSING_MESSAGE} (Tổng trọng 2 cont: 10.000 kg)`);
    // One leg declared, one undeclared: the pair cannot be checked — same advisory.
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: 18000 },
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: null },
    )).toBe(`${PAIR_CAPACITY_MISSING_MESSAGE} (Tổng trọng 2 cont: 10.000 kg)`);
    // Unprovable total: the advisory still fires (the rating is missing).
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: Number.NaN, vehicleCapacityKg: 18000, declaredCapacityKg: null },
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: null },
    )).toBe(PAIR_CAPACITY_MISSING_MESSAGE);
  });

  it('declared overload → warning text carries the total vs declared rating', () => {
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 11000, vehicleCapacityKg: 24000, declaredCapacityKg: 18000 },
      { cargoWeightKg: 11000, vehicleCapacityKg: 24000, declaredCapacityKg: 18000 },
    )).toBe(`${KEP_WEIGHT_WARNING_MESSAGE} (Tổng trọng 2 cont: 22.000 kg — Tải trọng khai báo của xe: 18.000 kg)`);
  });

  it('declared within the rating → no dialog (healthy pair, including exactly at capacity)', () => {
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: 18000 },
      { cargoWeightKg: 5000, vehicleCapacityKg: 18000, declaredCapacityKg: 18000 },
    )).toBeNull();
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 9000, vehicleCapacityKg: 24000, declaredCapacityKg: 18000 },
      { cargoWeightKg: 9000, vehicleCapacityKg: 24000, declaredCapacityKg: 18000 },
    )).toBeNull();
  });

  it('declared differing ratings stay silent — the backend 422 owns the anomaly', () => {
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 11000, vehicleCapacityKg: 24000, declaredCapacityKg: 18000 },
      { cargoWeightKg: 11000, vehicleCapacityKg: 24000, declaredCapacityKg: 30000 },
    )).toBeNull();
  });

  it('no trailer fact resolvable (undefined) → the snapshot law keeps owning', () => {
    // Catalog still loading / trailer gone: exactly the pre-SIL-1148 behavior.
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 11000, vehicleCapacityKg: 24000, declaredCapacityKg: undefined },
      { cargoWeightKg: 11000, vehicleCapacityKg: 24000 },
    )).toBeNull();
    expect(pairWeightPreSaveWarning(
      { cargoWeightKg: 18500, vehicleCapacityKg: null },
      { cargoWeightKg: 18500, vehicleCapacityKg: null, declaredCapacityKg: undefined },
    )).toBe(PAIR_CAPACITY_MISSING_MESSAGE);
  });
});
