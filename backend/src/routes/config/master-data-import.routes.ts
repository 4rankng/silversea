import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Role } from '@tingting/shared';

import { ApiError } from '../../errors';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { resolveIdempotencyKey } from '../../services/idempotency.service';
import { cacheInvalidate } from '../../lib/redis';
import {
  analyzeMasterWorkbook,
  applyMasterImport,
  getMasterImportBatch,
  MASTER_IMPORT_MAX_BYTES,
  mergeWorkbookFiles,
  rejectMasterImport,
} from '../../services/master-data-import.service';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MASTER_IMPORT_MAX_BYTES, files: 2 },
});

router.use(requireRoles(Role.ADMIN));

// The legacy single-file workbook uses field name 'file'; the Sep-2026
// delivery is two files ('dataForm' = Data form.xlsx, 'userRole' = User &
// Role.xlsx), uploaded together so cross-file joins (e.g. a driver's bank
// info keyed by driver code) resolve in one dry-run. Both are optional at
// the multer layer — the handler below requires at least one.
function receiveWorkbooks(req: Request, res: Response, next: NextFunction): void {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'dataForm', maxCount: 1 },
    { name: 'userRole', maxCount: 1 },
  ])(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new ApiError(413, 'Tệp XLSX không được vượt quá 15 MB.'));
      return;
    }
    if (error) {
      next(new ApiError(400, 'Không thể nhận tệp XLSX.'));
      return;
    }
    next();
  });
}

const analyzeHandler = asyncHandler(async (req: Request, res: Response) => {
  const filesByField = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const files = [...(filesByField.file ?? []), ...(filesByField.dataForm ?? []), ...(filesByField.userRole ?? [])];
  if (files.length === 0) throw new ApiError(400, 'Tệp XLSX là bắt buộc.');
  const merged = await mergeWorkbookFiles(files);
  const result = await analyzeMasterWorkbook(merged, getUser(req));
  res.status(result.replayed ? 200 : 201).json(result);
});

// POST /analyze and /dry-run — upload and persist a redacted dry-run.
router.post('/analyze', receiveWorkbooks, analyzeHandler);
router.post('/dry-run', receiveWorkbooks, analyzeHandler);

// GET /:id — persistent batch status and redacted row outcomes.
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const batchId = Number(req.params.id);
  res.json(await getMasterImportBatch(batchId, getUser(req)));
}));

// POST /:id/apply — explicitly apply accepted rows using optimistic locking.
router.post('/:id/apply', asyncHandler(async (req: Request, res: Response) => {
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  const outcome = await applyMasterImport({
    batchId: Number(req.params.id),
    expectedVersion: Number(req.body?.expectedVersion),
    idempotencyKey,
    actor: getUser(req),
  });
  // The import writes customers/trucks/trailers/drivers/routes — the same
  // tables the cached /catalogs/bootstrap blob serves. Bust it when rows
  // were actually applied so catalog dropdowns reflect the import without
  // waiting out the 60s TTL (2026-09-09 stale-dropdown bug class). Harmless
  // extra bust on an idempotent replay.
  const appliedAny = Object.values((outcome.result as { appliedCounts?: Record<string, number> }).appliedCounts ?? {})
    .some((count) => Number(count) > 0);
  if (outcome.statusCode === 200 && appliedAny) {
    await cacheInvalidate('catalogs:bootstrap');
  }
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

// POST /:id/reject — close a dry-run without applying any business row.
router.post('/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  const outcome = await rejectMasterImport({
    batchId: Number(req.params.id),
    expectedVersion: Number(req.body?.expectedVersion),
    reason: typeof req.body?.reason === 'string' ? req.body.reason : '',
    idempotencyKey,
    actor: getUser(req),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

export default router;
