// Quotation service (card 20260922_66) — CRUD for the per-customer quotation
// frame + live-view grid assembly. Reuses the QA-passed pricing engine per
// container pair (no second engine — card ban): the engine is invoked with
// the base class code; the LIGHT column uses its freight/liters/surcharge and
// the HEAVY column derives the surcharge-only line (its Giá cos is missing
// data per operator ruling 2, never light-fallback).

import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  QUOTATION_GRID_COLUMNS,
  quotationBaseClassCode,
} from '@tingting/shared';
import type {
  QuotationCellInput, QuotationCellView, QuotationCreateInput, QuotationUpdateInput, QuotationView,
} from '@tingting/shared';
import type { ResolvedFreightRate } from './freight-pricing-engine.service';
import { resolveFreightRate } from './freight-pricing-engine.service';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

async function assertCustomerExists(customerId: number, ex: DbOrTx): Promise<void> {
  const [row] = await ex.select({ id: s.customers.id }).from(s.customers)
    .where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(400, 'Khách hàng không tồn tại');
}

async function resolveClassIds(codes: string[], ex: DbOrTx): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map();
  const rows = await ex.select({ id: s.vehicleSizeClasses.id, code: s.vehicleSizeClasses.code })
    .from(s.vehicleSizeClasses)
    .where(inArray(s.vehicleSizeClasses.code, codes));
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const unknown = codes.filter((c) => !byCode.has(c));
  if (unknown.length > 0) throw new ApiError(400, `Hạng xe không tồn tại: ${unknown.join(', ')}`);
  return byCode;
}

async function writeCells(quotationId: number, cells: QuotationCellInput[], ex: DbOrTx): Promise<void> {
  if (cells.length === 0) return;
  const codes = [...new Set(cells.map((c) => c.vehicleSizeClassCode))];
  const classIdByCode = await resolveClassIds(codes, ex);
  await ex.insert(s.quotationCells).values(cells.map((c) => ({
    quotationId,
    routeId: c.routeId,
    vehicleSizeClassId: classIdByCode.get(c.vehicleSizeClassCode)!,
    heSo: String(c.heSo ?? 1),
  })));
}

export async function createQuotation(
  input: QuotationCreateInput,
  ex: DbOrTx = db,
): Promise<{ id: number }> {
  await assertCustomerExists(input.customerId, ex);
  const [row] = await ex.insert(s.quotations).values({
    customerId: input.customerId,
    templateName: input.templateName,
    effectiveDate: input.effectiveDate,
    surchargeRoundingMode: input.surchargeRoundingMode ?? 'NONE',
    note: input.note ?? null,
  }).returning({ id: s.quotations.id });
  await writeCells(row.id, input.cells ?? [], ex);
  return { id: row.id };
}

export async function updateQuotation(
  quotationId: number,
  input: QuotationUpdateInput,
  ex: DbOrTx = db,
): Promise<void> {
  const [frame] = await ex.select({ id: s.quotations.id }).from(s.quotations)
    .where(and(eq(s.quotations.id, quotationId), isNull(s.quotations.deletedAt)))
    .limit(1);
  if (!frame) throw new ApiError(404, 'Không tìm thấy báo giá');
  await ex.update(s.quotations).set({
    templateName: input.templateName,
    effectiveDate: input.effectiveDate,
    surchargeRoundingMode: input.surchargeRoundingMode ?? 'NONE',
    note: input.note ?? null,
    updatedAt: new Date(),
  }).where(eq(s.quotations.id, quotationId));
  // Replace-all cell semantics (sparse overrides; absent = hệ số 1).
  await ex.delete(s.quotationCells).where(eq(s.quotationCells.quotationId, quotationId));
  await writeCells(quotationId, input.cells, ex);
}

export async function deleteQuotation(quotationId: number, ex: DbOrTx = db): Promise<void> {
  await ex.update(s.quotations).set({ deletedAt: new Date() })
    .where(and(eq(s.quotations.id, quotationId), isNull(s.quotations.deletedAt)));
}

// ─── Read side: live-view grid ──────────────────────────────────────────────
// Routes = the customer's freight_rate_terms routes at the quotation's
// effective date (the live ref itself); cells resolve through the QA-passed
// engine at the BASE class code of each grid column.

type EngineCell = QuotationCellView;

type CellColumn = {
  routeId: number; routeName: string; vehicleSizeClassCode: string; heSo: number;
  baseFuelPrice: number; fuelLagDays: number;
};

function cellFromEngine(rate: ResolvedFreightRate, col: CellColumn): EngineCell {
  // Only the .HEAVY split columns are price-less (Mẫu 1 leaves their Giá cos
  // empty, ruling 2); the .LIGHT columns carry the base-class price.
  const split = col.vehicleSizeClassCode.endsWith('.HEAVY');
  const missing = rate.source === 'MANUAL';
  const giaCos = !split && !missing ? rate.freight : null;
  const liters = missing ? null : rate.liters;
  // Card 20260922_59: the ENGINE applies the cell factor (resolveCellHeSo →
  // Math.round(engine surcharge × heSo)) — rate.surcharge arrives already
  // scaled, so the grid must NOT multiply again (double-application guard).
  const surcharge = missing ? null : rate.surcharge;
  // Card 20260922_60: pre-rounding raw rides the engine result (== surcharge
  // when the customer's rounding mode is NONE).
  const surchargeRaw = missing ? null : (rate.surchargeRaw ?? rate.surcharge);
  return {
    routeId: col.routeId,
    routeName: col.routeName,
    vehicleSizeClassCode: col.vehicleSizeClassCode,
    heSo: col.heSo,
    giaCos,
    missingPrice: split || missing,
    liters,
    surcharge,
    surchargeRaw,
    total: giaCos == null ? null : giaCos + (surcharge ?? 0),
    baseFuelPrice: col.baseFuelPrice,
    fuelLagDays: col.fuelLagDays,
    formula: missing
      ? rate.formula
      : split
        ? `Phụ phí hạng nặng: MAX(0, Δdầu) × ${rate.liters} lít × hệ số ${col.heSo} — Giá cos chưa có`
        : rate.formula, // engine formula already carries the × hệ số term when ≠1
  };
}

function missingCell(col: CellColumn, hint: string | null, litersFallback: number | null): EngineCell {
  return {
    routeId: col.routeId,
    routeName: col.routeName,
    vehicleSizeClassCode: col.vehicleSizeClassCode,
    heSo: col.heSo,
    giaCos: null,
    missingPrice: true,
    liters: litersFallback,
    surcharge: null,
    surchargeRaw: null,
    total: null,
    baseFuelPrice: col.baseFuelPrice,
    fuelLagDays: col.fuelLagDays,
    formula: hint ?? (litersFallback != null
      ? `Giá cos chưa có — ${litersFallback} lít/chuyến suy ra từ km × định mức (ruling 2: không tự điền giá)`
      : null),
    };
}

async function buildGrid(
  quotationId: number,
  customerId: number,
  effectiveDate: string,
): Promise<QuotationCellView[]> {
  // Hệ số overrides the quotation actually owns (sparse rows).
  const overrideRows = await db.select({
    routeId: s.quotationCells.routeId,
    code: s.vehicleSizeClasses.code,
    heSo: s.quotationCells.heSo,
  }).from(s.quotationCells)
    .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.quotationCells.vehicleSizeClassId))
    .where(eq(s.quotationCells.quotationId, quotationId));
  const heSoByKey = new Map(overrideRows.map((r) => [`${r.routeId}:${r.code}`, Number(r.heSo)]));

  // Route sections = the customer's terms rows at the effective date.
  const termRows = await db.select({
    routeId: s.freightRateTerms.routeId,
    routeName: s.routes.name,
    baseFuelPrice: s.freightRateTerms.baseFuelPrice,
    fuelLagDays: s.freightRateTerms.fuelLagDays,
    billingKmOneWay: s.freightRateTerms.billingKmOneWay,
    billingKmMultiplier: s.freightRateTerms.billingKmMultiplier,
  }).from(s.freightRateTerms)
    .innerJoin(s.routes, eq(s.routes.id, s.freightRateTerms.routeId))
    .where(and(
      eq(s.freightRateTerms.customerId, customerId),
      lte(s.freightRateTerms.effectiveDate, effectiveDate),
      isNull(s.freightRateTerms.deletedAt),
    ))
    .orderBy(desc(s.freightRateTerms.effectiveDate));
  const seen = new Set<number>();
  const routes: typeof termRows = [];
  for (const row of termRows) {
    if (seen.has(row.routeId)) continue;
    seen.add(row.routeId);
    routes.push(row);
  }

  const BASE_CODES = [...new Set(QUOTATION_GRID_COLUMNS.map((c) => quotationBaseClassCode(c.vehicleSizeClassCode)))];
  const cells: QuotationCellView[] = [];
  for (const route of routes) {
    // Liters derivation (pure card formula, price-independent): the liters
    // row of Mẫu 1 stays complete even where Giá cos is missing.
    const billedKm = Number(route.billingKmOneWay) * Number(route.billingKmMultiplier);
    const normRows = await db.select({
      code: s.vehicleSizeClasses.code,
      litersPerKm: s.fuelConsumptionNorms.litersPerKm,
    }).from(s.fuelConsumptionNorms)
      .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.fuelConsumptionNorms.vehicleSizeClassId))
      .where(and(
        inArray(s.vehicleSizeClasses.code, BASE_CODES),
        lte(s.fuelConsumptionNorms.effectiveDate, effectiveDate),
        isNull(s.fuelConsumptionNorms.deletedAt),
      ))
      .orderBy(desc(s.fuelConsumptionNorms.effectiveDate));
    const lpkByCode = new Map<string, number>();
    for (const row of normRows) {
      if (!lpkByCode.has(row.code)) lpkByCode.set(row.code, Number(row.litersPerKm));
    }
    // One engine resolve per base class per route; container split columns
    // share the base resolve (identical norms per card _58).
    const rateByBase = new Map<string, ResolvedFreightRate | null>();
    for (const column of QUOTATION_GRID_COLUMNS) {
      const heSo = heSoByKey.get(`${route.routeId}:${column.vehicleSizeClassCode}`) ?? 1;
      const col = {
        routeId: route.routeId,
        routeName: route.routeName,
        vehicleSizeClassCode: column.vehicleSizeClassCode,
        heSo,
        baseFuelPrice: Number(route.baseFuelPrice),
        fuelLagDays: route.fuelLagDays,
      };
      const base = quotationBaseClassCode(column.vehicleSizeClassCode);
      let rate = rateByBase.get(base);
      if (rate === undefined) {
        try {
          rate = await resolveFreightRate({
            customerId,
            routeId: route.routeId,
            vehicleSizeClassCode: base,
            transportDate: effectiveDate,
          });
        } catch {
          rate = null;
        }
        rateByBase.set(base, rate);
      }
      if (rate == null || rate.source === 'MANUAL') {
        const lpk = lpkByCode.get(base);
        cells.push(missingCell(col, rate?.formula ?? null, lpk != null ? billedKm * lpk : null));
      } else {
        cells.push(cellFromEngine(rate, col));
      }
    }
  }
  return cells;
}

export async function getQuotation(quotationId: number): Promise<QuotationView> {
  const [frame] = await db.select({
    id: s.quotations.id,
    customerId: s.quotations.customerId,
    customerName: s.customers.name,
    templateName: s.quotations.templateName,
    effectiveDate: s.quotations.effectiveDate,
    surchargeRoundingMode: s.quotations.surchargeRoundingMode,
    note: s.quotations.note,
  }).from(s.quotations)
    .innerJoin(s.customers, eq(s.customers.id, s.quotations.customerId))
    .where(and(eq(s.quotations.id, quotationId), isNull(s.quotations.deletedAt)))
    .limit(1);
  if (!frame) throw new ApiError(404, 'Không tìm thấy báo giá');
  const grid = await buildGrid(quotationId, frame.customerId, frame.effectiveDate);
  return {
    ...frame,
    surchargeRoundingMode: frame.surchargeRoundingMode as QuotationView['surchargeRoundingMode'],
    cells: grid,
  };
}

export async function listQuotations(): Promise<QuotationView[]> {
  const rows = await db.select({
    id: s.quotations.id,
    customerId: s.quotations.customerId,
    customerName: s.customers.name,
    templateName: s.quotations.templateName,
    effectiveDate: s.quotations.effectiveDate,
    surchargeRoundingMode: s.quotations.surchargeRoundingMode,
    note: s.quotations.note,
  }).from(s.quotations)
    .innerJoin(s.customers, eq(s.customers.id, s.quotations.customerId))
    .where(isNull(s.quotations.deletedAt))
    .orderBy(desc(s.quotations.createdAt));
  // Frames only — the live grid assembles on the detail route.
  return rows.map((r) => ({
    ...r,
    surchargeRoundingMode: r.surchargeRoundingMode as QuotationView['surchargeRoundingMode'],
    cells: [],
  }));
}


// ─── Card 20260922_61: fuel-update approval workflow (ruling 8) ─────────────

/** When kế toán enters a fuel price period, every customer with an ACTIVE
 *  quotation gets one PENDING row for that period. UNIQUE (period, customer)
 *  makes replay/re-entry a no-op. Returns the created count. */
export async function spawnQuotationFuelApprovals(fuelPricePeriodId: number, ex: DbOrTx = db): Promise<number> {
  const activeQuotations = await ex
    .select({ id: s.quotations.id, customerId: s.quotations.customerId })
    .from(s.quotations)
    .where(isNull(s.quotations.deletedAt))
    .orderBy(desc(s.quotations.effectiveDate));
  const latestPerCustomer = new Map<number, number>();
  for (const q of activeQuotations) {
    if (!latestPerCustomer.has(q.customerId)) latestPerCustomer.set(q.customerId, q.id);
  }
  if (latestPerCustomer.size === 0) return 0;
  await ex.insert(s.quotationFuelApprovals)
    .values([...latestPerCustomer.entries()].map(([customerId, quotationId]) => ({
      fuelPricePeriodId, customerId, quotationId, status: 'PENDING' as const,
    })))
    .onConflictDoNothing();
  return latestPerCustomer.size;
}

/** Batch list for the kế toán alert — pending (or any status) rows with the
 *  names the UI renders (ids never render as text on this surface). */
export async function listQuotationFuelApprovals(status?: string) {
  const rows = await db
    .select({
      id: s.quotationFuelApprovals.id,
      fuelPricePeriodId: s.quotationFuelApprovals.fuelPricePeriodId,
      customerId: s.quotationFuelApprovals.customerId,
      quotationId: s.quotationFuelApprovals.quotationId,
      status: s.quotationFuelApprovals.status,
      customerName: s.customers.name,
      periodUnitPrice: s.fuelPricePeriods.unitPrice,
      periodEffectiveFrom: s.fuelPricePeriods.effectiveFrom,
      quotationName: s.quotations.templateName,
      quotationEffectiveDate: s.quotations.effectiveDate,
      decidedAt: s.quotationFuelApprovals.decidedAt,
    })
    .from(s.quotationFuelApprovals)
    .innerJoin(s.customers, eq(s.customers.id, s.quotationFuelApprovals.customerId))
    .innerJoin(s.fuelPricePeriods, eq(s.fuelPricePeriods.id, s.quotationFuelApprovals.fuelPricePeriodId))
    .innerJoin(s.quotations, eq(s.quotations.id, s.quotationFuelApprovals.quotationId))
    .where(status ? eq(s.quotationFuelApprovals.status, status) : undefined)
    .orderBy(desc(s.quotationFuelApprovals.id));
  return { items: rows, total: rows.length };
}

/** Đồng ý / Không — batch (many ids) or per-row (one id) through the same
 *  endpoint. Already-decided rows keep their state (idempotent batch);
 *  'Để sau' never calls this (rows simply stay PENDING). */
export async function decideQuotationFuelApprovals(actorId: number, ids: number[], decision: 'AGREED' | 'DECLINED', ex: DbOrTx = db) {
  if (ids.length === 0) throw new ApiError(400, 'Chưa chọn dòng nào.');
  const now = new Date();
  const updated = await ex.update(s.quotationFuelApprovals)
    .set({ status: decision, decidedBy: actorId, decidedAt: now, updatedAt: now })
    .where(and(
      inArray(s.quotationFuelApprovals.id, ids),
      eq(s.quotationFuelApprovals.status, 'PENDING'),
    ))
    .returning({ id: s.quotationFuelApprovals.id, customerId: s.quotationFuelApprovals.customerId, status: s.quotationFuelApprovals.status });
  return { updated };
}
