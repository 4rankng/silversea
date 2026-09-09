import { round2dp, roundInt } from './round';

export interface ComputeFuelSurchargeInput {
  currentPrice: number | null;
  basePrice: number | null;
  sharePct: number | null;
  quotaLiters: number;
}

export interface ComputeFuelSurchargeResult {
  amount: number;
  applicable: boolean;
}

export interface FuelSurchargeSnapshot {
  currentFuelPrice: number | null;
  baseFuelPrice: number | null;
  quotaLiters: number;
  customerSharePct: number | null;
  customerId: number;
  computedAt: string;
}

/**
 * @deprecated Use computeFreightRate() for new code. This function applies sharePct
 * to the fuel surcharge (wrong per Excel PRD). The correct formula applies sharePct
 * to the base freight price and charges 100% of fuel surcharge.
 * See CuocPhiThietKeDB.md §1.1.
 */
export function computeFuelSurcharge(input: ComputeFuelSurchargeInput): ComputeFuelSurchargeResult {
  const currentPrice = input.currentPrice;
  const basePrice = input.basePrice;
  const sharePct = input.sharePct;
  if (
    currentPrice == null
    || basePrice == null
    || sharePct == null
    || sharePct <= 0
    || input.quotaLiters <= 0
    || currentPrice <= basePrice
  ) {
    return { amount: 0, applicable: false };
  }

  const delta = currentPrice - basePrice;
  const shareFraction = sharePct / 100;
  return {
    amount: roundInt(round2dp(delta * input.quotaLiters * shareFraction)),
    applicable: true,
  };
}


// ─── Correct freight rate computation (2026-09-09) ─────────────────────────
// Per Excel PRD: freight = basePrice × (1 + sharePct/100)
//                 surcharge = MAX(0, (fuelPrice − baseFuelPrice) × liters)
//                 total = freight + surcharge

export interface ComputeFreightRateInput {
  /** Giá gốc (I) — base price from pricing_tables */
  basePrice: number;
  /** % chia sẻ — share percentage from freight_rate_terms */
  sharePct: number;
  /** Giá dầu kỳ (G) — current fuel price from fuel_price_periods */
  fuelPrice: number;
  /** Giá dầu mốc (F) — base fuel price from freight_rate_terms */
  baseFuelPrice: number;
  /** Số lít dầu / chuyến (E) — billedKm × litersPerKm */
  liters: number;
}

export interface ComputeFreightRateResult {
  /** Giá cước đã chia sẻ (J) = basePrice × (1 + sharePct/100) */
  freight: number;
  /** Phụ phí dầu (H) = MAX(0, (fuelPrice − baseFuelPrice) × liters) */
  surcharge: number;
  /** Cước gồm phụ phí (K) = freight + surcharge */
  total: number;
  /** Chênh lệch giá dầu (G − F) */
  fuelDelta: number;
}

/**
 * Compute the correct freight rate per Excel formula (CuocPhiThietKeDB.md §4.1).
 * Each component is rounded separately to VND (HALF_UP) per §4.2.
 * fuelDelta and liters are NOT rounded (they are formula parameters).
 */
export function computeFreightRate(input: ComputeFreightRateInput): ComputeFreightRateResult {
  const { basePrice, sharePct, fuelPrice, baseFuelPrice, liters } = input;

  const fuelDelta = fuelPrice - baseFuelPrice;
  // H = MAX(0, ROUND(fuelDelta × liters)) — kẹp 0 (chốt 2026-09-09 Câu 1 = B)
  const surcharge = Math.max(0, roundInt(round2dp(fuelDelta * liters)));
  // J = ROUND(basePrice × (1 + sharePct/100))
  const freight = roundInt(round2dp(basePrice * (1 + sharePct / 100)));
  const total = freight + surcharge;

  return { freight, surcharge, total, fuelDelta };
}
