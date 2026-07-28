/**
 * Admin FAQ knowledge base management — CRUD over `faq_entries` with automatic
 * embedding regeneration on every create/update.
 *
 * RBAC: the `faq-admin` Casbin resource has NO policy row — only the ADMIN
 * wildcard (`p, ADMIN, *, *`) matches, so every non-ADMIN role gets 403.
 * `requireRoles(Role.ADMIN)` is applied at mount time (index.ts) as
 * belt-and-suspenders. This mirrors the llm-settings route exactly.
 *
 * Why a custom router (not createCrudRouter)?
 *   - The table uses `is_active` (not `deletedAt`), which the factory's
 *     soft-delete auto-detection can't express.
 *   - create/update need a side-effect: regenerate the row's vector embedding
 *     so the new/edited FAQ is immediately queryable by the chatbot fast lane.
 *   - The list/detail endpoints must SELECT every column EXCEPT `embedding`
 *     (1536 floats) to keep payloads small and avoid leaking vectors.
 *
 * Tone-stripping: `requiredTerms` / `forbiddenTerms` MUST be stored
 * tone-stripped (e.g. 'phat' not 'phạt') because the fast-lane matcher compares
 * them against tone-stripped query tokens. We reuse the SAME normalizeText()
 * helper the matcher uses (services/agent/text.ts) so both sides agree byte-
 * for-byte. Storing diacritics here would silently reject every semantic match.
 *
 * Fail-soft embedding: if the OpenRouter key is missing or the provider is
 * down, the row still saves with `embedding = NULL` and the response carries
 * `embeddingStatus: 'failed'`. The fast lane already abstains on NULL
 * embeddings (its WHERE clause filters them out), so the chatbot degrades
 * gracefully — no 500, no broken state.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import {
  faqEntryCreateSchema,
  faqEntryUpdateSchema,
  type FaqEmbeddingStatus,
} from '@tingting/shared';
import { embedText, vecLiteral } from '../services/llm/embeddings';
import { normalizeText } from '../services/agent/text';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';

const router = Router();
const FAQ_COMMANDS = {
  CREATE: 'admin.faq-entries.create',
  UPDATE: 'admin.faq-entries.update',
  DELETE: 'admin.faq-entries.delete',
} as const;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Columns selected for API responses. The `embedding` vector column is
// deliberately excluded — it's 1536 floats and never useful to the client.
// Embedding presence is instead surfaced via a computed `hasEmbedding` flag.
const ENTRY_COLUMNS = {
  id: s.faqEntries.id,
  question: s.faqEntries.question,
  answer: s.faqEntries.answer,
  questionVariants: s.faqEntries.questionVariants,
  requiredTerms: s.faqEntries.requiredTerms,
  forbiddenTerms: s.faqEntries.forbiddenTerms,
  searchText: s.faqEntries.searchText,
  isActive: s.faqEntries.isActive,
  sortOrder: s.faqEntries.sortOrder,
  createdAt: s.faqEntries.createdAt,
  updatedAt: s.faqEntries.updatedAt,
  // Boolean projection of `embedding IS NOT NULL` — cheap, lets the UI show
  // an accurate "embedded / not embedded" badge without shipping the vector.
  hasEmbedding: sql<boolean>`${s.faqEntries.embedding} IS NOT NULL`,
} as const;

// Drizzle's inferred row type — timestamps are `Date` at the DB layer. They
// serialize to ISO strings in the JSON response via Date.prototype.toJSON
// (invoked by res.json's JSON.stringify), so the client sees the shared
// `FaqEntry` (string timestamps) without any explicit conversion here.
type FaqEntryRow = {
  id: number;
  question: string;
  answer: string;
  questionVariants: string[];
  requiredTerms: string[];
  forbiddenTerms: string[];
  searchText: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  hasEmbedding: boolean;
};

/** Tone-strip every term in an array, dropping empties. `questionVariants`
 *  keep diacritics (normalized at match time) — only required/forbidden terms
 *  are stripped, per the seed's documented contract. */
function stripTerms(terms: string[] | undefined): string[] {
  if (!terms) return [];
  return terms.map((t) => normalizeText(t.trim())).filter((t) => t.length > 0);
}

/** (Re)embed a single FAQ row and persist the vector. Mirrors the backfill
 *  script's input format: question + variants joined by ' \n ' so the vector
 *  captures the question's full intent space. Fail-soft: returns false on any
 *  error so the caller can surface `embeddingStatus: 'failed'` without failing
 *  the save. The row's embedding stays NULL on failure. */
async function embedAndStore(
  q: typeof db | Tx,
  id: number,
  question: string,
  variants: string[],
): Promise<boolean> {
  try {
    const input = [question, ...(variants ?? [])].join(' \n ');
    const vec = await embedText(input);
    const lit = vecLiteral(vec);
    if (!lit) return false;
    await q.execute(
      sql`UPDATE faq_entries SET embedding = ${lit}::vector, updated_at = NOW() WHERE id = ${id}`,
    );
    return true;
  } catch (e) {
    console.warn(
      `[faq-admin] embed failed for entry ${id} (saved with NULL embedding):`,
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

/** Re-fetch a row's response columns (no embedding). Used after the embedding
 *  side-effect UPDATE so the returned `updatedAt` reflects the embedding write. */
async function fetchEntryForResponse(id: number): Promise<FaqEntryRow | null> {
  return fetchEntryForResponseInQuery(db, id);
}

async function fetchEntryForResponseInQuery(
  q: typeof db | Tx,
  id: number,
): Promise<FaqEntryRow | null> {
  const [row] = await q.select(ENTRY_COLUMNS).from(s.faqEntries).where(eq(s.faqEntries.id, id)).limit(1);
  return (row as FaqEntryRow | undefined) ?? null;
}

function requireIdempotencyKey(req: Request, message: string): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) throw new ApiError(400, message);
  return key;
}

function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) throw new ApiError(428, message);
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

async function lockEntryVersion(tx: Tx, id: number, expected: Date): Promise<void> {
  const [row] = await tx.select({ updatedAt: s.faqEntries.updatedAt })
    .from(s.faqEntries)
    .where(eq(s.faqEntries.id, id))
    .limit(1)
    .for('update');
  if (!row) throw new ApiError(404, 'Không tìm thấy câu hỏi FAQ');
  if (row.updatedAt.getTime() !== expected.getTime()) {
    throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

/** GET / — list all entries. Ordered by sortOrder then id for stable display.
 *  `?search=` applies unaccent-ILIKE on the canonical question. Inactive entries
 *  are hidden by default; `?includeInactive=true` surfaces them for admin
 *  revival/audit. Paginated via the standard page/limit query params. */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const search = (req.query.search as string | undefined)?.trim();
  const includeInactive = req.query.includeInactive === 'true';
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) || '100', 10) || 100));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (!includeInactive) conditions.push(eq(s.faqEntries.isActive, true));
  if (search) {
    const escaped = search.replace(/[%_]/g, '\\$&');
    conditions.push(sql`unaccent(${s.faqEntries.question}) ILIKE unaccent(${"%" + escaped + "%"})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = (await db.select(ENTRY_COLUMNS).from(s.faqEntries).where(where)
    .orderBy(asc(s.faqEntries.sortOrder), asc(s.faqEntries.id))
    .limit(limit).offset(offset)) as FaqEntryRow[];
  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(s.faqEntries).where(where);

  res.json({ items, total: Number(countRow?.count ?? 0), page, pageSize: limit });
}));

/** GET /:id — single entry (no embedding column). */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'ID không hợp lệ');
  const entry = await fetchEntryForResponse(id);
  if (!entry) throw new ApiError(404, 'Không tìm thấy câu hỏi FAQ');
  res.json(entry);
}));

/** POST / — create a new FAQ entry, then (re)embed it in the same request. */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const data = faqEntryCreateSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tạo câu hỏi FAQ.');
  const { result, replayed } = await runIdempotent({
    endpoint: FAQ_COMMANDS.CREATE,
    idempotencyKey,
    payload: data,
    createdBy: req.user?.userId ?? null,
    entityType: 'faq-entries',
    responseStatusCode: 201,
    create: async (tx) => {
      const [created] = await tx.insert(s.faqEntries).values({
        question: data.question,
        answer: data.answer,
        questionVariants: data.questionVariants,
        requiredTerms: stripTerms(data.requiredTerms),
        forbiddenTerms: stripTerms(data.forbiddenTerms),
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      }).returning(ENTRY_COLUMNS);
      if (!created) throw new ApiError(500, 'Không thể tạo câu hỏi FAQ');
      const ok = await embedAndStore(tx, created.id, created.question, created.questionVariants);
      const entry = (await fetchEntryForResponseInQuery(tx, created.id)) ?? (created as unknown as FaqEntryRow);
      return {
        entry,
        embeddingStatus: ok ? 'embedded' : 'failed' as FaqEmbeddingStatus,
      };
    },
  });
  res.status(201).json({ ...result, replayed });
}));

/** PUT /:id — partial update. Tone-strips terms if present, then re-embeds
 *  (the question's intent may shift even when only terms change — cheap & safe
 *  to always re-embed). */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'ID không hợp lệ');
  const data = faqEntryUpdateSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật câu hỏi FAQ.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản câu hỏi FAQ. Vui lòng tải lại trước khi cập nhật.',
  );
  const { result, replayed } = await runIdempotent({
    endpoint: FAQ_COMMANDS.UPDATE,
    idempotencyKey,
    payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: req.user?.userId ?? null,
    entityType: 'faq-entries',
    create: async (tx) => {
      await lockEntryVersion(tx, id, expectedUpdatedAt);
      const patch: Record<string, unknown> = { ...data, updatedAt: new Date() };
      if (data.requiredTerms) patch.requiredTerms = stripTerms(data.requiredTerms);
      if (data.forbiddenTerms) patch.forbiddenTerms = stripTerms(data.forbiddenTerms);
      const [updated] = await tx.update(s.faqEntries)
        .set(patch)
        .where(eq(s.faqEntries.id, id))
        .returning(ENTRY_COLUMNS);
      if (!updated) throw new ApiError(404, 'Không tìm thấy câu hỏi FAQ');
      const ok = await embedAndStore(tx, updated.id, updated.question, updated.questionVariants);
      const entry = (await fetchEntryForResponseInQuery(tx, updated.id)) ?? (updated as unknown as FaqEntryRow);
      return {
        entry,
        embeddingStatus: ok ? 'embedded' : 'failed' as FaqEmbeddingStatus,
      };
    },
  });
  res.json({ ...result, replayed });
}));

/** DELETE /:id — hard delete. The HNSW partial index drops the row automatically.
 *  is_active toggling is handled via PUT, so there's no separate endpoint. */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) throw new ApiError(400, 'ID không hợp lệ');
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi xóa câu hỏi FAQ.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản câu hỏi FAQ. Vui lòng tải lại trước khi xóa.',
  );
  const { replayed } = await runIdempotent({
    endpoint: FAQ_COMMANDS.DELETE,
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: req.user?.userId ?? null,
    entityType: 'faq-entries',
    create: async (tx) => {
      await lockEntryVersion(tx, id, expectedUpdatedAt);
      const [deleted] = await tx.delete(s.faqEntries)
        .where(eq(s.faqEntries.id, id))
        .returning({ id: s.faqEntries.id });
      if (!deleted) throw new ApiError(404, 'Không tìm thấy câu hỏi FAQ');
      return { ok: true };
    },
  });
  res.json({ ok: true, replayed });
}));

export default router;
