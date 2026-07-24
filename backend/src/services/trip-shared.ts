// Trip Shared — Types and helpers used across trip sub-modules

import { db } from '../db';
import * as s from '../db/schema';
import { isNull, eq, and } from 'drizzle-orm';

/** Transaction type alias used by all mutation/status functions */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Resolve the active trailer for a truck's currentTrailerId.
 * Returns null for both fields if no trailer is linked or the trailer is soft-deleted.
 */
export async function resolveTrailer(
  tx: Tx,
  currentTrailerId: number | null,
): Promise<{ trailerId: number | null; trailerType: string | null }> {
  if (!currentTrailerId) return { trailerId: null, trailerType: null };
  const [trailer] = await tx.select().from(s.trailers)
    .where(and(eq(s.trailers.id, currentTrailerId), isNull(s.trailers.deletedAt)))
    .limit(1);
  if (trailer) {
    return { trailerId: trailer.id, trailerType: trailer.type };
  }
  return { trailerId: null, trailerType: null };
}
