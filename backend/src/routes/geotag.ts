import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { geotagSchema, GEOTAG_ENTITY_TYPES } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { throwValidation } from '../lib/validation';
import { ApiError } from '../errors';
import { submitGeotag, getGeotag } from '../services/geotag.service';

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
  const stored = await submitGeotag(parsed.data, user);
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
  const stored = await getGeotag(typeParsed.data, Number(req.params.entityId), user);
  res.json(stored);
}));

export default router;
