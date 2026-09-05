import { Router } from 'express';
import type { Request, Response } from 'express';
import { pricingTableSchema } from '@tingting/shared';
import { ApiError } from '../../errors';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { parsePagination } from '../utils/pagination';
import {
  requestPricingTableCreate,
  requestPricingTableDelete,
  requestPricingTableUpdate,
} from '../../services/price-config-governance.service';
import { listPricingTablesPaginated, getPricingTableById } from '../../services/pricing.service';
import {
  buildCrudIdempotencyEndpoint,
  resolveIdempotencyKey,
  runIdempotent,
} from '../../services/idempotency.service';

const router = Router();

function parsePricingTableId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, 'ID không hợp lệ');
  }
  return id;
}

function requireReason(req: Request): string {
  if (typeof req.body?.reason !== 'string') {
    throw new ApiError(400, 'Lý do thay đổi bảng giá là bắt buộc');
  }
  const reason = req.body.reason.trim();
  if (!reason) {
    throw new ApiError(400, 'Lý do thay đổi bảng giá là bắt buộc');
  }
  return reason;
}

function requireExpectedVersion(req: Request): number {
  const expectedVersion = Number(req.body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  return expectedVersion;
}

function requestIdempotencyKey(req: Request): string | undefined {
  return resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: (req.body as Record<string, unknown> | undefined)?._requestId,
  });
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, offset } = parsePagination(req);
  const { items, total } = await listPricingTablesPaginated(page, limit, offset);
  res.json({ items, total, page, pageSize: limit });
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parsePricingTableId(req);
  const item = await getPricingTableById(id);
  if (!item) {
    return res.status(404).json({ error: 'Không tìm thấy' });
  }
  res.json(item);
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const data = pricingTableSchema.parse(req.body);
  const reason = requireReason(req);
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint: buildCrudIdempotencyEndpoint('pricing_tables', 'create'),
    idempotencyKey: requestIdempotencyKey(req),
    payload: { actorId: actor.userId, data, reason },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestPricingTableCreate({
      data,
      reason,
      makerId: actor.userId,
      makerRole: actor.role,
      transaction: tx,
    }),
    getEntityId: (outcome) => outcome.action.id,
  });
  res.locals.auditEntityId = result.action.id;
  res.locals.auditEntityKey = result.action.subjectKey;
  res.status(statusCode).json({ ...result.action, replayed });
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const pricingTableId = parsePricingTableId(req);
  const data = pricingTableSchema.partial().parse(req.body);
  const reason = requireReason(req);
  const expectedVersion = requireExpectedVersion(req);
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint: buildCrudIdempotencyEndpoint('pricing_tables', 'update'),
    idempotencyKey: requestIdempotencyKey(req),
    payload: { actorId: actor.userId, pricingTableId, data, reason, expectedVersion },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestPricingTableUpdate({
      pricingTableId,
      data,
      reason,
      makerId: actor.userId,
      makerRole: actor.role,
      expectedVersion,
      transaction: tx,
    }),
    getEntityId: (outcome) => outcome.action.id,
  });
  res.locals.auditEntityId = result.action.id;
  res.locals.auditEntityKey = result.action.subjectKey;
  res.status(statusCode).json({ ...result.action, replayed });
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const pricingTableId = parsePricingTableId(req);
  const reason = requireReason(req);
  const expectedVersion = requireExpectedVersion(req);
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint: buildCrudIdempotencyEndpoint('pricing_tables', 'delete'),
    idempotencyKey: requestIdempotencyKey(req),
    payload: { actorId: actor.userId, pricingTableId, reason, expectedVersion },
    createdBy: actor.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestPricingTableDelete({
      pricingTableId,
      reason,
      makerId: actor.userId,
      makerRole: actor.role,
      expectedVersion,
      transaction: tx,
    }),
    getEntityId: (outcome) => outcome.action.id,
  });
  res.locals.auditEntityId = result.action.id;
  res.locals.auditEntityKey = result.action.subjectKey;
  res.status(statusCode).json({ ...result.action, replayed });
}));

export default router;
