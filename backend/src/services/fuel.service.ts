// Fuel Service — Wave 1 Pricing & Fuel Data Layer.
//
// Resolves the correct fuel-consumption norm for a given route × truck ×
// date. Priority:
//   1. fuel_norms with routeId + truckId + effectiveDate ≤ trip date (most specific)
//   2. fuel_norms with routeId only + effectiveDate ≤ trip date (per-route default)
//   3. Legacy fuel_config singleton (backward-compat for trips created before fuel_norms)
//   4. NONE — returns zeros; the caller (trip-create) treats this as "use zero norms"
//
// Mountain-route handling: if the route has `isMountain = true` AND the
// resolved norm has `flatRateLiters` set, the caller should use the flat
// rate instead of per-100km norms. The service flags this via the return
// shape's `useFlatRate` field; the actual calculation (which applies the
// flat rate vs per-100km) is done by the existing trip-calculation code
// (future roadmap item: "Wire auto-revenue into trip create/update").
//
// NOT wired into trip-create yet — this item delivers the service + tests.

import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolveFuelNormInput {
  routeId?: number;
  truckId?: number;
  /** Trip date (YYYY-MM-DD). */
  date: string;
}

export interface ResolvedFuelNorm {
  /** Where the norm came from. */
  source: 'FUEL_NORMS' | 'FUEL_CONFIG' | 'NONE';
  /** Liters per 100km when loaded. */
  loadedLitersPer100Km: number;
  /** Liters per 100km when empty. */
  emptyLitersPer100Km: number;
  /** Supplement liters (e.g. for AC, mountain grade, etc.). */
  supplementLiters: number;
  /** Flat-rate liters for mountain routes (null if not configured). */
  flatRateLiters: number | null;
  /** True when the route is mountainous AND flatRateLiters is set. The
   * caller should use flatRateLiters instead of per-100km norms. */
  useFlatRate: boolean;
  /** Human-readable Vietnamese description for the UI / audit trail. */
  description: string;
  /** Snapshot for the trip's pricing_snapshot jsonb. */
  snapshot: Record<string, unknown>;
}

// ─── resolveFuelNorm ────────────────────────────────────────────────────────

export async function resolveFuelNorm(input: ResolveFuelNormInput): Promise<ResolvedFuelNorm> {
  // 1. Check if the route is mountainous (affects flat-rate logic).
  let isMountain = false;
  if (input.routeId != null) {
    const [route] = await db.select({ isMountain: s.routes.isMountain })
      .from(s.routes)
      .where(eq(s.routes.id, input.routeId))
      .limit(1);
    isMountain = route?.isMountain ?? false;
  }

  // 2. Try fuel_norms — prefer route+truck, then route-only.
  if (input.routeId != null) {
    // Most specific: routeId + truckId (if truckId provided).
    const specificConditions = [
      eq(s.fuelNorms.routeId, input.routeId),
      lte(s.fuelNorms.effectiveDate, input.date),
      isNull(s.fuelNorms.deletedAt),
    ];
    if (input.truckId != null) {
      specificConditions.push(eq(s.fuelNorms.truckId, input.truckId));
    }

    const [specificNorm] = await db.select()
      .from(s.fuelNorms)
      .where(and(...specificConditions))
      .orderBy(desc(s.fuelNorms.effectiveDate))
      .limit(1);

    if (specificNorm) {
      return buildResult(specificNorm, isMountain, 'FUEL_NORMS', input);
    }

    // Less specific: routeId only (truckId is NULL in the norm row).
    if (input.truckId != null) {
      const [routeOnlyNorm] = await db.select()
        .from(s.fuelNorms)
        .where(and(
          eq(s.fuelNorms.routeId, input.routeId),
          isNull(s.fuelNorms.truckId),
          lte(s.fuelNorms.effectiveDate, input.date),
          isNull(s.fuelNorms.deletedAt),
        ))
        .orderBy(desc(s.fuelNorms.effectiveDate))
        .limit(1);

      if (routeOnlyNorm) {
        return buildResult(routeOnlyNorm, isMountain, 'FUEL_NORMS', input);
      }
    }
  }

  // 3. Fall back to legacy fuel_config singleton.
  const [legacyConfig] = await db.select()
    .from(s.fuelConfig)
    .where(isNull(s.fuelConfig.deletedAt))
    .limit(1);

  if (legacyConfig) {
    return {
      source: 'FUEL_CONFIG',
      loadedLitersPer100Km: Number(legacyConfig.loadedNorm),
      emptyLitersPer100Km: Number(legacyConfig.emptyNorm),
      supplementLiters: Number(legacyConfig.supplement ?? 0),
      flatRateLiters: null,
      useFlatRate: false,
      description: 'Định mức nhiên liệu mặc định (cấu hình chung)',
      snapshot: {
        source: 'FUEL_CONFIG',
        fuelConfigId: legacyConfig.id,
        loadedNorm: legacyConfig.loadedNorm,
        emptyNorm: legacyConfig.emptyNorm,
        supplement: legacyConfig.supplement,
      },
    };
  }

  // 4. No norm at all — return zeros. Trip creation is not blocked.
  return {
    source: 'NONE',
    loadedLitersPer100Km: 0,
    emptyLitersPer100Km: 0,
    supplementLiters: 0,
    flatRateLiters: null,
    useFlatRate: false,
    description: 'Chưa có định mức nhiên liệu — cần cấu hình',
    snapshot: { source: 'NONE', reason: 'NO_FUEL_NORM_OR_CONFIG' },
  };
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function buildResult(
  norm: typeof s.fuelNorms.$inferSelect,
  isMountain: boolean,
  source: 'FUEL_NORMS',
  input: ResolveFuelNormInput,
): ResolvedFuelNorm {
  const flatRate = norm.flatRateLiters != null ? Number(norm.flatRateLiters) : null;
  const useFlatRate = isMountain && flatRate != null;

  let description: string;
  if (useFlatRate) {
    description = `Định mức flat-rate (${flatRate} lít) cho tuyến miền núi`;
  } else if (input.truckId != null && norm.truckId != null) {
    description = `Định mức theo tuyến + xe (${Number(norm.loadedLitersPer100Km)} lít/100km loaded)`;
  } else {
    description = `Định mức theo tuyến (${Number(norm.loadedLitersPer100Km)} lít/100km loaded)`;
  }

  return {
    source,
    loadedLitersPer100Km: Number(norm.loadedLitersPer100Km),
    emptyLitersPer100Km: Number(norm.emptyLitersPer100Km),
    supplementLiters: Number(norm.supplementLiters ?? 0),
    flatRateLiters: flatRate,
    useFlatRate,
    description,
    snapshot: {
      source: 'FUEL_NORMS',
      fuelNormId: norm.id,
      routeId: norm.routeId,
      truckId: norm.truckId,
      loadedLitersPer100Km: norm.loadedLitersPer100Km,
      emptyLitersPer100Km: norm.emptyLitersPer100Km,
      supplementLiters: norm.supplementLiters,
      flatRateLiters: norm.flatRateLiters,
      effectiveDate: norm.effectiveDate,
      isMountain,
      useFlatRate,
    },
  };
}
