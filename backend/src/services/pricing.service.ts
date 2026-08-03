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
import { and, desc, eq, inArray, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { computeFuelSurcharge, computeTripTotals, FuelMode } from '@tingting/shared';
import type { FuelSurchargeSnapshot } from '@tingting/shared';
import { ApiError } from '../errors';
import { resolveFuelNorm } from './fuel.service';

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
  /** Exact container type selector for FCL rows. */
  containerTypeId?: number | null;
  /** Explicit price-class selector for truck/LCL rows (e.g. CONT20, 1.25T). */
  pricingRateKey?: string | null;
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

export type ShipmentPricingProjectionReadiness =
  | 'READY'
  | 'MISSING_INPUT'
  | 'MISSING_AUTHORITY';

export interface ShipmentPricingBreakdownLine {
  label: string;
  quantity: number;
  amount: number;
  formula: string;
}

export interface ShipmentPricingProjection {
  readiness: ShipmentPricingProjectionReadiness;
  message: string;
  freightPrice: number | null;
  freightSource: ResolvedFreightPrice['source'] | null;
  freightFormula: string | null;
  expectedFuelSurcharge: number | null;
  expectedFuelLiters: number | null;
  estimationDate: string | null;
  breakdown: ShipmentPricingBreakdownLine[];
}

export interface ResolveShipmentPricingProjectionInput {
  customerId: number;
  routeId?: number | null;
  cargoMode?: 'FCL' | 'LCL' | null;
  cargoTypeId?: number | null;
  date?: string | null;
  cargoWeightKg?: number | string | null;
  containerCount?: number | null;
  containerTypeIds?: Array<number | null | undefined>;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatVnd(value: number): string {
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}

function missingProjection(message: string): ShipmentPricingProjection {
  return {
    readiness: 'MISSING_INPUT',
    message,
    freightPrice: null,
    freightSource: null,
    freightFormula: null,
    expectedFuelSurcharge: null,
    expectedFuelLiters: null,
    estimationDate: null,
    breakdown: [],
  };
}

function authorityProjection(message: string): ShipmentPricingProjection {
  return {
    readiness: 'MISSING_AUTHORITY',
    message,
    freightPrice: null,
    freightSource: null,
    freightFormula: null,
    expectedFuelSurcharge: null,
    expectedFuelLiters: null,
    estimationDate: null,
    breakdown: [],
  };
}

function normalizePositiveInteger(value: number | null | undefined): number {
  if (value == null || !Number.isInteger(value) || value <= 0) return 0;
  return value;
}

function normalizePositiveNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
}

async function estimateShipmentFuelSurcharge(args: {
  customerId: number;
  routeId: number;
  date: string;
  fulfillmentCount: number;
}): Promise<{ liters: number; amount: number } | null> {
  const [route] = await db.select({
    distanceKm: s.routes.distanceKm,
    defaultLegs: s.routes.defaultLegs,
    isMountain: s.routes.isMountain,
    fixedFuelAllowance: s.routes.fixedFuelAllowance,
  }).from(s.routes)
    .where(eq(s.routes.id, args.routeId))
    .limit(1);
  if (!route) {
    throw new ApiError(400, 'Tuyến đường không tồn tại');
  }

  const legs = route.defaultLegs?.length
    ? route.defaultLegs.map((leg, index) => ({
        sequence: index + 1,
        km: leg.km,
        loadingType: leg.loadingType,
      }))
    : route.distanceKm && route.distanceKm > 0
      ? [{ sequence: 1, km: route.distanceKm, loadingType: 'HANG' as const }]
      : [];
  if (legs.length === 0) return null;

  const fuelNorm = await resolveFuelNorm({
    routeId: args.routeId,
    date: args.date,
  });
  if (fuelNorm.source === 'NONE') return null;

  const totals = computeTripTotals({
    legs,
    fuelMode: FuelMode.AUTO,
    fuelLitersOverride: null,
    fuelSupplementLiters: 0,
    fuelLoadedNorm: fuelNorm.loadedLitersPer100Km,
    fuelEmptyNorm: fuelNorm.emptyLitersPer100Km,
    fuelPerTripSupplement: fuelNorm.supplementLiters,
    fuelUnitPrice: 0,
    fuelActualUnitPrice: null,
    isMountainRoute: route.isMountain === true,
    mountainFixedAllowance: route.fixedFuelAllowance != null
      ? Number(route.fixedFuelAllowance)
      : null,
    roadAllowanceBase: 0,
    tollsDiscount: 0,
    tollsAddition: 0,
    tollsStations: 0,
    tollPerStation: 0,
    hasReturnCargo: false,
    returnCargoBonus: 0,
    revenue: 0,
    driverSalary: 0,
    twoPointDeliveryBonus: 0,
    vehicleShiftAllowance: 0,
    vatRate: 0,
    carrierType: 'OWN',
    externalFreightCost: 0,
  });
  const totalFuelLiters = Math.round(
    Math.max(0, totals.totalFuelLiters) * Math.max(1, args.fulfillmentCount),
  );
  if (totalFuelLiters <= 0) return null;

  const surcharge = await resolveFuelSurcharge({
    customerId: args.customerId,
    fuelLiters: totalFuelLiters,
    date: new Date(`${args.date}T00:00:00.000Z`),
  });
  return {
    liters: totalFuelLiters,
    amount: surcharge.amount,
  };
}

export async function resolveShipmentPricingProjection(
  input: ResolveShipmentPricingProjectionInput,
): Promise<ShipmentPricingProjection> {
  if (input.routeId == null) {
    return missingProjection('Chọn tuyến đường để xem cước và phụ phí nhiên liệu dự kiến.');
  }
  if (input.cargoMode == null) {
    return missingProjection('Chọn loại lô hàng để xem đơn giá dự kiến.');
  }

  const estimationDate = input.date?.trim() || todayIsoDate();
  const breakdown: ShipmentPricingBreakdownLine[] = [];
  let freightPrice = 0;
  let freightSource: ResolvedFreightPrice['source'] | null = null;
  let freightFormula: string | null = null;
  let fulfillmentCount = 0;

  if (input.cargoMode === 'FCL') {
    const explicitContainerCount = normalizePositiveInteger(input.containerCount);
    const validTypeIds = (input.containerTypeIds ?? [])
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0);
    const totalContainerCount = Math.max(explicitContainerCount, validTypeIds.length);
    if (totalContainerCount <= 0) {
      return missingProjection('Thêm ít nhất một container để xem cước dự kiến.');
    }

    const groupedCounts = new Map<number | null, number>();
    for (const typeId of validTypeIds) {
      groupedCounts.set(typeId, (groupedCounts.get(typeId) ?? 0) + 1);
    }
    const unspecifiedCount = totalContainerCount - validTypeIds.length;
    if (unspecifiedCount > 0) {
      groupedCounts.set(null, (groupedCounts.get(null) ?? 0) + unspecifiedCount);
    }

    const namedContainerTypes = validTypeIds.length > 0
      ? await db.select({
        id: s.containerTypes.id,
        code: s.containerTypes.code,
        name: s.containerTypes.name,
      }).from(s.containerTypes)
        .where(and(
          isNull(s.containerTypes.deletedAt),
          inArray(s.containerTypes.id, validTypeIds),
        ))
      : [];
    const containerTypeById = new Map(
      namedContainerTypes.map((row) => [row.id, row]),
    );

    for (const [containerTypeId, quantity] of groupedCounts.entries()) {
      const resolved = await resolveTableFreightPrice({
        customerId: input.customerId,
        routeId: input.routeId,
        date: estimationDate,
        containerTypeId,
        containerCount: quantity,
      });
      if (resolved.source === 'MANUAL') {
        return authorityProjection(
          containerTypeId == null
            ? 'Chưa có bảng giá cước tổng quát cho tuyến này.'
            : 'Chưa có bảng giá cước cho loại container đã chọn trên tuyến này.',
        );
      }
      const containerType = containerTypeId != null ? containerTypeById.get(containerTypeId) : null;
      breakdown.push({
        label: containerType != null
          ? `${containerType.code} - ${containerType.name}`
          : 'Container chưa chọn loại',
        quantity,
        amount: resolved.price,
        formula: resolved.formula,
      });
      freightPrice += resolved.price;
      freightSource = freightSource ?? resolved.source;
      fulfillmentCount += quantity;
    }
    freightFormula = breakdown.map((item) => item.formula).join(' + ');
  } else {
    const cargoWeightKg = normalizePositiveNumber(input.cargoWeightKg);
    if (input.cargoTypeId == null) {
      return missingProjection('Chọn loại hàng để xem cước LCL dự kiến.');
    }
    if (cargoWeightKg == null) {
      return missingProjection('Nhập trọng lượng thực tế để xem cước LCL dự kiến.');
    }
    const resolved = await resolveFreightPrice({
      customerId: input.customerId,
      routeId: input.routeId,
      cargoTypeId: input.cargoTypeId,
      weightKg: cargoWeightKg,
      date: estimationDate,
    });
    if (resolved.source === 'MANUAL') {
      return authorityProjection('Chưa có bảng giá theo trọng lượng cho tuyến và loại hàng này.');
    }
    freightPrice = resolved.price;
    freightSource = resolved.source;
    freightFormula = resolved.formula;
    fulfillmentCount = 1;
    breakdown.push({
      label: 'Lô hàng lẻ',
      quantity: 1,
      amount: resolved.price,
      formula: resolved.formula,
    });
  }

  const fuelEstimate = await estimateShipmentFuelSurcharge({
    customerId: input.customerId,
    routeId: input.routeId,
    date: estimationDate,
    fulfillmentCount,
  });
  if (fuelEstimate == null) {
    return authorityProjection('Tuyến đường chưa đủ định mức hoặc quãng đường mặc định để ước tính phụ phí nhiên liệu.');
  }

  return {
    readiness: 'READY',
    message: `Cước dự kiến ${formatVnd(freightPrice)} và phụ phí nhiên liệu dự kiến ${formatVnd(fuelEstimate.amount)} được tính theo cấu hình hiện hành.`,
    freightPrice,
    freightSource,
    freightFormula,
    expectedFuelSurcharge: fuelEstimate.amount,
    expectedFuelLiters: fuelEstimate.liters,
    estimationDate,
    breakdown,
  };
}

export interface OverlapPair {
  id1: number;
  id2: number;
  detail: string;
}

function normalizePricingRateKey(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
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

export async function resolveFuelSurcharge(input: {
  customerId: number;
  fuelLiters: number;
  date?: Date;
}): Promise<{ amount: number; snapshot: FuelSurchargeSnapshot }> {
  const [customer, config] = await Promise.all([
    db.select({ fuelSurchargeSharePct: s.customers.fuelSurchargeSharePct })
      .from(s.customers)
      .where(eq(s.customers.id, input.customerId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select({
      unitPrice: s.fuelConfig.unitPrice,
      baseUnitPrice: s.fuelConfig.baseUnitPrice,
    })
      .from(s.fuelConfig)
      .where(isNull(s.fuelConfig.deletedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const currentPrice = config?.unitPrice != null ? Number(config.unitPrice) : null;
  const basePrice = config?.baseUnitPrice != null ? Number(config.baseUnitPrice) : null;
  const sharePct = customer?.fuelSurchargeSharePct != null ? Number(customer.fuelSurchargeSharePct) : null;
  return {
    amount: computeFuelSurcharge({
      currentPrice,
      basePrice,
      sharePct,
      quotaLiters: input.fuelLiters,
    }).amount,
    snapshot: {
      currentFuelPrice: currentPrice,
      baseFuelPrice: basePrice,
      quotaLiters: input.fuelLiters,
      customerSharePct: sharePct,
      customerId: input.customerId,
      computedAt: new Date().toISOString(),
    },
  };
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
  const requestedRateKey = normalizePricingRateKey(input.pricingRateKey);
  const baseConditions = [
    eq(s.pricingTables.customerId, input.customerId),
    eq(s.pricingTables.routeId, input.routeId),
    lte(s.pricingTables.effectiveDate, input.date),
    isNull(s.pricingTables.deletedAt),
  ];
  const findLatest = (selector: SQL) => db.select()
    .from(s.pricingTables)
    .where(and(...baseConditions, selector))
    .orderBy(desc(s.pricingTables.effectiveDate), desc(s.pricingTables.id));
  const [containerRate] = input.containerTypeId != null
    ? await findLatest(eq(s.pricingTables.containerTypeId, input.containerTypeId)).limit(1)
    : [];
  const [rateClass] = containerRate || requestedRateKey == null
    ? []
    : await findLatest(eq(s.pricingTables.rateKey, requestedRateKey)).limit(1);
  const [generalRate] = containerRate || rateClass
    ? []
    : await findLatest(and(isNull(s.pricingTables.containerTypeId), isNull(s.pricingTables.rateKey))!).limit(1);
  const pricing = containerRate ?? rateClass ?? generalRate;

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
        requestedContainerTypeId: input.containerTypeId ?? null,
        requestedRateKey,
      },
    };
  }

  const unitPrice = Number(pricing.price);
  const containerCount = input.containerCount ?? 1;
  const totalPrice = unitPrice * containerCount;
  const matchedRateKey = normalizePricingRateKey(pricing.rateKey);
  const selectorLabel = matchedRateKey
    ? `nhóm giá ${matchedRateKey}`
    : pricing.containerTypeId != null
      ? 'container'
      : 'container';
  const countLabel = selectorLabel === 'container'
    ? `${containerCount} container`
    : `${containerCount} ${selectorLabel}`;

  return {
    source: 'TABLE',
    price: totalPrice,
    unitPrice,
    formula: `${countLabel} × ${unitPrice.toLocaleString('vi-VN')} ₫ = ${totalPrice.toLocaleString('vi-VN')} ₫`,
    snapshot: {
      pricingTableId: pricing.id,
      unitPrice: pricing.price,
      containerCount,
      effectiveDate: pricing.effectiveDate,
      requestedContainerTypeId: input.containerTypeId ?? null,
      requestedRateKey,
      matchedContainerTypeId: pricing.containerTypeId ?? null,
      matchedRateKey,
    },
  };
}

/** Resolve the fixed-price table without requiring a cargo-type decision. */
export async function resolveTableFreightPrice(input: Omit<ResolveFreightPriceInput, 'cargoTypeId'>): Promise<ResolvedFreightPrice> {
  return resolveTablePrice({ ...input, cargoTypeId: 0 });
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
  selector?: { containerTypeId?: number | null; rateKey?: string | null },
  excludeId?: number,
): Promise<OverlapPair[]> {
  const normalizedRateKey = normalizePricingRateKey(selector?.rateKey);
  const rows = await db.select()
    .from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.customerId, customerId),
      eq(s.pricingTables.routeId, routeId),
      eq(s.pricingTables.effectiveDate, effectiveDate),
      selector?.containerTypeId != null
        ? eq(s.pricingTables.containerTypeId, selector.containerTypeId)
        : isNull(s.pricingTables.containerTypeId),
      normalizedRateKey != null
        ? eq(s.pricingTables.rateKey, normalizedRateKey)
        : isNull(s.pricingTables.rateKey),
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
        detail: `Cùng ngày hiệu lực ${effectiveDate}${selector?.containerTypeId != null ? ` cho loại container ${selector.containerTypeId}` : normalizedRateKey != null ? ` cho mã lớp giá ${normalizedRateKey}` : ''}`,
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
  loadState: 'LOADED' | 'EMPTY';
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
      eq(s.liftPricing.loadState, input.loadState),
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
