import { Router } from 'express';
import type { Request, Response } from 'express';
import { expenseSchema } from '@tingting/shared';
import { db } from '../db';
import { registerAuditEvent } from '../services/audit-registry';
import { AuditEvent } from '../services/audit-types';
import {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getRenewalReminders,
  getExpense,
} from '../services/expense.service';
import type { ExpenseUpdateInput } from '../services/expense.service';
import { asyncHandler } from '../middleware/asyncHandler';
import multer from 'multer';
import sharp from 'sharp';
import { eq, and } from 'drizzle-orm';
import * as s from '../db/schema';
import { storageService } from '../services/storage.service';
import { sniffImageType } from '../lib/format';
import { getUser } from '../middleware/auth';
import { invalidateReportCaches } from '../lib/redis';

registerAuditEvent('POST', '/api/expenses', AuditEvent.ENTITY_CREATED);
registerAuditEvent('PUT', '/api/expenses/', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('DELETE', '/api/expenses/', AuditEvent.ENTITY_DELETED);

const router = Router();

// B1: receipt-photo upload for company expenses. Mirrors the forwarder
// expense-photo pipeline but writes to expense_photos (FK→expenses.id) and
// wraps sharp in try/catch so a missing input codec (e.g. HEIC on a slim
// deploy) returns a clean 400 instead of a 500.
const MAX_IMAGE_DIMENSION = 2048;
// D1b: raised from 5 MB to 15 MB to match the trip-photo pipeline — the old
// 5 MB ceiling rejected many phone receipt photos even after resizing.
const EXPENSE_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const expensePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EXPENSE_PHOTO_MAX_BYTES } });

router.get('/reports/renewals', asyncHandler(async (_req: Request, res: Response) => {
  const reminders = await getRenewalReminders(db);
  res.json(reminders);
}));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const filters = {
    truckId: req.query.truckId ? Number(req.query.truckId) : undefined,
    supplierId: req.query.supplierId ? Number(req.query.supplierId) : undefined,
    categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
  };
  res.json(await listExpenses(db, filters));
}));

// GET /api/expenses/:id — fetch one expense for the edit page.
// The frontend `ExpenseEntryPage` queries this when isEdit=true; without it
// the form rendered empty for every "sửa phiếu".
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'ID không hợp lệ' });
  }
  const expense = await getExpense(db, id);
  if (!expense) return res.status(404).json({ error: 'Không tìm thấy khoản chi phí' });
  res.json(expense);
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const validatedData = expenseSchema.parse(req.body);
  const userId = req.user?.userId;
  const result = await db.transaction(async (tx) => {
    return createExpense(tx, { ...validatedData, amount: String(validatedData.amount) }, userId);
  });
  await invalidateReportCaches();
  res.status(201).json(result);
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const validatedData = expenseSchema.partial().parse(req.body);
  const userId = req.user?.userId;
  const { amount, ...rest } = validatedData;
  const serviceData: Partial<ExpenseUpdateInput> = {
    ...rest,
    ...(amount !== undefined ? { amount: String(amount) } : {}),
  };
  const result = await db.transaction(async (tx) => {
    return updateExpense(tx, Number(req.params.id), serviceData, userId);
  });
  await invalidateReportCaches();
  res.json(result);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  await db.transaction(async (tx) => {
    await deleteExpense(tx, Number(req.params.id), userId);
  });
  await invalidateReportCaches();
  res.json({ ok: true });
}));

// ── Expense receipt photos (B1) ─────────────────────────────────────────────
// Edit-mode flow: an expense must exist (have an id) before photos can attach —
// ExpenseEntryPage hides the upload zone until the row is saved, matching the
// expense_photos.expense_id FK. Keys live under expense-photos/<id>/ and are
// served by the shared /api/photos router (extended to allow these keys).

router.get('/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID không hợp lệ' });
  const rows = await db.select({
    id: s.expensePhotos.id,
    storageKey: s.expensePhotos.storageKey,
    uploadedAt: s.expensePhotos.uploadedAt,
  }).from(s.expensePhotos).where(eq(s.expensePhotos.expenseId, id))
    .orderBy(s.expensePhotos.uploadedAt);
  res.json({ items: rows.map(r => ({ ...r, url: `/api/photos/${encodeURIComponent(r.storageKey)}` })) });
}));

router.post('/:id/photos', expensePhotoUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID không hợp lệ' });
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Không có file tải lên' });

  // The expense must exist (and not be soft-deleted) before a photo can attach.
  // Authz: this router inherits casbinAuthz('financial'), so only
  // ACCOUNTANT/MANAGER/ADMIN reach it. Company expenses are a shared finance
  // resource — any finance-role user may manage (incl. attach/delete receipts
  // for) any expense, exactly as PUT/DELETE /api/expenses/:id already allow.
  // No per-user ownership gate, by design (consistent with existing CRUD).
  const expense = await getExpense(db, id);
  if (!expense) return res.status(404).json({ error: 'Không tìm thấy khoản chi phí' });

  const mime = sniffImageType(file.buffer);
  if (!mime) return res.status(400).json({ error: 'Định dạng file không được hỗ trợ' });

  // sharp throws when the deploy's libvips lacks the input codec (notably HEIC);
  // surface that as a clean 400 instead of a 500.
  let processedBuffer: Buffer;
  let ext: string;
  try {
    if (mime === 'image/png') {
      processedBuffer = await sharp(file.buffer).rotate()
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .png().toBuffer();
      ext = '.png';
    } else {
      processedBuffer = await sharp(file.buffer).rotate()
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
      ext = '.jpg';
    }
  } catch (err) {
    // sharp throws when libvips lacks the input codec (notably HEIC on a slim
    // deploy). Log so ops can detect a codec regression; return a clean 400.
    console.warn('[expenses/:id/photos] sharp failed to process image:', err instanceof Error ? err.message : err);
    return res.status(400).json({ error: 'Không xử lý được ảnh. Nếu là ảnh HEIC (iPhone), vui lòng đổi sang JPG/PNG rồi tải lại.' });
  }

  const storageKey = `expense-photos/${id}/${Date.now()}${ext}`;
  await storageService.upload(processedBuffer, storageKey);
  const [photo] = await db.insert(s.expensePhotos).values({
    expenseId: id,
    storageKey,
    uploadedBy: getUser(req).userId,
  }).returning({ id: s.expensePhotos.id, storageKey: s.expensePhotos.storageKey });

  res.status(201).json({ ...photo, url: `/api/photos/${encodeURIComponent(photo.storageKey)}` });
}));

router.delete('/:id/photos/:photoId', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(photoId) || photoId <= 0) return res.status(400).json({ error: 'ID không hợp lệ' });
  // Scope by both ids so the path's :id is honoured: a finance user may only
  // delete a photo that belongs to the expense named in the URL, never an
  // arbitrary row by photoId alone (defense-in-depth within the finance scope).
  const [row] = await db.select({ storageKey: s.expensePhotos.storageKey })
    .from(s.expensePhotos).where(and(eq(s.expensePhotos.id, photoId), eq(s.expensePhotos.expenseId, id))).limit(1);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  await db.delete(s.expensePhotos).where(and(eq(s.expensePhotos.id, photoId), eq(s.expensePhotos.expenseId, id)));
  try { await storageService.delete(row.storageKey); } catch { /* best-effort */ }
  res.json({ ok: true });
}));

export default router;
