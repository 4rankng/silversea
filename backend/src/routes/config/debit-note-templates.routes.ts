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
import type { Tx } from '../../services/trip-shared';
import * as s from '../../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { debitNoteTemplateSchema } from '@tingting/shared';
import { cacheInvalidate } from '../../lib/redis';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../../errors';
import { resolveIdempotencyKey, runIdempotent } from '../../services/idempotency.service';
import {
  registerGovernedCrudResource,
  requestGovernedCrudCreate,
  requestGovernedCrudDelete,
  requestGovernedCrudUpdate,
} from '../../services/price-config-governance.service';
import { listDebitNoteTemplates, getDebitNoteTemplateById } from '../../services/debit-note-template-reads.service';

const router = Router();
const COMMANDS = {
  CREATE: 'config.debit-note-templates.create',
  UPDATE: 'config.debit-note-templates.update',
  DELETE: 'config.debit-note-templates.delete',
} as const;

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

/** Clear every other active default of the same document type. */
async function clearOtherDefaults(tx: Tx, documentType: string): Promise<void> {
  await tx.update(s.debitNoteTemplates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(s.debitNoteTemplates.isDefault, true),
      eq(s.debitNoteTemplates.documentType, documentType),
      isNull(s.debitNoteTemplates.deletedAt),
    ));
}

registerGovernedCrudResource({
  resource: 'debit-note-templates',
  actionKind: 'PRICE_CONFIG_CHANGE',
  subjectType: 'PRICE_CONFIG',
  table: s.debitNoteTemplates,
  deleteMode: 'soft',
  reasonLabel: 'mẫu giấy báo nợ và thông tin phát hành chứng từ',
  beforeCreate: async (data, _req, tx) => {
    if (data.isDefault) {
      await clearOtherDefaults(tx, String(data.documentType));
    }
    return data;
  },
  afterCreate: async () => {
    await cacheInvalidate('catalogs:bootstrap');
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.isDefault) {
      await clearOtherDefaults(tx, String(data.documentType));
    }
    return data;
  },
  afterUpdate: async () => {
    await cacheInvalidate('catalogs:bootstrap');
  },
  afterDelete: async () => {
    await cacheInvalidate('catalogs:bootstrap');
  },
});

// GET / — list (search by name; default first, then by name)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, offset } = parsePagination(req);
  const { items, total } = await listDebitNoteTemplates({
    page,
    limit,
    offset,
    search: req.query.search as string | undefined,
    documentType: req.query.documentType as string | undefined,
  });
  res.json({ items, total, page, pageSize: limit });
}));

// GET /:id
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const row = await getDebitNoteTemplateById(id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json(row);
}));

// POST / — create (transactional single-default enforcement)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const data = debitNoteTemplateSchema.parse(req.body);
  const createdBy = getUser(req).userId;
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tạo mẫu giấy báo nợ.');
  const { result, replayed } = await runIdempotent({
    endpoint: COMMANDS.CREATE,
    idempotencyKey,
    payload: data,
    createdBy,
    entityType: 'debit-note-templates',
    responseStatusCode: 201,
    create: (tx) => requestGovernedCrudCreate({
      resource: 'debit-note-templates',
      data: { ...data, createdBy },
      makerId: createdBy,
      makerRole: getUser(req).role,
      transaction: tx,
    }),
  });
  res.status(201).json({ ...result, replayed });
}));

// PUT /:id — update (full form; transactional single-default enforcement)
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = debitNoteTemplateSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật mẫu giấy báo nợ.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản mẫu giấy báo nợ. Vui lòng tải lại trước khi cập nhật.',
  );
  const { result, replayed } = await runIdempotent({
    endpoint: COMMANDS.UPDATE,
    idempotencyKey,
    payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: req.user?.userId ?? null,
    entityType: 'debit-note-templates',
    create: (tx) => requestGovernedCrudUpdate({
      resource: 'debit-note-templates',
      id,
      data,
      makerId: getUser(req).userId,
      makerRole: getUser(req).role,
      expectedUpdatedAt,
      transaction: tx,
    }),
  });
  res.json({ ...result, replayed });
}));

// DELETE /:id — soft delete. Deleting the active default may leave zero defaults;
// the resolver then falls back to the legacy renderer until a new default is set.
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi xóa mẫu giấy báo nợ.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản mẫu giấy báo nợ. Vui lòng tải lại trước khi xóa.',
  );
  const { result, replayed } = await runIdempotent({
    endpoint: COMMANDS.DELETE,
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: req.user?.userId ?? null,
    entityType: 'debit-note-templates',
    create: (tx) => requestGovernedCrudDelete({
      resource: 'debit-note-templates',
      id,
      makerId: getUser(req).userId,
      makerRole: getUser(req).role,
      expectedUpdatedAt,
      transaction: tx,
    }),
  });
  res.json({ ...result, replayed });
}));

export default router;
