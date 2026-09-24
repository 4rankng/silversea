// Quotation CRUD routes (card 20260922_66). Mounted by routes/config.ts so
// the /api casbin 'config' gate applies to reads; writes additionally
// requireRoles to the financial trio (operator ruling 2026-09-22 e:
// ADMIN / MANAGER / ACCOUNTANT precedent). Idempotency-Key honored on writes
// per house standard.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Role, quotationCreateSchema, quotationUpdateSchema } from '@tingting/shared';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import multer from 'multer';
import { previewQuotationImport, commitQuotationImport } from '../../services/quotation-import.service';
import { buildQuotationExport } from '../../services/quotation-export.service';

const quotationImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import {
  createQuotation, decideQuotationFuelApprovals, deleteQuotation, getQuotation,
  listActiveQuotationFeesForCustomer, listQuotationFuelApprovals, listQuotations, updateQuotation,
} from '../../services/quotation.service';
import {
  getQuotationVersionPayload, listQuotationVersions, releaseQuotationVersion,
} from '../../services/quotation-version.service';

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

const router = Router();

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listQuotations());
}));

router.get('/fuel-approvals', asyncHandler(async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await listQuotationFuelApprovals(status));
}));

// Card _62: version history — list (all releases, newest first) and one
// frozen payload. Reads ride the config gate; releases are event-driven.
router.get('/:id/versions', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json(await listQuotationVersions(id, { from, to }));
}));

router.get('/:id/versions/:version', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const version = Number(req.params.version);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(version) || version < 1) {
    throw new ApiError(400, 'ID không hợp lệ');
  }
  res.json(await getQuotationVersionPayload(id, version));
}));

// NOTE: '/:id' param routes register AFTER the literal paths above so the
// list/version routes are never swallowed by an :id match.

// Card _64 Phase A — the customer's active-frame Chi-phí-khác catalog for
// lô-level intake (feeName/subType/defaultAmount/routing). Routing enum
// values travel opaque; display labels stay data-driven. Literal path,
// registered before '/:id'.
const activeFeesQuerySchema = z.object({ customerId: z.coerce.number().int().positive() });
router.get('/fees/active', asyncHandler(async (req: Request, res: Response) => {
  const parsed = activeFeesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, parsed.error.errors[0]?.message ?? 'customerId không hợp lệ');
  res.json({ items: await listActiveQuotationFeesForCustomer(parsed.data.customerId) });
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  res.json(await getQuotation(id));
}));

router.post('/', requireRoles(...WRITE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const parsed = quotationCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.errors[0]?.message ?? 'Dữ liệu báo giá không hợp lệ');
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: 'quotations.create',
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: actor.userId, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'quotation',
    create: (tx) => createQuotation(parsed.data, tx),
    getEntityId: (value) => value.id,
  });
  // Card _62: a fresh frame releases its birth version (v1).
  if (!replayed) {
    const view = await getQuotation(result.id);
    await releaseQuotationVersion(view, { triggerKind: 'MANUAL_EDIT', actorId: actor.userId });
  }
  res.status(replayed ? 200 : 201).json(result);
}));

router.put('/:id', requireRoles(...WRITE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  const parsed = quotationUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new ApiError(400, parsed.error.errors[0]?.message ?? 'Dữ liệu báo giá không hợp lệ');
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: 'quotations.update',
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: actor.userId, quotationId: id, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'quotation',
    getEntityId: () => id,
    create: (tx) => updateQuotation(id, parsed.data, tx).then(() => ({ id })),
  });
  // Card _62: a committed manual edit releases the new state as a version.
  if (!replayed) {
    const view = await getQuotation(id);
    await releaseQuotationVersion(view, { triggerKind: 'MANUAL_EDIT', actorId: actor.userId });
  }
  res.json(result);
}));

router.delete('/:id', requireRoles(...WRITE_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  const actor = getUser(req);
  await runIdempotent({
    endpoint: 'quotations.delete',
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: actor.userId, quotationId: id },
    createdBy: actor.userId,
    entityType: 'quotation',
    getEntityId: () => id,
    create: async (tx) => {
      await deleteQuotation(id, tx);
      return { id };
    },
  });
  res.json({ ok: true });
}));

// ─── Card 20260922_61: "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" (ruling 8) ──────────────
// ONE batch list for kế toán: select-all and per-row both ride the same
// decide endpoint; 'Để sau' makes no call (rows stay PENDING). Reads share
// the mount's casbin 'config' gate; decisions are finance-gated.

router.post('/fuel-approvals/decide', requireRoles(Role.ACCOUNTANT, Role.ADMIN), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const parsed = z.object({
    ids: z.array(z.number().int().positive()).min(1, 'Chưa chọn dòng nào.'),
    decision: z.enum(['AGREED', 'DECLINED']),
  }).parse(req.body ?? {});
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này.');
  const { result, replayed } = await runIdempotent({
    endpoint: 'quotation-fuel-approvals.decide',
    idempotencyKey,
    payload: { ids: parsed.ids, decision: parsed.decision, actorId: actor.userId },
    createdBy: actor.userId,
    entityType: 'quotation',
    create: (tx) => decideQuotationFuelApprovals(actor.userId, parsed.ids, parsed.decision, tx),
  });
  // Card _62: an AGREED fuel update releases a version of each affected
  // quotation (the new fuel-period watermark takes effect from this event).
  if (!replayed && parsed.decision === 'AGREED') {
    for (const row of (result as { updated: Array<{ quotationId: number }> }).updated) {
      const view = await getQuotation(row.quotationId);
      await releaseQuotationVersion(view, { triggerKind: 'FUEL_APPROVED', actorId: actor.userId });
    }
  }
  res.status(replayed ? 200 : 201).json(result);
}));

// ─── Card 20260922_57: báo giá xlsx import/export ─────────────────────────
// Preview never writes; commit is per-sheet transactional and ALWAYS creates
// a new quotation frame (ruling 6). Export round-trips the template layout.

router.post('/import', requireRoles(Role.ACCOUNTANT, Role.ADMIN), quotationImportUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(400, 'Chưa chọn tệp xlsx.');
  res.json(await previewQuotationImport(req.file.buffer));
}));

router.post('/import/commit', requireRoles(Role.ACCOUNTANT, Role.ADMIN), quotationImportUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  if (!req.file) throw new ApiError(400, 'Chưa chọn tệp xlsx.');
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này.');
  // The durable command boundary: the file buffer is the payload (not
  // hashed — the key distinguishes uploads), commitQuotationImport keeps
  // its own per-sheet transactions inside, and the idempotency row + audit
  // persist in the boundary transaction. A replay returns the stored
  // response instead of always creating a new quotation frame.
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.QUOTATION_IMPORT_COMMIT,
    idempotencyKey,
    payload: { userId: actor.userId },
    createdBy: actor.userId,
    responseStatusCode: 200,
    create: async () => ({ results: await commitQuotationImport(req.file!.buffer, actor.userId) }),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.get('/:id/export', requireRoles(Role.ACCOUNTANT, Role.ADMIN), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID không hợp lệ');
  const versionRaw = req.query.version;
  const version = versionRaw != null && String(versionRaw) !== '' ? Number(versionRaw) : undefined;
  const buffer = await buildQuotationExport(id, version);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao-gia-${id}.xlsx"`);
  res.end(Buffer.from(buffer));
}));

export default router;
