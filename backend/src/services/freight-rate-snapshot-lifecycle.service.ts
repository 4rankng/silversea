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
import { and, desc, eq, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';
import { localDateInBusinessZone } from '@tingting/shared';
import { ApiError } from '../errors';
import {
  persistFreightRateSnapshot,
  resolveFreightRate,
  type ResolveFreightRateInput,
  type ResolvedFreightRate,
} from './freight-pricing-engine.service';
import { bookingFamilyRoot, classifyLotPricingBasis, positiveWeightKg, type LotPricingGrounds } from './freight-lot-basis';
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
 * `resolveFreightRate`, but the engine's one remaining lookup miss (terms —
 * customer × route × transport date unconfigured) degrades to a MANUAL result
 * instead of throwing — the pricing wave must never block shipment intake or
 * dispatch. Every LATER parameter miss (base price, norm, fuel period)
 * already returns MANUAL from inside the engine carrying the trace ids
 * resolved so far (SIL-676; round 2 removed the vehicle-class catalog gate —
 * the engine prices from the sheet's selected row regardless of the class
 * catalog), so `MANUAL_ZERO_RESULT`'s zeroed ids are truthful
 * here: rateTermsId 0 ⟺ the terms lookup itself missed. The engine's
 * Vietnamese error message becomes the formula hint shown to CUS/accounting.
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
  /**
   * Card _58 ruling 4c (QA rework): DISPATCH calls set this — a weightless
   * container lot then 409s ("Thiếu trọng tải") instead of silently skipping,
   * because a silently unpriced dispatch is the exact failure the ruling
   * forbids. Intake calls leave it unset: edits keep skipping pricing.
   */
  requirePrice?: boolean;
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
 * The đủ-căn cứ/thiếu-căn cứ decision itself lives in the pure
 * `classifyLotPricingBasis` (freight-lot-basis.ts, unit-tested): đủ căn cứ
 * (tuyến + khách + hạng xe + ngày vận chuyển [+ trọng tải cont]) → resolve +
 * persist; thiếu → SKIP, không bịa số — DISPATCH's requirePrice turns
 * MISSING_WEIGHT into the loud 409 (card _58 ruling 4c).
 *
 * Always runs inside the caller's transaction: derivation reads see this
 * transaction's rows, and a rolled-back intake leaves no orphan snapshot.
 */
/** SIL-693 — the ONE pricing-grounds derivation, shared by the dispatch freeze
 *  (`lockShipmentFreightRate`) and the cost-lock freeze (`buildCostSnapshot`,
 *  which must record the same đủ/thiếu-căn cứ verdict the dispatch ran, so a
 *  debit-note issuance can tell "unpriced by design" from "pricing never ran").
 *  Returns null when the shipment row is missing — the caller's existing
 *  silent-skip contract. */
export interface DeclaredCargoWeightProbe {
  shipmentId: number;
  /** The fulfillment's own container (the freeze's anchor); null resolves
   *  the lot's trips across any of its containers. */
  anchorContainerId: number | null;
  /** The anchor container's stored weight (raw column value, may be null/0). */
  containerWeightKg: unknown;
  /** The lot's stored weight (raw column value, may be null/0). */
  lotWeightKg: unknown;
  /** The lot's booking reference (Số Bill, else Số Booking) for the family. */
  reference: string | null | undefined;
  customerId: number | null;
}

/**
 * SIL-898 — the declared cargo weight of a container lot, the ONE chain both
 * the dispatch freeze and the /dispatch-detail row read walk, so the row can
 * never display a weight the freeze refuses (CR-010.1 BUG-03's law) nor
 * refuse a weight the row shows.
 *
 * Precedence, each step only when the previous yields no positive weight:
 *   1. the anchor container's own column — a stored 0.00 is NOT a declaration
 *      (`positiveWeightKg`); it must not shadow the lot (staging 07/11: a lot
 *      declared 5000, issued, then the line was zeroed and began 409ing),
 *   2. the declared lot weight (the 9b0b855f fallback),
 *   3. the weight the lot's own trips recorded — the operator's last issued
 *      dispatch of this exact container (canceled retries keep it), and
 *   4. the booking family's declared weight: when every sibling lot of the
 *      same booking (same customer, reference root, e.g. R3Q-676-1/-2/-3/-4)
 *      that declared a weight agrees on ONE positive value, the booking's
 *      declared weight answers for its weightless line — "trọng tải hàng theo
 *      booking", never a default: disagreeing or absent siblings leave the
 *      lot weightless and the dispatch stays loudly blocked (card _58 law).
 */
export async function resolveDeclaredCargoWeightKg(
  tx: DbOrTx,
  probe: DeclaredCargoWeightProbe,
): Promise<number | null> {
  const fromContainer = positiveWeightKg(probe.containerWeightKg);
  if (fromContainer != null) return fromContainer;
  const fromLot = positiveWeightKg(probe.lotWeightKg);
  if (fromLot != null) return fromLot;

  // (3) The lot's own previously issued dispatch weight — the trip snapshot
  // of the same container the fulfillment anchors. Cancel + re-issue must not
  // lose the weight the operator already declared for this exact leg.
  const [lastTripWeight] = await tx.select({ weightKg: s.tripContainers.cargoWeightKg })
    .from(s.tripContainers)
    .innerJoin(s.trips, eq(s.trips.id, s.tripContainers.tripId))
    .where(and(
      eq(s.trips.shipmentId, probe.shipmentId),
      isNull(s.trips.deletedAt),
      ...(probe.anchorContainerId != null
        ? [eq(s.tripContainers.sourceShipmentContainerId, probe.anchorContainerId)]
        : []),
    ))
    .orderBy(desc(s.tripContainers.id))
    .limit(1);
  const fromOwnTrips = positiveWeightKg(lastTripWeight?.weightKg);
  if (fromOwnTrips != null) return fromOwnTrips;

  // (4) The booking family's unanimous declared weight.
  const root = bookingFamilyRoot(probe.reference);
  if (root == null || probe.customerId == null) return null;
  const escapedRoot = root.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const familyFilter = or(
    like(s.shipments.blNumber, `${escapedRoot}-%`),
    like(s.shipments.bookingRef, `${escapedRoot}-%`),
  );
  if (familyFilter == null) return null;
  const [familyContainerWeights, familyLotWeights] = await Promise.all([
    tx.select({ weightKg: s.shipmentContainers.cargoWeightKg })
      .from(s.shipmentContainers)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
      .where(and(
        ne(s.shipments.id, probe.shipmentId),
        eq(s.shipments.customerId, probe.customerId),
        isNull(s.shipments.deletedAt),
        familyFilter,
      )),
    tx.select({ weightKg: s.shipments.cargoWeightKg })
      .from(s.shipments)
      .where(and(
        ne(s.shipments.id, probe.shipmentId),
        eq(s.shipments.customerId, probe.customerId),
        isNull(s.shipments.deletedAt),
        familyFilter,
        isNotNull(s.shipments.cargoWeightKg),
      )),
  ]);
  const votes = [...familyContainerWeights, ...familyLotWeights]
    .map((row) => positiveWeightKg(row.weightKg))
    .filter((weight): weight is number => weight != null);
  const distinct = new Set(votes);
  return distinct.size === 1 ? votes[0]! : null;
}


export async function deriveLotPricingGrounds(
  tx: DbOrTx,
  shipmentId: number,
  args: Pick<LockShipmentFreightRateArgs, 'rateKeyOverride' | 'shipmentContainerId' | 'fallbackTransportDate'>,
): Promise<LotPricingGrounds | null> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    routeId: s.shipments.routeId,
    isAdHoc: s.shipments.isAdHoc,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    cargoWeightKg: s.shipments.cargoWeightKg,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
  })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) return null;

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
        eq(s.shipmentContainers.shipmentId, shipmentId),
        eq(s.shipmentContainers.id, args.shipmentContainerId),
      ))
      .limit(1);
    routeId = anchored?.routeId ?? null;
  }
  if (routeId == null) {
    const [routed] = await tx.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.shipmentId, shipmentId),
        isNotNull(s.shipmentContainers.routeId),
      ))
      .orderBy(s.shipmentContainers.id)
      .limit(1);
    routeId = routed?.routeId ?? null;
  }

  // Derive the rate key: explicit override (dispatch) beats the anchor
  // container's class, which beats the shipment's first typed container.
  // Multi-container shipments with mixed 20/40 types get their exact
  // per-container class at dispatch; intake approximation is acceptable
  // because dispatch supersedes with the precise row.
  let rateKey = args.rateKeyOverride?.trim().toUpperCase() || null;
  let containerTransportDate: string | null = null;
  if (!rateKey) {
    const [typedContainer] = await tx.select({
      typeCode: s.containerTypes.code,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    })
      .from(s.shipmentContainers)
      .innerJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(args.shipmentContainerId != null
        ? and(
          eq(s.shipmentContainers.shipmentId, shipmentId),
          eq(s.shipmentContainers.id, args.shipmentContainerId),
        )
        : eq(s.shipmentContainers.shipmentId, shipmentId))
      .orderBy(s.shipmentContainers.id)
      .limit(1);
    rateKey = containerTypeCodeToRateKey(typedContainer?.typeCode);
    containerTransportDate = typedContainer?.customerAppointmentAt
      ? localDateInBusinessZone(typedContainer.customerAppointmentAt)
      : null;
  }

  // Card 20260922_58 selection half: container base classes pick their PRICE
  // column from cargo weight (≥ 20,0t nặng; weight = cargo weight; missing
  // weight BLOCKS — never a default). Norms stay keyed on the base class, so
  // liters never change. The weight read only runs for container base rate
  // keys (truck keys price unsplit).
  // SIL-898 — the declared weight is the ONE chain
  // (`resolveDeclaredCargoWeightKg`): the anchor container's own column first
  // (a stored 0.00 is not a declaration and no longer shadows the lot — the
  // staging lot that issued at 5000 then got zeroed 409'd on the retry), the
  // declared lot weight second (9b0b855f), then the lot's own last issued
  // trip weight, then the booking family's unanimous declared weight. The
  // row read walks the SAME chain, so a row can never display a weight the
  // freeze refuses nor refuse a weight the row shows (CR-010.1 BUG-03 law).
  let containerCargoWeightKg: number | null = null;
  if (rateKey != null && /^(CONT20|CONT40)$/.test(rateKey)) {
    let anchorContainerWeightKg: unknown = null;
    if (args.shipmentContainerId != null) {
      const [anchorContainer] = await tx.select({ cargoWeightKg: s.shipmentContainers.cargoWeightKg })
        .from(s.shipmentContainers)
        .where(and(
          eq(s.shipmentContainers.shipmentId, shipmentId),
          eq(s.shipmentContainers.id, args.shipmentContainerId),
        ))
        .limit(1);
      anchorContainerWeightKg = anchorContainer?.cargoWeightKg ?? null;
    } else {
      const [firstTypedContainer] = await tx.select({ cargoWeightKg: s.shipmentContainers.cargoWeightKg })
        .from(s.shipmentContainers)
        .where(and(
          eq(s.shipmentContainers.shipmentId, shipmentId),
          isNotNull(s.shipmentContainers.containerTypeId),
        ))
        .orderBy(s.shipmentContainers.id)
        .limit(1);
      anchorContainerWeightKg = firstTypedContainer?.cargoWeightKg ?? null;
    }
    containerCargoWeightKg = await resolveDeclaredCargoWeightKg(tx, {
      shipmentId,
      anchorContainerId: args.shipmentContainerId ?? null,
      containerWeightKg: anchorContainerWeightKg,
      lotWeightKg: shipment.cargoWeightKg,
      reference: shipment.blNumber ?? shipment.bookingRef,
      customerId: shipment.customerId,
    });
  }

  return {
    isAdHoc: shipment.isAdHoc,
    customerId: shipment.customerId,
    routeId,
    rateKey,
    containerTransportDate,
    expectedDeliveryDate: shipment.expectedDeliveryDate,
    fallbackTransportDate: args.fallbackTransportDate ?? null,
    containerCargoWeightKg,
  };
}

export async function lockShipmentFreightRate(
  tx: Tx,
  args: LockShipmentFreightRateArgs,
): Promise<FreightRateLockOutcome | null> {
  const grounds = await deriveLotPricingGrounds(tx, args.shipmentId, args);
  if (!grounds) return null;

  const decision = classifyLotPricingBasis(grounds);
  if (decision.action === 'SKIP') {
    // Ruling (c): missing weight = NO PRICE, deterministically — the freeze is
    // SKIPPED (no invented number, no stale column) rather than throwing:
    // a hard 409 here would also block plain intake edits (dates, etc.) on
    // weightless lots, which never asked for a price. Dispatch surfaces the
    // missing price through the absent freeze; the shared resolver's
    // MISSING_WEIGHT message carries the reason for price-preview surfaces.
    if (decision.reason === 'MISSING_WEIGHT' && args.requirePrice) {
      throw new ApiError(409, 'Thiếu trọng tải — không thể tính giá container. Nhập trọng tải hàng theo booking rồi thử lại.');
    }
    return null;
  }

  // classifyLotPricingBasis only LOCKs with customer + route present; these
  // guards keep the resolved call's types honest without inventing defaults.
  if (grounds.customerId == null || grounds.routeId == null) return null;

  const resolved = await resolveFreightRateWithManualFallback({
    customerId: grounds.customerId,
    routeId: grounds.routeId,
    vehicleSizeClassCode: decision.rateKey,
    priceVehicleSizeClassCode: decision.priceVehicleSizeClassCode,
    transportDate: decision.transportDate,
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
    source: snap.formulaText ? 'AUTO' : (isManual ? 'MANUAL' : 'AUTO'),
    freightAmount: Number(snap.freightAmount),
    surchargeAmount: Number(snap.surchargeAmount),
    totalAmount: Number(snap.totalAmount),
    billedKm: Number(snap.billedKm),
    liters: Number(snap.liters),
    fuelDelta: Number(snap.fuelDelta),
    sharePct: Number(snap.sharePct),
    formula: snap.formulaText ?? buildFormulaHint(row),
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
