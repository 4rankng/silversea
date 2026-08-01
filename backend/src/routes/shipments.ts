// Shipment routes — Wave 0 HTTP surface for the `shipments` (lô hàng) entity.
//
// Exposes `shipment.service.ts` over REST at `/api/shipments`, mirroring the
// conventions used by `routes/trips.ts`:
//
//   - The mount in `index.ts` gates every method with `casbinAuthz('shipments')`,
//     so the role matrix is enforced before any handler runs:
//       ADMIN    → wildcard (everything)
//       MANAGER  → shipments read|write|delete  (added in this slice)
//       ACCOUNTANT → shipments read              (added in this slice)
//       CLERK    → shipments read|write          (existing Wave 0 rows)
//       CUSTOMER / DRIVER / FORWARDER → denied at the mount
//
//   - Mutating handlers additionally use `requireRoles` for an explicit
//     in-handler guard. This belt-and-suspenders pattern matches
//     `routes/trips.ts` (delete trip is ADMIN/MANAGER only even though trips
//     already sit behind casbinAuthz('trips')).
//
//   - Zod validation via the shared schemas (`createShipmentSchema`, …) so the
//     frontend can reuse the exact same schemas for client-side validation.
//
//   - Audit events are registered here and resolved by the audit middleware.
//
// All user-facing messages are Vietnamese (PRD Mxx-HT-01). Optimistic-lock
// conflicts surface as 409 via `ApiError` thrown from the service.

import { Router } from 'express';
import { Role } from '@tingting/shared';
import { z } from 'zod';
import {
  cancelShipmentFulfillmentSchema,
  createShipmentSchema,
  updateShipmentSchema,
  transitionShipmentStatusSchema,
  attachShipmentDocumentSchema,
  shipmentContainerBatchSchema,
  quickCreateShipmentSchema,
  submitShipmentForDispatchSchema,
} from '@tingting/shared';
import {
  createShipment,
  cancelShipmentFulfillment,
  createShipmentIdempotent,
  downloadShipmentPodFile,
  getShipment,
  getShipmentDetail,
  listShipmentsPaginated,
  reviewTripPodSubmission,
  updateShipment,
  transitionShipmentStatus,
  softDeleteShipment,
  batchUpsertShipmentContainers,
  attachShipmentDocument,
  upsertShipmentDeclaration,
  replaceShipmentDocument,
  reviewShipmentChangeRequest,
} from '../services/shipment.service';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { registerAuditEvent } from '../services/audit-registry';
import { AuditEvent } from '../services/audit-types';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { parsePagination } from './utils/pagination';
import { throwValidation } from '../lib/validation';
import { ApiError } from '../errors';
import { ShipmentStatus } from '@tingting/shared';
import {
  IDEMPOTENCY_ENDPOINTS,
  runIdempotent,
} from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import type { Tx } from '../services/trip-shared';
import {
  CUSTOMER_EVENT_TYPES,
  createCustomerVisibleEvent,
  listCustomerVisibleEvents,
} from '../services/shipment-coordination.service';
import {
  createHandoff,
  getActiveHandoffForShipment,
  markSeen,
  resolveHandoff,
} from '../services/dispatch-handoff.service';
import { listOperationalSitesForIntake, submitShipmentForDispatch } from '../services/shipment-intake.service';
import {
  acceptDispatchHandoff,
  issueFulfillmentDispatchOrder,
  listDispatchFleet,
  listDispatchHandoffs,
  listDispatchQueue,
} from '../services/dispatch-planning.service';
import { attachmentDisposition } from '../services/statement.service';

// Audit event registrations — matched by the audit middleware on every write.
// Suffix-mode registrations (prefix + suffix) cover all /:id sub-paths. The
// registry's "longest suffix wins" rule means a sub-path like `/containers`
// (length 11) beats the empty-suffix (length 0) registration for the path
// `/api/shipments/42/containers`, so the two PUT registrations below are
// orthogonal: empty-suffix handles `/api/shipments/42` (the basic update),
// `/containers` handles the container-batch upsert.
registerAuditEvent('POST', '/api/shipments', AuditEvent.SHIPMENT_CREATED);
registerAuditEvent('POST', '/api/shipments/', '/quick', AuditEvent.SHIPMENT_CREATED);
registerAuditEvent('POST', '/api/shipments/', '/dispatch', AuditEvent.SHIPMENT_DISPATCHED);
registerAuditEvent('POST', '/api/shipments/', '/submit-for-dispatch', AuditEvent.SHIPMENT_DISPATCHED);
registerAuditEvent('POST', '/api/shipments/', '/transition', AuditEvent.SHIPMENT_STATUS_CHANGED);
registerAuditEvent('POST', '/api/shipments/', '/documents', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('POST', '/api/shipments/', '/documents/', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('POST', '/api/shipments/', '/declarations', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '/declarations/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/pod-reviews/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/fulfillments/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/change-requests/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '/containers', AuditEvent.SHIPMENT_CONTAINERS_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('DELETE', '/api/shipments/', '', AuditEvent.SHIPMENT_DELETED);

const shipmentDeclarationSchema = z.object({
  declarationNumber: z.string().trim().max(50).optional().nullable(),
  issuedAt: z.string().trim().min(1).optional().nullable(),
  scope: z.enum(['SINGLE', 'SHARED']).optional(),
  note: z.string().trim().optional().nullable(),
});

const replaceShipmentDocumentSchema = z.object({
  expectedVersion: z.number().int().nonnegative('expectedVersion là bắt buộc để kiểm soát đồng thời'),
  storageKey: z.string().trim().min(1, 'storageKey là bắt buộc').max(255),
  expiresAt: z.string().trim().min(1).optional().nullable(),
});

const reviewShipmentChangeRequestSchema = z.object({
  resolution: z.enum(['APPLIED', 'REJECTED']),
});

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

const fulfillmentDispatchSchema = z.object({
  fulfillmentId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  plannedStartAt: z.string().trim().min(1),
  plannedEndAt: z.string().trim().min(1),
  endTimeConfirmed: z.boolean(),
  carrierType: z.enum(['OWN', 'EXTERNAL']),
  cargoTypeId: z.number().int().positive().optional().nullable(),
  truckId: z.number().int().positive().optional().nullable(),
  driverId: z.number().int().positive().optional().nullable(),
  trailerId: z.number().int().positive().optional().nullable(),
  containerTypeId: z.number().int().positive().optional().nullable(),
  externalCarrierId: z.number().int().positive().optional().nullable(),
  externalPlateNumber: z.string().trim().max(20).optional().nullable(),
  externalDriverName: z.string().trim().max(100).optional().nullable(),
  externalDriverPhone: z.string().trim().max(20).optional().nullable(),
});

const reviewTripPodSchema = z.object({
  expectedVersion: z.number().int().positive(),
  resolution: z.enum(['ACCEPT', 'REJECT']),
  rejectionReason: z.string().trim().max(2_000).optional().nullable(),
});

const router = Router();

interface ShipmentWriteEnvelope<T> {
  body: T;
  status: number;
  auditEntityId: number;
  auditEntityKey?: string;
}

async function runShipmentWrite<T>(
  req: Request,
  endpoint: string,
  payload: Record<string, unknown>,
  create: (tx: Tx) => Promise<ShipmentWriteEnvelope<T>>,
) {
  const user = getUser(req);
  return runIdempotent({
    endpoint,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: user.userId, ...payload },
    createdBy: user.userId,
    create,
    entityType: 'shipment-write',
    getEntityId: (result) => result.auditEntityId,
  });
}

function sendShipmentWrite<T>(
  res: Response,
  envelope: ShipmentWriteEnvelope<T>,
) {
  res.locals.auditEntityId = envelope.auditEntityId;
  if (envelope.auditEntityKey) res.locals.auditEntityKey = envelope.auditEntityKey;
  return res.status(envelope.status).json(envelope.body);
}

// Parse a non-negative integer id from the route. Returns -1 (and a 400 from
// the caller) on garbage input — never NaN. Centralised so every /:id handler
// is consistent with `routes/trips.ts`.
function parseId(req: Request, res: Response): number | null {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID lô hàng không hợp lệ' });
    return null;
  }
  return id;
}

function requireShipmentIdempotencyKey(req: Request, message: string): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) throw new ApiError(400, message);
  return key;
}

// ─── GET / — paginated list ────────────────────────────────────────────────
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const customerIdVal = (req.query.customerId || req.query.customer_id) as string | undefined;
  const statusVal = req.query.status as string | undefined;
  const q = typeof req.query.q === 'string' && req.query.q.trim().length > 0
    ? req.query.q.trim()
    : undefined;
  if (q && q.length > 100) {
    return res.status(400).json({ error: 'Từ khóa tìm kiếm không được vượt quá 100 ký tự' });
  }

  // Validate the status filter early — an invalid enum value would otherwise
  // silently return an empty list, hiding a client bug.
  let status: ShipmentStatus | undefined;
  if (statusVal !== undefined) {
    if (!Object.values(ShipmentStatus).includes(statusVal as ShipmentStatus)) {
      return res.status(400).json({ error: 'Trạng thái lô hàng không hợp lệ' });
    }
    status = statusVal as ShipmentStatus;
  }

  const result = await listShipmentsPaginated({
    page,
    limit,
    customerId: customerIdVal ? parseInt(customerIdVal, 10) : undefined,
    status,
    q,
    actor: getUser(req),
  });
  res.json(result);
}));

router.get(
  '/dispatch-handoffs',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string'
      ? req.query.status.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
    const urgency = typeof req.query.urgency === 'string' ? req.query.urgency : undefined;
    res.json(await listDispatchHandoffs({
      actor: getUser(req),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      status: status as Array<'UNSEEN' | 'SEEN'> | undefined,
      urgency: urgency as 'NORMAL' | 'URGENT' | undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    }));
  }),
);

router.get(
  '/dispatch-queue',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string'
      ? req.query.status.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
    const urgency = typeof req.query.urgency === 'string' ? req.query.urgency : undefined;
    res.json(await listDispatchQueue({
      actor: getUser(req),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      status: status as Array<'READY' | 'DISPATCHED'> | undefined,
      urgency: urgency as 'NORMAL' | 'URGENT' | undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    }));
  }),
);

router.get(
  '/dispatch-fleet',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listDispatchFleet({
      actor: getUser(req),
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    }));
  }),
);

router.get('/:id/customer-events', asyncHandler(async (req: Request, res: Response) => {
  const shipmentId = parseId(req, res);
  if (shipmentId === null) return;
  res.json({ items: await listCustomerVisibleEvents({ shipmentId, actor: getUser(req) }) });
}));

router.post(
  '/:id/submit-for-dispatch',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = submitShipmentForDispatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const outcome = await submitShipmentForDispatch({
      shipmentId,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: idempotencyKey ?? '',
      actor: getUser(req),
      priority: parsed.data.priority,
      vehicleNeededBy: parsed.data.vehicleNeededBy ? new Date(parsed.data.vehicleNeededBy) : null,
      operationalNote: parsed.data.operationalNote,
    });
    res.json({ ...outcome.result, replayed: outcome.replayed });
  }),
);

router.post(
  '/:id/customer-events',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
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

router.get('/:id/dispatch-handoff', asyncHandler(async (req: Request, res: Response) => {
  const shipmentId = parseId(req, res);
  if (shipmentId === null) return;
  await getShipmentDetail(shipmentId, getUser(req));
  res.json(await getActiveHandoffForShipment(shipmentId));
}));

router.post(
  '/:id/dispatch-handoffs',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
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

router.post(
  '/:id/dispatch-handoffs/:handoffId/resolve',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const handoffId = Number(req.params.handoffId);
    if (!Number.isInteger(handoffId) || handoffId <= 0) throw new ApiError(400, 'ID lệnh điều vận không hợp lệ');
    const parsed = resolveHandoffSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    await getShipmentDetail(shipmentId, actor);
    if (parsed.data.resolution === 'SEEN') {
      res.json(await markSeen(handoffId, {
        actorId: actor.userId,
        expectedVersion: parsed.data.expectedVersion,
        expectedShipmentId: shipmentId,
      }));
      return;
    }
    if (parsed.data.resolution === 'ACCEPTED') {
      res.json(await acceptDispatchHandoff({
        shipmentId,
        handoffId,
        expectedVersion: parsed.data.expectedVersion,
        actor: actor as typeof actor & { role: Role.ADMIN | Role.MANAGER },
      }));
      return;
    }
    res.json(await resolveHandoff(handoffId, parsed.data.resolution, actor.userId, parsed.data.expectedVersion, {
      rejectReason: parsed.data.rejectReason,
      expectedShipmentId: shipmentId,
    }));
  }),
);

router.get(
  '/operational-sites',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const customerId = Number(req.query.customerId);
    if (!Number.isInteger(customerId) || customerId < 1) {
      throw new ApiError(400, 'customerId không hợp lệ.');
    }
    res.json({ items: await listOperationalSitesForIntake(customerId, getUser(req)) });
  }),
);

// ─── POST / — create draft shipment ────────────────────────────────────────
router.post(
  '/',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CREATE,
      { data: parsed.data },
      async (tx) => {
        const shipment = await createShipment({
          ...parsed.data,
          cargoTypeId: parsed.data.cargoTypeId,
          createdBy: user.userId,
        }, user, tx);
        return {
          body: shipment,
          status: 201,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── POST /quick — M10.1 clerk mobile quick-create ──────────────────────────
//
// Same minimum data set as `POST /` (customerId required; all other fields
// optional), wrapped with server-side idempotency so a flaky-network
// resubmit returns the original shipment instead of creating a duplicate
// (PRD M10-01-03, Q23 proposal). The dedupe token is the `Idempotency-Key`
// header when present, otherwise the body `_requestId` (the offline-queue
// client lib prefers the body channel). A replay with a differing payload
// is rejected 409 — never silently overwritten.
//
// RBAC: same mount-level `casbinAuthz('shipments')` applies (CLERK has
// shipments read|write; ACCOUNTANT has read only → 403; CUSTOMER/DRIVER/
// FORWARDER denied at the mount). The explicit `requireRoles` guard is
// belt-and-suspenders, mirroring `POST /`.
router.post(
  '/quick',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = quickCreateShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    // Header wins; fall back to body channel for the offline-queue lib.
    const idempotencyKey =
      (req.header('Idempotency-Key') as string | undefined) ?? parsed.data._requestId;
    if (!idempotencyKey) {
      throw new ApiError(400, 'Idempotency-Key là bắt buộc khi tạo lệnh giao nhận nhanh.');
    }
    const { shipment, replayed } = await createShipmentIdempotent(
      {
        customerId: parsed.data.customerId,
        routeId: parsed.data.routeId,
        cargoTypeId: parsed.data.cargoTypeId,
        responsibleUnitId: parsed.data.responsibleUnitId,
        bookingRef: parsed.data.bookingRef,
        blNumber: parsed.data.blNumber,
        tradeDirection: parsed.data.tradeDirection,
        cargoMode: parsed.data.cargoMode,
        operationalSiteId: parsed.data.operationalSiteId,
        pickupWarehouseSiteId: parsed.data.pickupWarehouseSiteId,
        factoryName: parsed.data.factoryName,
        shippingLineName: parsed.data.shippingLineName,
        expectedDeliveryDate: parsed.data.expectedDeliveryDate,
        customsCutoffAt: parsed.data.customsCutoffAt,
        closingAt: parsed.data.closingAt,
        plannedReturnAt: parsed.data.plannedReturnAt,
        cargoWeightKg: parsed.data.cargoWeightKg,
        cargoVolumeCbm: parsed.data.cargoVolumeCbm,
        packageCount: parsed.data.packageCount,
        packageType: parsed.data.packageType,
        operationalNotes: parsed.data.operationalNotes,
        pickupLocation: parsed.data.pickupLocation,
        deliveryLocation: parsed.data.deliveryLocation,
        contactName: parsed.data.contactName,
        contactPhone: parsed.data.contactPhone,
        createdBy: getUser(req).userId,
      },
      idempotencyKey,
      getUser(req),
    );
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.status(replayed ? 200 : 201).json(shipment);
  }),
);

// ─── GET /:id — detail (shipment + containers + documents + declarations + history)
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === null) return;
  res.json(await getShipmentDetail(id, getUser(req)));
}));

router.get(
  '/:id/pod-files/:fileId',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const fileId = parseInt(req.params.fileId as string, 10);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      res.status(400).json({ error: 'ID tệp e-POD không hợp lệ' });
      return;
    }
    const file = await downloadShipmentPodFile(shipmentId, fileId, getUser(req));
    res.type(file.mimeType);
    res.setHeader('Content-Disposition', attachmentDisposition(file.originalFileName));
    res.send(file.buffer);
  }),
);

// ─── PUT /:id — update with optimistic-lock version ────────────────────────
router.put(
  '/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = updateShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_UPDATE,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const shipment = await updateShipment(id, {
          expectedVersion: parsed.data.expectedVersion,
          customerId: parsed.data.customerId,
          routeId: parsed.data.routeId,
          cargoTypeId: parsed.data.cargoTypeId,
          responsibleUnitId: parsed.data.responsibleUnitId,
          bookingRef: parsed.data.bookingRef,
          blNumber: parsed.data.blNumber,
          tradeDirection: parsed.data.tradeDirection,
          cargoMode: parsed.data.cargoMode,
          operationalSiteId: parsed.data.operationalSiteId,
          pickupWarehouseSiteId: parsed.data.pickupWarehouseSiteId,
          factoryName: parsed.data.factoryName,
          shippingLineName: parsed.data.shippingLineName,
          expectedDeliveryDate: parsed.data.expectedDeliveryDate,
          customsCutoffAt: parsed.data.customsCutoffAt,
          closingAt: parsed.data.closingAt,
          plannedReturnAt: parsed.data.plannedReturnAt,
          cargoWeightKg: parsed.data.cargoWeightKg,
          cargoVolumeCbm: parsed.data.cargoVolumeCbm,
          packageCount: parsed.data.packageCount,
          packageType: parsed.data.packageType,
          operationalNotes: parsed.data.operationalNotes,
          pickupLocation: parsed.data.pickupLocation,
          deliveryLocation: parsed.data.deliveryLocation,
          contactName: parsed.data.contactName,
          contactPhone: parsed.data.contactPhone,
          updatedBy: user.userId,
        }, user, tx);
        return {
          body: shipment,
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── POST /:id/transition — status transition ──────────────────────────────
router.post(
  '/:id/transition',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = transitionShipmentStatusSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_TRANSITION,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const shipment = await transitionShipmentStatus(id, parsed.data.status, {
          reason: parsed.data.reason ?? null,
          changedBy: user.userId,
        }, tx);
        return {
          body: shipment,
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── POST /:id/dispatch — fulfillment → linked trip ────────────────────────
router.post(
  '/:id/dispatch',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = fulfillmentDispatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const shipment = await getShipment(id);
    const outcome = await issueFulfillmentDispatchOrder({
      shipmentId: id,
      fulfillmentId: parsed.data.fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      plannedStartAt: parsed.data.plannedStartAt,
      plannedEndAt: parsed.data.plannedEndAt,
      endTimeConfirmed: parsed.data.endTimeConfirmed,
      carrierType: parsed.data.carrierType,
      cargoTypeId: parsed.data.cargoTypeId ?? null,
      truckId: parsed.data.truckId ?? null,
      driverId: parsed.data.driverId ?? null,
      trailerId: parsed.data.trailerId ?? null,
      containerTypeId: parsed.data.containerTypeId ?? null,
      externalCarrierId: parsed.data.externalCarrierId ?? null,
      externalPlateNumber: parsed.data.externalPlateNumber ?? null,
      externalDriverName: parsed.data.externalDriverName ?? null,
      externalDriverPhone: parsed.data.externalDriverPhone ?? null,
      idempotencyKey: getRequestIdempotencyKey(req) ?? '',
      actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER },
    });
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${id}`;
    res.status(outcome.replayed ? 200 : 201).json(outcome);
  }),
);

router.post(
  '/:id/pod-reviews/:submissionId/review',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const submissionId = parseInt(req.params.submissionId as string, 10);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      res.status(400).json({ error: 'ID e-POD không hợp lệ' });
      return;
    }
    const parsed = reviewTripPodSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const idempotencyKey = requireShipmentIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi duyệt e-POD.');
    const reviewed = await reviewTripPodSubmission({
      shipmentId,
      submissionId,
      expectedVersion: parsed.data.expectedVersion,
      resolution: parsed.data.resolution,
      rejectionReason: parsed.data.rejectionReason ?? null,
      idempotencyKey,
      actor,
    });
    res.locals.auditEntityId = reviewed.shipment.id;
    res.locals.auditEntityKey = reviewed.shipment.shipmentCode ?? `#${reviewed.shipment.id}`;
    res.json(reviewed);
  }),
);

router.post(
  '/:id/fulfillments/:fulfillmentId/cancellation-disposition',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
    if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
      res.status(400).json({ error: 'ID tác vụ không hợp lệ' });
      return;
    }
    const parsed = cancelShipmentFulfillmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const idempotencyKey = requireShipmentIdempotencyKey(
      req,
      'Idempotency-Key là bắt buộc khi xử lý tác vụ đã hủy.',
    );
    const updated = await cancelShipmentFulfillment({
      shipmentId,
      fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      disposition: parsed.data.disposition,
      reason: parsed.data.reason,
      actor,
      idempotencyKey,
    });
    res.locals.auditEntityId = updated.shipment.id;
    res.locals.auditEntityKey = updated.shipment.shipmentCode ?? `#${updated.shipment.id}`;
    res.json(updated);
  }),
);

// ─── POST /:id/documents — record an uploaded document's metadata ──────────
//
// The file bytes themselves are uploaded via `/api/upload`; this endpoint
// records the resulting `storageKey` against the shipment. A future Wave 2
// portal variant may accept multipart directly.
router.post(
  '/:id/documents',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = attachShipmentDocumentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DOCUMENT_ATTACH,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(id, tx);
        const doc = await attachShipmentDocument(id, {
          type: parsed.data.type,
          storageKey: parsed.data.storageKey,
          uploadedBy: user.userId,
        }, user, tx);
        return {
          body: doc,
          status: 201,
          auditEntityId: id,
          auditEntityKey: shipment.shipmentCode ?? `#${id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

router.post(
  '/:id/documents/:documentId/replace',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const documentId = parseInt(req.params.documentId as string, 10);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: 'ID tài liệu không hợp lệ' });
      return;
    }
    const parsed = replaceShipmentDocumentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DOCUMENT_REPLACE,
      { shipmentId, documentId, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(shipmentId, tx);
        const replaced = await replaceShipmentDocument(shipmentId, documentId, {
          expectedVersion: parsed.data.expectedVersion,
          storageKey: parsed.data.storageKey,
          expiresAt: parsed.data.expiresAt ?? null,
          uploadedBy: user.userId,
        }, user, tx);
        return {
          body: replaced,
          status: 201,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

router.post(
  '/:id/declarations',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentDeclarationSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DECLARATION_CREATE,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(shipmentId, tx);
        const declaration = await upsertShipmentDeclaration(shipmentId, {
          declarationNumber: parsed.data.declarationNumber ?? null,
          issuedAt: parsed.data.issuedAt ?? null,
          scope: parsed.data.scope,
          note: parsed.data.note ?? null,
          updatedBy: user.userId,
        }, user, tx);
        return {
          body: declaration,
          status: 201,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

router.put(
  '/:id/declarations/:declarationId',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const declarationId = parseInt(req.params.declarationId as string, 10);
    if (!Number.isInteger(declarationId) || declarationId <= 0) {
      res.status(400).json({ error: 'ID tờ khai không hợp lệ' });
      return;
    }
    const parsed = shipmentDeclarationSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DECLARATION_UPDATE,
      { shipmentId, declarationId, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(shipmentId, tx);
        const declaration = await upsertShipmentDeclaration(shipmentId, {
          id: declarationId,
          declarationNumber: parsed.data.declarationNumber ?? null,
          issuedAt: parsed.data.issuedAt ?? null,
          scope: parsed.data.scope,
          note: parsed.data.note ?? null,
          updatedBy: user.userId,
        }, user, tx);
        return {
          body: declaration,
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── GET /:id/containers — list shipment containers ────────────────────────
router.get('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === null) return;
  // 404 if the shipment itself is missing, rather than returning an empty
  // list that would mask the missing parent.
  const detail = await getShipmentDetail(id, getUser(req));
  res.json({ items: detail.containers });
}));

// ─── PUT /:id/containers — full reconcile of shipment containers ───────────
router.put(
  '/:id/containers',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = shipmentContainerBatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CONTAINERS_RECONCILE,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const reconciled = await batchUpsertShipmentContainers(
          id,
          user.userId,
          parsed.data.expectedVersion,
          parsed.data.containers,
          user,
          tx,
        );
        return {
          body: reconciled,
          status: 200,
          auditEntityId: id,
        };
      },
    );
    // Report both the reconciled ids (what the caller asked for) and the full
    // refreshed list (what the UI needs to re-render). Mirrors the trips
    // containers PUT response contract.
    sendShipmentWrite(res, result);
  }),
);

router.post(
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
          auditEntityKey: reviewed.shipment.shipmentCode ?? `#${reviewed.shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── DELETE /:id — soft-delete (DRAFT/CANCELED only, version-gated) ─────────
router.delete(
  '/:id',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    // version is required for the optimistic-lock check; accept it from either
    // the body (JSON DELETE) or the query string for clients that can't send
    // a DELETE body.
    const versionRaw = (req.body?.version ?? req.query.version) as unknown;
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 0) {
      return res.status(400).json({ error: 'version là bắt buộc để xóa lô hàng' });
    }
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE,
      { shipmentId: id, version },
      async (tx) => {
        const shipment = await softDeleteShipment(id, {
          version,
          deletedBy: user.userId,
        }, tx);
        return {
          body: { ok: true },
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? `#${shipment.id}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

export default router;
