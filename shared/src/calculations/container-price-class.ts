// Container price classes split by cargo weight (card 20260922_58, operator
// ruling 2026-09-22). The customer sheet (BÁO GIÁ MẪU 1 — LONG MINH) prices
// CONT20/CONT40 twice — light (< 20 tấn) and heavy (≥ 20 tấn) — so the
// vehicle-size-class catalog gains four container rows while fuel norms stay
// per container size (the sheet's lít/chuyến is identical across each
// light/heavy pair: 64/64 and 70/70).
//
// Boundary ruling (PM, 2026-09-22):
//   (a) < 20.0t = light; >= 20.0t = heavy — exactly 20.0t is HEAVY.
//   (b) Weight = cargo weight from the booking (cus/điều vận), never gross —
//       a wrong class misroutes the vehicle, not just the price.
//   (c) Missing weight BLOCKS container pricing ("Thiếu trọng tải") — never
//       default; silently undercharging is the failure mode.
//
// The price-selection half (card _66) consumes resolveContainerPriceClass
// verbatim at pricing time: container size → base type (the existing
// snapshot-lifecycle normalization) + booking cargo weight → price-class
// code, then looks up fuel norms by the BASE type (CONT20/CONT40) — weight
// does not split norms, only prices.

export const CONTAINER_WEIGHT_BOUNDARY_TONS = 20;

export type ContainerBaseType = 'CONT20' | 'CONT40';

export type ContainerPriceClassCode =
  | 'CONT20.LIGHT'
  | 'CONT20.HEAVY'
  | 'CONT40.LIGHT'
  | 'CONT40.HEAVY';

export type ContainerPriceClassResolution =
  | { ok: true; code: ContainerPriceClassCode }
  | { ok: false; reason: 'MISSING_WEIGHT'; message: string };

// VN labels exactly as the customer's sheet names the four columns.
export const CONTAINER_PRICE_CLASS_LABELS: Record<ContainerPriceClassCode, string> = {
  'CONT20.LIGHT': 'Cont 20 - Trọng tải < 20 tấn',
  'CONT20.HEAVY': 'Cont 20 - Trọng tải > 20 tấn',
  'CONT40.LIGHT': 'Cont 40 nhẹ - Trọng tải < 20 tấn',
  'CONT40.HEAVY': 'Cont 40 nặng - Trọng tải > 20 tấn',
};

export const MISSING_WEIGHT_MESSAGE = 'Thiếu trọng tải';

export function resolveContainerPriceClass(
  baseType: ContainerBaseType,
  cargoWeightTons: number | null | undefined,
): ContainerPriceClassResolution {
  // 0 and negatives count as "not entered" — a 0t booking weight is not a
  // measurable cargo; defaulting it would silently undercharge.
  if (cargoWeightTons == null || !Number.isFinite(cargoWeightTons) || cargoWeightTons <= 0) {
    return { ok: false, reason: 'MISSING_WEIGHT', message: MISSING_WEIGHT_MESSAGE };
  }
  const heavy = cargoWeightTons >= CONTAINER_WEIGHT_BOUNDARY_TONS;
  if (baseType === 'CONT20') return { ok: true, code: heavy ? 'CONT20.HEAVY' : 'CONT20.LIGHT' };
  return { ok: true, code: heavy ? 'CONT40.HEAVY' : 'CONT40.LIGHT' };
}
