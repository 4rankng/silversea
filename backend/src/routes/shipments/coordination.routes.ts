// Shipment coordination leaf — customer-visible events, dispatch handoffs,
// and change-request review.
//
// `/:id/customer-events` feed (portal-visible timeline), the
// `/:id/dispatch-handoff(s)` clerk→dispatcher handoff lifecycle, and the
// ADMIN/MANAGER decision on shipment change requests.

import { Router } from 'express';
import { Role } from '@tingting/shared';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { getShipmentDetail, reviewShipmentChangeRequest } from '../../services/shipment.service';
import {
  CUSTOMER_EVENT_TYPES,
  createCustomerVisibleEvent,
  listCustomerVisibleEvents,
} from '../../services/shipment-coordination.service';
import {
  createHandoff,
  getLatestHandoffForShipment,
  markSeen,
  resolveHandoff,
} from '../../services/dispatch-handoff.service';
import { acceptDispatchHandoff } from '../../services/dispatch-planning.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { ApiError } from '../../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { parseId, runShipmentWrite, sendShipmentWrite } from './shipment-shared';

const customerVisibleEventSchema = z.object({
  eventKey: z.string().trim().min(1).max(120),
  eventType: z.enum(CUSTOMER_EVENT_TYPES),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(1_000),
  occurredAt: z.string().datetime().optional(),
  supersedesEventId: z.number().int().positive().optional(),
});

const createHandoffSchema = z.object({
  handlerId: z.number().int().positive().optional().nullable(),
  priority: z.string().trim().min(1).max(20).optional(),
  vehicleNeededBy: z.string().datetime().optional().nullable(),
  operationalNote: z.string().trim().max(2_000).optional().nullable(),
});

const resolveHandoffSchema = z.object({
  resolution: z.enum(['SEEN', 'ACCEPTED', 'REJECTED']),
  expectedVersion: z.number().int().positive(),
  rejectReason: z.string().trim().min(1).max(1_000).optional().nullable(),
});

const reviewShipmentChangeRequestSchema = z.object({
  resolution: z.enum(['APPLIED', 'REJECTED']),
});

const coordinationRoutes = Router();

coordinationRoutes.get('/:id/customer-events', asyncHandler(async (req: Request, res: Response) => {
  const shipmentId = parseId(req, res);
  if (shipmentId === null) return;
  res.json({ items: await listCustomerVisibleEvents({ shipmentId, actor: getUser(req) }) });
}));

coordinationRoutes.post(
  '/:id/customer-events',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = customerVisibleEventSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const event = await createCustomerVisibleEvent({
      shipmentId,
      ...parsed.data,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
      createdBy: actor.userId,
    }, actor);
    res.status(201).json(event);
  }),
);

coordinationRoutes.get('/:id/dispatch-handoff', asyncHandler(async (req: Request, res: Response) => {
  const shipmentId = parseId(req, res);
  if (shipmentId === null) return;
  await getShipmentDetail(shipmentId, getUser(req));
  res.json(await getLatestHandoffForShipment(shipmentId));
}));

coordinationRoutes.post(
  '/:id/dispatch-handoffs',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = createHandoffSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const handoff = await createHandoff({
      shipmentId,
      ...parsed.data,
      vehicleNeededBy: parsed.data.vehicleNeededBy ? new Date(parsed.data.vehicleNeededBy) : null,
      createdBy: actor.userId,
      actor,
    });
    res.status(201).json(handoff);
  }),
);

coordinationRoutes.post(
  '/:id/dispatch-handoffs/:handoffId/resolve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const handoffId = Number(req.params.handoffId);
    if (!Number.isInteger(handoffId) || handoffId <= 0) throw new ApiError(400, 'ID lệnh điều vận không hợp lệ');
    const parsed = resolveHandoffSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    await getShipmentDetail(shipmentId, actor);

    // Idempotent resolve (P1#2 closed-loop fix 2026-08-28): replaying the
    // same Idempotency-Key returns the original result, so a network-retry
    // by the dispatcher never produces a duplicate fulfillment.
    const idempotencyKey = getRequestIdempotencyKey(req);
    if (!idempotencyKey) {
      throw new ApiError(
        400,
        'Idempotency-Key là bắt buộc cho thao tác giải quyết lệnh điều vận.',
      );
    }

    const resolution = parsed.data.resolution;
    const expectedVersion = parsed.data.expectedVersion;
    const rejectReason = parsed.data.rejectReason ?? null;
    const typedActor = actor as typeof actor & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER };

    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_HANDOFF_RESOLVE,
      idempotencyKey,
      payload: {
        shipmentId,
        handoffId,
        resolution,
        expectedVersion,
        rejectReason,
        actorId: actor.userId,
      },
      createdBy: actor.userId,
      entityType: 'dispatch_handoff',
      getEntityId: (r: { handoff?: { id: number } | null }) => r.handoff?.id ?? handoffId,
      create: async () => {
        if (resolution === 'SEEN') {
          return {
            handoff: await markSeen(handoffId, {
              actorId: actor.userId,
              expectedVersion,
              expectedShipmentId: shipmentId,
            }),
            fulfillments: [],
          };
        }
        if (resolution === 'ACCEPTED') {
          return await acceptDispatchHandoff({
            shipmentId,
            handoffId,
            expectedVersion,
            actor: typedActor,
          });
        }
        return {
          handoff: await resolveHandoff(handoffId, resolution, actor.userId, expectedVersion, {
            rejectReason,
            expectedShipmentId: shipmentId,
          }),
          fulfillments: [],
        };
      },
    });

    res.json({ ...result, replayed });
  }),
);

coordinationRoutes.post(
  '/:id/change-requests/:requestId/review',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const requestId = parseInt(req.params.requestId as string, 10);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      res.status(400).json({ error: 'ID yêu cầu thay đổi không hợp lệ' });
      return;
    }
    const parsed = reviewShipmentChangeRequestSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CHANGE_REQUEST_REVIEW,
      { shipmentId, requestId, data: parsed.data },
      async (tx) => {
        const reviewed = await reviewShipmentChangeRequest(
          shipmentId,
          requestId,
          parsed.data.resolution,
          user,
          tx,
        );
        return {
          body: reviewed,
          status: 200,
          auditEntityId: reviewed.shipment.id,
          auditEntityKey: reviewed.shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

export { coordinationRoutes };
