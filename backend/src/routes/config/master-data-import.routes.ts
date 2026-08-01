import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Role } from '@tingting/shared';

import { ApiError } from '../../errors';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { resolveIdempotencyKey } from '../../services/idempotency.service';
import {
  analyzeMasterWorkbook,
  applyMasterImport,
  getMasterImportBatch,
  MASTER_IMPORT_MAX_BYTES,
  rejectMasterImport,
} from '../../services/master-data-import.service';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MASTER_IMPORT_MAX_BYTES, files: 1 },
});

router.use(requireRoles(Role.ADMIN));

function receiveWorkbook(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error) => {
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
  if (!req.file) throw new ApiError(400, 'Tệp XLSX là bắt buộc.');
  const result = await analyzeMasterWorkbook(req.file, getUser(req));
  res.status(result.replayed ? 200 : 201).json(result);
});

// POST /analyze and /dry-run — upload and persist a redacted dry-run.
router.post('/analyze', receiveWorkbook, analyzeHandler);
router.post('/dry-run', receiveWorkbook, analyzeHandler);

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
