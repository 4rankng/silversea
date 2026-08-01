// Pricing Service — Wave 1 Pricing & Fuel Data Layer.
//
// Consolidates freight-price resolution into a single, testable module so
// the trip-create / trip-update flow can call one function instead of
// inline-pricing-lookup. The service picks the pricing method (TIER for
// bulk cargo, TABLE for fixed-price, MANUAL as fallback) and returns a
// structured result with a human-readable formula string for the UI.
//
// The service is NOT wired into trip-create yet — that's roadmap item 4
// ("Wire auto-revenue into trip create/update"). This item delivers the
// service + overlap validators + tests.
//
// Design decisions (safest backward-compatible interpretation):
//   - Rounding: rounds to the nearest VND (Banker's rounding not needed at
//     integer-VND precision). PRD M2.2 §3 is open on this; nearest-VND is
//     the standard Vietnamese practice.
//   - Unit: weight_pricing_tiers.price_per_kg is per-KG. If the caller
//     passes weightKg, it's used directly. If the caller has tonnes,
//     they convert before calling (×1000). PRD M2.2 §6 is open; per-KG is
//     the finest-grained choice and the service never rounds pre-multiply.
//   - Overlap validators return the conflicting rows rather than throwing,
//     so the caller (route handler or admin UI) can present them to the
//     user with a clear message.

import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, isNull, lte, ne } from 'drizzle-orm';
import { ApiError } from '../errors';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolveFreightPriceInput {
  customerId: number;
  routeId: number;
  cargoTypeId?: number | null;
  /** Weight in KG. Required for TIER resolution; ignored for TABLE. */
  weightKg?: number;
  /** Departure or trip date (YYYY-MM-DD). */
  date: string;
  /** Optional container count for TABLE pricing (revenue = price × count). */
  containerCount?: number;
}

export interface ResolvedFreightPrice {
  /** How the price was determined. */
  source: 'TIER' | 'TABLE' | 'MANUAL';
  /** Total freight price in VND (integer). */
  price: number;
  /** Per-unit price (per-KG for TIER, per-container for TABLE). */
  unitPrice: number;
  /** Human-readable Vietnamese formula for the UI. */
  formula: string;
  /** Snapshot of the resolved pricing data for persistence on the trip. */
  snapshot: Record<string, unknown>;
}

export interface OverlapPair {
  id1: number;
  id2: number;
  detail: string;
}

// ─── resolveFreightPrice ────────────────────────────────────────────────────

/**
 * Resolve the freight price for a given customer × route × cargo × date.
 *
 * Resolution rule (single source of truth):
 *   1. Look up the cargoType. If `isBulk` → use weight_pricing_tiers.
 *      Otherwise → use pricing_tables (existing fixed-per-container model).
 *   2. If the applicable table/tier has no matching row → return MANUAL
 *      with price 0 and a clear formula. The caller (trip-create) treats
 *      this as "operator must enter the price manually."
 *   3. Never throws for a missing price — returns MANUAL so trip creation
 *      is not blocked by incomplete pricing setup.
 */
export async function resolveFreightPrice(
  input: ResolveFreightPriceInput,
): Promise<ResolvedFreightPrice> {
  if (input.cargoTypeId == null) {
    return {
      source: 'MANUAL',
      price: 0,
      unitPrice: 0,
      formula: 'Chưa có loại hàng — cần nhập thủ công',
      snapshot: { reason: 'NO_CARGO_TYPE' },
    };
  }
  const cargoTypeId = input.cargoTypeId;

  // 1. Fetch the cargo type to decide the resolution path.
  const [cargoType] = await db.select({ id: s.cargoTypes.id, isBulk: s.cargoTypes.isBulk })
    .from(s.cargoTypes)
    .where(eq(s.cargoTypes.id, cargoTypeId))
    .limit(1);

  if (!cargoType) {
    throw new ApiError(400, 'Loại hàng hóa không tồn tại');
  }

  // 2. Resolve.
  if (cargoType.isBulk) {
    return resolveTierPrice({ ...input, cargoTypeId });
  }
  return resolveTablePrice({ ...input, cargoTypeId });
}

// ─── TIER resolution (weight-tier pricing for bulk cargo) ───────────────────

async function resolveTierPrice(
  input: ResolveFreightPriceInput & { cargoTypeId: number },
): Promise<ResolvedFreightPrice> {
  if (input.weightKg == null || input.weightKg <= 0) {
    // Bulk cargo requires a weight to resolve. Without it, fall back to MANUAL.
    return {
      source: 'MANUAL',
      price: 0,
      unitPrice: 0,
      formula: 'Thiếu trọng lượng — cần nhập thủ công',
      snapshot: { reason: 'NO_WEIGHT', cargoTypeId: input.cargoTypeId },
    };
  }

  // Find tiers for this route + cargoType effective on or before the date.
  const tiers = await db.select()
    .from(s.weightPricingTiers)
    .where(and(
      eq(s.weightPricingTiers.routeId, input.routeId),
      eq(s.weightPricingTiers.cargoTypeId, input.cargoTypeId),
      lte(s.weightPricingTiers.effectiveDate, input.date),
      isNull(s.weightPricingTiers.deletedAt),
    ))
    .orderBy(desc(s.weightPricingTiers.effectiveDate));

  if (tiers.length === 0) {
    return {
      source: 'MANUAL',
      price: 0,
      unitPrice: 0,
      formula: 'Chưa có bảng giá theo trọng lượng — cần nhập thủ công',
      snapshot: { reason: 'NO_TIER', routeId: input.routeId, cargoTypeId: input.cargoTypeId },
    };
  }

  // Use tiers from the most recent effectiveDate set (the query orders by
  // effectiveDate DESC, so the first row's effectiveDate is the latest).
  const latestDate = tiers[0].effectiveDate;
  const latestTiers = tiers.filter((t) => t.effectiveDate === latestDate);

  // Find the tier where weightKg is in [minKg, maxKg).
  const tier = latestTiers.find(
    (t) => Number(t.minKg) <= input.weightKg! && input.weightKg! < Number(t.maxKg),
  );

  if (!tier) {
    return {
      source: 'MANUAL',
      price: 0,
      unitPrice: 0,
      formula: `Trọng lượng ${input.weightKg}kg ngoài khoảng giá — cần nhập thủ công`,
      snapshot: {
        reason: 'WEIGHT_OUTSIDE_TIERS',
        weightKg: input.weightKg,
        tiers: latestTiers.map((t) => ({ minKg: t.minKg, maxKg: t.maxKg })),
      },
    };
  }

  const pricePerKg = Number(tier.pricePerKg);
  const totalPrice = Math.round(pricePerKg * input.weightKg);

  return {
    source: 'TIER',
    price: totalPrice,
    unitPrice: pricePerKg,
    formula: `${input.weightKg}kg × ${pricePerKg.toLocaleString('vi-VN')} ₫/kg = ${totalPrice.toLocaleString('vi-VN')} ₫`,
    snapshot: {
      tierId: tier.id,
      minKg: tier.minKg,
      maxKg: tier.maxKg,
      pricePerKg: tier.pricePerKg,
      weightKg: input.weightKg,
      effectiveDate: tier.effectiveDate,
    },
  };
}

// ─── TABLE resolution (fixed per-container pricing) ─────────────────────────

async function resolveTablePrice(
  input: ResolveFreightPriceInput & { cargoTypeId: number },
): Promise<ResolvedFreightPrice> {
  const [pricing] = await db.select()
    .from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.customerId, input.customerId),
      eq(s.pricingTables.routeId, input.routeId),
      lte(s.pricingTables.effectiveDate, input.date),
      isNull(s.pricingTables.deletedAt),
    ))
    .orderBy(desc(s.pricingTables.effectiveDate))
    .limit(1);

  if (!pricing) {
    return {
      source: 'MANUAL',
      price: 0,
      unitPrice: 0,
      formula: 'Chưa có bảng giá cho tuyến này — cần nhập thủ công',
      snapshot: {
        reason: 'NO_PRICING_TABLE',
        customerId: input.customerId,
        routeId: input.routeId,
      },
    };
  }

  const unitPrice = Number(pricing.price);
  const containerCount = input.containerCount ?? 1;
  const totalPrice = unitPrice * containerCount;

  return {
    source: 'TABLE',
    price: totalPrice,
    unitPrice,
    formula: `${containerCount} container × ${unitPrice.toLocaleString('vi-VN')} ₫ = ${totalPrice.toLocaleString('vi-VN')} ₫`,
    snapshot: {
      pricingTableId: pricing.id,
      unitPrice: pricing.price,
      containerCount,
      effectiveDate: pricing.effectiveDate,
    },
  };
}

// ─── Overlap validators ─────────────────────────────────────────────────────

/**
 * Detect overlapping [minKg, maxKg) ranges among weight_pricing_tiers for
 * the same (routeId, cargoTypeId, effectiveDate). Returns an array of
 * overlap pairs; empty if no overlaps.
 *
 * Overlap = any two tiers where minKg₁ < maxKg₂ AND minKg₂ < maxKg₁.
 * Adjacent ranges (maxKg₁ === minKg₂) are NOT overlapping.
 */
export async function validateWeightTierOverlap(
  routeId: number,
  cargoTypeId: number,
  effectiveDate: string,
  excludeId?: number,
): Promise<OverlapPair[]> {
  const tiers = await db.select()
    .from(s.weightPricingTiers)
    .where(and(
      eq(s.weightPricingTiers.routeId, routeId),
      eq(s.weightPricingTiers.cargoTypeId, cargoTypeId),
      eq(s.weightPricingTiers.effectiveDate, effectiveDate),
      isNull(s.weightPricingTiers.deletedAt),
      ...(excludeId != null ? [ne(s.weightPricingTiers.id, excludeId)] : []),
    ));

  const overlaps: OverlapPair[] = [];
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i];
      const b = tiers[j];
      const aMin = Number(a.minKg);
      const aMax = Number(a.maxKg);
      const bMin = Number(b.minKg);
      const bMax = Number(b.maxKg);
      if (aMin < bMax && bMin < aMax) {
        overlaps.push({
          id1: a.id,
          id2: b.id,
          detail: `[${aMin}, ${aMax}) chồng lên [${bMin}, ${bMax})`,
        });
      }
    }
  }
  return overlaps;
}

/**
 * Detect duplicate effectiveDate entries for the same (customerId, routeId)
 * in pricing_tables. Two rows with the same effectiveDate is always wrong
 * (the system picks "most recent" — a tie is ambiguous). Returns the
 * conflicting pair IDs; empty if no duplicates.
 */
export async function validatePricingTableOverlap(
  customerId: number,
  routeId: number,
  effectiveDate: string,
  excludeId?: number,
): Promise<OverlapPair[]> {
  const rows = await db.select()
    .from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.customerId, customerId),
      eq(s.pricingTables.routeId, routeId),
      eq(s.pricingTables.effectiveDate, effectiveDate),
      isNull(s.pricingTables.deletedAt),
      ...(excludeId != null ? [ne(s.pricingTables.id, excludeId)] : []),
    ));

  if (rows.length < 2) return [];

  // All pairs are conflicts (same effectiveDate = ambiguous lookup).
  const overlaps: OverlapPair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      overlaps.push({
        id1: rows[i].id,
        id2: rows[j].id,
        detail: `Cùng ngày hiệu lực ${effectiveDate}`,
      });
    }
  }
  return overlaps;
}

// ─── M2.4: lift/up-down (nâng/hạ) price resolution ─────────────────────────
//
// Looks up the lift_pricing catalog for a given port × containerType ×
// direction × date and returns the suggested price. Used by the forwarder
// expense-entry flow (future wiring) to suggest a price and show the delta
// between suggested and actual.
//
// Resolution rule:
//   1. Find the most recent lift_pricing row matching port + containerType +
//      direction + effectiveDate ≤ trip date.
//   2. Return { suggestedPrice, liftPricingId, effectiveDate } or null if no
//      matching row.

export interface ResolveLiftPriceInput {
  portId: number;
  containerTypeId: number;
  direction: 'LIFT_UP' | 'LIFT_DOWN';
  /** Trip or expense date (YYYY-MM-DD). */
  date: string;
}

export interface ResolvedLiftPrice {
  suggestedPrice: number;
  liftPricingId: number;
  effectiveDate: string;
}

export async function resolveLiftPrice(input: ResolveLiftPriceInput): Promise<ResolvedLiftPrice | null> {
  const [row] = await db.select()
    .from(s.liftPricing)
    .where(and(
      eq(s.liftPricing.portId, input.portId),
      eq(s.liftPricing.containerTypeId, input.containerTypeId),
      eq(s.liftPricing.direction, input.direction),
      lte(s.liftPricing.effectiveDate, input.date),
      isNull(s.liftPricing.deletedAt),
    ))
    .orderBy(desc(s.liftPricing.effectiveDate))
    .limit(1);

  if (!row) return null;

  return {
    suggestedPrice: Number(row.unitPrice),
    liftPricingId: row.id,
    effectiveDate: row.effectiveDate,
  };
}
