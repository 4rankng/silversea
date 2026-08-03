// Billing Document Re-issue Guard — Wave 2 M3.5.
//
// Prevents double-issuing debit notes with overlapping date ranges for the
// same customer. Application-owned locking prevents both exact duplicates and
// overlapping ranges
// (range1.from < range2.to AND range2.from < range1.to).
//
// Usage: call checkOverlap before creating a new billing document. If the
// result has overlaps, the route should return 409 with the overlapping
// documents' details so the operator can adjust the range or cancel the old
// one first.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Tx } from './trip-shared';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

export interface OverlapResult {
  hasOverlap: boolean;
  overlappingDocs: Array<{
    id: number;
    rangeFrom: string;
    rangeTo: string;
    type: string;
  }>;
}

export type BillingDocumentOverlapParams = {
  type: string;
  entityType: string;
  entityId: number;
  rangeFrom: string;
  rangeTo: string;
  excludeId?: number;
};

export async function lockBillingDocumentOverlapAuthority(
  tx: Tx,
  params: Pick<BillingDocumentOverlapParams, 'type' | 'entityType' | 'entityId'>,
): Promise<void> {
  await lockApplicationOwnedUniqueness(
    tx,
    'billing-document-overlap',
    [params.type, params.entityType, params.entityId],
  );
}

/**
 * Check whether a new billing document with the given (type, entityType,
 * entityId, rangeFrom, rangeTo) would overlap an existing active (non-deleted)
 * document of the same type+entity. Overlap = date ranges that share at least
 * one day.
 *
 * @param excludeId When editing an existing document, pass its id to exclude
 *                  it from the overlap check.
 */
export async function checkBillingDocumentOverlap(
  params: BillingDocumentOverlapParams,
  executor: typeof db | Tx = db,
): Promise<OverlapResult> {
  // Date-range overlap: two ranges [A_from, A_to] and [B_from, B_to] overlap
  // iff A_from <= B_to AND B_from <= A_to. We query for existing docs where
  // this condition holds.
  const conditions = [
    eq(s.billingDocuments.type, params.type),
    eq(s.billingDocuments.entityType, params.entityType),
    eq(s.billingDocuments.entityId, params.entityId),
    isNull(s.billingDocuments.deletedAt),
    or(
      isNull(s.billingDocuments.debitNoteStatus),
      ne(s.billingDocuments.debitNoteStatus, 'CANCELED'),
    ),
    sql`${s.billingDocuments.rangeFrom} <= ${params.rangeTo}`,
    sql`${s.billingDocuments.rangeTo} >= ${params.rangeFrom}`,
  ];
  if (params.excludeId != null) {
    conditions.push(ne(s.billingDocuments.id, params.excludeId));
  }

  const overlapping = await executor.select({
    id: s.billingDocuments.id,
    rangeFrom: s.billingDocuments.rangeFrom,
    rangeTo: s.billingDocuments.rangeTo,
    type: s.billingDocuments.type,
  })
    .from(s.billingDocuments)
    .where(and(...conditions));

  return {
    hasOverlap: overlapping.length > 0,
    overlappingDocs: overlapping.map(d => ({
      id: d.id,
      rangeFrom: d.rangeFrom,
      rangeTo: d.rangeTo,
      type: d.type,
    })),
  };
}
