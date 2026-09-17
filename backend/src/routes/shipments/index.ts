// Shipment routes — HTTP surface for the `shipments` (lô hàng) entity.
//
// Split into resource leaves mounted on one router; the single mount point in
// `index.ts` stays `app.use('/api/shipments', authMiddleware,
// casbinAuthz('shipments'), shipmentRoutes)`, so importing this module is
// unchanged from the old single-file router.
//
// Leaf mount order preserves the old single-file registration order wherever
// route patterns overlap: the cus-workspace and dispatch-planning static
// segments (`/cus-workspace`, `/dispatch-handoffs`, …) must win over the core
// leaf's `GET /:id`, and `/cus-workspace/containers` must win over the
// documents leaf's `GET /:id/containers`.
//
//   - The mount gates every method with `casbinAuthz('shipments')`, so the
//     role matrix is enforced before any handler runs:
//       ADMIN    → wildcard (everything)
//       MANAGER  → shipments read|write|delete  (added in this slice)
//       ACCOUNTANT → shipments read|write for O2C review/close flows
//       CUS      → shipments read|write          (existing Wave 0 rows)
//       DISPATCHER → shipments read|write for the canonical intake workflow
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
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';
import { cusWorkspaceRoutes } from './cus-workspace.routes';
import { dispatchPlanningRoutes } from './dispatch-planning.routes';
import { coreRoutes } from './core.routes';
import { documentsRoutes } from './documents.routes';
import { podRoutes } from './pod.routes';
import { coordinationRoutes } from './coordination.routes';
import { financeRecordsRoutes } from './finance-records.routes';

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
registerAuditEvent('POST', '/api/shipments/', '/carrier-allocations', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/cus-workspace/', '/finance-confirmations', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/cus-workspace/', '/proposal-billing-links', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/cus-workspace/', '/containers/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/cus-workspace/', '/document-custody', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/cus-workspace/', '/lock', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/cus-workspace/', '/reopen-requests', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/recovery-facts', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/transition', AuditEvent.SHIPMENT_STATUS_CHANGED);
registerAuditEvent('POST', '/api/shipments/', '/complete', AuditEvent.SHIPMENT_STATUS_CHANGED);
registerAuditEvent('POST', '/api/shipments/', '/documents', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('POST', '/api/shipments/', '/documents/', AuditEvent.SHIPMENT_DOCUMENT_UPLOADED);
registerAuditEvent('POST', '/api/shipments/', '/declarations', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '/declarations/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/pod-reviews/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/fulfillments/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('POST', '/api/shipments/', '/change-requests/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '/containers', AuditEvent.SHIPMENT_CONTAINERS_UPDATED);
registerAuditEvent('PUT', '/api/shipments/', '', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('PATCH', '/api/shipments/', '/dispatch-detail-plan-rows/', AuditEvent.SHIPMENT_UPDATED);
registerAuditEvent('DELETE', '/api/shipments/', '', AuditEvent.SHIPMENT_DELETED);
// Master-data CRUD: creating a factory/warehouse from the intake form is an
// entity-level change, not a shipment-lifecycle event, so it uses ENTITY_*.
registerAuditEvent('POST', '/api/shipments/operational-sites', AuditEvent.ENTITY_CREATED);

const router = Router();

router.use(financeRecordsRoutes);
router.use(cusWorkspaceRoutes);
router.use(dispatchPlanningRoutes);
router.use(coreRoutes);
router.use(documentsRoutes);
router.use(podRoutes);
router.use(coordinationRoutes);

export default router;
