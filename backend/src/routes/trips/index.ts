/**
 * Trips routes — HTTP surface for the `trips` (chuyến đi) entity.
 *
 * Split into family leaves mounted on one router; the single mount point in
 * `src/index.ts` (`app.use('/api/trips', ...)`) keeps working because
 * `./routes/trips` resolves to this index. Leaves were cut in the old file's
 * registration order: static single-segment paths (`/summary`, `/stats`,
 * `/bulk-figures`, `/pairs`) live in the crud leaf and mount before any
 * `/:id` parametric route can shadow them.
 */
import { Router } from 'express';
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';
import crudRoutes from './crud';
import figuresRoutes from './figures';
import statusRoutes from './status';
import podRoutes from './pod';
import reassignmentRoutes from './reassignment';
import governanceRoutes from './governance';
import expensesRoutes from './expenses';
import containersRoutes from './containers';
import fuelRoutes from './fuel';

// Audit event registrations — declared once at module load, matched by middleware
registerAuditEvent('POST', '/api/trips', AuditEvent.TRIP_CREATED);
registerAuditEvent('POST', '/api/trips/', '/copy', AuditEvent.TRIP_CREATED);
registerAuditEvent('PUT', '/api/trips/', '/pre-departure', AuditEvent.TRIP_UPDATED_PRE_DEPARTURE);
registerAuditEvent('PUT', '/api/trips/', '/actuals', AuditEvent.TRIP_UPDATED_ACTUALS);
registerAuditEvent('POST', '/api/trips/bulk-figures', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/trips/', '/dispatch', AuditEvent.TRIP_DISPATCHED);
registerAuditEvent('POST', '/api/trips/', '/complete', AuditEvent.TRIP_COMPLETED);
registerAuditEvent('POST', '/api/trips/', '/cancel', AuditEvent.TRIP_CANCELED);
registerAuditEvent('POST', '/api/trips/', '/adjustment', AuditEvent.ADJUSTMENT_CREATED);
registerAuditEvent('POST', '/api/trips/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/trips/', '/unlock', AuditEvent.ENTITY_CREATED);
registerAuditEvent('PATCH', '/api/trips/', '/departure-date', AuditEvent.TRIP_DEPARTURE_DATE_CHANGED);

const router = Router();
router.use('/', crudRoutes);
router.use('/', figuresRoutes);
router.use('/', statusRoutes);
router.use('/', podRoutes);
router.use('/', reassignmentRoutes);
router.use('/', governanceRoutes);
router.use('/', expensesRoutes);
router.use('/', containersRoutes);
router.use('/', fuelRoutes);

export default router;
