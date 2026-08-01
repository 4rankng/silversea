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
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError } from '../errors';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import {
  captureIssuedOfficialIdentitySnapshot,
  getDocument,
} from './billingDocument.service';
import { DURABLE_EFFECT_KIND, enqueueDurableEffect } from './durable-effect.service';

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
  /** Optimistic document version observed by the caller. */
  expectedVersion?: number;
  /** Required when targetStatus = CONFIRMED (who confirmed). */
  confirmedBy?: string;
  reason?: string;
  disputeEvidence?: {
    customerId: number;
    reason: string;
    evidenceRefs: string[];
    idempotencyKey: string;
  };
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
    if (input.expectedVersion !== undefined && doc.version !== input.expectedVersion) {
      throw new ApiError(409, 'Giấy báo nợ vừa thay đổi. Vui lòng tải lại và thử lại.');
    }
    if (input.expectedStatus !== undefined && currentStatus !== input.expectedStatus) {
      throw new ApiError(409, 'Trạng thái giấy báo nợ vừa thay đổi. Vui lòng tải lại và thử lại.');
    }
    if (!isValidTransition(currentStatus, input.targetStatus)) {
      throw new ApiError(
        409,
        `Không thể chuyển giấy báo nợ từ "${currentStatus}" sang "${input.targetStatus}".`,
      );
    }
    if (currentStatus === input.targetStatus) return doc;
    if (input.targetStatus === 'REJECTED') {
      const evidence = input.disputeEvidence;
      if (!evidence?.reason.trim() || !evidence.idempotencyKey.trim()) {
        throw new ApiError(400, 'Lý do và mã giao dịch khiếu nại là bắt buộc.');
      }
      if (doc.entityType !== 'CUSTOMER' || doc.entityId !== evidence.customerId) {
        throw new ApiError(404, 'Không tìm thấy giấy báo nợ');
      }
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
      version: doc.version + 1,
      updatedAt: new Date(),
    };

    // When transitioning to CONFIRMED, record who confirmed + lock the document.
    if (input.targetStatus === 'CONFIRMED') {
      updates.customerConfirmedAt = new Date();
      if (input.confirmedBy) updates.customerConfirmedBy = input.confirmedBy;
      const confirmedVersion = doc.version + 1;
      const payloadHash = createHash('sha256').update(JSON.stringify({
        documentId: doc.id,
        confirmedVersion,
        entityId: doc.entityId,
        totalInclVat: doc.totalInclVat,
        officialIdentitySnapshot: doc.officialIdentitySnapshot,
      })).digest('hex');
      updates.legalInvoiceRef = {
        provider: 'REFERENCE_ONLY',
        status: 'PENDING',
        requestVersion: confirmedVersion,
        payloadHash,
        updatedAt: new Date().toISOString(),
      };
    }
    if (currentStatus === 'DRAFT' && input.targetStatus === 'SENT') {
      const hydratedDocument = await getDocument(doc.id, tx);
      const issuedSnapshot = await captureIssuedOfficialIdentitySnapshot(hydratedDocument, tx);
      updates.debitNoteTemplateSnapshot = issuedSnapshot;
      updates.officialIdentitySnapshot = (
        issuedSnapshot as typeof issuedSnapshot & {
          officialIdentity?: unknown;
        }
      ).officialIdentity ?? null;
      updates.issuedAt = doc.issuedAt ?? new Date();
      updates.authorityState = 'CURRENT';
      updates.authorityWarningReason = null;
      updates.authorityWarningAt = null;
    }

    const statusCondition = doc.debitNoteStatus === null
      ? isNull(s.billingDocuments.debitNoteStatus)
      : eq(s.billingDocuments.debitNoteStatus, currentStatus);
    if (input.targetStatus === 'CANCELED') {
      const releasedAt = new Date();
      await tx.update(s.billingDocumentTripClaims).set({
        releasedAt,
        releasedBy: input.actorUserId,
        releaseReason: 'DOCUMENT_CANCELED',
      }).where(and(
        eq(s.billingDocumentTripClaims.documentId, doc.id),
        isNull(s.billingDocumentTripClaims.releasedAt),
      ));
      await tx.update(s.billingDocumentRecoverableClaims).set({
        releasedAt,
        releasedBy: input.actorUserId,
        releaseReason: 'DOCUMENT_CANCELED',
      }).where(and(
        eq(s.billingDocumentRecoverableClaims.documentId, doc.id),
        isNull(s.billingDocumentRecoverableClaims.releasedAt),
      ));
    }
    const [updated] = await tx.update(s.billingDocuments)
      .set(updates)
      .where(and(
        eq(s.billingDocuments.id, input.documentId),
        isNull(s.billingDocuments.deletedAt),
        eq(s.billingDocuments.version, doc.version),
        statusCondition,
      ))
      .returning();

    if (!updated) {
      throw new ApiError(409, 'Trạng thái giấy báo nợ vừa thay đổi. Vui lòng tải lại và thử lại.');
    }

    if (input.targetStatus === 'REJECTED' && input.disputeEvidence) {
      await tx.insert(s.billingDocumentDisputes).values({
        documentId: doc.id,
        documentVersion: updated.version,
        customerId: input.disputeEvidence.customerId,
        disputedBy: input.actorUserId,
        reason: input.disputeEvidence.reason.trim(),
        evidenceRefs: input.disputeEvidence.evidenceRefs
          .map((reference) => reference.trim())
          .filter(Boolean),
        idempotencyKey: input.disputeEvidence.idempotencyKey.trim(),
      });
    }

    if (input.targetStatus === 'CONFIRMED' && updated.legalInvoiceRef) {
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.LEGAL_INVOICE_HANDOFF,
        payloadVersion: 1,
        dedupeKey: `legal-invoice:REFERENCE_ONLY:${doc.id}:${updated.version}:ISSUE`,
        payload: {
          documentId: doc.id,
          confirmedVersion: updated.version,
          provider: 'REFERENCE_ONLY',
          payloadHash: updated.legalInvoiceRef.payloadHash!,
        },
      });
    }

    return updated;
  };

  if (input.transaction) {
    return execute(input.transaction);
  }

  return db.transaction(execute);
}

export async function sendDebitNoteForCustomerConfirmation(input: {
  documentId: number;
  expectedVersion: number;
  actorUserId: number;
  transaction?: Tx;
}) {
  return transitionDebitNoteStatus({
    documentId: input.documentId,
    targetStatus: 'PENDING_CONFIRM',
    expectedStatus: 'SENT',
    expectedVersion: input.expectedVersion,
    actorUserId: input.actorUserId,
    transaction: input.transaction,
  });
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
