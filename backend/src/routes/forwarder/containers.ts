/**
 * Forwarder container creation + lift-pricing resolve. Handler bodies moved
 * verbatim from routes/forwarder.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as s from '../../db/schema';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Tx } from '../../services/trip-shared';
import { ApiError } from '../../errors';
import { throwValidation } from '../../lib/validation';
import { createTripContainerInClient } from '../../services/forwarder-container.service';
import { resolveLiftPrice } from '../../services/pricing.service';
import {
  assertForwarderMutableTripScope, listActiveSuppliersForForwarder,
} from '../../services/forwarder.service';
import { tripContainerSchema } from '@tingting/shared';
import {
  requireForwarderIdempotencyKey, FORWARDER_IDEMPOTENCY_ENDPOINTS,
  forwarderTripContainerSchema, isLiftExpenseType, resolveLiftPricingForWrite,

} from './forwarder-shared';
import {
  findIdempotencyRecord, runIdempotent, waitForIdempotencyRecord,
} from '../../services/idempotency.service';

const router = Router();

router.post('/trips/:tripId/containers', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = forwarderTripContainerSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.CONTAINER_CREATE,
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    responseStatusCode: 201,
    create: async (tx) => {
      await assertForwarderMutableTripScope(tripId, forwarder.id, tx);
      return createTripContainerInClient(tx, {
        ...parsed.data,
        tripId,
        containerTypeId: parsed.data.containerTypeId ?? null,
        sealNumber: parsed.data.sealNumber ?? null,
        notes: parsed.data.notes ?? null,
        createdBy: forwarder.id,
      });
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.get('/suppliers', asyncHandler(async (_req: Request, res: Response) => {
  const items = await listActiveSuppliersForForwarder();
  res.json({ items });
}));

const resolveLiftPriceQuerySchema = z.object({
  portId: z.coerce.number().int().positive(),
  containerTypeId: z.coerce.number().int().positive(),
  direction: z.enum(['LIFT_UP', 'LIFT_DOWN']),
  loadState: z.enum(['LOADED', 'EMPTY']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Ngày áp dụng không hợp lệ'),
});


router.get('/lift-pricing/resolve', asyncHandler(async (req: Request, res: Response) => {
  const parsed = resolveLiftPriceQuerySchema.safeParse(req.query);
  if (!parsed.success) throwValidation(parsed.error);
  const resolved = await resolveLiftPrice(parsed.data);
  res.json(resolved
    ? { ...resolved, source: 'MATRIX' as const }
    : { suggestedPrice: 0, liftPricingId: null, effectiveDate: null, source: 'MANUAL' as const });
}));


export default router;
