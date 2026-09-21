// Freight rate snapshot lifecycle — wires the pricing engine
// (freight-pricing-engine.service.ts) into the shipment lifecycle.
//
// WHEN snapshots are written (docx §2-D: lock at Ngày vận chuyển):
//   - FCL container intake (`batchUpsertShipmentContainers`): the container
//     type + appointment arrive together — usually the first lock.
//   - CUS workspace container-line appointment edits: supersede.
//   - Shipment `expectedDeliveryDate` change: supersede.
//   - Dispatch (`issueOrderCreateOrUpdate`): definitive per-trip lock with the
//     dispatcher's rate key.
//
// Immutability contract (chốt 2026-09-09 Câu 2 = A): supersede = INSERT only.
// No code path ever UPDATEs or DELETEs a freight_rate_snapshots row; the
// latest row (max id) is the live one and older rows answer "why was this
// trip priced X at the time".
//
// Non-blocking contract (docx §3 MANUAL mode): when the engine cannot resolve
// a parameter (missing terms, missing 15T base price, lag pointing before the
// first fuel period) the fallback writes a MANUAL snapshot with zeros + a
// hint naming the missing parameter. Intake and dispatch always proceed; the
// MANUAL row flags the shipment for accountant manual entry.
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { localDateInBusinessZone } from '@tingting/shared';
import { ApiError } from '../errors';
import {
  persistFreightRateSnapshot,
  resolveFreightRate,
  type ResolveFreightRateInput,
  type ResolvedFreightRate,
} from './freight-pricing-engine.service';
import type { Tx } from './trip-shared';

type DbOrTx = typeof db | Tx;

// ─── Rate key derivation ─────────────────────────────────────────────────────

/**
 * Map an ISO container-type code (20DC, 40HC, 45HC…) onto the revenue-side
 * vehicle-size-class rate key used by `pricing_tables.rate_key`. 20-foot →
 * CONT20; 40/45-foot → CONT40 — the customer's price sheet has no CONT45
 * class, so the 45' rate rides CONT40 (same as the seeded size catalog).
 */
export function containerTypeCodeToRateKey(code: string | null | undefined): string | null {
  const normalized = (code ?? '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.startsWith('20')) return 'CONT20';
  if (normalized.startsWith('40') || normalized.startsWith('45')) return 'CONT40';
  return null;
}

// ─── Resolution with MANUAL fallback ─────────────────────────────────────────

const MANUAL_ZERO_RESULT: Omit<ResolvedFreightRate, 'formula'> = {
  freight: 0,
  surcharge: 0,
  total: 0,
  fuelDelta: 0,
  fuelPricePeriodId: 0,
  rateTermsId: 0,
  pricingTableId: 0,
  fuelNormId: 0,
  billedKm: 0,
  liters: 0,
  sharePct: 0,
  source: 'MANUAL',
};

/**
 * `resolveFreightRate`, but engine lookups that miss (missing terms / base
 * price / norm / fuel period, incl. the lag-before-first-period edge) degrade
 * to a MANUAL result instead of throwing — the pricing wave must never block
 * shipment intake or dispatch. The engine's Vietnamese error message becomes
 * the formula hint shown to CUS/accounting.
 */
export async function resolveFreightRateWithManualFallback(
  input: ResolveFreightRateInput,
): Promise<ResolvedFreightRate> {
  try {
    return await resolveFreightRate(input);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return { ...MANUAL_ZERO_RESULT, formula: `${error.message} — cần nhập tay giá cước` };
    }
    throw error;
  }
}

// ─── Snapshot lock (INSERT-only) ─────────────────────────────────────────────

export interface FreightRateLockOutcome {
  snapshotId: number;
  source: 'AUTO' | 'MANUAL';
  totalAmount: number;
  formula: string;
}

export interface LockShipmentFreightRateArgs {
  shipmentId: number;
  /** Dispatch supplies the trip the snapshot freezes. */
  tripId?: number | null;
  /** Dispatch supplies the dispatcher-selected rate key (pricingRateKey). */
  rateKeyOverride?: string | null;
  /**
   * Anchor derivation to this container's type + appointment (dispatch locks
   * the fulfillment's own container, not just the shipment's first). When
   * absent, the first typed container is used.
   */
  shipmentContainerId?: number | null;
  /**
   * Last-resort transport date (dispatch passes the planned start date) used
   * after the container appointment and the shipment's expected delivery date.
   */
  fallbackTransportDate?: string | null;
}

/**
 * Insert one freight-rate snapshot for the shipment. Skips (returns null)
 * without writing when auto pricing is not applicable YET:
 *   - ad-hoc shipments (Lệnh chạy ngoài: no internal freight norm applies —
 *     revenue is the customer-reported freight plus chi hộ fees), or
 *   - no catalog customer/route, or
 *   - no derivable rate key (no typed container and no override) — LCL
 *     shipments without a dispatcher rate key lock at dispatch instead.
 *
 * Always runs inside the caller's transaction: derivation reads see this
 * transaction's rows, and a rolled-back intake leaves no orphan snapshot.
 */
export async function lockShipmentFreightRate(
  tx: Tx,
  args: LockShipmentFreightRateArgs,
): Promise<FreightRateLockOutcome | null> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    routeId: s.shipments.routeId,
    isAdHoc: s.shipments.isAdHoc,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
  })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, args.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) return null;
  // Lệnh chạy ngoài: bảng định mức cước nội bộ không áp dụng — doanh thu chỉ
  // gồm cước do khách báo và phí chi hộ (spec §4). Đây là bản chất của loại
  // lô, không phải cơ chế bỏ qua kiểm tra cước phí.
  if (shipment.isAdHoc) return null;
  if (shipment.customerId == null) return null;

  // Route source: FCL lots carry the route on containers (the CUS create form
  // keeps shipments.route_id null for FCL), LCL keeps it on the shipment. The
  // lock resolves the route from the anchor container (dispatch passes the
  // fulfillment's container) or the first routed container, so container-level
  // routing freezes exactly like lot-level routing. A lot with no route
  // anywhere still stays silent.
  let routeId = shipment.routeId;
  if (routeId == null && args.shipmentContainerId != null) {
    const [anchored] = await tx.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.shipmentId, args.shipmentId),
        eq(s.shipmentContainers.id, args.shipmentContainerId),
      ))
      .limit(1);
    routeId = anchored?.routeId ?? null;
  }
  if (routeId == null) {
    const [routed] = await tx.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.shipmentId, args.shipmentId),
        isNotNull(s.shipmentContainers.routeId),
      ))
      .orderBy(s.shipmentContainers.id)
      .limit(1);
    routeId = routed?.routeId ?? null;
  }
  if (routeId == null) return null;

  // Derive the rate key: explicit override (dispatch) beats the anchor
  // container's class, which beats the shipment's first typed container.
  // Multi-container shipments with mixed 20/40 types get their exact
  // per-container class at dispatch; intake approximation is acceptable
  // because dispatch supersedes with the precise row.
  let rateKey = args.rateKeyOverride?.trim().toUpperCase() || null;
  let transportDate: string | null = null;
  if (!rateKey) {
    const [typedContainer] = await tx.select({
      typeCode: s.containerTypes.code,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    })
      .from(s.shipmentContainers)
      .innerJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(args.shipmentContainerId != null
        ? and(
          eq(s.shipmentContainers.shipmentId, args.shipmentId),
          eq(s.shipmentContainers.id, args.shipmentContainerId),
        )
        : eq(s.shipmentContainers.shipmentId, args.shipmentId))
      .orderBy(s.shipmentContainers.id)
      .limit(1);
    if (!rateKey) {
      rateKey = containerTypeCodeToRateKey(typedContainer?.typeCode);
    }
    transportDate = (typedContainer?.customerAppointmentAt
      ? localDateInBusinessZone(typedContainer.customerAppointmentAt)
      : null) ?? shipment.expectedDeliveryDate ?? null;
  }
  transportDate = transportDate
    ?? shipment.expectedDeliveryDate
    ?? args.fallbackTransportDate?.trim()
    ?? null;
  if (!rateKey || !transportDate) return null;

  const resolved = await resolveFreightRateWithManualFallback({
    customerId: shipment.customerId,
    routeId,
    vehicleSizeClassCode: rateKey,
    transportDate,
  });

  const snapshotId = await persistFreightRateSnapshot(resolved, {
    shipmentId: args.shipmentId,
    tripId: args.tripId ?? undefined,
    executor: tx,
  });

  return {
    snapshotId,
    source: resolved.source,
    totalAmount: resolved.total,
    formula: resolved.formula,
  };
}

// ─── Read model ──────────────────────────────────────────────────────────────

export interface FreightRateOverrideView {
  id: number;
  systemCalculatedFreight: number;
  finalDebitFreight: number | null;
  overrideReason: string | null;
  overrideBy: number | null;
  overrideAt: string | null;
}

export interface ShipmentFreightRateSnapshotView {
  id: number;
  shipmentId: number | null;
  tripId: number | null;
  source: 'AUTO' | 'MANUAL';
  freightAmount: number;
  surchargeAmount: number;
  totalAmount: number;
  billedKm: number;
  liters: number;
  fuelDelta: number;
  sharePct: number;
  formula: string;
  computedAt: string;
  rateTermsId: number;
  pricingTableId: number;
  fuelNormId: number;
  fuelPricePeriodId: number;
  override: FreightRateOverrideView | null;
}

interface SnapshotJoinRow {
  snapshot: typeof s.freightRateSnapshots.$inferSelect;
  basePrice: string | null;
  baseFuelPrice: string | null;
  fuelPrice: string | null;
  override: typeof s.debitNoteOverrides.$inferSelect | null;
}

/**
 * Reconstruct the human-readable formula from the frozen intermediates +
 * trace joins. The snapshot table intentionally stores numbers, not prose:
 * AUTO rows rebuild the exact engine formula; MANUAL rows name the first
 * missing parameter in engine step order (terms → base price → norm → fuel
 * period) so CUS/accounting sees what to fix.
 */
function buildFormulaHint(row: SnapshotJoinRow): string {
  const snap = row.snapshot;
  const termsMissing = snap.rateTermsId === 0;
  const basePriceMissing = snap.pricingTableId === 0;
  const normMissing = snap.fuelNormId === 0;
  const fuelPeriodMissing = snap.fuelPricePeriodId === 0;

  if (termsMissing || basePriceMissing || normMissing || fuelPeriodMissing) {
    if (termsMissing) return 'Thiếu điều khoản cước tự động (khách × tuyến chưa cấu hình) — cần nhập tay';
    if (basePriceMissing) return 'Thiếu giá gốc cho loại xe/container này — cần nhập tay';
    if (normMissing) return 'Thiếu định mức tiêu hao dầu cho loại xe — cần nhập tay';
    return 'Không tìm thấy kỳ giá dầu hiệu lực (kiểm tra số ngày trễ giá) — cần nhập tay';
  }

  const basePrice = row.basePrice != null ? Number(row.basePrice) : null;
  const baseFuelPrice = row.baseFuelPrice != null ? Number(row.baseFuelPrice) : null;
  const fuelPrice = row.fuelPrice != null ? Number(row.fuelPrice) : null;
  const sharePct = Number(snap.sharePct);
  const liters = Number(snap.liters);
  if (basePrice == null || baseFuelPrice == null || fuelPrice == null) {
    return 'Cấu hình giá đã bị xóa sau khi chốt — xem ảnh chụp tại thời điểm tính';
  }
  return [
    `${basePrice} × (1 + ${sharePct}%) = ${Number(snap.freightAmount)}`,
    `+ MAX(0, (${fuelPrice} − ${baseFuelPrice}) × ${liters.toFixed(3)})`,
    `= ${Number(snap.totalAmount)}`,
  ].join(' ');
}

function toSnapshotView(row: SnapshotJoinRow): ShipmentFreightRateSnapshotView {
  const snap = row.snapshot;
  const isManual = snap.rateTermsId === 0
    || snap.pricingTableId === 0
    || snap.fuelNormId === 0
    || snap.fuelPricePeriodId === 0;
  return {
    id: snap.id,
    shipmentId: snap.shipmentId,
    tripId: snap.tripId,
    source: isManual ? 'MANUAL' : 'AUTO',
    freightAmount: Number(snap.freightAmount),
    surchargeAmount: Number(snap.surchargeAmount),
    totalAmount: Number(snap.totalAmount),
    billedKm: Number(snap.billedKm),
    liters: Number(snap.liters),
    fuelDelta: Number(snap.fuelDelta),
    sharePct: Number(snap.sharePct),
    formula: buildFormulaHint(row),
    computedAt: snap.computedAt.toISOString(),
    rateTermsId: snap.rateTermsId,
    pricingTableId: snap.pricingTableId,
    fuelNormId: snap.fuelNormId,
    fuelPricePeriodId: snap.fuelPricePeriodId,
    override: row.override
      ? {
        id: row.override.id,
        systemCalculatedFreight: Number(row.override.systemCalculatedFreight),
        finalDebitFreight: row.override.finalDebitFreight != null
          ? Number(row.override.finalDebitFreight)
          : null,
        overrideReason: row.override.overrideReason,
        overrideBy: row.override.overrideBy,
        overrideAt: row.override.overrideAt?.toISOString() ?? null,
      }
      : null,
  };
}

function snapshotBaseQuery(executor: DbOrTx) {
  return executor
    .select({
      snapshot: s.freightRateSnapshots,
      basePrice: s.pricingTables.price,
      baseFuelPrice: s.freightRateTerms.baseFuelPrice,
      fuelPrice: s.fuelPricePeriods.unitPrice,
      override: s.debitNoteOverrides,
    })
    .from(s.freightRateSnapshots)
    .leftJoin(s.pricingTables, eq(s.pricingTables.id, s.freightRateSnapshots.pricingTableId))
    .leftJoin(s.freightRateTerms, eq(s.freightRateTerms.id, s.freightRateSnapshots.rateTermsId))
    .leftJoin(s.fuelPricePeriods, eq(s.fuelPricePeriods.id, s.freightRateSnapshots.fuelPricePeriodId))
    .leftJoin(s.debitNoteOverrides, eq(s.debitNoteOverrides.snapshotId, s.freightRateSnapshots.id));
}

export async function getFreightRateSnapshotById(
  snapshotId: number,
  executor: DbOrTx = db,
): Promise<ShipmentFreightRateSnapshotView | null> {
  const [row] = await snapshotBaseQuery(executor)
    .where(eq(s.freightRateSnapshots.id, snapshotId))
    .limit(1);
  return row ? toSnapshotView(row) : null;
}

export interface ShipmentFreightRateView {
  /** Latest snapshot by id — supersede INSERTs make max(id) the live row. */
  latest: ShipmentFreightRateSnapshotView | null;
  snapshotCount: number;
}

export async function getShipmentFreightRateView(
  shipmentId: number,
  executor: DbOrTx = db,
): Promise<ShipmentFreightRateView> {
  const [countRow] = await executor
    .select({ count: sql<number>`count(*)` })
    .from(s.freightRateSnapshots)
    .where(eq(s.freightRateSnapshots.shipmentId, shipmentId));
  const rows = await snapshotBaseQuery(executor)
    .where(eq(s.freightRateSnapshots.shipmentId, shipmentId))
    .orderBy(desc(s.freightRateSnapshots.id))
    .limit(1);
  return {
    latest: rows[0] ? toSnapshotView(rows[0]) : null,
    snapshotCount: Number(countRow?.count ?? 0),
  };
}
