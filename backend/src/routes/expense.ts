import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
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
import { ApiError } from '../errors';
import { runIdempotent } from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';

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

function requireIdempotencyKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thay đổi chi phí.');
  return key;
}

function requireExpectedUpdatedAt(req: Request): Date {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) {
    throw new ApiError(
      428,
      'Thiếu phiên bản dữ liệu. Vui lòng tải lại khoản chi trước khi cập nhật.',
    );
  }
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

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
  const userId = getUser(req).userId;
  const idempotencyKey = requireIdempotencyKey(req);
  const input = { ...validatedData, amount: String(validatedData.amount) };
  const { result } = await runIdempotent({
    endpoint: 'expenses.create',
    idempotencyKey,
    payload: input,
    createdBy: userId,
    entityType: 'EXPENSE',
    create: (tx) => createExpense(tx, input, userId),
  });
  await invalidateReportCaches();
  res.status(201).json(result);
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const validatedData = expenseSchema.partial().parse(req.body);
  const userId = getUser(req).userId;
  const id = Number(req.params.id);
  const idempotencyKey = requireIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(req);
  const { amount, ...rest } = validatedData;
  const serviceData: Partial<ExpenseUpdateInput> = {
    ...rest,
    ...(amount !== undefined ? { amount: String(amount) } : {}),
  };
  const { result } = await runIdempotent({
    endpoint: 'expenses.update',
    idempotencyKey,
    payload: { id, body: serviceData, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: userId,
    entityType: 'EXPENSE',
    create: (tx) => updateExpense(tx, id, serviceData, expectedUpdatedAt, userId),
  });
  await invalidateReportCaches();
  res.json(result);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUser(req).userId;
  const id = Number(req.params.id);
  const idempotencyKey = requireIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(req);
  const { result } = await runIdempotent({
    endpoint: 'expenses.delete',
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: userId,
    entityType: 'EXPENSE',
    create: async (tx) => {
      await deleteExpense(tx, id, expectedUpdatedAt, userId);
      return { ok: true as const, id };
    },
    getEntityId: (value) => value.id,
    serializeResult: () => ({ ok: true }),
    deserializeResult: () => ({ ok: true as const, id }),
  });
  await invalidateReportCaches();
  res.json({ ok: result.ok });
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
  const idempotencyKey = requireIdempotencyKey(req);
  const actorId = getUser(req).userId;

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

  const fileHash = createHash('sha256').update(processedBuffer).digest('hex');
  const keyHash = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  const storageKey = `expense-photos/${id}/${keyHash}${ext}`;
  const { result: photo } = await runIdempotent({
    endpoint: 'expenses.photo.create',
    idempotencyKey,
    payload: { expenseId: id, fileHash, mime },
    createdBy: actorId,
    entityType: 'EXPENSE_PHOTO',
    create: async (tx) => {
      // The external object key is deterministic from the transaction key.
      // If the process stops after upload but before DB commit, an exact retry
      // overwrites the same object and then commits one photo row.
      const expense = await getExpense(tx, id);
      if (!expense) throw new ApiError(404, 'Không tìm thấy khoản chi phí');
      await storageService.upload(processedBuffer, storageKey);
      const [created] = await tx.insert(s.expensePhotos).values({
        expenseId: id,
        storageKey,
        uploadedBy: actorId,
      }).returning({ id: s.expensePhotos.id, storageKey: s.expensePhotos.storageKey });
      return created;
    },
  });

  res.status(201).json({ ...photo, url: `/api/photos/${encodeURIComponent(photo.storageKey)}` });
}));

router.delete('/:id/photos/:photoId', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(photoId) || photoId <= 0) return res.status(400).json({ error: 'ID không hợp lệ' });
  const idempotencyKey = requireIdempotencyKey(req);
  const actorId = getUser(req).userId;
  const { result, replayed } = await runIdempotent({
    endpoint: 'expenses.photo.delete',
    idempotencyKey,
    payload: { expenseId: id, photoId },
    createdBy: actorId,
    entityType: 'EXPENSE_PHOTO',
    create: async (tx) => {
      // Scope by both ids so the path's :id is honoured, and lock the row so
      // two different keys still have one valid deletion winner.
      const [row] = await tx.select({
        id: s.expensePhotos.id,
        storageKey: s.expensePhotos.storageKey,
      })
        .from(s.expensePhotos)
        .where(and(eq(s.expensePhotos.id, photoId), eq(s.expensePhotos.expenseId, id)))
        .limit(1)
        .for('update');
      if (!row) throw new ApiError(404, 'Không tìm thấy ảnh');
      await tx.delete(s.expensePhotos)
        .where(and(eq(s.expensePhotos.id, photoId), eq(s.expensePhotos.expenseId, id)));
      return { ok: true as const, id: row.id, storageKey: row.storageKey };
    },
    getEntityId: (value) => value.id,
  });
  if (!replayed) {
    try { await storageService.delete(result.storageKey); } catch { /* best-effort */ }
  }
  res.json({ ok: true });
}));

export default router;
