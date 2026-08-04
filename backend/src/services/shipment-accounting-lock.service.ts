import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Role, type ShipmentAccountingLockInput } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';

const ISSUED_DEBIT_NOTE_STATUSES = new Set([
  'SENT',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'PARTIAL_PAID',
  'PAID',
]);

function financialPostingChecksum(posting: {
  id: number;
  tripId: number;
  version: number;
  tripVersion: number;
  reason: string;
  effectiveAt: Date;
}) {
  return createHash('sha256').update(JSON.stringify({
    id: posting.id,
    tripId: posting.tripId,
    version: posting.version,
    tripVersion: posting.tripVersion,
    reason: posting.reason,
    effectiveAt: posting.effectiveAt.toISOString(),
  })).digest('hex');
}

function expenseSourceVersion(expense: { updatedAt: Date; approvalStatus: string; sellAmount: string }) {
  return `expense:${expense.updatedAt.toISOString()}:${expense.approvalStatus}:${Number(expense.sellAmount)}`;
}

export const SHIPMENT_ACCOUNTING_LOCKED_MESSAGE =
  'Lô hàng đã được Kế toán khóa sau khi phát hành Debit Note. Mọi thay đổi vận hành phải được xử lý bằng chứng từ điều chỉnh.';

export async function getShipmentAccountingLock(shipmentId: number, tx?: Tx) {
  const executor = tx ?? db;
  const [row] = await executor.select({
    lock: s.shipmentAccountingLocks,
    billingDocumentStatus: s.billingDocuments.debitNoteStatus,
    billingDocumentIssuedAt: s.billingDocuments.issuedAt,
    actorName: s.users.fullName,
    actorUsername: s.users.username,
  })
    .from(s.shipmentAccountingLocks)
    .innerJoin(s.billingDocuments, eq(s.billingDocuments.id, s.shipmentAccountingLocks.billingDocumentId))
    .leftJoin(s.users, eq(s.users.id, s.shipmentAccountingLocks.activatedBy))
    .where(eq(s.shipmentAccountingLocks.shipmentId, shipmentId))
    .limit(1);
  if (!row) return null;
  return {
    ...row.lock,
    billingDocumentStatus: row.billingDocumentStatus,
    billingDocumentIssuedAt: row.billingDocumentIssuedAt,
    activatedByName: row.actorName ?? row.actorUsername ?? null,
  };
}

export async function getShipmentAccountingLockSummary(shipmentId: number, tx?: Tx) {
  const lock = await getShipmentAccountingLock(shipmentId, tx);
  if (!lock) return null;
  return {
    billingDocumentId: lock.billingDocumentId,
    activatedAt: lock.activatedAt,
    activatedByName: lock.activatedByName,
    reason: lock.reason,
  };
}

/**
 * Aggregate write guard. Call inside the same transaction and before the first
 * mutation. Locking the shipment row serializes accounting-lock activation
 * against operational writes that follow this contract.
 */
export async function assertShipmentAccountingUnlocked(tx: Tx, shipmentId: number) {
  const [shipment] = await tx.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  const [lock] = await tx.select({ id: s.shipmentAccountingLocks.id })
    .from(s.shipmentAccountingLocks)
    .where(eq(s.shipmentAccountingLocks.shipmentId, shipmentId))
    .limit(1);
  if (lock) throw new ApiError(409, SHIPMENT_ACCOUNTING_LOCKED_MESSAGE);
  return shipment;
}

export async function assertTripShipmentAccountingUnlocked(tx: Tx, tripId: number) {
  const [trip] = await tx.select({ shipmentId: s.trips.shipmentId })
    .from(s.trips)
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  if (trip.shipmentId != null) {
    await assertShipmentAccountingUnlocked(tx, trip.shipmentId);
  }
  return trip.shipmentId;
}

export async function activateShipmentAccountingLock(args: {
  shipmentId: number;
  input: ShipmentAccountingLockInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.ACCOUNTANT) {
    throw new ApiError(403, 'Chỉ Kế toán được khóa lô sau khi phát hành Debit Note.');
  }

  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, args.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

    const existing = await getShipmentAccountingLock(args.shipmentId, tx);
    if (existing) {
      if (existing.billingDocumentId === args.input.billingDocumentId) {
        return { lock: existing, replayed: true };
      }
      throw new ApiError(409, SHIPMENT_ACCOUNTING_LOCKED_MESSAGE);
    }
    if (shipment.version !== args.input.expectedVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi khóa.');
    }

    const [document] = await tx.select().from(s.billingDocuments)
      .where(and(
        eq(s.billingDocuments.id, args.input.billingDocumentId),
        isNull(s.billingDocuments.deletedAt),
      ))
      .for('update')
      .limit(1);
    const documentStatus = document?.debitNoteStatus ?? 'DRAFT';
    if (
      !document
      || document.type !== 'DEBIT_NOTE'
      || document.entityType !== 'CUSTOMER'
      || document.entityId !== shipment.customerId
      || document.issuedAt == null
      || document.authorityState !== 'CURRENT'
      || document.authorityWarningAt != null
      || !ISSUED_DEBIT_NOTE_STATUSES.has(documentStatus)
    ) {
      throw new ApiError(409, 'Debit Note chưa đủ điều kiện để khóa lô hàng này.');
    }

    const liveTrips = await tx.select({ id: s.trips.id, status: s.trips.status })
      .from(s.trips)
      .where(and(
        eq(s.trips.shipmentId, shipment.id),
        ne(s.trips.status, 'CANCELED'),
        isNull(s.trips.deletedAt),
      ))
      .orderBy(asc(s.trips.id))
      .for('update');
    if (liveTrips.length === 0 || liveTrips.some((trip) => trip.status !== 'COMPLETED')) {
      throw new ApiError(409, 'Chỉ được khóa lô khi mọi chuyến nguồn đã hoàn thành.');
    }

    const claims = await tx.select({
      tripId: s.billingDocumentTripClaims.tripId,
      financialPostingId: s.billingDocumentTripClaims.financialPostingId,
      financialPostingVersion: s.billingDocumentTripClaims.financialPostingVersion,
      postingChecksum: s.billingDocumentTripClaims.postingChecksum,
      postingId: s.tripFinancialPostings.id,
      postingTripId: s.tripFinancialPostings.tripId,
      postingVersion: s.tripFinancialPostings.version,
      postingTripVersion: s.tripFinancialPostings.tripVersion,
      postingReason: s.tripFinancialPostings.reason,
      postingEffectiveAt: s.tripFinancialPostings.effectiveAt,
    })
      .from(s.billingDocumentTripClaims)
      .innerJoin(s.tripFinancialPostings, and(
        eq(s.tripFinancialPostings.id, s.billingDocumentTripClaims.financialPostingId),
        eq(s.tripFinancialPostings.status, 'ACTIVE'),
      ))
      .where(and(
        eq(s.billingDocumentTripClaims.documentId, document.id),
        inArray(s.billingDocumentTripClaims.tripId, liveTrips.map((trip) => trip.id)),
        isNull(s.billingDocumentTripClaims.releasedAt),
      ))
      .orderBy(asc(s.billingDocumentTripClaims.tripId))
      .for('update');
    const claimedTripIds = new Set(claims.map((claim) => claim.tripId));
    if (liveTrips.some((trip) => !claimedTripIds.has(trip.id))) {
      throw new ApiError(409, 'Debit Note chưa bao phủ đầy đủ các chuyến của lô hàng.');
    }
    const staleTripClaim = claims.find((claim) => (
      claim.financialPostingId !== claim.postingId
      || claim.tripId !== claim.postingTripId
      || claim.financialPostingVersion !== claim.postingVersion
      || claim.postingChecksum !== financialPostingChecksum({
        id: claim.financialPostingId,
        tripId: claim.postingTripId,
        version: claim.postingVersion,
        tripVersion: claim.postingTripVersion,
        reason: claim.postingReason,
        effectiveAt: claim.postingEffectiveAt,
      })
    ));
    if (staleTripClaim) {
      throw new ApiError(409, 'Nguồn hạch toán của Debit Note đã thay đổi. Vui lòng phát hành chứng từ mới trước khi khóa lô.');
    }

    const recoverableExpenses = await tx.select({
      id: s.tripExpenses.id,
      version: s.tripExpenses.version,
      approvalStatus: s.tripExpenses.approvalStatus,
      sellAmount: s.tripExpenses.sellAmount,
      updatedAt: s.tripExpenses.updatedAt,
      claimDocumentId: s.billingDocumentRecoverableClaims.documentId,
      claimExpenseVersion: s.billingDocumentRecoverableClaims.expenseVersion,
      claimSourceVersion: s.billingDocumentRecoverableClaims.sourceVersion,
    })
      .from(s.tripExpenses)
      .leftJoin(s.billingDocumentRecoverableClaims, and(
        eq(s.billingDocumentRecoverableClaims.expenseId, s.tripExpenses.id),
        isNull(s.billingDocumentRecoverableClaims.releasedAt),
      ))
      .where(and(
        inArray(s.tripExpenses.tripId, liveTrips.map((trip) => trip.id)),
        eq(s.tripExpenses.approvalStatus, 'APPROVED'),
        ne(s.tripExpenses.sellAmount, '0'),
      ))
      .orderBy(asc(s.tripExpenses.id));
    const uncoveredRecoverable = recoverableExpenses.find((expense) => (
      expense.claimDocumentId !== document.id
      || expense.claimExpenseVersion !== expense.version
      || expense.claimSourceVersion !== expenseSourceVersion(expense)
    ));
    if (uncoveredRecoverable) {
      throw new ApiError(409, 'Debit Note chưa bao phủ đầy đủ chi phí thu lại khách hàng hoặc nguồn chi phí đã thay đổi.');
    }

    const [lock] = await tx.insert(s.shipmentAccountingLocks).values({
      shipmentId: shipment.id,
      billingDocumentId: document.id,
      billingDocumentVersion: document.version,
      billingPeriodSnapshot: {
        rangeFrom: document.rangeFrom,
        rangeTo: document.rangeTo,
        issuedAt: document.issuedAt.toISOString(),
      },
      shipmentVersionAtLock: shipment.version,
      reason: args.input.reason,
      activatedBy: args.actor.userId,
    }).returning();

    await tx.update(s.shipments).set({
      version: shipment.version + 1,
      updatedBy: args.actor.userId,
      updatedAt: new Date(),
    }).where(and(eq(s.shipments.id, shipment.id), eq(s.shipments.version, shipment.version)));

    await tx.insert(s.auditLogs).values({
      userId: args.actor.userId,
      actorName: args.actor.fullName ?? args.actor.username,
      message: `Kế toán khóa lô ${shipment.shipmentCode ?? `#${shipment.id}`} theo Debit Note #${document.id}`,
      entityType: 'shipment-accounting-lock',
      entityId: shipment.id,
      payload: {
        lockId: lock.id,
        billingDocumentId: document.id,
        billingDocumentVersion: document.version,
        shipmentVersionAtLock: shipment.version,
        reason: args.input.reason,
      },
    });

    return { lock, replayed: false };
  };
  return args.transaction ? execute(args.transaction) : db.transaction(execute);
}
