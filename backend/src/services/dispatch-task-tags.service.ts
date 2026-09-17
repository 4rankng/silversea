/**
 * dispatch-task-tags — global quick-select tag pool for the dispatch-plan
 * note composer ("Ghi chú tác vụ"). Labels are opaque operator-facing text;
 * `normalized_label` (NFC + lowercase + trim) backs the case-insensitive
 * duplicate guard. Seeded by migration 0058; dispatcher-created labels join
 * the same pool.
 */
import { and, asc, eq, ne, or, sql } from 'drizzle-orm';

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

// Applied migration 0066 stored three GẮP labels under a legacy "gặp" key.
// Compare the visible label too, so existing installations cannot recreate
// those labels as duplicate chips. Keep the stored-key comparison for the
// unique constraint and normalize Unicode just like the public boundary.
function matchingTaskTagLabel(normalized: string) {
  return or(
    eq(s.dispatchTaskTags.normalizedLabel, normalized),
    sql`lower(btrim(normalize(${s.dispatchTaskTags.label}, NFC))) = ${normalized}`,
  );
}

/** Active tags for the composer's chip row: the canonical operation-tag set
 *  (ticket a6cb2543, migration 0066) in display order first, then any
 *  dispatcher-added labels alphabetically. */
export async function listDispatchTaskTags() {
  const rows = await db.select({
    id: s.dispatchTaskTags.id,
    label: s.dispatchTaskTags.label,
    displayOrder: s.dispatchTaskTags.displayOrder,
  })
    .from(s.dispatchTaskTags)
    .where(eq(s.dispatchTaskTags.isActive, true))
    .orderBy(
      sql`${s.dispatchTaskTags.displayOrder} asc nulls last`,
      asc(s.dispatchTaskTags.label),
    );
  return { items: rows };
}

/**
 * Create: validates 1..80 chars and returns the row. A duplicate normalized
 * label is a 409 — the frontend then selects the existing chip instead of
 * erroring out the dispatcher — unless the key is held by a soft-deleted row,
 * which is resurrected instead (see below).
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
  const values = {
    label: trimmed,
    normalizedLabel: normalized,
    createdBy: input.actor?.userId ?? null,
  };
  const matches = await db.select().from(s.dispatchTaskTags)
    .where(matchingTaskTagLabel(normalized));
  if (matches.some((row) => row.isActive)) throw new ApiError(409, 'Tag đã tồn tại.');
  // Prefer the row already owning the canonical unique key if historical
  // duplicates were both deactivated. Never delete another custom record.
  const existing = matches.find((row) => row.normalizedLabel === normalized) ?? matches[0];
  if (existing) {
    const [revived] = await db.update(s.dispatchTaskTags)
      .set({ ...values, isActive: true })
      .where(and(eq(s.dispatchTaskTags.id, existing.id), eq(s.dispatchTaskTags.isActive, false)))
      .returning();
    if (revived) return { id: revived.id, label: revived.label };
    throw new ApiError(409, 'Tag đã tồn tại.');
  }
  const [inserted] = await db.insert(s.dispatchTaskTags).values(values)
    .onConflictDoNothing({ target: s.dispatchTaskTags.normalizedLabel }).returning();
  if (inserted) return { id: inserted.id, label: inserted.label };
  // onConflictDoNothing also skips when the key is held by a soft-deleted
  // row (deletion keeps the unique normalized_label). Re-create after delete
  // rejoins the pool: reactivate that row instead of 409ing a label the
  // operator just saw disappear from the chip row.
  const [revived] = await db.update(s.dispatchTaskTags)
    .set({ ...values, isActive: true })
    .where(and(
      eq(s.dispatchTaskTags.normalizedLabel, normalized),
      eq(s.dispatchTaskTags.isActive, false),
    ))
    .returning();
  if (revived) return { id: revived.id, label: revived.label };
  // Still held by an active row (or vanished mid-race) — genuine duplicate.
  throw new ApiError(409, 'Tag đã tồn tại.');
}

/**
 * Rename: same validation as create. The normalized key is unique across
 * active AND inactive rows, so renaming onto a key another row holds is a
 * 409 — a rename never resurrects a deleted label. Renaming onto the row's
 * own key (casing-only change) is allowed. Unknown id → 404.
 */
export async function updateDispatchTaskTag(input: { id: number; label: string; actor: AuthUser }): Promise<{ id: number; label: string }> {
  const trimmed = input.label.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new ApiError(400, 'Tên tag phải từ 1 đến 80 ký tự.');
  }
  if (trimmed.includes(';')) {
    throw new ApiError(400, 'Tên tag không được chứa dấu ;');
  }
  const normalized = normalizeDispatchTaskTagLabel(trimmed);
  if (normalized.length > 80) {
    throw new ApiError(400, 'Tên tag quá dài sau khi chuẩn hóa.');
  }
  const [existing] = await db.select()
    .from(s.dispatchTaskTags)
    .where(eq(s.dispatchTaskTags.id, input.id));
  if (!existing) throw new ApiError(404, 'Tag không tồn tại.');
  // A legacy visible label may have an incorrect key; exclude this row so
  // repairing its own key remains allowed, while other labels stay unique.
  const [conflict] = await db.select({ id: s.dispatchTaskTags.id })
    .from(s.dispatchTaskTags)
    .where(and(ne(s.dispatchTaskTags.id, input.id), matchingTaskTagLabel(normalized)));
  if (conflict) throw new ApiError(409, 'Tag đã tồn tại.');
  await db.update(s.dispatchTaskTags)
    .set({ label: trimmed, normalizedLabel: normalized })
    .where(eq(s.dispatchTaskTags.id, input.id));
  return { id: input.id, label: trimmed };
}

/**
 * Soft-delete: hides the label from the composer's chip row while keeping
 * the unique normalized key. Idempotent — deactivating an already-inactive
 * row still reports success so a second delete click doesn't 404.
 */
export async function deactivateDispatchTaskTag(input: { id: number }): Promise<{ ok: true }> {
  const [deactivated] = await db.update(s.dispatchTaskTags)
    .set({ isActive: false })
    .where(eq(s.dispatchTaskTags.id, input.id))
    .returning({ id: s.dispatchTaskTags.id });
  if (!deactivated) throw new ApiError(404, 'Tag không tồn tại.');
  return { ok: true };
}
