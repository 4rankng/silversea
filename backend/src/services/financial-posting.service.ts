import { and, desc, eq } from 'drizzle-orm';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

export type FinancialPostingReason = 'COMPLETION' | 'GOVERNED_CORRECTION' | 'CANCELLATION';

export async function getActiveFinancialPosting(tx: Tx, tripId: number) {
  const [posting] = await tx.select().from(s.tripFinancialPostings)
    .where(and(
      eq(s.tripFinancialPostings.tripId, tripId),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .limit(1);
  return posting ?? null;
}

export async function getFinancialPostingForGovernanceAction(
  tx: Tx,
  tripId: number,
  governanceActionId: number,
  reason: FinancialPostingReason,
) {
  const [posting] = await tx.select().from(s.tripFinancialPostings)
    .where(and(
      eq(s.tripFinancialPostings.tripId, tripId),
      eq(s.tripFinancialPostings.reason, reason),
    ))
    .orderBy(desc(s.tripFinancialPostings.version))
    .limit(1);
  return posting ?? null;
}

/**
 * Creates the immutable financial version for a trip. Completion is retry-safe;
 * governed corrections supersede the current version and cancellation reverses it.
 * Callers must already hold the trip financial-authority lock.
 */
export async function createFinancialPosting(tx: Tx, input: {
  tripId: number;
  tripVersion: number;
  reason: FinancialPostingReason;
  effectiveAt?: Date;
}) {
  const active = await getActiveFinancialPosting(tx, input.tripId);
  if (input.reason === 'COMPLETION' && active) {
    if (active.tripVersion !== input.tripVersion) {
      throw new ApiError(409, 'Chuyến đã có phiên bản hạch toán khác; cần ghi nhận điều chỉnh tài chính');
    }
    return active;
  }
  if (input.reason !== 'COMPLETION' && !active) {
    throw new ApiError(409, 'Chuyến chưa có phiên bản hạch toán đang hiệu lực');
  }

  if (active) {
    const nextStatus = input.reason === 'CANCELLATION' ? 'REVERSED' : 'SUPERSEDED';
    await tx.update(s.tripFinancialPostings)
      .set({ status: nextStatus })
      .where(and(
        eq(s.tripFinancialPostings.id, active.id),
        eq(s.tripFinancialPostings.status, 'ACTIVE'),
      ));
  }

  const [latest] = await tx.select({ version: s.tripFinancialPostings.version })
    .from(s.tripFinancialPostings)
    .where(eq(s.tripFinancialPostings.tripId, input.tripId))
    .orderBy(desc(s.tripFinancialPostings.version))
    .limit(1);
  const [created] = await tx.insert(s.tripFinancialPostings).values({
    tripId: input.tripId,
    tripVersion: input.tripVersion,
    version: (latest?.version ?? 0) + 1,
    status: input.reason === 'CANCELLATION' ? 'REVERSED' : 'ACTIVE',
    reason: input.reason,
    supersedesId: active?.id ?? null,
    effectiveAt: input.effectiveAt ?? new Date(),
  }).returning();
  return created;
}
