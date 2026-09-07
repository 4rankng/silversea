/**
 * dispatch-task-tags — global quick-select tag pool for the dispatch-plan
 * note composer ("Ghi chú tác vụ"). Labels are opaque operator-facing text;
 * `normalized_label` (NFC + lowercase + trim) backs the case-insensitive
 * duplicate guard. Seeded by migration 0058; dispatcher-created labels join
 * the same pool.
 */
import { asc, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';

/** NFC + lowercase + trim — the case-insensitive duplicate key. NFC runs
 *  first so decomposed Vietnamese input still matches the composed seed
 *  rows. */
export function normalizeDispatchTaskTagLabel(label: string): string {
  return label.normalize('NFC').toLowerCase().trim();
}

/** Active tags ordered by label for the composer's chip row. */
export async function listDispatchTaskTags() {
  const rows = await db.select({ id: s.dispatchTaskTags.id, label: s.dispatchTaskTags.label })
    .from(s.dispatchTaskTags)
    .where(eq(s.dispatchTaskTags.isActive, true))
    .orderBy(asc(s.dispatchTaskTags.label));
  return { items: rows };
}

/**
 * Create: validates 1..80 chars and returns the new row. A duplicate
 * normalized label is a 409 — the frontend then selects the existing chip
 * instead of erroring out the dispatcher.
 */
export async function createDispatchTaskTag(input: { label: string; actor: AuthUser }): Promise<{ id: number; label: string }> {
  const trimmed = input.label.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new ApiError(400, 'Tên tag phải từ 1 đến 80 ký tự.');
  }
  // The composer joins note parts with '; ' — a label containing ';' could
  // never re-parse as a chip and would duplicate on re-toggle.
  if (trimmed.includes(';')) {
    throw new ApiError(400, 'Tên tag không được chứa dấu ;');
  }
  const normalized = normalizeDispatchTaskTagLabel(trimmed);
  // NFC lowering can expand a char (İ → i̇) — keep the key within its column.
  if (normalized.length > 80) {
    throw new ApiError(400, 'Tên tag quá dài sau khi chuẩn hóa.');
  }
  const [inserted] = await db.insert(s.dispatchTaskTags).values({
    label: trimmed,
    normalizedLabel: normalized,
    createdBy: input.actor?.userId ?? null,
  }).onConflictDoNothing({ target: s.dispatchTaskTags.normalizedLabel }).returning();
  if (!inserted) throw new ApiError(409, 'Tag đã tồn tại.');
  return { id: inserted.id, label: inserted.label };
}
