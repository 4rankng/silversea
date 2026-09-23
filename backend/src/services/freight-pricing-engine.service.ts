/**
 * Freight Pricing Engine — Automatic freight calculation per docx PRD.
 *
 * Implements the 3-step pricing engine from CuocPhiThietKeDB.md §4.1:
 *   1. Determine target date (transport_date − lag_days)
 *   2. Retrieve & check fuel price against threshold
 *   3. Lock freight price (system_calculated_freight, read-only)
 *
 * Source: `Phương án tính cước tự động.docx` + PRD `CuocPhiThietKeDB.md`.
 */

import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, inArray, isNull, lte, notInArray } from 'drizzle-orm';
import { computeFreightRate } from '@tingting/shared';
import { quotationBaseClassCode } from '@tingting/shared';
import { roundHalfAwayFromZero } from '@tingting/shared';
import type { ComputeFreightRateResult } from '@tingting/shared';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolveFreightRateInput {
  customerId: number;
  routeId: number;
  /** Norms class — liters NEVER change with weight (card 20260922_58). */
  vehicleSizeClassCode: string;
  /** Card 20260922_58: the class whose PRICING row applies when the catalog
   *  splits container classes by cargo weight (CONT20.LIGHT/…). Absent ⇒
   *  identical behavior (the pricing row is looked up on this same code). */
  priceVehicleSizeClassCode?: string;
  /** Transport date (Trigger_Type) — the date freight is locked to. */
  transportDate: string;
}

export interface ResolvedFreightRate extends ComputeFreightRateResult {
  /** Which fuel price period was used. */
  fuelPricePeriodId: number;
  /** Which rate terms were used. */
  rateTermsId: number;
  /** Which pricing table row was used. */
  pricingTableId: number;
  /** Which fuel consumption norm was used. */
  fuelNormId: number;
  /** Billed km (one-way × multiplier). */
  billedKm: number;
  /** Liters consumed (billedKm × litersPerKm). */
  liters: number;
  /** Share percentage used. */
  sharePct: number;
  /** Per-cell fuel-surcharge multiplier applied (card 20260922_59; 1 = none).
   * Optional: MANUAL fallbacks elsewhere may omit it; persist defaults to 1. */
  heSo?: number;
  /** Pre-rounding surcharge (card 20260922_60): the value AFTER the heSo
   * multiplication but BEFORE the customer's rounding rule. Equals `surcharge`
   * when no rounding mode is configured. Absent on MANUAL fallbacks. */
  surchargeRaw?: number;
  /** Whether the result should be treated as MANUAL (missing data). */
  source: 'AUTO' | 'MANUAL';
  /** Human-readable formula for the UI. */
  formula: string;
}

// ─── Resolve freight rate (3-step engine) ───────────────────────────────────

/**
 * Per-cell Hệ số + the quotation frame's rounding mode (cards _59/_60): the
 * customer's latest active quotation at the transport date. Cell candidates
 * in order: the exact class code, the base class's LIGHT split (the price-
 * carrying column when callers address the base code), the base code itself.
 * No quotation / no cell ⇒ { heSo: 1, roundingMode: 'NONE' } (ruling 5/7
 * deterministic defaults — pre-card behavior intact).
 */
async function resolveQuotationHints(
  customerId: number,
  routeId: number,
  vehicleSizeClassCode: string,
  transportDate: string,
): Promise<{ heSo: number; roundingMode: string }> {
  const [quotation] = await db
    .select({ id: s.quotations.id, roundingMode: s.quotations.surchargeRoundingMode })
    .from(s.quotations)
    .where(and(
      eq(s.quotations.customerId, customerId),
      lte(s.quotations.effectiveDate, transportDate),
      isNull(s.quotations.deletedAt),
    ))
    .orderBy(desc(s.quotations.effectiveDate), desc(s.quotations.id))
    .limit(1);
  if (!quotation) return { heSo: 1, roundingMode: 'NONE' };

  const base = quotationBaseClassCode(vehicleSizeClassCode);
  const candidates = [vehicleSizeClassCode, `${base}.LIGHT`, base]
    .filter((code, index, all) => all.indexOf(code) === index);
  const rows = await db
    .select({ code: s.vehicleSizeClasses.code, heSo: s.quotationCells.heSo })
    .from(s.quotationCells)
    .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.quotationCells.vehicleSizeClassId))
    .where(and(
      eq(s.quotationCells.quotationId, quotation.id),
      eq(s.quotationCells.routeId, routeId),
      inArray(s.vehicleSizeClasses.code, candidates),
    ));
  let heSo = 1;
  for (const candidate of candidates) {
    const hit = rows.find((r) => r.code === candidate);
    if (hit) {
      heSo = Number(hit.heSo);
      break;
    }
  }
  return { heSo, roundingMode: quotation.roundingMode };
}

/**
 * Card 20260922_60: apply the customer's surcharge rounding rule — Excel
 * ROUND(x; -n) half-away-from-zero (ruling 7). 'NONE' = unconfigured ⇒ the
 * value passes through unchanged (deterministic default). Surcharge is
 * always ≥ 0 (MAX(0, …) clamp upstream), but the helper stays sign-safe.
 */
function applySurchargeRounding(mode: string, value: number): number {
  if (mode === 'THOUSAND') return roundHalfAwayFromZero(value, -3);
  if (mode === 'TEN_THOUSAND') return roundHalfAwayFromZero(value, -4);
  return value;
}

/**
 * Resolve the freight rate for a trip/shipment per the automatic pricing engine.
 *
 * Implements CuocPhiThietKeDB.md §4.1:
 *   Step 1: Lookup freight_rate_terms (contract terms per customer × route)
 *   Step 2: Lookup pricing_tables (base price per customer × route × vehicle class)
 *   Step 3: Lookup fuel_consumption_norms (liters per km per vehicle class)
 *   Step 4: Lookup fuel_price_periods with lag + threshold check
 *   Step 5-10: Compute freight, surcharge, total
 *
 * Returns MANUAL if any required parameter is missing (e.g. no base price for 15T).
 */
export async function resolveFreightRate(
  input: ResolveFreightRateInput,
): Promise<ResolvedFreightRate> {
  const { customerId, routeId, vehicleSizeClassCode, transportDate } = input;
  const priceClassCode = input.priceVehicleSizeClassCode ?? vehicleSizeClassCode;

  // ── Step 1: freight_rate_terms ──
  const terms = await db
    .select()
    .from(s.freightRateTerms)
    .where(
      and(
        eq(s.freightRateTerms.customerId, customerId),
        eq(s.freightRateTerms.routeId, routeId),
        lte(s.freightRateTerms.effectiveDate, transportDate),
        isNull(s.freightRateTerms.deletedAt),
      ),
    )
    .orderBy(desc(s.freightRateTerms.effectiveDate))
    .limit(1)
    .then((rows) => rows[0]);

  if (!terms) {
    throw new ApiError(
      404,
      `Không tìm thấy điều khoản cước cho khách hàng #${customerId}, tuyến #${routeId}`,
    );
  }

  // ── Card 20260922_59/_60: per-cell Hệ số + the frame's rounding mode ──
  // Both live on the customer's active quotation (quotation frame + cells,
  // _66). Defaults keep pre-card behavior intact: multiplier 1, no rounding.
  const { heSo, roundingMode } = await resolveQuotationHints(
    customerId, routeId, vehicleSizeClassCode, transportDate,
  );

  // ── Step 2: pricing_tables (base price) ──
  const vehicleClass = await db
    .select()
    .from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, vehicleSizeClassCode))
    .limit(1)
    .then((rows) => rows[0]);

  if (!vehicleClass) {
    throw new ApiError(404, `Không tìm thấy loại xe: ${vehicleSizeClassCode}`);
  }

  let basePriceRow = await db
    .select()
    .from(s.pricingTables)
    .where(
      and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.routeId, routeId),
        eq(s.pricingTables.rateKey, priceClassCode),
        lte(s.pricingTables.effectiveDate, transportDate),
        isNull(s.pricingTables.deletedAt),
      ),
    )
    .orderBy(desc(s.pricingTables.effectiveDate))
    .limit(1)
    .then((rows) => rows[0]);

  // Card 20260922_58 (PM đợt-2 doctrine): a customer whose catalog predates
  // the 4-class split (or whose weight-class row is blank) inherits the BASE
  // class row instead of dropping to MANUAL — the formula records the
  // inheritance so the giá-tạm marking has its ground truth.
  let priceClassInherited = false;
  let effectivePriceClass = priceClassCode;
  if (!basePriceRow && priceClassCode !== vehicleSizeClassCode) {
    const inheritedRow = await db
      .select()
      .from(s.pricingTables)
      .where(
        and(
          eq(s.pricingTables.customerId, customerId),
          eq(s.pricingTables.routeId, routeId),
          eq(s.pricingTables.rateKey, vehicleSizeClassCode),
          lte(s.pricingTables.effectiveDate, transportDate),
          isNull(s.pricingTables.deletedAt),
        ),
      )
      .orderBy(desc(s.pricingTables.effectiveDate))
      .limit(1)
      .then((rows) => rows[0]);
    if (inheritedRow) {
      basePriceRow = inheritedRow;
      priceClassInherited = true;
      effectivePriceClass = vehicleSizeClassCode;
    }
  }

  // No base price ⇒ MANUAL mode (e.g. 15T with no data)
  if (!basePriceRow || Number(basePriceRow.price) === 0) {
    return {
      freight: 0,
      surcharge: 0,
      total: 0,
      fuelDelta: 0,
      fuelPricePeriodId: 0,
      rateTermsId: terms.id,
      pricingTableId: basePriceRow?.id ?? 0,
      fuelNormId: 0,
      billedKm: 0,
      liters: 0,
      sharePct: Number(terms.sharePct),
      heSo: 1,
      source: 'MANUAL',
      formula: `Thiếu giá gốc cho ${effectivePriceClass} — cần nhập tay`,
    };
  }

  // Unconfirmed surcharge terms ⇒ MANUAL mode. PRD CuocPhiThietKeDB.md §8
  // (via 20260917_11): an empty threshold must NOT be read as "always
  // adjust" — a contract whose threshold mode is UNSET (never customer-
  // confirmed) or whose lag has no confirmation cannot auto-apply a new
  // fuel-period price as if the grounds were complete. Mirrors the 15T
  // missing-base-price path above: flag for an authorized human decision.
  if (
    terms.surchargeThresholdMode === 'UNSET'
    || !terms.fuelLagConfirmed
  ) {
    const missing: string[] = [];
    if (terms.surchargeThresholdMode === 'UNSET') missing.push('ngưỡng biến động giá dầu chưa được khách chốt');
    if (!terms.fuelLagConfirmed) missing.push('độ trễ giá dầu chưa được xác nhận');
    return {
      freight: 0, surcharge: 0, total: 0, fuelDelta: 0,
      fuelPricePeriodId: 0,
      rateTermsId: terms.id,
      pricingTableId: basePriceRow?.id ?? 0,
      fuelNormId: 0,
      billedKm: 0,
      liters: 0,
      sharePct: Number(terms.sharePct),
      heSo: 1,
      source: 'MANUAL',
      formula: `Thiếu căn cứ phụ phí dầu: ${missing.join('; ')} — cần người có thẩm quyền chốt.`,
    };
  }

  // ── Step 3: fuel_consumption_norms ──
  // Norms are keyed on the BASE class (weight never splits consumption —
  // _58), but staging data seeded on the weight-split rows must still
  // resolve: the family lookup covers base + LIGHT/HEAVY members.
  const normFamilyCodes = [vehicleSizeClassCode, `${vehicleSizeClassCode}.LIGHT`, `${vehicleSizeClassCode}.HEAVY`]
    .filter((code, index, all) => all.indexOf(code) === index);
  const norm = await db
    .select({ id: s.fuelConsumptionNorms.id, litersPerKm: s.fuelConsumptionNorms.litersPerKm })
    .from(s.fuelConsumptionNorms)
    .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.fuelConsumptionNorms.vehicleSizeClassId))
    .where(
      and(
        inArray(s.vehicleSizeClasses.code, normFamilyCodes),
        lte(s.fuelConsumptionNorms.effectiveDate, transportDate),
        isNull(s.fuelConsumptionNorms.deletedAt),
      ),
    )
    .orderBy(desc(s.fuelConsumptionNorms.effectiveDate))
    .limit(1)
    .then((rows) => rows[0]);

  if (!norm) {
    throw new ApiError(
      404,
      `Không tìm thấy định mức dầu cho loại xe: ${vehicleSizeClassCode}`,
    );
  }

  // ── Step 4: fuel_price_periods (with lag + threshold) ──
  const lagDays = terms.fuelLagDays ?? 0;
  const targetDate = subtractDays(transportDate, lagDays);

  // ── Card 20260922_61 (ruling 8): the approval gate ──
  // The engine may not use a fuel period this customer has NOT agreed to.
  // Any PENDING/DECLINED approval row for the customer blocks its period;
  // Đồng ý clears the block so trips priced after approval use the new
  // period. In-flight shipments are already frozen in their snapshots.
  const blockedPeriods = (await db
    .select({ periodId: s.quotationFuelApprovals.fuelPricePeriodId })
    .from(s.quotationFuelApprovals)
    .where(and(
      eq(s.quotationFuelApprovals.customerId, customerId),
      inArray(s.quotationFuelApprovals.status, ['PENDING', 'DECLINED']),
    ))).map((row) => row.periodId);

  let fuel = await db
    .select()
    .from(s.fuelPricePeriods)
    .where(
      and(
        lte(s.fuelPricePeriods.effectiveFrom, targetDate),
        isNull(s.fuelPricePeriods.deletedAt),
        blockedPeriods.length > 0 ? notInArray(s.fuelPricePeriods.id, blockedPeriods) : undefined,
      ),
    )
    .orderBy(desc(s.fuelPricePeriods.effectiveFrom))
    .limit(1)
    .then((rows) => rows[0]);

  if (!fuel) {
    throw new ApiError(
      404,
      `Không tìm thấy giá dầu hiệu lực tại ngày ${targetDate} (transport: ${transportDate}, lag: ${lagDays}d)`,
    );
  }

  // ── Step 4a-4b: Threshold check ──
  // Find the previous fuel period to compare against
  const prevFuel = await db
    .select()
    .from(s.fuelPricePeriods)
    .where(
      and(
        lte(s.fuelPricePeriods.effectiveFrom, subtractDays(fuel.effectiveFrom, 1)),
        isNull(s.fuelPricePeriods.deletedAt),
      ),
    )
    .orderBy(desc(s.fuelPricePeriods.effectiveFrom))
    .limit(1)
    .then((rows) => rows[0]);

  if (prevFuel) {
    const currentUnitPrice = Number(fuel.unitPrice);
    const prevUnitPrice = Number(prevFuel.unitPrice);
    const priceChange = Math.abs(currentUnitPrice - prevUnitPrice);

    // Check percentage threshold
    const thresholdPct = terms.surchargeThresholdPct
      ? Number(terms.surchargeThresholdPct)
      : null;
    if (thresholdPct != null && thresholdPct > 0 && prevUnitPrice > 0) {
      const changePct = (priceChange / prevUnitPrice) * 100;
      if (changePct < thresholdPct) {
        // Below threshold — use previous period's price
        fuel = prevFuel;
      }
    }

    // Check absolute threshold
    const thresholdAbs = terms.surchargeThresholdAbs
      ? Number(terms.surchargeThresholdAbs)
      : null;
    if (thresholdAbs != null && thresholdAbs > 0) {
      // Only check if we haven't already fallen back to prevFuel
      if (fuel.id !== prevFuel.id || (thresholdPct == null || thresholdPct <= 0)) {
        if (priceChange < thresholdAbs) {
          fuel = prevFuel;
        }
      }
    }
  }

  // ── Steps 5-10: Compute ──
  const billedKm =
    Number(terms.billingKmOneWay) * Number(terms.billingKmMultiplier);
  const liters = billedKm * Number(norm.litersPerKm);

  const result = computeFreightRate({
    basePrice: Number(basePriceRow.price),
    sharePct: Number(terms.sharePct),
    fuelPrice: Number(fuel.unitPrice),
    baseFuelPrice: Number(terms.baseFuelPrice),
    liters,
  });

  // Cards _59/_60: the cell Hệ số multiplies the fuel surcharge ONLY; the
  // customer's rounding rule then rounds that product (Excel ROUND, half
  // away from zero — ruling 7). Giá cos (freight J) never sees either.
  // At heSo=1 + mode NONE this is byte-identical to the pre-card engine
  // (regression-pinned by test).
  const surchargeAfterHeSo = Math.round(result.surcharge * heSo);
  const surchargeRaw = surchargeAfterHeSo;
  const surcharge = applySurchargeRounding(roundingMode, surchargeAfterHeSo);
  const total = result.freight + surcharge;

  const priceClassNote = priceClassInherited
    ? `[${effectivePriceClass} kế thừa giá gốc của ${priceClassCode} — giá tạm] `
    : (priceClassCode !== vehicleSizeClassCode ? `[giá theo hạng ${priceClassCode}] ` : '');

  const formula = priceClassNote + [
    `${basePriceRow.price} × (1 + ${terms.sharePct}%) = ${result.freight}`,
    `+ MAX(0, (${fuel.unitPrice} − ${terms.baseFuelPrice}) × ${liters.toFixed(3)})`,
    ...(heSo !== 1 ? [`× hệ số ${heSo}`] : []),
    ...(roundingMode !== 'NONE'
      ? [`→ làm tròn ${roundingMode === 'THOUSAND' ? '3 số' : '4 số'} = ${surcharge}`]
      : []),
    `= ${total}`,
  ].join(' ');

  return {
    ...result,
    surcharge,
    surchargeRaw,
    total,
    fuelPricePeriodId: fuel.id,
    rateTermsId: terms.id,
    pricingTableId: basePriceRow.id,
    fuelNormId: norm.id,
    billedKm,
    liters,
    sharePct: Number(terms.sharePct),
    heSo,
    source: 'AUTO',
    formula,
  };
}

// ─── Snapshot persistence ───────────────────────────────────────────────────

/**
 * Persist a freight rate snapshot (freight_rate_snapshots table).
 * Called when a trip/shipment is issued — freezes the calculation result.
 * Pass `executor` to participate in the caller's transaction (the lifecycle
 * hooks run inside shipment/dispatch transactions); defaults to the pool.
 */
export async function persistFreightRateSnapshot(
  result: ResolvedFreightRate,
  opts: { shipmentId?: number | null; tripId?: number | null; executor?: DbOrTx },
): Promise<number> {
  const [row] = await (opts.executor ?? db)
    .insert(s.freightRateSnapshots)
    .values({
      shipmentId: opts.shipmentId ?? null,
      tripId: opts.tripId ?? null,
      freightAmount: String(result.freight),
      surchargeAmount: String(result.surcharge),
      totalAmount: String(result.total),
      rateTermsId: result.rateTermsId,
      pricingTableId: result.pricingTableId,
      fuelNormId: result.fuelNormId,
      fuelPricePeriodId: result.fuelPricePeriodId,
      billedKm: String(result.billedKm),
      liters: String(result.liters),
      fuelDelta: String(result.fuelDelta),
      sharePct: String(result.sharePct),
      heSo: String(result.heSo ?? 1),
      surchargeRaw: String(result.surchargeRaw ?? result.surcharge),
    })
    .returning({ id: s.freightRateSnapshots.id });

  return row.id;
}

// ─── Debit note override ────────────────────────────────────────────────────

export interface CreateDebitNoteOverrideInput {
  snapshotId: number;
  systemCalculatedFreight: number;
  finalDebitFreight?: number;
  overrideReason?: string;
  overrideBy?: number;
  /** Participate in the caller's transaction (idempotency wrapper); defaults to the pool. */
  executor?: DbOrTx;
}

/**
 * Create or update a debit note override.
 * Enforces: if final != system, reason is required.
 */
export async function upsertDebitNoteOverride(
  input: CreateDebitNoteOverrideInput,
): Promise<number> {
  const { snapshotId, systemCalculatedFreight, finalDebitFreight, overrideReason, overrideBy, executor } =
    input;
  const run = executor ?? db;

  if (
    finalDebitFreight != null &&
    finalDebitFreight !== systemCalculatedFreight &&
    !overrideReason
  ) {
    throw new ApiError(400, 'Bắt buộc nhập lý do khi thay đổi giá cước');
  }

  const existing = await run
    .select()
    .from(s.debitNoteOverrides)
    .where(eq(s.debitNoteOverrides.snapshotId, snapshotId))
    .limit(1)
    .then((rows) => rows[0]);

  if (existing) {
    const [row] = await run
      .update(s.debitNoteOverrides)
      .set({
        finalDebitFreight: finalDebitFreight != null ? String(finalDebitFreight) : null,
        overrideReason: overrideReason ?? null,
        overrideBy: overrideBy ?? null,
        overrideAt: new Date(),
      })
      .where(eq(s.debitNoteOverrides.id, existing.id))
      .returning({ id: s.debitNoteOverrides.id });
    return row.id;
  }

  const [row] = await run
    .insert(s.debitNoteOverrides)
    .values({
      snapshotId,
      systemCalculatedFreight: String(systemCalculatedFreight),
      finalDebitFreight: finalDebitFreight != null ? String(finalDebitFreight) : null,
      overrideReason: overrideReason ?? null,
      overrideBy: overrideBy ?? null,
      overrideAt: finalDebitFreight != null ? new Date() : null,
    })
    .returning({ id: s.debitNoteOverrides.id });

  return row.id;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
