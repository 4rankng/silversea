import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { CONFIG, PRICING_ENGINE } from '@tingting/shared';

// Drizzle `numeric` columns serialize as strings over the wire — keep them as
// strings client-side and format at render time. Mutations send numbers.

export interface FuelPricePeriodRow {
  id: number;
  /** Fuel price G (d/lit, before VAT) — numeric(12,2) as string. */
  unitPrice: string;
  effectiveFrom: string;
  /** Engine-owned window end; never edited in the UI. */
  effectiveTo: string | null;
  sourceNote: string | null;
}

export interface FreightRateTermRow {
  id: number;
  customerId: number;
  routeId: number;
  sharePct: string;
  billingKmOneWay: number;
  /** Fixed x2 (round trip) — decision Cau 4 = A; never editable. */
  billingKmMultiplier: string;
  /** Base fuel price F — numeric(12,4) as string (e.g. "17842.5926"). */
  baseFuelPrice: string;
  fuelLagDays: number;
  surchargeThresholdPct: string | null;
  surchargeThresholdAbs: string | null;
  effectiveDate: string;
  note: string | null;
}
export interface FreightPreviewInput {
  customerId: number;
  routeId: number;
  vehicleSizeClassCode: string;
  transportDate: string;
}

export interface FreightPreviewResult {
  source: 'AUTO' | 'MANUAL';
  /** Base price after share (I) — integer VND. */
  freight: number;
  /** Fuel surcharge H — integer VND, clamped >= 0 (Cau 1 = B). */
  surcharge: number;
  /** K = freight + surcharge — integer VND. */
  total: number;
  billedKm: number;
  liters: number;
  sharePct: number;
  fuelDelta: number;
  /** Human-readable formula trace for the UI. */
  formula: string;
}

export interface DebitNoteOverrideRow {
  id: number;
  snapshotId: number;
  systemCalculatedFreight: number;
  finalDebitFreight: number | null;
  overrideReason: string | null;
  overrideBy: number | null;
  overrideAt: string | null;
}

export const pricingClient = {
  listFuelPricePeriods: () =>
    api.get<{ items: FuelPricePeriodRow[]; total: number }>(CONFIG.FUEL_PRICE_PERIODS),

  createFuelPricePeriod: (data: {
    effectiveFrom: string; unitPrice: number; sourceNote?: string;
  }) => api.post<FuelPricePeriodRow>(CONFIG.FUEL_PRICE_PERIODS, data),

  updateFuelPricePeriod: (id: number, data: Partial<{
    effectiveFrom: string; unitPrice: number; sourceNote: string | null;
  }>) => api.put<FuelPricePeriodRow>(CONFIG.FUEL_PRICE_PERIOD(id), data),

  deleteFuelPricePeriod: (id: number) =>
    api.delete<{ ok: true }>(CONFIG.FUEL_PRICE_PERIOD(id)),

  listFreightRateTerms: () =>
    api.get<{ items: FreightRateTermRow[]; total: number }>(CONFIG.FREIGHT_RATE_TERMS),

  createFreightRateTerm: (data: {
    customerId: number; routeId: number;
    sharePct: number; billingKmOneWay: number;
    baseFuelPrice: number | string; fuelLagDays: number;
    surchargeThresholdPct?: number | null; surchargeThresholdAbs?: number | null;
    note?: string;
  }) => api.post<FreightRateTermRow>(CONFIG.FREIGHT_RATE_TERMS, data),

  updateFreightRateTerm: (id: number, data: Partial<{
    sharePct: number; billingKmOneWay: number;
    baseFuelPrice: number | string; fuelLagDays: number;
    surchargeThresholdPct: number | null; surchargeThresholdAbs: number | null;
    note: string | null;
  }>) => api.put<FreightRateTermRow>(CONFIG.FREIGHT_RATE_TERM(id), data),

  deleteFreightRateTerm: (id: number) =>
    api.delete<{ ok: true }>(CONFIG.FREIGHT_RATE_TERM(id)),

  // Live preview — non-blocking: config/engine gaps return MANUAL or hide the card.
  previewFreight: (input: FreightPreviewInput) =>
    api.get<FreightPreviewResult>(
      `${PRICING_ENGINE.FREIGHT_PREVIEW}${toQuery({
        customerId: input.customerId,
        routeId: input.routeId,
        vehicleSizeClassCode: input.vehicleSizeClassCode,
        transportDate: input.transportDate,
      })}`,
    ),

  // 404 = no override yet — hook treats as null, not an error.
  getDebitNoteOverride: (snapshotId: number) =>
    api.get<DebitNoteOverrideRow | null>(PRICING_ENGINE.SNAPSHOT_OVERRIDE(snapshotId)),

  // Reason required iff final != system — enforced in the component AND server-side (T1).
  saveDebitNoteOverride: (snapshotId: number, data: {
    finalDebitFreight: number | null; overrideReason?: string;
  }) => api.put<DebitNoteOverrideRow>(PRICING_ENGINE.SNAPSHOT_OVERRIDE(snapshotId), data),
};
