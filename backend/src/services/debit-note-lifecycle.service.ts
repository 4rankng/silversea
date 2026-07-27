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
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';

type DebitNoteStatus = typeof s.debitNoteStatusEnum.enumValues[number];

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
  /** Required when targetStatus = CONFIRMED (who confirmed). */
  confirmedBy?: string;
  reason?: string;
}

export async function transitionDebitNoteStatus(input: TransitionInput) {
  const [doc] = await db.select().from(s.billingDocuments)
    .where(eq(s.billingDocuments.id, input.documentId))
    .limit(1);
  if (!doc) throw new ApiError(404, 'Không tìm thấy giấy báo nợ');

  const currentStatus = (doc.debitNoteStatus ?? 'DRAFT') as DebitNoteStatus;

  if (!isValidTransition(currentStatus, input.targetStatus)) {
    throw new ApiError(
      409,
      `Không thể chuyển giấy báo nợ từ "${currentStatus}" sang "${input.targetStatus}".`,
    );
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
  const [updated] = await db.update(s.billingDocuments)
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
