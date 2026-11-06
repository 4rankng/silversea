// Card 20260918_19 — lot cost lock (Khóa lô) + adjust history.
// Spec: docs/card-19-lock-and-adjust-design.md. A LOT lock, independent of
// the kỳ kế toán lock: guards chain (the accounting lock still wins for cost
// edits). Snapshots are assembled server-side from engine values and are
// never recomputed after lock — "mở kỳ mới không đổi số đã khóa".
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import { effectiveBillingPlate } from '@tingting/shared';
import * as s from '../db/schema';
import { db } from '../db';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Executor } from '../db';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { getShipmentDebitSummary } from './shipment-debit-summary.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { computeLotPayablesBreakdown } from './lot-payables.service';
import { resolveLotZoneSurcharge } from './zone-surcharge.service';
import { documentVatTotals, VAT_TREATMENT_VERSION } from './billing-document-shared.service';
import { buildFrozenShipmentDebitLines } from './shipment-cost-lock-lines';
import { deriveLotPricingGrounds } from './freight-rate-snapshot-lifecycle.service';
import { classifyLotPricingBasis } from './freight-lot-basis';

export const SHIPMENT_COST_LOCKED_MESSAGE = 'Lô hàng đã khóa chi phí. Cần ADMIN mở khóa (kèm lý do) để chỉnh sửa chi phí.';
export const SHIPMENT_COST_NOT_LOCKED_MESSAGE = 'Lô hàng chưa khóa chi phí — hãy khóa lô trước khi điều chỉnh.';

/** Advisory-locked lot-claim namespace: serializes concurrent exports that
 * touch the same locked lot before the active-claim check/insert runs. */
const LOT_CLAIM_LOCK_SCOPE = 'billing-document-lot-claim';

/** Lot-level uniqueness guard (ruling 2026-09-19): a locked lot may appear in
 * at most ONE issued debit note. Overlapping selections are rejected 409 with
 * the colliding lot codes so the UI can name them. */
async function assertLotsNotInIssuedDebitNote(
  executor: Executor,
  shipmentIds: readonly number[],
): Promise<void> {
  await lockApplicationOwnedUniquenessSet(
    executor,
    shipmentIds.map((shipmentId) => ({ scope: LOT_CLAIM_LOCK_SCOPE, parts: [shipmentId] })),
  );
  const overlapping = await executor.select({
    shipmentId: s.debitNoteLots.shipmentId,
    shipmentCode: s.shipments.shipmentCode,
  })
    .from(s.debitNoteLots)
    .innerJoin(s.shipments, eq(s.shipments.id, s.debitNoteLots.shipmentId))
    .where(and(
      inArray(s.debitNoteLots.shipmentId, [...shipmentIds]),
      isNull(s.debitNoteLots.releasedAt),
    ));
  if (overlapping.length > 0) {
    const overlappingLotCodes = [...new Set(overlapping.map((row) => row.shipmentCode ?? String(row.shipmentId)))];
    throw new ApiError(
      409,
      `Các lô ${overlappingLotCodes.join(', ')} đã được xuất Debit Note. Mỗi lô đã khóa chỉ xuất trong một Debit Note duy nhất.`,
      undefined,
      { overlappingLotCodes },
    );
  }
}

/** Freeze gate for every Lớp-2 write surface on the shipment (mirrors
 *  assertShipmentAccountingUnlocked). Violations → 409 with the dedicated
 *  message. QA 2026-11-04: when the locked lot already sits in an issued
 *  Debit Note, "ADMIN mở khóa" is itself refused (unlockShipmentCost 409s on
 *  the same debitNoteLots claim), so the guidance names the document
 *  instead of pointing at an impossible unlock. */
export async function assertShipmentCostUnlocked(executor: Executor, shipmentId: number): Promise<void> {
  const [active] = await executor.select({ id: s.shipmentCostLocks.id })
    .from(s.shipmentCostLocks)
    .where(and(
      eq(s.shipmentCostLocks.shipmentId, shipmentId),
      isNull(s.shipmentCostLocks.unlockedAt),
    ))
    .limit(1);
  if (!active) return;
  const [claim] = await executor.select({ documentId: s.debitNoteLots.documentId })
    .from(s.debitNoteLots)
    .where(and(
      eq(s.debitNoteLots.shipmentId, shipmentId),
      isNull(s.debitNoteLots.releasedAt),
    ))
    .limit(1);
  if (claim) {
    throw new ApiError(409, `Lô đã nằm trong Debit Note #${claim.documentId} — không sửa được chi phí; xử lý chứng từ debit trước khi mở khóa lô.`);
  }
  throw new ApiError(409, SHIPMENT_COST_LOCKED_MESSAGE);
}

/** Audit 2026-11-04 §2.3 — trip-level freeze gate for the cost lock, the
 * byte-for-byte mirror of assertTripShipmentAccountingUnlocked: the lot a
 * trip executes resolves through the fulfillment (direct link wins; the
 * wave-model fulfillment lot is the fallback; a soft-deleted lot counts as
 * unlocked — nothing live left to protect). No resolvable lot ⇒ allow
 * (fail-open, the accounting variant's own ruling). */
export async function assertTripShipmentCostUnlocked(executor: Executor, tripId: number) {
  const [trip] = await executor.select({
    shipmentId: sql<number | null>`coalesce(${s.trips.shipmentId}, ${s.shipmentFulfillments.shipmentId})`,
  })
    .from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  if (trip.shipmentId != null) {
    const [shipment] = await executor.select({ deletedAt: s.shipments.deletedAt })
      .from(s.shipments)
      .where(eq(s.shipments.id, trip.shipmentId))
      .limit(1);
    if (shipment && shipment.deletedAt == null) {
      await assertShipmentCostUnlocked(executor, trip.shipmentId);
    }
  }
  return trip.shipmentId;
}

/** Server-assembled frozen Lớp-1 totals from the rollup engine values —
 *  never client amounts. SIL-693: the freeze also records the pricing engine's
 *  đủ/thiếu-căn cứ verdict (`classifyLotPricingBasis` over the SAME grounds
 *  derivation the dispatch freeze runs — one `deriveLotPricingGrounds`) so a
 *  debit-note issuance can tell "unpriced by design" (ad-hoc) from "pricing
 *  never ran" (the silent freight-less note defect). Locks frozen before
 *  SIL-693 lack the key; readers treat missing keys as absent (legacy law). */
async function buildCostSnapshot(shipmentId: number, executor: Executor = db): Promise<Record<string, unknown>> {
  const [lot] = await db.select({ customerId: s.shipments.customerId })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
  if (!lot) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
  const summary = await getShipmentDebitSummary({ customerId: lot.customerId!, lockStatus: 'ALL' });
  const item = summary.items.find((row) => row.shipmentId === shipmentId);
  const payables = await computeLotPayablesBreakdown(shipmentId);
  // Freeze contract: port labels join the frozen basis — a rename after the
  // lock must not rewrite the issued note's lift/drop columns. Per-container
  // capture (catalog labels + ad-hoc raw names); old snapshots lack the key
  // and consumers fall back to live reads (null = not frozen).
  const lotContainers = await db.select({
    id: s.shipmentContainers.id,
    pickupPortId: s.shipmentContainers.pickupPortId,
    dropoffPortId: s.shipmentContainers.dropoffPortId,
    rawPickupPortName: s.shipmentContainers.rawPickupPortName,
    rawDropoffPortName: s.shipmentContainers.rawDropoffPortName,
  }).from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId))
    .orderBy(s.shipmentContainers.id);
  const portIdSet = new Set<number>();
  for (const c of lotContainers) {
    if (c.pickupPortId != null) portIdSet.add(c.pickupPortId);
    if (c.dropoffPortId != null) portIdSet.add(c.dropoffPortId);
  }
  const portNameById = new Map<number, string>();
  if (portIdSet.size > 0) {
    const portRows = await db.select({ id: s.ports.id, name: s.ports.name })
      .from(s.ports)
      .where(inArray(s.ports.id, [...portIdSet]));
    for (const row of portRows) portNameById.set(row.id, row.name);
  }
  const portLabels = {
    byContainer: lotContainers.map((c) => ({
      containerId: c.id,
      liftSiteLabel: c.pickupPortId != null ? portNameById.get(c.pickupPortId) ?? null : null,
      dropSiteLabel: c.dropoffPortId != null ? portNameById.get(c.dropoffPortId) ?? null : null,
      rawLiftSiteName: c.rawPickupPortName,
      rawDropSiteName: c.rawDropoffPortName,
    })),
    ports: Object.fromEntries([...portIdSet].map((id) => [String(id), portNameById.get(id) ?? null])),
  };
  return {
    freightAuto: item?.freightAuto ?? null,
    chiHoTotal: item?.chiHoTotal ?? null,
    receivableTotal: item?.receivableTotal ?? null,
    profit: item?.profit ?? null,
    // SIL-693 provenance (see the function doc): the classifier's verdict over
    // the shared grounds derivation. Intake-consistent scope (no dispatch
    // container/rate-key override): the lot-level "should a price exist" law.
    freightPricingBasis: await (async () => {
      const grounds = await deriveLotPricingGrounds(executor, shipmentId, {});
      return grounds ? classifyLotPricingBasis(grounds) : null;
    })(),
    // Frozen 2.3 composition (ruling 2026-09-19): a catalog rename must not
    // rewrite the shape of an issued note. Old snapshots lack these keys —
    // readers treat missing keys as null (Chưa xác định).
    externalFreightCost: payables.externalFreightCost,
    hqgsFee: payables.hqgsFee,
    phatSinhFee: payables.phatSinhFee,
    unclassifiedFee: payables.unclassifiedFee,
    opsExpenseTotal: payables.opsExpenseTotal,
    payableTotal: payables.payableTotal,
    portLabels,
    zoneSurcharge: await resolveLotZoneSurcharge(shipmentId),
  };
}

export interface LockShipmentCostInput {
  shipmentId: number;
  expectedShipmentVersion?: number | null;
  lockNote?: string | null;
  actor: AuthUser;
  idempotencyKey: string;
}

export interface ShipmentCostLockAuditResult {
  id: number;
  lockedBy: number;
  lockedByName: string | null;
  lockedAt: string;
  lockNote: string | null;
}

export async function lockShipmentCost(input: LockShipmentCostInput): Promise<ShipmentCostLockAuditResult> {
  const { result } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_COST_LOCK,
    idempotencyKey: input.idempotencyKey,
    payload: { shipmentId: input.shipmentId, expectedShipmentVersion: input.expectedShipmentVersion ?? null, lockNote: input.lockNote ?? null },
    createdBy: input.actor.userId,
    entityType: 'shipment',
    create: async (tx) => {
      const [shipment] = await tx.select({ id: s.shipments.id, version: s.shipments.version, deletedAt: s.shipments.deletedAt })
        .from(s.shipments).where(eq(s.shipments.id, input.shipmentId)).limit(1);
      if (!shipment || shipment.deletedAt) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
      if (input.expectedShipmentVersion != null && shipment.version !== input.expectedShipmentVersion) {
        throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
      }
      const [active] = await tx.select({ id: s.shipmentCostLocks.id })
        .from(s.shipmentCostLocks)
        .where(and(
          eq(s.shipmentCostLocks.shipmentId, input.shipmentId),
          isNull(s.shipmentCostLocks.unlockedAt),
        ))
        .limit(1);
      if (active) throw new ApiError(409, SHIPMENT_COST_LOCKED_MESSAGE);
      const snapshot = await buildCostSnapshot(input.shipmentId, tx);
      const [row] = await tx.insert(s.shipmentCostLocks).values({
        shipmentId: input.shipmentId,
        shipmentVersionAtLock: shipment.version,
        costSnapshot: snapshot,
        lockedBy: input.actor.userId,
        lockNote: input.lockNote?.trim() || null,
      }).returning({
        id: s.shipmentCostLocks.id,
        lockedBy: s.shipmentCostLocks.lockedBy,
        lockedAt: s.shipmentCostLocks.lockedAt,
        lockNote: s.shipmentCostLocks.lockNote,
      });
      // Audit 2026-11-04 r2 (QA comment 3834): the write responses carry the
      // audit fields themselves — never id-only.
      return {
        id: row.id,
        lockedBy: row.lockedBy,
        lockedByName: input.actor.fullName ?? input.actor.username ?? null,
        lockedAt: row.lockedAt.toISOString(),
        lockNote: row.lockNote,
      };
    },
  });
  return result;
}

export interface UnlockShipmentCostInput {
  shipmentId: number;
  reason: string;
  actor: AuthUser;
  expectedShipmentVersion?: number | null;
}

/** Mở khóa lô (audit 2026-11-04 §2.1): closes the ACTIVE cost lock with the
 * actor + reason on the row itself — history survives, and a later re-lock
 * inserts a NEW active row (the partial unique index
 * `shipment_cost_locks_active_uniq … WHERE unlocked_at is null` permits it).
 * Mirrors the accounting-lock reopen governance the customer accepted: ADMIN
 * route gate + a mandatory reason.
 *
 * Refused while an unreleased debit-note claim holds the lot: the issued note
 * priced THIS lock's frozen snapshot, so the document must be handled first
 * (canceling releases the claim, `debit-note-lifecycle.service.ts`). The
 * accounting lock is deliberately NOT asserted here — unlock is a lock-state
 * write, not cost data, and that lock keeps its own ADMIN reopen channel. */
export interface ShipmentCostUnlockAuditResult {
  id: number;
  unlockedBy: number;
  unlockedByName: string | null;
  unlockedAt: string;
  unlockReason: string;
}

export async function unlockShipmentCost(input: UnlockShipmentCostInput): Promise<ShipmentCostUnlockAuditResult> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) throw new ApiError(400, 'Vui lòng nhập lý do mở khóa.');
  if (reason.length > 2000) throw new ApiError(400, 'Lý do mở khóa không được vượt quá 2000 ký tự.');
  return db.transaction(async (tx) => {
    const [shipment] = await tx.select({ id: s.shipments.id, version: s.shipments.version, deletedAt: s.shipments.deletedAt })
      .from(s.shipments).where(eq(s.shipments.id, input.shipmentId)).limit(1);
    if (!shipment || shipment.deletedAt) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
    if (input.expectedShipmentVersion != null && shipment.version !== input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
    }
    const [active] = await tx.select({ id: s.shipmentCostLocks.id })
      .from(s.shipmentCostLocks)
      .where(and(
        eq(s.shipmentCostLocks.shipmentId, input.shipmentId),
        isNull(s.shipmentCostLocks.unlockedAt),
      ))
      .limit(1)
      .for('update');
    if (!active) throw new ApiError(409, 'Lô hàng chưa khóa chi phí — không có khóa nào để mở.');
    const [claim] = await tx.select({ documentId: s.debitNoteLots.documentId })
      .from(s.debitNoteLots)
      .where(and(
        eq(s.debitNoteLots.shipmentId, input.shipmentId),
        isNull(s.debitNoteLots.releasedAt),
      ))
      .limit(1);
    if (claim) {
      throw new ApiError(409, `Lô đã nằm trong Debit Note #${claim.documentId} — xử lý chứng từ trước khi mở khóa lô.`);
    }
    await tx.update(s.shipmentCostLocks).set({
      unlockedBy: input.actor.userId,
      unlockedAt: new Date(),
      unlockReason: reason,
    }).where(eq(s.shipmentCostLocks.id, active.id));
    await tx.insert(s.auditLogs).values({
      userId: input.actor.userId,
      actorName: input.actor.fullName ?? input.actor.username ?? undefined,
      message: 'SHIPMENT_COST_UNLOCKED',
      entityType: 'shipment',
      entityId: input.shipmentId,
      payload: { lockId: active.id, reason },
    });
    // Audit 2026-11-04 r2 (QA comment 3834): the unlock response carries the
    // audit fields themselves — who, why, when — never id-only.
    return {
      id: active.id,
      unlockedBy: input.actor.userId,
      unlockedByName: input.actor.fullName ?? input.actor.username ?? null,
      unlockedAt: new Date().toISOString(),
      unlockReason: reason,
    };
  });
}

export interface ShipmentCostLockHistoryEvent {
  action: 'LOCK' | 'UNLOCK';
  lockId: number;
  actorId: number | null;
  actorName: string | null;
  reason: string | null;
  /** ISO instant of lockedAt (LOCK) / unlockedAt (UNLOCK). */
  timestamp: string;
  /** The lot's unreleased Debit Note claim at read time, if any — the same
   *  claim the unlock path refuses on (ruling 2026-09-19, one issued note
   *  per locked lot). null once the note releases the claim. */
  debitNoteId: number | null;
}

/** Audit 2026-11-04 r2 (QA comment 3834 §1) — the lot's full khóa/mở khóa
 * history: one LOCK event per lock row plus its UNLOCK when closed, each
 * with actor name, reason, timestamp and the debit-note link when the lot
 * sits under an unreleased claim. ADMIN-only surface (route gate) — the
 * unlock governance is ADMIN, so reading its audit trail rides the same
 * clearance. */
export async function listShipmentCostLockHistory(shipmentId: number): Promise<{ events: ShipmentCostLockHistoryEvent[] }> {
  const [shipment] = await db.select({ id: s.shipments.id, deletedAt: s.shipments.deletedAt })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
  if (!shipment || shipment.deletedAt) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
  const locker = alias(s.users, 'cost_lock_locker');
  const unlocker = alias(s.users, 'cost_lock_unlocker');
  const [rows, claims] = await Promise.all([
    db.select({
      id: s.shipmentCostLocks.id,
      lockedBy: s.shipmentCostLocks.lockedBy,
      lockedAt: s.shipmentCostLocks.lockedAt,
      lockNote: s.shipmentCostLocks.lockNote,
      lockedByName: locker.fullName,
      unlockedBy: s.shipmentCostLocks.unlockedBy,
      unlockedAt: s.shipmentCostLocks.unlockedAt,
      unlockReason: s.shipmentCostLocks.unlockReason,
      unlockedByName: unlocker.fullName,
    }).from(s.shipmentCostLocks)
      .leftJoin(locker, eq(locker.id, s.shipmentCostLocks.lockedBy))
      .leftJoin(unlocker, eq(unlocker.id, s.shipmentCostLocks.unlockedBy))
      .where(eq(s.shipmentCostLocks.shipmentId, shipmentId))
      .orderBy(asc(s.shipmentCostLocks.lockedAt), asc(s.shipmentCostLocks.id)),
    db.select({ documentId: s.debitNoteLots.documentId })
      .from(s.debitNoteLots)
      .where(and(eq(s.debitNoteLots.shipmentId, shipmentId), isNull(s.debitNoteLots.releasedAt)))
      .limit(1),
  ]);
  const debitNoteId = claims[0]?.documentId ?? null;
  const events: ShipmentCostLockHistoryEvent[] = [];
  for (const row of rows) {
    events.push({
      action: 'LOCK',
      lockId: row.id,
      actorId: row.lockedBy,
      actorName: row.lockedByName ?? null,
      reason: row.lockNote ?? null,
      timestamp: row.lockedAt.toISOString(),
      debitNoteId,
    });
    if (row.unlockedAt != null) {
      events.push({
        action: 'UNLOCK',
        lockId: row.id,
        actorId: row.unlockedBy ?? null,
        actorName: row.unlockedByName ?? null,
        reason: row.unlockReason ?? null,
        timestamp: row.unlockedAt.toISOString(),
        debitNoteId,
      });
    }
  }
  return { events };
}

export interface AdjustShipmentCostInput {
  shipmentId: number;
  reason: string;
  changes?: Record<string, unknown> | null;
  actor: AuthUser;
  idempotencyKey: string;
}

export interface AdjustShipmentCostInput {
  shipmentId: number;
  reason: string;
  changes?: Record<string, unknown> | null;
  actor: AuthUser;
  idempotencyKey: string;
}

export async function adjustShipmentCost(input: AdjustShipmentCostInput): Promise<{ id: number }> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) throw new ApiError(400, 'Vui lòng nhập lý do điều chỉnh.');
  const [lock] = await db.select({ id: s.shipmentCostLocks.id, snapshot: s.shipmentCostLocks.costSnapshot })
    .from(s.shipmentCostLocks)
    .where(and(
      eq(s.shipmentCostLocks.shipmentId, input.shipmentId),
      isNull(s.shipmentCostLocks.unlockedAt),
    ))
    .limit(1);
  if (!lock) throw new ApiError(409, SHIPMENT_COST_NOT_LOCKED_MESSAGE);
  await assertShipmentAccountingUnlocked(db, input.shipmentId);
  const [existing] = await db.select({ id: s.shipmentCostAdjustments.id })
    .from(s.shipmentCostAdjustments)
    .where(eq(s.shipmentCostAdjustments.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) return { id: existing.id };
  const after = { ...(lock.snapshot ?? {}), ...(input.changes ?? {}), adjustedNote: reason };
  const [row] = await db.insert(s.shipmentCostAdjustments).values({
    shipmentId: input.shipmentId,
    costLockId: lock.id,
    beforeJson: (lock.snapshot ?? {}) as Record<string, unknown>,
    afterJson: after,
    reason,
    adjustedBy: input.actor.userId,
    idempotencyKey: input.idempotencyKey,
  }).returning({ id: s.shipmentCostAdjustments.id });
  return { id: row.id };
}

export async function listShipmentCostAdjustments(shipmentId: number): Promise<Array<Record<string, unknown>>> {
  return db.select({
    id: s.shipmentCostAdjustments.id,
    before: s.shipmentCostAdjustments.beforeJson,
    after: s.shipmentCostAdjustments.afterJson,
    reason: s.shipmentCostAdjustments.reason,
    adjustedAt: s.shipmentCostAdjustments.adjustedAt,
  }).from(s.shipmentCostAdjustments)
    .where(eq(s.shipmentCostAdjustments.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentCostAdjustments.id));
}

/** Ruling 2026-09-19: the note's range is [min,max] of the selection's
 *  expected delivery dates — the picker is a filter, the selection is the
 *  document's content, so a same-selection replay always derives the same
 *  range. A selection with no delivery dates falls back to the processing
 *  day (the columns are notNull); the residual is logged, not hidden. */
/** The business calendar is VN-local: a "day" is the Asia/Ho_Chi_Minh
 *  calendar date of an instant, never the UTC date of the ISO string. */
export function vnCalendarDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function deriveRangeFromSelection(lots: ReadonlyArray<{ expectedDeliveryDate: string | null }>, now: () => Date = () => new Date()): { rangeFrom: string; rangeTo: string; fallback: boolean } {
  const dates = lots.map((lot) => lot.expectedDeliveryDate).filter((date): date is string => date != null).sort();
  if (dates.length === 0) {
    const today = vnCalendarDay(now());
    console.warn(`[debit-note] range falls back to the processing day — the selection carries no expected delivery dates`);
    return { rangeFrom: today, rangeTo: today, fallback: true };
  }
  return { rangeFrom: dates[0]!, rangeTo: dates[dates.length - 1]!, fallback: false };
}

export interface CreateDebitNoteFromCostLockInput {
  shipmentId: number;
  actor: AuthUser;
  idempotencyKey: string;
}

/** Xuất Debit Note from the active cost lock (ruling a): the snapshot's
 *  frozen values become the document's line set at creation — the document
 *  row is the debt instrument and never re-reads live rows afterwards.
 *  409 when the lot has no active lock: export only exists on locked lots. */
export async function createDebitNoteFromCostLock(
  input: CreateDebitNoteFromCostLockInput,
): Promise<{ id: number }> {
  const { result } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DEBIT_NOTE_FROM_LOCK,
    idempotencyKey: input.idempotencyKey,
    payload: { shipmentId: input.shipmentId },
    createdBy: input.actor.userId,
    entityType: 'billing_document',
    create: async (tx) => {
      const [lot] = await tx.select({
        id: s.shipments.id,
        customerId: s.shipments.customerId,
        rawCustomerName: s.shipments.rawCustomerName,
        shipmentCode: s.shipments.shipmentCode,
        expectedDeliveryDate: s.shipments.expectedDeliveryDate,
        // FB-094 §II.4: the file must print BKS báo khách + loại xe tính cước thu.
        billingTruckNo: s.shipments.billingTruckNo,
        actualTruckNo: s.shipments.actualTruckNo,
        cargoMode: s.shipments.cargoMode,
        revVehicleClassName: s.vehicleSizeClasses.name,
        revVehicleClassCode: s.vehicleSizeClasses.code,
      }).from(s.shipments)
        .leftJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.shipments.revVehicleClassId))
        .where(eq(s.shipments.id, input.shipmentId)).limit(1);
      if (!lot) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
      const [lock] = await tx.select({ snapshot: s.shipmentCostLocks.costSnapshot })
        .from(s.shipmentCostLocks)
        .where(and(
          eq(s.shipmentCostLocks.shipmentId, input.shipmentId),
          isNull(s.shipmentCostLocks.unlockedAt),
        ))
        .limit(1);
      if (!lock) throw new ApiError(409, SHIPMENT_COST_NOT_LOCKED_MESSAGE);
      await assertLotsNotInIssuedDebitNote(tx, [input.shipmentId]);
      const { rangeFrom, rangeTo } = deriveRangeFromSelection([lot]);
      const snapshot = (lock.snapshot ?? {}) as Record<string, unknown>;
      const lineRows = buildFrozenShipmentDebitLines(
        snapshot,
        lot.shipmentCode ?? String(input.shipmentId),
        {
          // Spec 23/10 — the frozen record holds the plate REPORTED to the
          // customer: BKS báo khách, or the ĐV-assigned BKS thực when blank
          // (effectiveBillingPlate; LCL only).
          billingTruckNo: effectiveBillingPlate(lot),
          vehicleType: lot.revVehicleClassName ?? lot.revVehicleClassCode,
        },
      );
      const totals = documentVatTotals(lineRows);
      const [doc] = await tx.insert(s.billingDocuments).values({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: lot.customerId ?? 0,
        entityName: lot.rawCustomerName?.trim() || null,
        rangeFrom,
        rangeTo,
        issuedAt: new Date(),
        debitNoteStatus: 'SENT',
        totalInclVat: String(totals.gross), totalNet: String(totals.net),
        totalTax: String(totals.tax), totalGross: String(totals.gross),
        vatTreatmentVersion: VAT_TREATMENT_VERSION, createdBy: input.actor.userId,
      }).returning({ id: s.billingDocuments.id });
      if (lineRows.length > 0) {
        await tx.insert(s.billingDocumentLines).values(lineRows.map((line, index) => ({
          documentId: doc.id,
          sourceType: 'ADHOC' as const,
          sourceId: null,
          // FB-094 §II.4: BKS báo khách + loại xe tính cước thu ride on the
          // frozen line so both the file export and the read API render them.
          renderData: line.renderData ? { ...line.renderData } : null,
          lineType: line.lineType,
          typeLabel: line.typeLabel,
          description: line.description,
          baseAmount: String(line.baseAmount), netAmount: String(line.netAmount),
          taxAmount: String(line.taxAmount), grossAmount: String(line.grossAmount),
          vatTreatment: line.vatTreatment, vatRate: String(line.vatRate),
          vatTreatmentVersion: line.vatTreatmentVersion, sortOrder: index,
        })));
      }
      await tx.insert(s.debitNoteLots).values([{
        documentId: doc.id,
        shipmentId: input.shipmentId,
        createdBy: input.actor.userId,
      }]);
      return { id: doc.id };
    },
  });
  return result;
}

export interface CreateConsolidatedDebitNoteInput {
  shipmentIds: number[];
  actor: AuthUser;
}

/** GỘP THEO KỲ (ruling 2026-09-19): one debit note per customer per period —
 *  the export takes ALL selected locked lots of one customer and issues a
 *  SINGLE document whose lines are the union of those lots' frozen snapshot
 *  lines, grouped per lot. Idempotent by selection: the key is derived
 *  server-side from the sorted lot ids, so the same selection replayed
 *  returns the same document regardless of client keys. */
export async function createConsolidatedDebitNote(
  input: { shipmentIds: number[]; actor: AuthUser },
): Promise<{ id: number }> {
  const shipmentIds = [...new Set(input.shipmentIds)].sort((a, b) => a - b);
  if (shipmentIds.length === 0) {
    throw new ApiError(400, 'Vui lòng chọn ít nhất một lô đã khóa để xuất Debit Note.');
  }
  const lots = await db.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    rawCustomerName: s.shipments.rawCustomerName,
    shipmentCode: s.shipments.shipmentCode,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    // FB-094 §II.4: BKS báo khách + loại xe tính cước thu khách per lot.
    billingTruckNo: s.shipments.billingTruckNo,
    actualTruckNo: s.shipments.actualTruckNo,
    cargoMode: s.shipments.cargoMode,
    revVehicleClassName: s.vehicleSizeClasses.name,
    revVehicleClassCode: s.vehicleSizeClasses.code,
  }).from(s.shipments)
    .leftJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.shipments.revVehicleClassId))
    .where(inArray(s.shipments.id, shipmentIds));
  if (lots.length !== shipmentIds.length) throw new ApiError(404, 'Có lô hàng không tồn tại hoặc đã bị xóa.');
  const customerIds = new Set(lots.map((lot) => lot.customerId));
  if (customerIds.size > 1) throw new ApiError(409, 'Các lô phải cùng một khách hàng để gộp kỳ xuất Debit Note.');
  const lockRows = await db.select({
    shipmentId: s.shipmentCostLocks.shipmentId,
    snapshot: s.shipmentCostLocks.costSnapshot,
  }).from(s.shipmentCostLocks)
    .where(and(
      inArray(s.shipmentCostLocks.shipmentId, shipmentIds),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  if (lockRows.length !== shipmentIds.length) {
    throw new ApiError(409, 'Xuất Debit Note chỉ áp dụng cho lô đã khóa chi phí.');
  }
  const customerId = lots[0]!.customerId ?? 0;
  // SIL-693 r2: the derived key ignores client headers, so a selection ANY
  // user once exported replays THEIR idempotency record — runIdempotent then
  // 409s with the actor-collision line before `create` (and the overlap
  // guard living inside it) ever runs. Answer the overlap law FIRST so the
  // selection that is already inside a Debit Note always gets the friendly
  // 409 (with overlappingLotCodes) instead of the actor-collision mask. The
  // in-transaction guard below stays authoritative for the create path.
  await assertLotsNotInIssuedDebitNote(db, shipmentIds);
  const idempotencyKey = `consolidated:${customerId}:${createHash('sha256').update(shipmentIds.join(',')).digest('hex').slice(0, 40)}`;
  const { result } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DEBIT_NOTE_CONSOLIDATED,
    idempotencyKey,
    payload: { shipmentIds },
    createdBy: input.actor.userId,
    entityType: 'billing_document',
    create: async (tx) => {
      await assertLotsNotInIssuedDebitNote(tx, shipmentIds);
      const { rangeFrom, rangeTo } = deriveRangeFromSelection(lots);
      const lineRows = lots.flatMap((lot) => {
        const lockRow = lockRows.find((row) => row.shipmentId === lot.id);
        return buildFrozenShipmentDebitLines(
          (lockRow?.snapshot ?? {}) as Record<string, unknown>,
          lot.shipmentCode ?? String(lot.id),
          {
            // Spec 23/10 — same reported-plate law as the single-lot export.
            billingTruckNo: effectiveBillingPlate(lot),
            vehicleType: lot.revVehicleClassName ?? lot.revVehicleClassCode,
          },
        );
      });
      const totals = documentVatTotals(lineRows);
      const [doc] = await tx.insert(s.billingDocuments).values({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: customerId,
        entityName: lots[0]!.rawCustomerName?.trim() || null,
        rangeFrom,
        rangeTo,
        issuedAt: new Date(),
        debitNoteStatus: 'SENT',
        totalInclVat: String(totals.gross), totalNet: String(totals.net),
        totalTax: String(totals.tax), totalGross: String(totals.gross),
        vatTreatmentVersion: VAT_TREATMENT_VERSION, createdBy: input.actor.userId,
      }).returning({ id: s.billingDocuments.id });
      if (lineRows.length > 0) {
        await tx.insert(s.billingDocumentLines).values(lineRows.map((line, index) => ({
          documentId: doc.id,
          sourceType: 'ADHOC' as const,
          sourceId: null,
          // FB-094 §II.4: BKS báo khách + loại xe tính cước thu ride on the
          // frozen line so both the file export and the read API render them.
          renderData: line.renderData ? { ...line.renderData } : null,
          lineType: line.lineType,
          typeLabel: line.typeLabel,
          description: line.description,
          baseAmount: String(line.baseAmount), netAmount: String(line.netAmount),
          taxAmount: String(line.taxAmount), grossAmount: String(line.grossAmount),
          vatTreatment: line.vatTreatment, vatRate: String(line.vatRate),
          vatTreatmentVersion: line.vatTreatmentVersion, sortOrder: index,
        })));
      }
      await tx.insert(s.debitNoteLots).values(shipmentIds.map((lotId) => ({
        documentId: doc.id,
        shipmentId: lotId,
        createdBy: input.actor.userId,
      })));
      return { id: doc.id };
    },
  });
  return result;
}
