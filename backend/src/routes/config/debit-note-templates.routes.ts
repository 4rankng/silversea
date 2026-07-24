/**
 * Debit-note (Giấy báo nợ) template CRUD.
 *
 * Writes (POST/PUT) use DEDICATED transactional handlers — NOT createCrudRouter.
 * crud-factory runs beforeCreate + insert as two non-transactional statements
 * (crud-factory.ts:99-124), which cannot atomically enforce the single-default
 * invariant and would race to 0 defaults under concurrent "set as default"
 * requests. Here, clear-other-defaults + insert/update run inside one
 * db.transaction, mirroring the salary_periods.isDefault precedent (in-code
 * enforcement, no DB-level unique index). Reads/deletes are standard.
 *
 * Mounted under the config router → already gated by casbinAuthz('config')
 * (ADMIN/MANAGER/ACCOUNTANT read+write; ADMIN-only delete).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db';
import * as s from '../../db/schema';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { debitNoteTemplateSchema } from '@tingting/shared';
import { cacheInvalidate } from '../../lib/redis';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { parsePagination } from '../utils/pagination';

const router = Router();

/** Clear every other active default of the same document type. */
async function clearOtherDefaults(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], documentType: string): Promise<void> {
  await tx.update(s.debitNoteTemplates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(s.debitNoteTemplates.isDefault, true),
      eq(s.debitNoteTemplates.documentType, documentType),
      isNull(s.debitNoteTemplates.deletedAt),
    ));
}

// GET / — list (search by name; default first, then by name)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, offset } = parsePagination(req);
  const search = req.query.search as string;
  const documentType = req.query.documentType as string | undefined;
  const conds = [isNull(s.debitNoteTemplates.deletedAt)];
  if (documentType === 'DEBIT_NOTE' || documentType === 'PAYMENT_STATEMENT') {
    conds.push(eq(s.debitNoteTemplates.documentType, documentType));
  }
  if (search) {
    const escaped = search.replace(/[%_]/g, '\\$&');
    conds.push(sql`unaccent(${s.debitNoteTemplates.name}) ILIKE unaccent(${"%" + escaped + "%"})`);
  }
  const where = and(...conds);
  const [items, countRow] = await Promise.all([
    db.select().from(s.debitNoteTemplates).where(where)
      .limit(limit).offset(offset)
      .orderBy(desc(s.debitNoteTemplates.isDefault), s.debitNoteTemplates.name),
    db.select({ count: sql<number>`count(*)` }).from(s.debitNoteTemplates).where(where),
  ]);
  res.json({ items, total: Number(countRow[0]?.count ?? 0), page, pageSize: limit });
}));

// GET /:id
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const [row] = await db.select().from(s.debitNoteTemplates)
    .where(and(eq(s.debitNoteTemplates.id, id), isNull(s.debitNoteTemplates.deletedAt))).limit(1);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json(row);
}));

// POST / — create (transactional single-default enforcement)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const data = debitNoteTemplateSchema.parse(req.body);
  const createdBy = getUser(req).userId;
  const rows = await db.transaction(async (tx) => {
    if (data.isDefault) await clearOtherDefaults(tx, data.documentType);
    return tx.insert(s.debitNoteTemplates).values({ ...data, createdBy }).returning();
  });
  await cacheInvalidate('catalogs:bootstrap');
  res.status(201).json(rows[0]);
}));

// PUT /:id — update (full form; transactional single-default enforcement)
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = debitNoteTemplateSchema.parse(req.body);
  const rows = await db.transaction(async (tx) => {
    if (data.isDefault) await clearOtherDefaults(tx, data.documentType);
    return tx.update(s.debitNoteTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(s.debitNoteTemplates.id, id), isNull(s.debitNoteTemplates.deletedAt)))
      .returning();
  });
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy' });
  await cacheInvalidate('catalogs:bootstrap');
  res.json(rows[0]);
}));

// DELETE /:id — soft delete. Deleting the active default may leave zero defaults;
// the resolver then falls back to the legacy renderer until a new default is set.
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const rows = await db.update(s.debitNoteTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.debitNoteTemplates.id, id), isNull(s.debitNoteTemplates.deletedAt)))
    .returning();
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy' });
  await cacheInvalidate('catalogs:bootstrap');
  res.json({ ok: true });
}));

export default router;
