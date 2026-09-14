import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { expenseSchema } from '@tingting/shared';
import { z } from 'zod';
import { db } from '../db';
import { registerAuditEvent } from '../services/audit-registry';
import { AuditEvent } from '../services/audit-types';
import {
  listExpenses,
  updateExpense,
  getRenewalReminders,
  getExpense,
  isGovernedCompanyExpenseMutation,
  requestCompanyExpenseGovernance,
  submitExpense,
  getExpensePhotoList,
  EXPENSE_LIST_SORT_KEYS,
} from '../services/expense.service';
import type { ExpenseUpdateInput } from '../services/expense.service';
import { parsePagination } from './utils/pagination';
import { asyncHandler } from '../middleware/asyncHandler';
import multer from 'multer';
import sharp from 'sharp';
import { eq, and } from 'drizzle-orm';
import * as s from '../db/schema';
import { storageService } from '../services/storage.service';
import { sniffImageType } from '../lib/format';
import { getUser } from '../middleware/auth';
import { requireRoles } from '../middleware/casbin';
import { Role } from '@tingting/shared';
import { invalidateReportCaches } from '../lib/report-cache';
import { ApiError } from '../errors';
import { throwValidation } from '../lib/validation';
import {
  IDEMPOTENCY_ENDPOINTS,
  findIdempotencyRecord,
  runIdempotent,
  waitForIdempotencyRecord,
} from '../services/idempotency.service';
import {
  runWithAuditRequestContext,
} from '../services/audit.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';
import {
  armStorageCleanupGuard,
  cancelStorageCleanupGuard,
  enqueueStorageDelete,
  releaseStorageCleanupGuard,
  STORAGE_DELETE_MODE,
  type StorageCleanupGuardLease,
} from '../services/durable-effect.service';

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

function withMaterialWriteAuditContext<T>(
  req: Request,
  res: Response,
  endpoint: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithAuditRequestContext({
    req,
    res,
    fullPath: (req.originalUrl || req.url || '').split('?')[0],
    isLoginPath: false,
    declaredMaterialWriteEndpoint: endpoint,
  }, fn);
}

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

function hashStorageKey(storageKey: string): string {
  return createHash('sha256').update(storageKey).digest('hex').slice(0, 32);
}

async function acquireExpenseCleanupGuard(args: {
  endpoint: string;
  idempotencyKey: string;
  dedupeKey: string;
  storageKey: string;
  entityId: number;
}): Promise<StorageCleanupGuardLease | null> {
  const existingIdempotency = await findIdempotencyRecord(args.endpoint, args.idempotencyKey);
  if (existingIdempotency) return null;
  try {
    return await armStorageCleanupGuard({
      dedupeKey: args.dedupeKey,
      storageKey: args.storageKey,
      entityType: 'expense_photos',
      entityId: args.entityId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('storage cleanup guard already leased')) {
      const committed = await waitForIdempotencyRecord(args.endpoint, args.idempotencyKey);
      if (committed) return null;
      throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
    }
    throw error;
  }
}

async function releaseExpenseCleanupGuard(
  lease: StorageCleanupGuardLease | null,
  error: unknown,
  context: string,
): Promise<void> {
  if (!lease) return;
  try {
    await releaseStorageCleanupGuard(lease, error);
  } catch (releaseError) {
    console.warn(
      `[${context}] failed to release durable cleanup guard ${lease.dedupeKey}:`,
      releaseError instanceof Error ? releaseError.message : releaseError,
    );
  }
}

const governanceReasonSchema = z.object({
  reason: z.string().trim().min(1, 'Lý do là bắt buộc').max(1000),
});

async function invalidateExpenseCreateReports(replayed: boolean) {
  if (!replayed) {
    await invalidateReportCaches();
  }
}

async function invalidateExpenseUpdateReports(replayed: boolean) {
  if (!replayed) {
    await invalidateReportCaches();
  }
}

async function invalidateExpenseDeleteReports(replayed: boolean) {
  if (!replayed) {
    await invalidateReportCaches();
  }
}

router.get('/reports/renewals', asyncHandler(async (_req: Request, res: Response) => {
  const reminders = await getRenewalReminders(db);
  res.json(reminders);
}));

// Sort params are validated separately from the numeric filters above so an
// unknown sortBy fails loudly (zod 400) instead of silently no-oping.
const expenseListSortQuerySchema = z.object({
  sortBy: z.enum(EXPENSE_LIST_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const parsedSort = expenseListSortQuerySchema.safeParse(req.query);
  if (!parsedSort.success) throwValidation(parsedSort.error);
  const filters = {
    truckId: req.query.truckId ? Number(req.query.truckId) : undefined,
    supplierId: req.query.supplierId ? Number(req.query.supplierId) : undefined,
    categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
    page,
    // Service param is `pageSize`; pagination parsing/clamping is shared.
    pageSize: limit,
    sortBy: parsedSort.data.sortBy,
    sortDir: parsedSort.data.sortDir,
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
  const idempotencyKey = requireIdempotencyKey(req);
  const validatedData = expenseSchema.parse(req.body);
  const actor = getUser(req);
  const reason = governanceReasonSchema.parse(req.body).reason;
  const input = { ...validatedData, amount: String(validatedData.amount) };
  // Dual-control: submission parks the expense as PENDING with NO ledger
  // entry — nothing posts until a checker and a different approver review.
  const { result, replayed } = await runIdempotent({
    endpoint: 'expenses.submit',
    idempotencyKey,
    payload: { reason, input },
    createdBy: actor.userId,
    create: async (tx) => {
      const { expense } = await submitExpense(tx, input, reason, actor.userId);
      return expense;
    },
  });
  await invalidateExpenseCreateReports(replayed);
  res.locals.auditEntityId = result.id;
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// KP-150: check/approve/reject endpoints removed — expenses post directly.

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const validatedData = expenseSchema.partial().parse(req.body);
  const userId = getUser(req).userId;
  const userRole = getUser(req).role;
  const id = Number(req.params.id);
  const idempotencyKey = requireIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(req);
  const { amount, ...rest } = validatedData;
  const serviceData: Partial<ExpenseUpdateInput> = {
    ...rest,
    ...(amount !== undefined ? { amount: String(amount) } : {}),
  };
  const existing = await getExpense(db, id);
  if (!existing) {
    return res.status(404).json({ error: 'Không tìm thấy khoản chi phí' });
  }
  if (existing.approvalStatus === 'PENDING' || existing.approvalStatus === 'CHECKED') {
    return res.status(409).json({ error: 'Chi phí đang chờ duyệt — hoàn tất kiểm tra/phê duyệt trước khi chỉnh sửa.' });
  }
  if (isGovernedCompanyExpenseMutation(existing, serviceData)) {
    const reason = governanceReasonSchema.parse(req.body).reason;
    const { result, replayed } = await runIdempotent({
      endpoint: 'expenses.governed-update',
      idempotencyKey,
      payload: {
        expenseId: id,
        reason,
        expectedUpdatedAt: expectedUpdatedAt.toISOString(),
        body: serviceData,
      },
      createdBy: userId,
      entityType: 'governance_action',
      create: (tx) => autoApplyGovernanceAction({
        make: (tx) => requestCompanyExpenseGovernance({
          expenseId: id,
          expectedUpdatedAt,
          reason,
          makerId: userId,
          makerRole: userRole,
          mutation: 'UPDATE',
          patch: serviceData,
          transaction: tx,
        }),
        actorId: userId,
        actorRole: userRole,
        transaction: tx,
      }),
    });
    await invalidateExpenseUpdateReports(replayed);
    res.locals.auditEntityId = result.id;
    return res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
  }
  const { result, replayed } = await runIdempotent({
    endpoint: 'expenses.update',
    idempotencyKey,
    payload: { id, body: serviceData, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: userId,
    entityType: 'EXPENSE',
    create: (tx) => updateExpense(tx, id, serviceData, expectedUpdatedAt, userId),
  });
  await invalidateExpenseUpdateReports(replayed);
  res.json(result);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUser(req).userId;
  const userRole = getUser(req).role;
  const id = Number(req.params.id);
  const idempotencyKey = requireIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(req);
  const governanceReason = governanceReasonSchema.safeParse(req.body ?? {});
  const existing = await getExpense(db, id);
  if (!existing) {
    if (governanceReason.success) {
      const { result, replayed } = await runIdempotent<Record<string, unknown>>({
        endpoint: 'expenses.governed-delete',
        idempotencyKey,
        payload: {
          expenseId: id,
          reason: governanceReason.data.reason,
          expectedUpdatedAt: expectedUpdatedAt.toISOString(),
        },
        createdBy: userId,
        entityType: 'governance_action',
        create: async () => {
          throw new ApiError(404, 'Không tìm thấy khoản chi phí');
        },
      });
      return res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
    }
    const { result } = await runIdempotent({
      endpoint: 'expenses.delete',
      idempotencyKey,
      payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: userId,
      entityType: 'EXPENSE',
      create: async () => {
        throw new ApiError(404, 'Không tìm thấy khoản chi phí');
      },
      getEntityId: (value) => value.id,
      serializeResult: () => ({ ok: true }),
      deserializeResult: () => ({ ok: true as const, id }),
    });
    return res.json({ ok: result.ok });
  }
  if (existing) {
    const reason = governanceReason.success
      ? governanceReason.data.reason
      : governanceReasonSchema.parse(req.body ?? {}).reason;
    const { result, replayed } = await runIdempotent({
      endpoint: 'expenses.governed-delete',
      idempotencyKey,
      payload: {
        expenseId: id,
        reason,
        expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      },
      createdBy: userId,
      entityType: 'governance_action',
      create: (tx) => autoApplyGovernanceAction({
        make: (tx) => requestCompanyExpenseGovernance({
          expenseId: id,
          expectedUpdatedAt,
          reason,
          makerId: userId,
          makerRole: userRole,
          mutation: 'DELETE',
          transaction: tx,
        }),
        actorId: userId,
        actorRole: userRole,
        transaction: tx,
      }),
    });
    await invalidateExpenseDeleteReports(replayed);
    res.locals.auditEntityId = result.id;
    return res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
  }
  throw new ApiError(404, 'Không tìm thấy khoản chi phí');
}));

// ── Expense receipt photos (B1) ─────────────────────────────────────────────
// Edit-mode flow: an expense must exist (have an id) before photos can attach —
// ExpenseEntryPage hides the upload zone until the row is saved, matching the
// expense_photos.expense_id FK. Keys live under expense-photos/<id>/ and are
// served by the shared /api/photos router (extended to allow these keys).

router.get('/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'ID không hợp lệ' });
  const rows = await getExpensePhotoList(id);
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
  const cleanupGuard = await acquireExpenseCleanupGuard({
    endpoint: IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
    idempotencyKey,
    dedupeKey: `expense-photo-orphan:${actorId}:${hashStorageKey(storageKey)}:${idempotencyKey}`,
    storageKey,
    entityId: id,
  });
  if (cleanupGuard) {
    try {
      await storageService.upload(processedBuffer, storageKey);
    } catch (error) {
      await releaseExpenseCleanupGuard(cleanupGuard, error, 'expenses.photo.create');
      throw error;
    }
  }
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
    () => runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
      idempotencyKey,
      payload: { expenseId: id, fileHash, mime },
      createdBy: actorId,
      entityType: 'EXPENSE_PHOTO',
      responseStatusCode: 201,
      create: async (tx) => {
        if (!cleanupGuard) {
          throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
        }
        // The external object key is deterministic from the transaction key.
        // If the process stops after upload but before DB commit, an exact retry
        // overwrites the same object and then commits one photo row.
        const expense = await getExpense(tx, id);
        if (!expense) throw new ApiError(404, 'Không tìm thấy khoản chi phí');
        const cancelled = await cancelStorageCleanupGuard(tx, cleanupGuard);
        if (!cancelled) {
          throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
        }
        const [created] = await tx.insert(s.expensePhotos).values({
          expenseId: id,
          storageKey,
          uploadedBy: actorId,
        }).returning({ id: s.expensePhotos.id, storageKey: s.expensePhotos.storageKey });
        return created;
      },
      onTransactionRollback: async (error) => {
        await releaseExpenseCleanupGuard(cleanupGuard, error, 'expenses.photo.create');
      },
    }),
  );

  res.status(outcome.statusCode).json({
    ...outcome.result,
    url: `/api/photos/${encodeURIComponent(outcome.result.storageKey)}`,
  });
}));

router.delete('/:id/photos/:photoId', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(photoId) || photoId <= 0) return res.status(400).json({ error: 'ID không hợp lệ' });
  const idempotencyKey = requireIdempotencyKey(req);
  const actorId = getUser(req).userId;
  await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_DELETE,
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
      await enqueueStorageDelete(tx, {
        dedupeKey: `expense-photo-final:${row.id}:${hashStorageKey(row.storageKey)}`,
        payload: {
          storageKey: row.storageKey,
          mode: STORAGE_DELETE_MODE.FINAL_DELETE,
          entityType: 'expense_photos',
          entityId: row.id,
        },
      });
      await tx.delete(s.expensePhotos)
        .where(and(eq(s.expensePhotos.id, photoId), eq(s.expensePhotos.expenseId, id)));
      return { ok: true as const, id: row.id, storageKey: row.storageKey };
    },
    getEntityId: (value) => value.id,
  });
  res.json({ ok: true });
}));

export default router;
