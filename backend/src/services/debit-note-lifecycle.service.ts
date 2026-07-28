// Debit-Note Lifecycle Service — Wave 2 M3.6.
//
// Manages the debit-note status machine: DRAFT → SENT → PENDING_CONFIRM →
// CONFIRMED → PARTIAL_PAID → PAID. Also handles REJECTED and CANCELED.
//
// After a customer CONFIRMS a debit note, it is LOCKED — no further edits to
// the document or its lines. Changes require an adjustment document (a new
// debit-note referencing the original).
//
// Overpayment handling (M3.6 §2): when a payment exceeds the debit note's
// total, the overpayment stays as a credit on the customer's AR — it does NOT
// drive the AR negative silently.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';

type DebitNoteStatus = typeof s.debitNoteStatusEnum.enumValues[number];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Legal transitions ──────────────────────────────────────────────────────

const LEGAL_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SENT', 'CANCELED'],
  SENT: ['PENDING_CONFIRM', 'CANCELED'],
  PENDING_CONFIRM: ['CONFIRMED', 'REJECTED', 'CANCELED'],
  CONFIRMED: ['PARTIAL_PAID', 'PAID', 'CANCELED'],
  PARTIAL_PAID: ['PAID', 'CANCELED'],
  PAID: [],
  REJECTED: ['DRAFT'], // can revise and re-send
  CANCELED: [],
};

export function isValidTransition(from: DebitNoteStatus, to: DebitNoteStatus): boolean {
  if (from === to) return true;
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

// ─── Status transition ──────────────────────────────────────────────────────

export interface TransitionInput {
  documentId: number;
  targetStatus: DebitNoteStatus;
  actorUserId: number;
  /** Reject when the locked row no longer has the status observed by the caller. */
  expectedStatus?: DebitNoteStatus;
  /** Required when targetStatus = CONFIRMED (who confirmed). */
  confirmedBy?: string;
  reason?: string;
  transaction?: Tx;
}

export async function transitionDebitNoteStatus(input: TransitionInput) {
  const execute = async (tx: Tx) => {
    const [doc] = await tx.select().from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, input.documentId))
      .limit(1)
      .for('update');
    if (!doc) throw new ApiError(404, 'Không tìm thấy giấy báo nợ');

    const currentStatus = (doc.debitNoteStatus ?? 'DRAFT') as DebitNoteStatus;
    if (input.expectedStatus !== undefined && currentStatus !== input.expectedStatus) {
      throw new ApiError(409, 'Trạng thái giấy báo nợ vừa thay đổi. Vui lòng tải lại và thử lại.');
    }
    if (!isValidTransition(currentStatus, input.targetStatus)) {
      throw new ApiError(
        409,
        `Không thể chuyển giấy báo nợ từ "${currentStatus}" sang "${input.targetStatus}".`,
      );
    }

    const readTripSourceIds = async () => {
      const sourceRows = await tx.select({ tripId: s.billingDocumentLines.sourceId })
        .from(s.billingDocumentLines)
        .where(and(
          eq(s.billingDocumentLines.documentId, input.documentId),
          eq(s.billingDocumentLines.sourceType, 'TRIP'),
        ));
      return [...new Set(sourceRows
        .map(row => row.tripId)
        .filter((tripId): tripId is number => tripId != null))]
        .sort((left, right) => left - right);
    };
    const lockedTripIds = await readTripSourceIds();
    await lockTripFinancialAuthority(tx, lockedTripIds);
    const tripIds = await readTripSourceIds();
    if (
      tripIds.length !== lockedTripIds.length
      || tripIds.some((tripId, index) => tripId !== lockedTripIds[index])
    ) {
      throw new ApiError(
        409,
        'Nguồn chuyến của giấy báo nợ vừa thay đổi. Vui lòng tải lại và thử lại.',
      );
    }

    if (currentStatus === 'DRAFT' && input.targetStatus === 'SENT' && tripIds.length > 0) {
      const sourceTrips = await tx.select({ id: s.trips.id, status: s.trips.status })
        .from(s.trips)
        .where(inArray(s.trips.id, tripIds));
      if (
        sourceTrips.length !== new Set(tripIds).size
        || sourceTrips.some(trip => trip.status !== 'LOCKED')
      ) {
        throw new ApiError(
          409,
          'Giấy báo nợ chỉ được phát hành khi mọi chuyến nguồn vẫn ở trạng thái đã chốt',
        );
      }
    }

    const updates: Partial<typeof s.billingDocuments.$inferInsert> = {
      debitNoteStatus: input.targetStatus,
      updatedAt: new Date(),
    };

    // When transitioning to CONFIRMED, record who confirmed + lock the document.
    if (input.targetStatus === 'CONFIRMED') {
      updates.customerConfirmedAt = new Date();
      if (input.confirmedBy) updates.customerConfirmedBy = input.confirmedBy;
    }

    const statusCondition = doc.debitNoteStatus === null
      ? isNull(s.billingDocuments.debitNoteStatus)
      : eq(s.billingDocuments.debitNoteStatus, currentStatus);
    const [updated] = await tx.update(s.billingDocuments)
      .set(updates)
      .where(and(
        eq(s.billingDocuments.id, input.documentId),
        isNull(s.billingDocuments.deletedAt),
        statusCondition,
      ))
      .returning();

    if (!updated) {
      throw new ApiError(409, 'Trạng thái giấy báo nợ vừa thay đổi. Vui lòng tải lại và thử lại.');
    }

    return updated;
  };

  if (input.transaction) {
    return execute(input.transaction);
  }

  return db.transaction(execute);
}

// ─── Lock check ─────────────────────────────────────────────────────────────

/**
 * True when the document is locked — no edits allowed. A document is locked
 * after it reaches CONFIRMED status. REJECTED documents are unlocked (they
 * can be revised). CANCELED documents are terminal (no edits, no transitions).
 */
export function isDocumentLocked(status: DebitNoteStatus | null | undefined): boolean {
  if (!status) return false;
  return ['CONFIRMED', 'PARTIAL_PAID', 'PAID', 'CANCELED'].includes(status);
}

/**
 * Assert that the document is NOT locked. Throws 409 when locked.
 */
export function assertNotLocked(status: DebitNoteStatus | null | undefined): void {
  if (isDocumentLocked(status)) {
    throw new ApiError(
      409,
      'Giấy báo nợ đã được xác nhận hoặc khóa — không thể chỉnh sửa. Tạo giấy điều chỉnh nếu cần thay đổi.',
    );
  }
}

// ─── Overpayment handling ───────────────────────────────────────────────────

/**
 * Calculate how a payment should be allocated against a debit note. Returns
 * the amount applied to this document and the overpayment (excess) that stays
 * as a credit on the customer's AR. Never drives AR negative.
 *
 * @param documentTotal The debit note's totalInclVat.
 * @param paymentAmount The amount the customer paid.
 * @param alreadyPaid Amount already applied to this document from prior payments.
 */
export function calculatePaymentAllocation(
  documentTotal: number,
  paymentAmount: number,
  alreadyPaid: number = 0,
): { appliedAmount: number; overpayment: number; remainingBalance: number } {
  const remaining = Math.max(0, documentTotal - alreadyPaid);
  const appliedAmount = Math.min(paymentAmount, remaining);
  const overpayment = Math.max(0, paymentAmount - remaining);
  return {
    appliedAmount,
    overpayment,
    remainingBalance: remaining - appliedAmount,
  };
}
