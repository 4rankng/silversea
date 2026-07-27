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
  createShipmentSchema,
  updateShipmentSchema,
  transitionShipmentStatusSchema,
  attachShipmentDocumentSchema,
  shipmentContainerBatchSchema,
  dispatchShipmentSchema,
  quickCreateShipmentSchema,
} from '@tingting/shared';
import {
  createShipment,
  createShipmentIdempotent,
  getShipment,
  getShipmentDetail,
  listShipmentsPaginated,
  updateShipment,
  transitionShipmentStatus,
  softDeleteShipment,
  batchUpsertShipmentContainers,
  attachShipmentDocument,
  upsertShipmentDeclaration,
  dispatchShipmentToTrip,
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
import { ShipmentStatus } from '@tingting/shared';

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
registerAuditEvent('POST', '/api/shipments/', '/transition', AuditEvent.SHIPMENT_STATUS_CHANGED);
registerAuditEvent('POST', '/api/shipments/', '/documents', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('POST', '/api/shipments/', '/documents/', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('POST', '/api/shipments/', '/declarations', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '/declarations/', AuditEvent.SHIPMENT_UPDATED);
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

const router = Router();

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

// ─── GET / — paginated list ────────────────────────────────────────────────
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const customerIdVal = (req.query.customerId || req.query.customer_id) as string | undefined;
  const statusVal = req.query.status as string | undefined;

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
    actor: getUser(req),
  });
  res.json(result);
}));

// ─── POST / — create draft shipment ────────────────────────────────────────
router.post(
  '/',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const shipment = await createShipment({
      ...parsed.data,
      createdBy: getUser(req).userId,
    }, getUser(req));
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.status(201).json(shipment);
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
    const { shipment, replayed } = await createShipmentIdempotent(
      {
        customerId: parsed.data.customerId,
        responsibleUnitId: parsed.data.responsibleUnitId,
        bookingRef: parsed.data.bookingRef,
        blNumber: parsed.data.blNumber,
        expectedDeliveryDate: parsed.data.expectedDeliveryDate,
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

// ─── PUT /:id — update with optimistic-lock version ────────────────────────
router.put(
  '/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = updateShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const shipment = await updateShipment(id, {
      expectedVersion: parsed.data.expectedVersion,
      customerId: parsed.data.customerId,
      responsibleUnitId: parsed.data.responsibleUnitId,
      bookingRef: parsed.data.bookingRef,
      blNumber: parsed.data.blNumber,
      expectedDeliveryDate: parsed.data.expectedDeliveryDate,
      pickupLocation: parsed.data.pickupLocation,
      deliveryLocation: parsed.data.deliveryLocation,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      updatedBy: getUser(req).userId,
    }, getUser(req));
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.json(shipment);
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
    const shipment = await transitionShipmentStatus(id, parsed.data.status, {
      reason: parsed.data.reason ?? null,
      changedBy: getUser(req).userId,
    });
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.json(shipment);
  }),
);

// ─── POST /:id/dispatch — shipment → linked trip ───────────────────────────
//
// Creates a trip linked to this shipment, snapshots the shipment's containers
// into the new trip, and moves the shipment to IN_PROGRESS. Idempotent: a
// second call for an already-dispatched shipment returns the existing trip.
router.post(
  '/:id/dispatch',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = dispatchShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    // Fetch the shipment up front for the audit entityKey. The audit row's
    // entityId is the SHIPMENT id (not the trip id), so its entityKey must
    // be the shipmentCode — otherwise the dispatch event is unsearchable by
    // shipment code. The new trip's code goes into the response body and the
    // audit metadata.path; it is not lost.
    const shipment = await getShipment(id);
    const result = await dispatchShipmentToTrip(
      id,
      parsed.data,
      { userId: user.userId, role: user.role },
    );
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${id}`;
    res.status(result.created ? 201 : 200).json(result);
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
    // Fetch the shipment first so a missing shipment 404s here AND we can
    // populate the audit log with a human-readable code (the doc row itself
    // does not carry the shipmentCode).
    const shipment = await getShipment(id);
    const doc = await attachShipmentDocument(id, {
      type: parsed.data.type,
      storageKey: parsed.data.storageKey,
      uploadedBy: getUser(req).userId,
    }, getUser(req));
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${id}`;
    res.status(201).json(doc);
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
    const shipment = await getShipment(shipmentId);
    const replaced = await replaceShipmentDocument(shipmentId, documentId, {
      expectedVersion: parsed.data.expectedVersion,
      storageKey: parsed.data.storageKey,
      expiresAt: parsed.data.expiresAt ?? null,
      uploadedBy: getUser(req).userId,
    }, getUser(req));
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.status(201).json(replaced);
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
    const shipment = await getShipment(shipmentId);
    const declaration = await upsertShipmentDeclaration(shipmentId, {
      declarationNumber: parsed.data.declarationNumber ?? null,
      issuedAt: parsed.data.issuedAt ?? null,
      scope: parsed.data.scope,
      note: parsed.data.note ?? null,
      updatedBy: getUser(req).userId,
    }, getUser(req));
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.status(201).json(declaration);
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
    const shipment = await getShipment(shipmentId);
    const declaration = await upsertShipmentDeclaration(shipmentId, {
      id: declarationId,
      declarationNumber: parsed.data.declarationNumber ?? null,
      issuedAt: parsed.data.issuedAt ?? null,
      scope: parsed.data.scope,
      note: parsed.data.note ?? null,
      updatedBy: getUser(req).userId,
    }, getUser(req));
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.json(declaration);
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
    const result = await batchUpsertShipmentContainers(
      id,
      getUser(req).userId,
      parsed.data.expectedVersion,
      parsed.data.containers,
      getUser(req),
    );
    res.locals.auditEntityId = id;
    // Report both the reconciled ids (what the caller asked for) and the full
    // refreshed list (what the UI needs to re-render). Mirrors the trips
    // containers PUT response contract.
    res.json(result);
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
    const result = await reviewShipmentChangeRequest(
      shipmentId,
      requestId,
      parsed.data.resolution,
      getUser(req),
    );
    res.locals.auditEntityId = result.shipment.id;
    res.locals.auditEntityKey = result.shipment.shipmentCode ?? `#${result.shipment.id}`;
    res.json(result);
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
    const shipment = await softDeleteShipment(id, {
      version,
      deletedBy: getUser(req).userId,
    });
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.json({ ok: true });
  }),
);

export default router;
