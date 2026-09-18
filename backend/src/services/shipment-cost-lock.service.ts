// Card 20260918_19 — lot cost lock (Khóa lô) + adjust history.
// Spec: docs/card-19-lock-and-adjust-design.md. A LOT lock, independent of
// the kỳ kế toán lock: guards chain (the accounting lock still wins for cost
// edits). Snapshots are assembled server-side from engine values and are
// never recomputed after lock — "mở kỳ mới không đổi số đã khóa".
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { db } from '../db';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';

export const SHIPMENT_COST_LOCKED_MESSAGE = 'Lô hàng đã khóa chi phí. Cần mở khóa (sẽ cấp sau) để chỉnh sửa chi phí.';
export const SHIPMENT_COST_NOT_LOCKED_MESSAGE = 'Lô hàng chưa khóa chi phí — hãy khóa lô trước khi điều chỉnh.';

/** Freeze gate for every Lớp-2 write surface on the shipment (mirrors
 *  assertShipmentAccountingUnlocked). Violations → 409 with the dedicated
 *  message. */
export async function assertShipmentCostUnlocked(tx: Tx, shipmentId: number): Promise<void> {
  const [active] = await tx.select({ id: s.shipmentCostLocks.id })
    .from(s.shipmentCostLocks)
    .where(and(
      eq(s.shipmentCostLocks.shipmentId, shipmentId),
      isNull(s.shipmentCostLocks.unlockedAt),
    ))
    .limit(1);
  if (active) throw new ApiError(409, SHIPMENT_COST_LOCKED_MESSAGE);
}

/** Server-assembled frozen Lớp-1 totals from the rollup engine values —
 *  never client amounts. */
async function buildCostSnapshot(shipmentId: number): Promise<Record<string, unknown>> {
  const [lot] = await db.select({ customerId: s.shipments.customerId })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
  if (!lot) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
  const { getShipmentDebitSummary } = await import('./shipment-debit-summary.service');
  const summary = await getShipmentDebitSummary({ customerId: lot.customerId!, lockStatus: 'ALL' });
  const item = summary.items.find((row) => row.shipmentId === shipmentId);
  return {
    freightAuto: item?.freightAuto ?? null,
    chiHoTotal: item?.chiHoTotal ?? null,
    receivableTotal: item?.receivableTotal ?? null,
    profit: item?.profit ?? null,
  };
}

export interface LockShipmentCostInput {
  shipmentId: number;
  expectedShipmentVersion?: number | null;
  lockNote?: string | null;
  actor: AuthUser;
  idempotencyKey: string;
}

export async function lockShipmentCost(input: LockShipmentCostInput): Promise<{ id: number }> {
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
      const snapshot = await buildCostSnapshot(input.shipmentId);
      const [row] = await tx.insert(s.shipmentCostLocks).values({
        shipmentId: input.shipmentId,
        shipmentVersionAtLock: shipment.version,
        costSnapshot: snapshot,
        lockedBy: input.actor.userId,
        lockNote: input.lockNote?.trim() || null,
      }).returning({ id: s.shipmentCostLocks.id });
      return { id: row.id };
    },
  });
  return result;
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
  await assertShipmentAccountingUnlocked(db as unknown as Tx, input.shipmentId);
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
      }).from(s.shipments).where(eq(s.shipments.id, input.shipmentId)).limit(1);
      if (!lot) throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
      const [lock] = await tx.select({ snapshot: s.shipmentCostLocks.costSnapshot })
        .from(s.shipmentCostLocks)
        .where(and(
          eq(s.shipmentCostLocks.shipmentId, input.shipmentId),
          isNull(s.shipmentCostLocks.unlockedAt),
        ))
        .limit(1);
      if (!lock) throw new ApiError(409, SHIPMENT_COST_NOT_LOCKED_MESSAGE);
      const snapshot = (lock.snapshot ?? {}) as Record<string, unknown>;
      const lineRows: Array<{
        lineType: string;
        typeLabel: string;
        baseAmount: string;
      }> = [];
      const freight = snapshot.freightAuto;
      if (typeof freight === 'string' && freight !== '' && freight !== '0') {
        lineRows.push({ lineType: 'FREIGHT', typeLabel: 'Cước vận tải (auto)', baseAmount: freight });
      }
      const chiHo = snapshot.chiHoTotal;
      if (typeof chiHo === 'string' && chiHo !== '' && chiHo !== '0') {
        lineRows.push({ lineType: 'SERVICE_FEE', typeLabel: 'Tổng chi hộ', baseAmount: chiHo });
      }
      const [doc] = await tx.insert(s.billingDocuments).values({
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        entityId: lot.customerId ?? 0,
        entityName: lot.rawCustomerName?.trim() || null,
        rangeFrom: new Date().toISOString().slice(0, 10),
        rangeTo: new Date().toISOString().slice(0, 10),
        issuedAt: new Date(),
        debitNoteStatus: 'SENT',
      }).returning({ id: s.billingDocuments.id });
      if (lineRows.length > 0) {
        await tx.insert(s.billingDocumentLines).values(lineRows.map((line, index) => ({
          documentId: doc.id,
          sourceType: 'ADHOC' as const,
          sourceId: null,
          lineType: line.lineType,
          typeLabel: line.typeLabel,
          description: `${line.typeLabel} — lô ${lot.shipmentCode ?? input.shipmentId} (chốt từ snapshot khóa lô)`,
          baseAmount: line.baseAmount,
          grossAmount: line.baseAmount,
        })));
      }
      return { id: doc.id };
    },
  });
  return result;
}
