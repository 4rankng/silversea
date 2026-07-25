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
import {
  createShipmentSchema,
  updateShipmentSchema,
  transitionShipmentStatusSchema,
  attachShipmentDocumentSchema,
  shipmentContainerBatchSchema,
  dispatchShipmentSchema,
} from '@tingting/shared';
import {
  createShipment,
  getShipment,
  getShipmentDetail,
  listShipmentsPaginated,
  updateShipment,
  transitionShipmentStatus,
  softDeleteShipment,
  batchUpsertShipmentContainers,
  attachShipmentDocument,
  dispatchShipmentToTrip,
  listShipmentContainers,
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
registerAuditEvent('POST', '/api/shipments/', '/dispatch', AuditEvent.SHIPMENT_DISPATCHED);
registerAuditEvent('POST', '/api/shipments/', '/transition', AuditEvent.SHIPMENT_STATUS_CHANGED);
registerAuditEvent('POST', '/api/shipments/', '/documents', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('PUT', '/api/shipments/', '/containers', AuditEvent.SHIPMENT_CONTAINERS_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('DELETE', '/api/shipments/', '', AuditEvent.SHIPMENT_DELETED);

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
    });
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.status(201).json(shipment);
  }),
);

// ─── GET /:id — detail (shipment + containers + documents + declarations + history)
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === null) return;
  res.json(await getShipmentDetail(id));
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
      ...parsed.data,
      updatedBy: getUser(req).userId,
    });
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${shipment.id}`;
    res.json(shipment);
  }),
);

// ─── POST /:id/transition — status transition ──────────────────────────────
router.post(
  '/:id/transition',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CLERK),
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
    });
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? `#${id}`;
    res.status(201).json(doc);
  }),
);

// ─── GET /:id/containers — list shipment containers ────────────────────────
router.get('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === null) return;
  // 404 if the shipment itself is missing, rather than returning an empty
  // list that would mask the missing parent.
  await getShipment(id);
  res.json({ items: await listShipmentContainers(id) });
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
    const upsertedIds = await batchUpsertShipmentContainers(
      id,
      getUser(req).userId,
      parsed.data.containers,
    );
    const items = await listShipmentContainers(id);
    res.locals.auditEntityId = id;
    // Report both the reconciled ids (what the caller asked for) and the full
    // refreshed list (what the UI needs to re-render). Mirrors the trips
    // containers PUT response contract.
    res.json({ items, upsertedIds });
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
