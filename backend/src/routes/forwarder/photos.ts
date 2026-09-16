/**
 * Forwarder expense photos: list, upload with HEIC-safe re-encode, and
 * guarded delete. Handler bodies + photo consts moved verbatim from
 * routes/forwarder.ts.
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { runIdempotent } from '../../services/idempotency.service';
import { cancelStorageCleanupGuard } from '../../services/durable-effect.service';
import type { Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as s from '../../db/schema';
import { and, eq } from 'drizzle-orm';

import { ApiError } from '../../errors';
import {
  assertForwarderTripScope, assertForwarderMutableTripScope,
  getExpensePhotos, getExpenseTripLink, getForwarderOwnedExpenseId,
} from '../../services/forwarder.service';
import { storageService } from '../../services/storage.service';
import { sniffImageType } from '../../lib/format';
import {
  acquireForwarderCleanupGuard, releaseForwarderCleanupGuard,
  deleteForwarderExpensePhotoCommand,
  requireForwarderIdempotencyKey,
  withMaterialWriteAuditContext, hashStorageKey,
  expensePhotoAfterUploadHookForTest, FORWARDER_IDEMPOTENCY_ENDPOINTS,
} from './forwarder-shared';

// Unify with upload.ts / expense.ts (2048). Was 1600 — inconsistent downscale ceiling.
const MAX_IMAGE_DIMENSION = 2048;
const expensePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();


router.get('/expenses/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  // N1: gate on expense ownership before listing — unowned → 404 (not 403),
  // so a forwarder cannot enumerate another forwarder's photo metadata.
  const ownedExpenseId = await getForwarderOwnedExpenseId(expenseId, forwarder.id);
  if (!ownedExpenseId) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }
  const ownedTripId = await getExpenseTripLink(expenseId);
  if (ownedTripId == null) throw new ApiError(404, 'Không tìm thấy chi phí');
  await assertForwarderTripScope(ownedTripId, forwarder.id);
  const photos = await getExpensePhotos(expenseId);
  res.json({ items: photos });
}));

router.post('/expenses/:id/photos', expensePhotoUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const file = req.file;
  if (!file) throw new ApiError(400, 'Không có file tải lên');

  const expenseId = parseInt(req.params.id as string, 10);

  // N1: ownership precheck BEFORE any processing — unowned → 404 (not 403),
  // so a forwarder cannot attach photos to another forwarder's trip_expense.
  const ownedExpenseId = await getForwarderOwnedExpenseId(expenseId, forwarder.id);
  if (!ownedExpenseId) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }

  // Validate image type
  const mime = sniffImageType(file.buffer);
  if (!mime) throw new ApiError(400, 'Định dạng file không được hỗ trợ');

  // Process: strip EXIF, downscale. Wrapped in try/catch (parity with
  // expense.ts) so a corrupt/unsupported codec yields a clean 400, not a 500.
  let processedBuffer: Buffer;
  let ext: string;
  try {
    if (mime === 'image/png') {
      processedBuffer = await sharp(file.buffer).rotate().resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      ext = '.png';
    } else {
      processedBuffer = await sharp(file.buffer).rotate().resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      ext = '.jpg';
    }
  } catch (err) {
    console.warn('[forwarder] expense-photo processing failed:', err instanceof Error ? err.message : err);
    throw new ApiError(400, 'Xử lý ảnh thất bại');
  }
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const fileHash = createHash('sha256').update(processedBuffer).digest('hex');
  const storageKey = `expense-photos/${expenseId}/${createHash('sha256')
    .update(`forwarder-expense-photo:${forwarder.id}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32)}${ext}`;
  const cleanupGuard = await acquireForwarderCleanupGuard({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
    idempotencyKey,
    dedupeKey: `forwarder-expense-photo-orphan:${forwarder.id}:${hashStorageKey(storageKey)}:${idempotencyKey}`,
    storageKey,
    entityId: expenseId,
  });
  if (cleanupGuard) {
    try {
      await storageService.upload(processedBuffer, storageKey);
    } catch (error) {
      await releaseForwarderCleanupGuard(cleanupGuard, error, 'forwarder.expense-photo.create');
      throw error;
    }
  }
  try {
    const outcome = await withMaterialWriteAuditContext(
      req,
      res,
      FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
      () => runIdempotent({
        endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
        idempotencyKey,
        payload: { expenseId, forwarderId: forwarder.id, fileHash },
        createdBy: forwarder.id,
        responseStatusCode: 201,
        create: async (tx) => {
          if (!cleanupGuard) {
            throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
          }
          const [expense] = await tx.select({ id: s.tripExpenses.id })
            .from(s.tripExpenses)
            .where(and(eq(s.tripExpenses.id, expenseId), eq(s.tripExpenses.forwarderId, forwarder.id)))
            .limit(1);
          if (!expense) {
            throw new ApiError(404, 'Không tìm thấy chi phí');
          }
          const [ownedExpense] = await tx.select({ tripId: s.tripExpenses.tripId })
            .from(s.tripExpenses)
            .where(eq(s.tripExpenses.id, expenseId))
            .limit(1);
          if (!ownedExpense) throw new ApiError(404, 'Không tìm thấy chi phí');
          await assertForwarderMutableTripScope(ownedExpense.tripId, forwarder.id, tx);
          const cancelled = await cancelStorageCleanupGuard(tx, cleanupGuard);
          if (!cancelled) {
            throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
          }
          if (expensePhotoAfterUploadHookForTest) {
            await expensePhotoAfterUploadHookForTest();
          }
          const [photo] = await tx.insert(s.tripExpensePhotos).values({
            tripExpenseId: expense.id,
            storageKey,
            uploadedBy: forwarder.id,
          }).returning();
          return photo;
        },
      }),
    );
    res.status(outcome.statusCode).json(outcome.result);
  } catch (error) {
    await releaseForwarderCleanupGuard(cleanupGuard, error, 'forwarder.expense-photo.create');
    throw error;
  }
}));

router.delete('/expense-photos/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const photoId = parseInt(req.params.id as string, 10);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  // 2026-09-12 user directive: the version precondition on photo delete is
  // removed — deletes always proceed. Ownership, idempotency stay; the command
  // already treats an absent expectedUpdatedAt as "skip the staleness check".
  await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_DELETE,
    idempotencyKey,
    payload: {
      photoId,
      forwarderId: forwarder.id,
    },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      const result = await deleteForwarderExpensePhotoCommand(tx, photoId, forwarder.id, undefined);
      if (!result) {
        throw new ApiError(404, 'Không tìm thấy ảnh');
      }
      return result;
    },
  });
  res.json({ success: true });
}));

// ── Expense type labels (for forwarder catalog) ──


export default router;
