/**
 * Card 20260922_62 — quotation version history on the release-snapshot seam
 * (operator ruling 2026-09-22 Q1: live view between releases, snapshot ONLY
 * at version release). Every change releases a version: manual edit, AGREED
 * fuel update (_61), new import (_57). The payload freezes the whole rendered
 * view so an old version renders its own figures; xlsx export rides _57's
 * exporter on this payload.
 */
import { and, desc, eq, gte, lte, max } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { QuotationView } from '@tingting/shared';

export type QuotationVersionTrigger = 'MANUAL_EDIT' | 'FUEL_APPROVED' | 'IMPORT';

export interface QuotationVersionRow {
  version: number;
  triggerKind: string | null;
  releasedBy: number | null;
  releasedAt: Date | null;
}

/**
 * Freeze the quotation's CURRENT rendered view as its next version. The
 * caller passes the freshly built view (getQuotation) — figures, fees, and
 * frame all freeze exactly as the live view showed them at release time.
 */
export async function releaseQuotationVersion(
  view: QuotationView,
  opts: { triggerKind: QuotationVersionTrigger; actorId: number },
): Promise<number> {
  const [maxRow] = await db.select({ maxVersion: max(s.quotationVersionSnapshots.version) })
    .from(s.quotationVersionSnapshots)
    .where(eq(s.quotationVersionSnapshots.quotationId, view.id));
  const version = (maxRow?.maxVersion ?? 0) + 1;
  const [row] = await db.insert(s.quotationVersionSnapshots).values({
    quotationId: view.id,
    version,
    payload: view as unknown as Record<string, unknown>,
    triggerKind: opts.triggerKind,
    releasedBy: opts.actorId,
    releasedAt: new Date(),
  }).returning({ id: s.quotationVersionSnapshots.id });
  return row.id;
}

/** All releases of one quotation, newest first; optional release-date window. */
export async function listQuotationVersions(
  quotationId: number,
  filter: { from?: string; to?: string } = {},
): Promise<{ items: QuotationVersionRow[]; total: number }> {
  const conditions = [eq(s.quotationVersionSnapshots.quotationId, quotationId)];
  if (filter.from) conditions.push(gte(s.quotationVersionSnapshots.releasedAt, new Date(filter.from)));
  if (filter.to) conditions.push(lte(s.quotationVersionSnapshots.releasedAt, new Date(filter.to)));
  const rows = await db.select({
    version: s.quotationVersionSnapshots.version,
    triggerKind: s.quotationVersionSnapshots.triggerKind,
    releasedBy: s.quotationVersionSnapshots.releasedBy,
    releasedAt: s.quotationVersionSnapshots.releasedAt,
  }).from(s.quotationVersionSnapshots)
    .where(and(...conditions))
    .orderBy(desc(s.quotationVersionSnapshots.version));
  return { items: rows, total: rows.length };
}

/** One version's frozen payload, verbatim (view-shaped; export-ready). */
export async function getQuotationVersionPayload(
  quotationId: number,
  version: number,
): Promise<Record<string, unknown>> {
  const [row] = await db.select({ payload: s.quotationVersionSnapshots.payload })
    .from(s.quotationVersionSnapshots)
    .where(and(
      eq(s.quotationVersionSnapshots.quotationId, quotationId),
      eq(s.quotationVersionSnapshots.version, version),
    ))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy phiên bản báo giá');
  return row.payload as Record<string, unknown>;
}
