import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { geotagSchema, GEOTAG_ENTITY_TYPES } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { throwValidation } from '../lib/validation';
import { ApiError } from '../errors';
import { submitGeotag, getGeotag } from '../services/geotag.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { parseId } from './utils/parse-id';
import { runIdempotent } from '../services/idempotency.service';

const router = Router();

// Reuse the shared whitelist so the GET path param can't drift from the POST
// body enum. `as GeotagEntityType` would bypass validation; safeParse keeps a
// junk value from reaching the ownership query.
const entityTypeParam = z.enum(GEOTAG_ENTITY_TYPES);

/**
 * POST /api/geotag — record a phone GPS fix for a photo submission.
 * Body validated by geotagSchema (shared). Ownership resolved per entity type
 * inside submitGeotag; freshness gate on gpsAt. Idempotent upsert.
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = geotagSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc khi ghi nhận GPS.');
  }
  const { result: stored } = await runIdempotent({
    endpoint: 'geotag.submit',
    idempotencyKey,
    payload: parsed.data,
    createdBy: user.userId,
    entityType: 'PHOTO_GEOTAG',
    create: (tx) => submitGeotag(parsed.data, user, tx),
  });
  res.status(201).json(stored);
}));

/**
 * GET /api/geotag/:entityType/:entityId — read the geotag for a photo.
 * Same ownership gate as POST (404 rather than 403 on no-access).
 */
router.get('/:entityType/:entityId', asyncHandler(async (req: Request, res: Response) => {
  const typeParsed = entityTypeParam.safeParse(req.params.entityType);
  if (!typeParsed.success) throw new ApiError(400, 'Loại chứng từ không hợp lệ');
  const user = getUser(req);
  // Garbage ids are a client error: 400 with the field label, never a NaN
  // flowing into the ownership query (backend refactor §2.1).
  const entityId = parseId(req.params.entityId, 'ID chứng từ');
  const stored = await getGeotag(typeParsed.data, entityId, user);
  res.json(stored);
}));

export default router;
