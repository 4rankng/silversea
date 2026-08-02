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
